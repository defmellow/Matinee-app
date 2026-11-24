// Auto-update controller. No Electron or electron-updater imports: everything is injected so it is unit-tested with fakes.
// Releases live in the public repo defmellow/matinee-app and are read without any key.
//
// States: off | idle | downloading | ready | available-portable | stalled
// "available-portable" is the state for every copy that cannot install an update itself: the Windows portable exe, any Mac copy
// (unsigned apps cannot be updated in place) and the Linux .deb. They all show a Download button that opens the right file.

export const REPO = { owner: 'defmellow', repo: 'matinee-app' };
export const CHANNELS = ['main', 'experimental'];
export const RELEASES_URL = 'https://github.com/defmellow/matinee-app/releases/latest';

/**
 * Which kind of copy cannot update itself, if any: 'portable' (Windows portable exe), 'mac' (unsigned, so no in-place updates),
 * 'deb' (Linux package; the AppImage sets APPIMAGE and updates itself). Null for installed Windows copies and AppImages.
 */
export function manualUpdateKind({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_FILE ? 'portable' : null;
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return env.APPIMAGE ? null : 'deb';
  return null;
}

/** The release file to open for a version: the Windows installer, the .dmg for this Mac's chip, the .deb or the AppImage. Null when the version is not a plain release number. */
export function downloadFileFor(version, kind, arch = 'x64') {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(-exp\.[0-9]+)?$/.test(String(version))) return null;
  // The plain names in build/electron-builder.yml (since v0.58; earlier releases used Matinee-Setup-<v>.exe, -arm64.dmg, _amd64.deb).
  if (kind === 'mac') return `Matinee-${version}-${arch === 'arm64' ? 'Mac' : 'Mac-Intel'}.dmg`;
  if (kind === 'deb') return `Matinee-${version}-Linux.deb`;
  if (kind === 'appimage') return `Matinee-${version}-Linux.AppImage`;
  return `Matinee-${version}-Windows.exe`;
}

/** Compare dotted numeric versions: negative, 0 or positive. A pre-release (0.5.0-exp.3) ranks below its own stable (0.5.0). */
export function compareVersions(a, b) {
  const split = v => { const [core, ...pre] = String(v).split('-'); return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre: pre.join('-') }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const px = x.pre.split('.'), py = y.pre.split('.');
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const nx = Number(px[i]), ny = Number(py[i]);
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(px[i] || '').localeCompare(String(py[i] || ''));
    if (d) return d;
  }
  return 0;
}

