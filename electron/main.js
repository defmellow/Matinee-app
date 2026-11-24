// Electron main process: one window, the core running in a utility process (core-host.js), a poster cache behind matinee-img://.
// The UI only ever sees window.matinee (see preload.cjs); everything privileged stays here.
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, screen, session, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createImageCache } from './image-cache.js';
import { friendlyError } from './rpc.js';
import { createCoreClient } from './core-bridge.js';
import { createPageRenderer, cleanUserAgent } from './page-renderer.js';
import { zipExportFolder } from './export-folder.js';
import { SHARE_FILENAME } from '../core/share.js';
import { createUpdateController, manualUpdateKind } from './updater.js';
import { createElectronFetch } from './net-adapter.js';
import { createReporter, rollLog, moveOldLogs, parseConsoleMessage, LOG_NAME } from './problem-log.js';
import { formatLogLine, createRateGuard, shouldReloadAfter, isTheme, backgroundFor, overlayFor, nativeSourceFor, usesTitleOverlay, iconFileFor, appDirFor as appDirOf, macMenuTemplate } from './shell-util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const UI_INDEX = path.join(ROOT, 'dist', 'ui', 'index.html');
const APP_URL = pathToFileURL(UI_INDEX).href;
const samePath = p => (process.platform === 'win32' ? p.toLowerCase() : p);
const APP_PATH = samePath(new URL(APP_URL).pathname);
// Windows only: macOS and Linux keep the normal system title bar (nothing the page draws then needs room).
const OVERLAY = usesTitleOverlay();
const MIN = { width: 960, height: 640 };

// Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'matinee-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// MATINEE_USER_DATA lets tests (and curious people) run against a throwaway profile.
if (process.env.MATINEE_USER_DATA) app.setPath('userData', path.resolve(process.env.MATINEE_USER_DATA));

let win = null;
let client = null;
let renderer = null;
let updates = null; // the update controller (packaged builds only)
let quitState = 'running'; // running | closing | done
const crashGuard = createRateGuard({ max: 3, windowMs: 60_000 }); // window crashes we will recover from per minute

// ---------- small log file (a packaged app has no console) ----------
// Everything lives in one folder, userData/logs: matinee.log (this file) and the core's problems.json / problems.log.
let logFile = null;
let logsDir = null;
let logWriteFailed = false;
function log(...args) {
  const line = formatLogLine(args); // never throws, even on circular objects
  console.error(line.trimEnd());
  if (!logFile) return;
  try { fs.appendFileSync(logFile, line); } catch (e) {
    // Logging must never break the app, but a log that cannot be written is itself worth knowing about (once).
    if (!logWriteFailed) { logWriteFailed = true; console.error('Could not write the log file:', e); reporter.report({ area: 'App', message: "Matinee couldn't write to its log file.", error: e }); }
  }
}
// Passes problems to the core's list (Settings → Debug). Quiet by design: nothing is shown to the user.
const reporter = createReporter({ log: (...a) => log(...a) });
const report = p => reporter.report(p);
/** Log a failure (full detail) and pass it on to the core's problem list. `message` is plain English. */
function problem(area, message, error, level = 'error') {
  log(message, error);
  report({ area, message, error, level });
}
function openLog() {
  logsDir = path.join(app.getPath('userData'), 'logs');
  logFile = path.join(logsDir, LOG_NAME);
  // First start of the version with a logs folder: bring the old log files along.
  const moved = moveOldLogs({ fs, fromDir: app.getPath('userData'), logsDir, join: path.join });
  for (const f of moved.failed) problem('App', `Matinee couldn't move an old log file (${path.basename(String(f.name))}) into the logs folder.`, f.error, 'warning');
  const rolled = rollLog({ fs, file: logFile });
  if (rolled.error) problem('App', "Matinee couldn't tidy its log file.", rolled.error, 'warning');
}

