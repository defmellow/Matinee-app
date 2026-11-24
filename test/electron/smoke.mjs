// Launches the real Electron app (against a throwaway profile) and checks the bridge end to end.
//   npm run build:ui && xvfb-run -a node test/electron/smoke.mjs
// Env: PACKAGED=<path to Matinee.exe / unpacked binary> tests an installed build instead of the source tree.
//      SMOKE_SHOT=<png path> where the screenshot goes (default /tmp/matinee-smoke.png). PW=<playwright dir>.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { _electron } = createRequire(import.meta.url)(process.env.PW || '/opt/node22/lib/node_modules/playwright');
if (!process.env.PACKAGED && !fs.existsSync(path.join(root, 'dist', 'ui', 'index.html'))) {
  console.log('dist/ui is missing: building the UI first');
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
}
const shot = process.env.SMOKE_SHOT || '/tmp/matinee-smoke.png';

const results = [];
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}${detail ? ' - ' + detail : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  FAIL ${name}\n       ${String(e && e.message || e).split('\n').join('\n       ')}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-smoke-'));
// A real library makes the event-loop check meaningful (big builds and saves). Skipped when the dev data isn't there.
const devData = path.join(root, '.cache', 'devdata');
const haveDevData = !packaged_() && fs.existsSync(path.join(devData, 'library.json'));
if (haveDevData) fs.cpSync(devData, path.join(userData, 'data'), { recursive: true });
function packaged_() { return !!process.env.PACKAGED; }
const launchArgs = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []; // containers and CI lack the Chromium sandbox helper
const packaged = process.env.PACKAGED;
const app = await _electron.launch({
  ...(packaged ? { executablePath: packaged, args: launchArgs } : { executablePath: path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'), args: [root, ...launchArgs] }),
  env: { ...process.env, MATINEE_USER_DATA: userData },
  timeout: 60_000,
}).catch(e => { console.error('Could not launch Electron:', e.message); process.exit(2); });

const pageErrors = [];
let win;
try {
  console.log(`Matinee smoke test (${packaged ? 'packaged: ' + packaged : 'source tree'})`);
  win = await app.firstWindow({ timeout: 60_000 });
  win.on('pageerror', e => pageErrors.push(e.message));
  const consoleErrors = [];
  win.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await win.waitForLoadState('load', { timeout: 30_000 });

  await check('window opens with the Matinee title and the saved-size defaults', async () => {
    const t = await win.title();
    assert(/^(.+ - )?Matinee$/.test(t), `title was "${t}"`);
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ ...w.getBounds(), min: w.getMinimumSize() })));
    assert(b.length === 1, `expected one window, got ${b.length}`);
    assert(b[0].width === 1280 && b[0].height === 820, `unexpected size ${b[0].width}x${b[0].height}`);
    assert(b[0].min[0] === 960 && b[0].min[1] === 640, `unexpected minimum size ${b[0].min}`);
  });

  await check('renderer is isolated (no require/process) and window.matinee has the bridge', async () => {
    const r = await win.evaluate(() => ({
      require: typeof require, process: typeof process,
      bridge: typeof window.matinee, call: typeof window.matinee?.call, onEvent: typeof window.matinee?.onEvent, openExternal: typeof window.matinee?.openExternal,
      keys: Object.keys(window.matinee || {}).sort().join(','),
    }));
    assert(r.require === 'undefined' && r.process === 'undefined', `Node leaked into the page: ${JSON.stringify(r)}`);
    assert(r.bridge === 'object' && r.call === 'function' && r.onEvent === 'function' && r.openExternal === 'function', `bridge incomplete: ${JSON.stringify(r)}`);
    assert(r.keys === 'call,onEvent,openDataFolder,openExternal,saveImage,setTheme,updates', `unexpected bridge surface: ${r.keys}`);
  });

  await check('saveImage exists and writes a PNG (dialog skipped via MATINEE_TEST_SAVE_PATH)', async () => {
    const target = path.join(userData, 'saved-image.png');
    assert(await win.evaluate(() => typeof window.matinee.saveImage) === 'function', 'saveImage is not a function');
    await app.evaluate((_, t) => { process.env.MATINEE_TEST_SAVE_PATH = t; }, target);
    const r = await win.evaluate(() => window.matinee.saveImage({ x: 0, y: 0, width: 200, height: 120 }, 'Test'));
    await app.evaluate(() => { delete process.env.MATINEE_TEST_SAVE_PATH; });
    assert(r.saved && r.path === target, `got ${JSON.stringify(r)}`);
    const buf = fs.readFileSync(target);
    assert(buf.subarray(1, 4).toString() === 'PNG', 'file is not a PNG');
    return `${buf.length} bytes`;
  });

  await check('the UI mounted', async () => {
    await win.waitForSelector('#app > *', { timeout: 20_000 });
    const html = await win.evaluate(() => document.querySelector('#app').innerText.trim().slice(0, 80));
    return JSON.stringify(html);
  });

  await check("call('getState') resolves { result } from the real core", async () => {
    const r = await win.evaluate(() => window.matinee.call('getState'));
    assert(r && r.result && typeof r.result === 'object', `got ${JSON.stringify(r)?.slice(0, 300)}`);
    assert(r.result.counts && typeof r.result.counts.films === 'number', `getState has no counts: ${JSON.stringify(r.result).slice(0, 300)}`);
    return `films=${r.result.counts.films} ready=${r.result.ready}`;
  });

  await check('call() never rejects: unknown methods and bad input come back as { error }', async () => {
    const r = await win.evaluate(async () => ({
      unknown: await window.matinee.call('noSuchMethod'),
      noArgs: await window.matinee.call('getState', undefined),
      weird: await window.matinee.call(42, () => {}).catch(e => ({ rejected: String(e) })),
    }));
    assert(r.unknown.error && r.unknown.error.code === 'unknown-method' && typeof r.unknown.error.message === 'string', `unknown: ${JSON.stringify(r.unknown)}`);
    assert(r.noArgs.result, `noArgs: ${JSON.stringify(r.noArgs)}`);
    assert(!r.weird.rejected && r.weird.error, `weird input should give { error }: ${JSON.stringify(r.weird)}`);
  });

  await check('events reach the page (onEvent) and unsubscribe works', async () => {
    const r = await win.evaluate(async () => {
      const seen = [];
      const off = window.matinee.onEvent((event, payload) => seen.push([event, payload]));
      await window.matinee.call('setSettings', { region: 'AU' }); // emits 'state'
      await new Promise(res => setTimeout(res, 300));
      off();
      const n = seen.length;
      await window.matinee.call('setSettings', { region: 'AU' });
      await new Promise(res => setTimeout(res, 300));
      return { names: seen.map(s => s[0]), n, after: seen.length };
    });
    assert(r.names.includes('state'), `no 'state' event arrived: ${JSON.stringify(r)}`);
    assert(r.after === r.n, 'events kept arriving after unsubscribe');
    return r.names.join(',');
  });

  await check('manual redirects work through the Electron net adapter (301 + location, no "Redirect was cancelled")', async () => {
    const srv = http.createServer((_req, res) => { res.writeHead(301, { location: 'https://letterboxd.com/film/x/' }); res.end(); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${srv.address().port}/abc`;
      const adapter = path.join(root, 'electron', 'net-adapter.js');
      const r = await app.evaluate(async ({ net }, a) => {
        // import() isn't available inside evaluate; require() of a plain ES module works on this Node.
        const { createElectronFetch } = (typeof require === 'function' ? require : process.mainModule.require)(a.adapter);
        const f = createElectronFetch({ fetch: (u, o) => net.fetch(u, o), request: o => net.request(o) });
        const res = await f(a.url, { method: 'HEAD', redirect: 'manual' });
        return { status: res.status, location: res.headers.get('location') };
      }, { adapter, url });
      assert(r.status === 301 && r.location === 'https://letterboxd.com/film/x/', `got ${JSON.stringify(r)}`);
    } finally { srv.close(); }
  });

  await check('the main process stays responsive while the core works (event-loop delay < 50 ms)', async () => {
    if (!haveDevData) return 'skipped: .cache/devdata not present';
    await app.evaluate(() => {
      const h = process.getBuiltinModule('node:perf_hooks').monitorEventLoopDelay({ resolution: 10 });
      h.enable(); globalThis.__loopDelay = h;
    });
    await win.evaluate(async () => {
      await window.matinee.call('deleteView', { id: 'nope' });
      for (let i = 0; i < 30; i++) await window.matinee.call("getLibrary");
    });
    await win.waitForTimeout(300);
    const d = await app.evaluate(() => {
      const h = globalThis.__loopDelay; h.disable();
      return { maxMs: h.max / 1e6, p99Ms: h.percentile(99) / 1e6 };
    });
    const msg = `main max ${d.maxMs.toFixed(1)} ms, p99 ${d.p99Ms.toFixed(1)} ms`;
    assert(d.maxMs < 50, msg);
    return msg;
  });

  await check('a ZIP passed as Uint8Array arrives intact and is imported', async () => {
    let makeExport;
    try { ({ makeExport } = await import(pathToFileURL(path.join(root, 'test/fixtures/synthetic/export.js')).href)); }
    catch (e) { throw new Error('synthetic export fixture unavailable: ' + e.message); }
    const bytes = Array.from(makeExport({ replace: { 'profile.csv': null } })); // no profile = no username = no Letterboxd request
    const r = await win.evaluate(async arr => {
      const imported = await window.matinee.call('importExport', { bytes: Uint8Array.from(arr) });
      await window.matinee.call('cancel'); // enrichment would go to the network; stop it straight away
      const state = await window.matinee.call('getState');
      return { imported, state };
    }, bytes);
    assert(r.imported.result, `import failed: ${JSON.stringify(r.imported)}`);
    assert(r.state.result.counts.films > 0, `import reported success but the library is empty: ${JSON.stringify(r.state.result.counts)}`);
    return `films=${r.state.result.counts.films}`;
  });

  await check('matinee-img:// is registered and refuses hosts outside the allowlist', async () => {
    // The page's CSP only allows matinee-img: for <img>, so ask the main process's session directly.
    const r = await app.evaluate(async ({ session }) => {
      const res = await session.defaultSession.fetch('matinee-img://cache/?u=' + encodeURIComponent('https://example.com/poster.jpg'));
      return { status: res.status, text: await res.text() };
    });
    assert(r.status === 403, `expected 403, got ${r.status} ${r.text}`);
  });

  await check('navigating away (link, dropped file) is blocked; window.open goes to the browser, not a new window', async () => {
    const before = win.url();
    await win.evaluate(() => { location.href = 'https://example.com/'; });
    await win.waitForTimeout(500);
    await win.evaluate(() => { location.href = 'file:///etc/hostname'; });
    await win.waitForTimeout(500);
    assert(win.url() === before, `page navigated to ${win.url()}`);
    await win.evaluate(() => { window.open('about:blank'); });
    await win.waitForTimeout(300);
    // The hidden page-loading window may exist (a refresh started); only visible windows count.
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length);
    assert(visible === 1, `window.open created a visible window (${visible})`);
  });

  await check('the core runs in its own utility process (matinee-core)', async () => {
    const m = await app.evaluate(({ app: a }) => a.getAppMetrics().map(x => ({ type: x.type, name: x.name, serviceName: x.serviceName, pid: x.pid })));
    const u = m.find(x => x.type === 'Utility' && (x.name === 'matinee-core' || x.serviceName === 'matinee-core'));
    assert(u, `no matinee-core process in ${JSON.stringify(m)}`);
    return `pid ${u.pid}`;
  });

  await check('if the core process dies it is restarted: calls work again and a state event arrives', async () => {
    const pid = await app.evaluate(({ app: a }) => a.getAppMetrics().find(x => x.type === 'Utility' && (x.name === 'matinee-core' || x.serviceName === 'matinee-core'))?.pid);
    assert(pid, 'core process not found');
    await win.evaluate(() => { window.__states = 0; window.__off = window.matinee.onEvent(e => { if (e === 'state') window.__states++; }); });
    await app.evaluate((_, p) => { process.kill(p); }, pid);
    const t0 = Date.now();
    let r;
    for (;;) {
      r = await win.evaluate(() => window.matinee.call('getState'));
      if (r.result || Date.now() - t0 > 10_000) break;
      await win.waitForTimeout(200);
    }
    assert(r.result, `getState did not recover: ${JSON.stringify(r)}`);
    await win.waitForTimeout(300);
    const n = await win.evaluate(() => { window.__off(); return window.__states; });
    assert(n >= 1, 'no state event after the restart');
    return `recovered in ${Date.now() - t0} ms`;
  });

  await check('no page errors; no CSP violations in the console', async () => {
    const csp = consoleErrors.filter(m => /Content Security Policy|Refused to/i.test(m));
    assert(!pageErrors.length, 'page errors:\n' + pageErrors.join('\n'));
    assert(!csp.length, 'CSP:\n' + csp.join('\n'));
    const other = consoleErrors.filter(m => !csp.includes(m));
    return other.length ? `${other.length} other console error(s): ${other[0].slice(0, 120)}` : '';
  });

  await win.waitForTimeout(400); // let fonts and layout settle
  await win.screenshot({ path: shot });
  console.log(`  screenshot: ${shot}`);
} catch (e) {
  results.push({ name: 'run', ok: false });
  console.log('FAIL unexpected:', e && e.stack || e);
  try { if (win) await win.screenshot({ path: shot }); } catch { /* ignore */ }
}

// Closing the window should save its position and leave the data folder tidy.
let closeError = null;
// An edit made an instant before quitting must survive: the core flushes its debounced save when it is told to close.
try { await win.evaluate(() => window.matinee.call('setSettings', { region: 'NZ' })); } catch { /* the run already failed */ }
try { await app.close(); } catch (e) { closeError = e; }
await check('window position is saved on close', async () => {
  const f = path.join(userData, 'window.json');
  assert(fs.existsSync(f), 'userData/window.json was not written');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert(s.width >= 960 && s.height >= 640, `odd saved size ${JSON.stringify(s)}`);
});
await check('library is written under userData/data on close', async () => {
  assert(!closeError, 'app.close failed: ' + closeError);
  const f = path.join(userData, 'data', 'library.json');
  assert(fs.existsSync(f), 'userData/data/library.json missing');
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert(saved.settings && saved.settings.region === 'NZ', `the last edit was lost on quit (region=${saved.settings && saved.settings.region})`);
});
fs.rmSync(userData, { recursive: true, force: true });

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED` : `\nAll ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