/** GitHub says "slow down" with a 403 and rate-limit headers or wording; that is not a refused key. */
export function isRateLimitError(e) {
  if (!e) return false;
  const h = e.headers || {};
  const get = k => { const v = h[k] ?? h[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  if (String(get('x-ratelimit-remaining')) === '0' || get('retry-after') != null) return true;
  return /rate limit|abuse detection|secondary rate/i.test(`${e.message || ''}\n${e.stack || ''}`);
}

/**
 * @param {object} d injected dependencies
 *   updater      electron-updater's AppUpdater (or null: updates are off)
 *   portable, manual (null | "portable" | "mac" | "deb": cannot install itself), arch, currentVersion, closeCore(): Promise, openExternal(url), send(status), readMemo(): object|null, writeMemo(obj|null),
 *   log(...args), report({ area, message, error, level }) (optional: passes a problem to the app's problem list), setTimeout/setInterval/clearTimeout/clearInterval, firstCheckMs, everyMs, releasesUrl,
 *   installWatchMs (how long the app may stay alive after quitAndInstall before the install counts as failed), onInstallStalled() (recover: the app relaunches)
 */
/** Release notes as plain text for the Settings row: GitHub sends the release body, possibly as HTML or a list of {note}. */
export function cleanNotes(raw) {
  if (Array.isArray(raw)) raw = raw.map(r => (r && r.note) || '').join('\n');
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/<\/(p|li|h\d|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, 2000) : null;
}

export function createUpdateController(d) {
  const {
    updater = null, portable = false, manual: manualKind = null, appImage = false, arch = 'x64', currentVersion = '0.0.0',
    closeCore = async () => {}, openExternal = () => {}, send = () => {},
    readMemo = () => null, writeMemo = () => {}, log: rawLog = () => {}, report: rawReport = () => {},
    setTimeout: setT = globalThis.setTimeout, setInterval: setI = globalThis.setInterval,
    clearTimeout: clearT = globalThis.clearTimeout, clearInterval: clearI = globalThis.clearInterval,
    firstCheckMs = 3_000, everyMs = 4 * 3600_000, releasesUrl = RELEASES_URL, now = Date.now,
    installWatchMs = 15_000, onInstallStalled = () => {},
  } = d;

  const manual = manualKind || (portable ? 'portable' : null); // cannot install an update itself: shows the Download button instead
  const redact = v => {
    if (v instanceof Error) return v.stack || v.message;
    if (v && typeof v === 'object') { try { return JSON.stringify(v); } catch { return '[object]'; } }
    return v;
  };
  const log = (...a) => { try { rawLog(...a.map(redact)); } catch { /* logging must not break updates, and there is nowhere left to log the failure */ } };
  // Log it and pass it to the problem list. `message` is plain English; the technical text goes as the detail.
  const fail = (message, e, level = 'error') => {
    log(message, e);
    try { rawReport({ area: 'Updates', message, detail: String(redact(e instanceof Error ? (e.stack || e.message) : e == null ? '' : typeof e === 'string' ? e : e)).slice(0, 400), level }); } catch (x) { log('Could not report an update problem:', x); }
  };
  const push = () => { try { send(status()); } catch (e) { log('Could not pass the update status to the window:', e); } }; // the window may be gone

  let state = updater ? 'idle' : 'off';
  let next = null;
  let notes = null;
  let percent = null;
  let installing = false;
  let checking = false;
  let started = false;
  let firstTimer = null, repeatTimer = null, installTimer = null;
  let lastProgressAt = 0;
  let channel = 'main';
  let memoData = null; // the install memo part of the settings file: { version, triedAt }
  let lastCheckedAt = null;
  let checkFailed = false;
  let recheck = false;

  const status = () => ({
    state, current: currentVersion, next, notes, percent, portable: !!portable, manual, appImage: !!appImage,
    channel, lastCheckedAt, checking, checkFailed,
    releasesUrl: state === 'available-portable' || state === 'stalled' ? releasesUrl : undefined,
  });
  const set = (s, patch = {}) => {
    state = s;
    if ('next' in patch) next = patch.next;
    if ('notes' in patch) notes = patch.notes;
    if ('percent' in patch) percent = patch.percent; else if (s !== 'downloading') percent = null;
    push();
  };
  // One small file holds the install memo and the channel; nothing is written while both are at their defaults.
  const persist = () => {
    const out = { ...(memoData || {}) };
    if (channel !== 'main') out.channel = channel;
    try { writeMemo(Object.keys(out).length ? out : null); } catch (e) { fail("Matinee couldn't save a note about the update.", e); }
  };
  const writeSafe = m => { memoData = m; persist(); };
  // Experimental: electron-updater's GitHub provider looks through the releases and takes the newest pre-release.
  // Main: only /releases/latest (never a pre-release), and an older main build is allowed so the user can step back from an experimental one.
  const applyChannel = () => {
    updater.allowPrerelease = channel === 'experimental';
    updater.allowDowngrade = channel === 'main';
  };

  function feed() {
    return { provider: 'github', owner: REPO.owner, repo: REPO.repo, releaseType: 'release' };
  }

  function onAvailable(info) {
    const v = info && info.version;
    const n = cleanNotes(info && info.releaseNotes);
    if (state === 'stalled' && v === next) return;
    if (manual) return set('available-portable', { next: v, notes: n });
    if ((state === 'ready' || state === 'downloading') && v === next) return; // a repeat check must not restart the bar
    set('downloading', { next: v, notes: n, percent: 0 });
  }
  function onProgress(p) {
    const t = now();
    if (state !== 'downloading' || t - lastProgressAt < 1000) return;
    lastProgressAt = t;
    set('downloading', { percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))) });
  }
  function onDownloaded(info) {
    const v = (info && info.version) || next;
    if (state === 'stalled' && v === next) return;
    writeSafe({ version: v });
    set('ready', { next: v });
  }
  function onNotAvailable() {
    if (state === 'idle') set('idle', { next: null, notes: null });
  }
  function onError(e) {
    fail(installing && !checking ? 'The update could not be installed.' : "Matinee couldn't check for updates.", e, installing && !checking ? 'error' : 'warning');
    checkFailed = true;
    if (installing && !checking) return installFailed('the updater reported an error: ' + String((e && e.message) || e).slice(0, 300));
    if (state === 'downloading') set('idle', { next: null, notes: null }); // the download died: let Try again / Check now start afresh
  }

  /** Runs one check (never two at once). Resolves the status afterwards. */
  async function check() {
    if (!updater || checking || installing) return status(); // nothing is checked while an install is under way
    checking = true;
    checkFailed = false;
    push();
    try {
      applyChannel();
      updater.setFeedURL(feed());
      await updater.checkForUpdates();
    } catch (e) { onError(e); } finally {
      checking = false;
      lastCheckedAt = now();
    }
    if (recheck) { recheck = false; return check(); }
    push();
    return status();
  }

  /** Returns { ok: true } or { ok: false, reason: 'invalid' | 'off' }. Saves the choice and checks straight away. */
  function setChannel(name) {
    if (!updater) return { ok: false, reason: 'off' };
    if (!CHANNELS.includes(name)) return { ok: false, reason: 'invalid' };
    if (name !== channel) {
      channel = name;
      persist();
      applyChannel();
      if (state === 'available-portable') { state = 'idle'; next = null; notes = null; }
    }
    if (checking) recheck = true; else check();
    push();
    return { ok: true };
  }

  function start() {
    if (!updater || started) return;
    started = true;
    updater.autoDownload = !manual;
    updater.autoInstallOnAppQuit = !manual;
    updater.logger = { info: (...a) => log(...a), warn: (...a) => log(...a), error: (...a) => log(...a), debug: () => {} };
    updater.on('update-available', onAvailable);
    updater.on('download-progress', onProgress);
    updater.on('update-downloaded', onDownloaded);
    updater.on('update-not-available', onNotAvailable);
    updater.on('error', onError);

    let memo = null;
    try { memo = readMemo(); } catch (e) { memo = null; log('Could not read the update note:', e); }
    if (memo && CHANNELS.includes(memo.channel)) channel = memo.channel;
    applyChannel();
    if (memo && memo.version) {
      if (compareVersions(currentVersion, memo.version) >= 0) writeSafe(null);
      else {
        memoData = { version: memo.version, ...(memo.triedAt ? { triedAt: memo.triedAt } : {}) };
        if (memo.triedAt) { state = 'stalled'; next = memo.version; }
      }
    }
    push();

    firstTimer = setT(() => { firstTimer = null; check(); }, firstCheckMs);
    repeatTimer = setI(() => { check(); }, everyMs);
  }

  async function install() {
    if (!updater || manual || state !== 'ready' || installing) return;
    installing = true;
    if (firstTimer) { clearT(firstTimer); firstTimer = null; }
    if (repeatTimer) { clearI(repeatTimer); repeatTimer = null; }
    writeSafe({ version: next, triedAt: new Date().toISOString() });
    let file = null;
    try { file = updater.installerPath || null; } catch (e) { file = null; log('Could not read the installer path:', e); }
    log(`Starting the update: ${currentVersion} -> ${next}, installer ${file || 'unknown'}, silent, run after install`);
    try {
      await closeCore(); // the library is saved and the core stopped before the installer can kill the app
      if (!installing) return; // something stalled it while the core was closing
      updater.quitAndInstall(true, true);
      // If the installer started, the app quits within a moment. Still here after installWatchMs means it did not
      // (nothing to install, a blocked or failed installer): the core is already closed, so restart instead of sitting dead.
      if (installing) installTimer = setT(() => { installTimer = null; installFailed(`the app was still running ${installWatchMs / 1000} s after the installer was started`); }, installWatchMs);
    } catch (e) {
      fail("Matinee couldn't start the update installer.", e);
      installFailed('quitAndInstall threw');
    }
  }

  // The install did not take over. The memo (version + triedAt) is already written, so after the restart Settings shows
  // 'stalled' with Try again / Get the installer.
  function installFailed(why) {
    if (!installing) return;
    installing = false;
    if (installTimer) { clearT(installTimer); installTimer = null; }
    fail(`The update to ${next} did not install, so Matinee is restarting.`, why);
    set('stalled', {});
    try { onInstallStalled(); } catch (e) { fail("Matinee couldn't restart after the update failed.", e); }
  }

  // The installer for the version we know about, straight from the release ;
  // the releases page when no version is known.
  const fileKind = manual || (appImage ? 'appimage' : null); // an AppImage installs itself, but a stalled one downloads the AppImage, not the .exe
  const installerUrl = () => { const f = next && downloadFileFor(next, fileKind, arch); return f ? `https://github.com/${REPO.owner}/${REPO.repo}/releases/download/v${next}/${f}` : releasesUrl; };
  function openDownload() { openExternal(installerUrl()); }

  /** After a failed install: forget the failed attempt and look again, which downloads and offers the update afresh. */
  async function retry() {
    if (!updater || manual) return status();
    if (state === 'stalled') { installing = false; writeSafe(null); next = null; notes = null; state = 'idle'; }
    return check();
  }

  function noteQuit() {
    if (!updater || manual || state !== 'ready') return;
    writeSafe({ version: next, triedAt: new Date().toISOString() });
  }

  function dispose() {
    if (firstTimer) clearT(firstTimer);
    if (installTimer) clearT(installTimer);
    if (repeatTimer) clearI(repeatTimer);
    firstTimer = repeatTimer = installTimer = null;
  }

  return { start, status, install, openDownload, noteQuit, dispose, check, setChannel, retry };
}