// ---------- window position and size ----------
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  let s;
  try { s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) {
    if (!e || e.code !== 'ENOENT') problem('App', "Matinee couldn't read where the window was last time, so it opened in the usual place.", e, 'warning'); // no file yet is normal on a first run
    return { width: 1280, height: 820 };
  }
  const num = v => Number.isFinite(v);
  const out = {
    width: num(s.width) ? Math.max(MIN.width, Math.round(s.width)) : 1280,
    height: num(s.height) ? Math.max(MIN.height, Math.round(s.height)) : 820,
    maximized: s.maximized === true,
    zoom: Number.isFinite(s.zoom) ? Math.max(-3, Math.min(5, s.zoom)) : 0,
  };
  // Only restore the position if it's still on a connected screen (monitors get unplugged).
  if (num(s.x) && num(s.y)) {
    const onScreen = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return s.x + 100 < a.x + a.width && s.x + out.width - 100 > a.x && s.y >= a.y - 10 && s.y + 100 < a.y + a.height;
    });
    if (onScreen) { out.x = Math.round(s.x); out.y = Math.round(s.y); }
  }
  return out;
}

function saveWindowState(w) {
  if (!w || w.isDestroyed()) return;
  try {
    const b = w.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: w.isMaximized(), zoom: w.webContents.getZoomLevel() }));
  } catch (e) { problem('App', "Matinee couldn't remember the window position and size.", e, 'warning'); }
}

// ---------- links and navigation ----------
function openExternalSafe(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href);
  } catch (e) { log('Ignored a link that is not a web address:', String(url).slice(0, 200), e && e.message); }
}
// An unparseable address is simply "not the app page": that is the expected answer, not a failure.
const isAppUrl = url => { try { const u = new URL(url); return u.protocol === 'file:' && samePath(u.pathname) === APP_PATH; } catch { return false; } };

let appTheme = 'system'; // the in-app theme choice (the grey 'neutral' theme needs its own window and title bar colours)

// The window's icon (taskbar button, Alt+Tab): Matinee's one logo, the same in every theme, and the same ticket
// as build/icon.ico on the .exe and shortcuts. Windows takes the .ico (a picture per size, so it stays sharp); elsewhere the .png.
const windowIcon = path.join(here, 'icons', iconFileFor());

function createWindow() {
  const state = loadWindowState();
  const icon = windowIcon;
  win = new BrowserWindow({
    width: state.width, height: state.height, x: state.x, y: state.y,
    minWidth: MIN.width, minHeight: MIN.height,
    backgroundColor: backgroundFor(nativeTheme.shouldUseDarkColors, appTheme),
    // Our own top strip (see .titlebar in ui/styles/shell.css) with the system's minimise / maximise / close buttons drawn over it.
    // The overlay keeps snap layouts, double-click maximise and screen readers working. Not used on macOS.
    ...(OVERLAY ? { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(nativeTheme.shouldUseDarkColors, appTheme) } : {}),
    autoHideMenuBar: true,
    show: false,
    title: 'Matinee',
    ...(fs.existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      additionalArguments: OVERLAY ? ['--matinee-titlebar'] : [], // tells the page to draw the drag strip
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  const w = win;
  // Mouse back/forward buttons (Windows sends these as app commands), same as the buttons in the rail.
  w.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') w.webContents.executeJavaScript('history.back()').catch(e => log('Mouse back button failed:', e));
    else if (cmd === 'browser-forward') w.webContents.executeJavaScript('history.forward()').catch(e => log('Mouse forward button failed:', e));
  });
  // A Mac's three-finger swipe (when the trackpad is set to swipe between pages) goes back and forward too.
  w.on('swipe', (_e, dir) => {
    if (dir === 'right') w.webContents.executeJavaScript('history.back()').catch(e => log('Swipe back failed:', e));
    else if (dir === 'left') w.webContents.executeJavaScript('history.forward()').catch(e => log('Swipe forward failed:', e));
  });
  // Zoom like a web page: Ctrl + / Ctrl - / Ctrl 0 (the menu is removed, so the built-in shortcuts are gone) and Ctrl + wheel.
  const zoomBy = d => { const wc = w.webContents; wc.setZoomLevel(d === 0 ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + d))); later(); };
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (input.key === '+' || input.key === '=') { zoomBy(0.5); e.preventDefault(); }
    else if (input.key === '-' || input.key === '_') { zoomBy(-0.5); e.preventDefault(); }
    else if (input.key === '0') { zoomBy(0); e.preventDefault(); }
  });
  w.webContents.on('zoom-changed', (_e, dir) => zoomBy(dir === 'in' ? 0.5 : -0.5)); // Ctrl + wheel
  w.webContents.once('did-finish-load', () => { if (state.zoom) w.webContents.setZoomLevel(state.zoom); });
  w.once('ready-to-show', () => { if (state.maximized) w.maximize(); w.show(); });

  let timer = null;
  const later = () => { clearTimeout(timer); timer = setTimeout(() => saveWindowState(w), 500); };
  w.on('resize', later); w.on('move', later);
  w.on('close', () => { clearTimeout(timer); saveWindowState(w); });
  // The hidden page window would otherwise keep the app alive after the main window closes.
  w.on('closed', () => { if (win === w) { win = null; try { if (renderer) renderer.dispose(); } catch (e) { log('Could not close the page window:', e); } } });

  const wc = w.webContents;
  wc.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  // Never leave the app: a dropped file or a stray link must not replace the UI.
  wc.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); openExternalSafe(url); } });
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3) return log('Page load cancelled:', url); // -3 = the page was replaced by another load: normal
    problem('App', "A screen in Matinee didn't load.", `${code} ${desc} ${url}`);
  });
  wc.on('preload-error', (_e, preloadPath, error) => problem('App', "Part of Matinee's window setup failed to load.", error || preloadPath));
  wc.on('unresponsive', () => problem('App', 'The Matinee window stopped responding for a moment.', 'unresponsive', 'warning'));
  wc.on('responsive', () => log('The Matinee window is responding again.'));
  // The page's own errors (console.error in the UI) go to the log and the problem list; nothing is shown.
  wc.on('console-message', (...a) => {
    const m = parseConsoleMessage(a);
    if (m) problem('App', 'The Matinee window reported an error.', `${m.message}${m.where ? ' (' + m.where + ')' : ''}`);
  });
  wc.on('render-process-gone', (_e, d) => {
    problem('App', 'The Matinee window stopped unexpectedly.', `${d.reason} (exit code ${d.exitCode})`, shouldReloadAfter(d.reason) ? 'error' : 'warning');
    if (!shouldReloadAfter(d.reason) || w.isDestroyed()) return;
    if (crashGuard.allow()) { try { wc.reload(); } catch (e) { problem('App', "Matinee couldn't reload its window after it stopped.", e); } return; }
    problem('App', 'The Matinee window keeps stopping, so Matinee is closing.', d.reason);
    dialog.showErrorBox('Matinee', 'The Matinee window keeps stopping. Please close Matinee and open it again. If it keeps happening, restart your computer.');
    app.quit(); // not exit(): quitting lets the core save what was changed in the last few seconds
  });
  wc.once('did-finish-load', () => { if (client) client.call('autoRefresh', {}); }); // quietly top up if it's been a while

  w.loadURL(APP_URL);
}

// ---------- startup ----------
/** Settings → Clear cache: empty Chromium's caches for the app and the page window. Cookies and site storage stay, so passed site checks still count. */
async function clearBrowserCaches() {
  for (const s of [session.defaultSession, session.fromPartition('persist:matinee-web')]) {
    try { await s.clearCache(); } catch (e) { problem('App', "Matinee couldn't empty the browser cache.", e); }
    try { await s.clearCodeCaches({}); } catch (e) { log('Could not clear the browser code cache (optional):', e); }
    try { await s.clearStorageData({ storages: ['shadercache', 'cachestorage'] }); } catch (e) { log('Could not clear the browser storage caches (optional):', e); }
  }
}

/** What to count as "Matinee itself" in Settings → Storage: the portable .exe, or the install folder. Nothing in dev. */
function appDirFor() {
  return appDirOf({ platform: process.platform, env: process.env, exe: app.isPackaged ? app.getPath('exe') : '', packaged: app.isPackaged });
}

async function start() {
  openLog();
  if (process.platform === 'win32') app.setAppUserModelId('app.matinee.desktop');
  const dataDir = path.join(app.getPath('userData'), 'data');

  if (!fs.existsSync(UI_INDEX)) {
    dialog.showErrorBox('Matinee', "Matinee's files are incomplete. Please reinstall it.");
    return app.exit(1);
  }

  // Nothing in the window asks for camera, location and so on, so say no to all of it, except writing text to the clipboard:
  // the Copy buttons (problems, fetch log, Test fetch report) need it, and without it writeText failed with NotAllowedError (22 Nov).
  const allowed = perm => perm === 'clipboard-sanitized-write';
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed(perm));

  // Posters: matinee-img://cache/?u=<remote url>, served from disk when we have them.
  const images = createImageCache({ dir: path.join(app.getPath('userData'), 'image-cache'), log, report, fetch: createElectronFetch({ fetch: (u, o) => net.fetch(u, o), request: o => net.request(o), log, report }) }); // net.fetch cannot do manual redirects
  protocol.handle('matinee-img', async request => {
    try {
      const r = await images.handle(new URL(request.url).searchParams.get('u'));
      return new Response(r.body, { status: r.status, headers: r.headers });
    } catch (e) {
      problem('Pictures', "Matinee couldn't load a picture.", e);
      return new Response('Image error.', { status: 500 });
    }
  });

  // The real core runs in its own process so big library builds and saves never block the window. If one of its files is
  // broken we say so instead of showing a blank window.
  try {
    // Chromium's network stack: honours Windows proxy settings and certificates, which Node's fetch does not.
    // Pages that need a real browser load in a hidden Chromium window; it is only shown if a site asks the user to prove they are human.
    renderer = createPageRenderer({ BrowserWindow, session, log, report, showChallenge: w => { w.setTitle('Matinee — a website wants you to check you’re human'); w.center(); w.show(); try { if (process.platform === 'darwin') app.focus({ steal: true }); w.focus(); w.flashFrame(true); } catch (e) { log('Could not bring the website check window forward:', e); } } });
    // The core's plain page requests share this session with the page window (shared cookies, so a check the user has completed
    // there counts), with its user agent minus the Electron token.
    const webSession = session.fromPartition('persist:matinee-web');
    let webUA;
    try { webUA = cleanUserAgent(webSession.getUserAgent()) || undefined; } catch (e) { webUA = undefined; log('Could not read the browser user agent:', e); }
    client = createCoreClient({
      spawn: () => utilityProcess.fork(path.join(here, 'core-host.js'), [], { serviceName: 'matinee-core', partition: 'persist:matinee-web' }),
      init: { dataDir, logsDir, appDir: appDirFor(), browserUserAgent: webUA },
      render: (u, o) => renderer.render(u, o),
      cookies: domain => webSession.cookies.get({ domain }), // for Settings → Test fetch (cookie names only reach the report)
      onEvent: (event, payload) => { try { if (win && !win.isDestroyed()) win.webContents.send('matinee:event', event, payload); } catch (e) { log('Could not pass an event to the window:', event, e); } },
      log,
      report,
      onFatal: message => { dialog.showErrorBox('Matinee', message); app.exit(1); },
    });
    await client.start();
    reporter.attach(async p => { // everything reported so far (and from now on) goes into the core's problem list
      const raw = await client.call('reportProblem', p);
      const r = JSON.parse(raw);
      if (r && r.error) throw new Error(r.error.message || 'The core did not take the problem.');
    });
  } catch (e) {
    problem('App', 'Matinee could not start its library.', e);
    dialog.showErrorBox('Matinee could not start', e && e.stage === 'load' ? 'Part of Matinee is damaged. Please reinstall it.' : friendlyError(e));
    return app.exit(1);
  }

  ipcMain.handle('matinee:call', (event, method, args) => {
    const f = event.senderFrame;
    if (!f || !isAppUrl(f.url)) return { error: { message: 'Not allowed.', code: 'forbidden' } };
    if (method === 'clearCache') return clearBrowserCaches().then(() => client.call(method, args));
    return client.call(method, args); // a JSON string; the preload parses it
  });
  ipcMain.on('matinee:open-external', (event, url) => {
    const f = event.senderFrame;
    if (f && isAppUrl(f.url)) openExternalSafe(url);
  });

  // The in-app theme drives the native chrome (title bar, menus, dialogs) and the pre-paint window colour.
  nativeTheme.on('updated', () => {
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(backgroundFor(nativeTheme.shouldUseDarkColors, appTheme));
    if (OVERLAY) { try { win.setTitleBarOverlay(overlayFor(nativeTheme.shouldUseDarkColors, appTheme)); } catch (e) { log('Could not recolour the title bar:', e); } }
  });
  ipcMain.on('matinee:theme', (event, theme) => {
    const f = event.senderFrame;
    if (!f || !isAppUrl(f.url) || !isTheme(theme)) return;
    appTheme = theme;
    nativeTheme.themeSource = nativeSourceFor(theme);
    if (win && !win.isDestroyed()) { // 'updated' does not fire when only the grey/pink choice changes, so recolour here too
      win.setBackgroundColor(backgroundFor(nativeTheme.shouldUseDarkColors, appTheme));
      if (OVERLAY) { try { win.setTitleBarOverlay(overlayFor(nativeTheme.shouldUseDarkColors, appTheme)); } catch (e) { log('Could not recolour the title bar:', e); } }
    }
  });

  // A picture of a rectangle of the page, at twice the size so it stays sharp. The page asks for a rectangle taller than the
  // window (a long recap card), which capturePage cannot give, so ask Chromium to capture beyond the viewport; fall back to
  // capturePage (visible part only) if that is not possible.
  async function capturePng(wc, r) {
    const dbg = wc.debugger;
    let attached = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...r, scale: 2 } });
      return Buffer.from(shot.data, 'base64');
    } catch (e) {
      log('Full-size capture failed, using the visible part:', e);
      return (await wc.capturePage(r)).toPNG();
    } finally {
      if (attached) { try { dbg.detach(); } catch (e) { log('Could not detach the screenshot helper (already gone):', e); } }
    }
  }

  ipcMain.handle('matinee:saveImage', async (event, rect, suggestedName) => {
    const f = event.senderFrame;
    if (!f || !isAppUrl(f.url) || !win || win.isDestroyed()) return { saved: false };
    try {
      const num = v => Math.max(0, Math.round(Number(v) || 0));
      const r = { x: num(rect?.x), y: num(rect?.y), width: num(rect?.width), height: num(rect?.height) };
      if (!r.width || !r.height) return { saved: false };
      const png = await capturePng(win.webContents, r);
      const name = String(suggestedName || 'Matinee').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Matinee';
      // MATINEE_TEST_SAVE_PATH skips the dialog so tests can check the file without a person clicking.
      let target = process.env.MATINEE_TEST_SAVE_PATH;
      if (!target) {
        const pick = await dialog.showSaveDialog(win, {
          defaultPath: path.join(app.getPath('pictures'), name + '.png'),
          filters: [{ name: 'PNG image', extensions: ['png'] }],
        });
        if (pick.canceled || !pick.filePath) return { saved: false };
        target = pick.filePath;
      }
      await fs.promises.writeFile(target, png);
      return { saved: true, path: target };
    } catch (e) {
      problem('App', "Matinee couldn't save the picture.", e);
      return { saved: false };
    }
  });

  // ---------- updates (packaged builds; Windows installs and Linux AppImages update themselves, the rest show a Download button; releases are read from the public repo defmellow/matinee-app, no key) ----------
  const forbidden = event => { const f = event.senderFrame; return !f || !isAppUrl(f.url); };
  const OFF = { state: 'off' };
  ipcMain.handle('matinee:update-status', event => (forbidden(event) || !updates ? OFF : updates.status()));
  ipcMain.handle('matinee:update-install', async event => { if (!forbidden(event) && updates) await updates.install(); });
  ipcMain.handle('matinee:update-download', event => { if (!forbidden(event) && updates) updates.openDownload(); });
  ipcMain.handle('matinee:open-data-folder', event => (forbidden(event) ? undefined : shell.openPath(app.getPath('userData'))));
  // The logs folder (matinee.log, problems.log, problems.json). shell.openPath resolves '' when it worked, else a message.
  ipcMain.handle('matinee:logs-path', event => (forbidden(event) ? null : logsDir));
  ipcMain.handle('matinee:open-logs', async event => {
    if (forbidden(event)) return { ok: false, path: null, error: 'Not allowed.' };
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      const error = await shell.openPath(logsDir);
      if (error) { problem('App', "Matinee couldn't open its logs folder.", error, 'warning'); return { ok: false, path: logsDir, error }; }
      return { ok: true, path: logsDir };
    } catch (e) {
      problem('App', "Matinee couldn't open its logs folder.", e, 'warning');
      return { ok: false, path: logsDir, error: String((e && e.message) || e) };
    }
  });
  // "Share data for troubleshooting": the Documents folder to write into, and showing the finished file in Explorer.
  // The export picker. A Mac unzips downloads by itself, so there the picker takes the folder too (Windows and Linux pickers can't
  // offer files and folders at once, and their downloads stay zipped). A folder is packed into the ZIP the core reads.
  ipcMain.handle('matinee:pick-export', async event => {
    if (forbidden(event)) return null;
    const win = BrowserWindow.fromWebContents(event.sender);
    const mac = process.platform === 'darwin';
    const pick = await dialog.showOpenDialog(win, {
      title: 'Choose your Letterboxd export',
      properties: mac ? ['openFile', 'openDirectory'] : ['openFile'],
      filters: [{ name: 'Letterboxd export', extensions: ['zip'] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return null; // the picker was closed: nothing to report
    const chosen = pick.filePaths[0];
    try {
      if (fs.statSync(chosen).isDirectory()) return { bytes: zipExportFolder(chosen) };
      return { bytes: new Uint8Array(fs.readFileSync(chosen)) };
    } catch (e) {
      if (e && (e.code === 'bad-file' || /Letterboxd export/.test(e.message || ''))) return { error: e.message }; // not an export: the screen says so
      problem('Import', "Matinee couldn't read the chosen export.", e);
      return { error: "Matinee couldn't read that. Try dropping it here instead." };
    }
  });
  ipcMain.handle('matinee:documents-dir', event => { if (forbidden(event)) return null; try { return app.getPath('documents'); } catch (e) { log('Could not find the Documents folder:', e); return null; } });
  ipcMain.handle('matinee:reveal-share-file', (event, file) => {
    if (forbidden(event) || typeof file !== 'string' || path.basename(file) !== SHARE_FILENAME) return false; // the zip core/share.js writes (this said .json, so the file was never shown)
    shell.showItemInFolder(file); return true;
  });
  ipcMain.handle('matinee:update-check', event => (forbidden(event) || !updates ? OFF : updates.check()));
  ipcMain.handle('matinee:update-retry', event => (forbidden(event) || !updates ? OFF : updates.retry()));
  ipcMain.handle('matinee:update-set-channel', (event, name) => (forbidden(event) || !updates ? { ok: false, reason: 'off' } : updates.setChannel(name)));
  if (app.isPackaged && ['win32', 'darwin', 'linux'].includes(process.platform)) {
    try {
      const { default: pkg } = await import('electron-updater');
      // Windows installers, Linux AppImages: install by themselves. Mac (unsigned: Squirrel.Mac refuses), the .deb and the portable exe only check.
      const manual = manualUpdateKind();
      const updater = process.platform === 'win32' ? new pkg.NsisUpdater() : process.platform === 'darwin' ? new pkg.MacUpdater() : process.env.APPIMAGE ? new pkg.AppImageUpdater() : new pkg.DebUpdater();
      const memoFile = path.join(app.getPath('userData'), 'update.json');
      // Builds before 1.0 read a private repo with a saved key; releases are public now, so the old key file is removed.
      try { fs.rmSync(path.join(app.getPath('userData'), 'update-token.bin'), { force: true }); } catch (e) { report({ area: 'Updates', message: "Matinee couldn't remove the old update key file.", error: e, level: 'warning' }); }
      updates = createUpdateController({
        updater,
        portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
        manual,
        appImage: !!process.env.APPIMAGE,
        arch: process.arch,
        currentVersion: app.getVersion(),
        closeCore: shutdownForUpdate,
        openExternal: openExternalSafe,
        send: s => { if (win && !win.isDestroyed()) win.webContents.send('matinee:event', 'update', s); },
        readMemo: () => { try { return JSON.parse(fs.readFileSync(memoFile, 'utf8')); } catch (e) { if (!e || e.code !== 'ENOENT') log('Could not read the update note:', e); return null; } }, // no file = nothing to remember
        writeMemo: m => { if (m == null) fs.rmSync(memoFile, { force: true }); else fs.writeFileSync(memoFile, JSON.stringify(m)); },
        log,
        report,
        // A failed install leaves the core closed, so start fresh; the saved note then shows 'stalled' with a retry.
        onInstallStalled: () => { app.relaunch(); app.exit(0); },
      });
      updates.start();
    } catch (e) { problem('Updates', 'Automatic updates could not start.', e); updates = null; }
  }

  // Windows and Linux: no menu bar at all (Alt used to reveal one); copy and paste still work in text fields.
  // macOS always has a menu bar, and Cmd+C / V / A / Z only work in text fields when an Edit menu exists.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(macMenuTemplate(app.name)) : null);
  createWindow();
}

// Same close path as quitting, run before the installer starts: the library is saved and the core stopped, so the installer
// killing the app a moment later loses nothing. Leaves quitState 'done' so quitAndInstall's own quit goes straight through.
async function shutdownForUpdate() {
  if (quitState === 'done') return;
  quitState = 'closing';
  try { if (client) await client.close(); } catch (err) { problem('App', "Matinee couldn't close the library cleanly before updating.", err); }
  try { if (renderer) renderer.dispose(); } catch (err) { log('Could not close the page window:', err); }
  quitState = 'done';
}

// Quit waits for the core to save and stop (it lives in another process), then quits for real.
function beforeQuit(e) {
  if (quitState === 'done') return;
  e.preventDefault();
  if (quitState === 'closing') return;
  quitState = 'closing';
  if (updates) updates.noteQuit();
  (async () => {
    try { if (client) await client.close(); } catch (err) { problem('App', "Matinee couldn't close the library cleanly.", err); }
    try { if (renderer) renderer.dispose(); } catch (err) { log('Could not close the page window:', err); }
    quitState = 'done';
    app.quit();
  })();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', beforeQuit);
  app.on('child-process-gone', (_e, d) => problem('App', `A background part of Matinee (${d.name || d.type}) stopped unexpectedly.`, `${d.reason} (exit code ${d.exitCode})`, d.reason === 'clean-exit' || d.reason === 'killed' ? 'warning' : 'error'));
  app.whenReady().then(start).catch(e => { problem('App', 'Matinee could not start.', e); app.exit(1); });
}
// Nothing is ever swallowed: stray errors go to the log and the problem list, and the app carries on.
process.on('uncaughtException', e => problem('App', 'Matinee hit an unexpected error.', e));
process.on('unhandledRejection', e => problem('App', 'Matinee hit an unexpected error.', e));
