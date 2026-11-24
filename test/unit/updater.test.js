import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdateController, compareVersions, cleanNotes, manualUpdateKind, downloadFileFor } from '../../electron/updater.js';

function fakeUpdater(over = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => { u.calls.push('check'); if (u.checkError) throw u.checkError; };
  u.setFeedURL = o => { u.calls.push('feed'); u.feed = o; };
  u.quitAndInstall = (...a) => { u.calls.push('quit:' + a.join(',')); };
  return Object.assign(u, over);
}
function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms, cleared: false }; t.timeouts.push(h); return h; };
  t.setInterval = (fn, ms) => { const h = { fn, ms, cleared: false }; t.intervals.push(h); return h; };
  t.clearTimeout = h => { h.cleared = true; };
  t.clearInterval = h => { h.cleared = true; };
  return t;
}
function make(over = {}) {
  const timers = fakeTimers();
  const logs = [], sent = [], opened = [];
  let memo = over.memo || null;
  const updater = 'updater' in over ? over.updater : fakeUpdater();
  const c = createUpdateController({
    updater, portable: false, currentVersion: '0.1.5',
    closeCore: async () => {}, openExternal: u => opened.push(u),
    send: s => sent.push(s), readMemo: () => memo, writeMemo: m => { memo = m; },
    log: (...a) => logs.push(a.join(' ')), now: () => over.clock ? over.clock.t : Date.now(),
    ...timers, ...over.deps,
  });
  return { c, updater, timers, logs, sent, opened, memo: () => memo };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('null updater: off, nothing scheduled, nothing happens', () => {
  const { c, timers } = make({ updater: null });
  c.start();
  assert.equal(c.status().state, 'off');
  assert.equal(timers.timeouts.length + timers.intervals.length, 0);
});

test('first check after the delay, then repeats; settings applied', async () => {
  const { c, updater, timers } = make();
  c.start();
  assert.equal(timers.timeouts[0].ms, 3_000);
  assert.equal(timers.intervals[0].ms, 4 * 3600_000);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, true); // main may step back from an experimental build
  timers.timeouts[0].fn(); await tick();
  timers.intervals[0].fn(); await tick();
  assert.deepEqual(updater.calls, ['feed', 'check', 'feed', 'check']);
  assert.deepEqual(updater.feed, { provider: 'github', owner: 'defmellow', repo: 'matinee-app', releaseType: 'release' }); // public: no key, not private
  c.dispose();
  assert.ok(timers.intervals[0].cleared);
});

test('errors from a check go to the log and never put the raw error in the status', async () => {
  const { c, updater, timers, logs } = make();
  updater.checkError = new Error('HttpError: 404 "Not Found"');
  c.start();
  timers.timeouts[0].fn(); await tick();
  assert.equal(c.status().state, 'idle');
  assert.equal(c.status().checkFailed, true);
  assert.ok(!JSON.stringify(c.status()).includes('HttpError'));
  assert.ok(logs.join('\n').includes('HttpError'));
  updater.checkError = null;
  timers.intervals[0].fn(); await tick();
  assert.equal(c.status().checkFailed, false);
});

test('update lifecycle: downloading, progress once a second, ready with memo', () => {
  const clock = { t: 10_000 };
  const { c, updater, memo, sent } = make({ clock });
  c.start();
  updater.emit('update-available', { version: '0.1.9' });
  assert.equal(c.status().state, 'downloading');
  const before = sent.length;
  updater.emit('download-progress', { percent: 10.4 });
  updater.emit('download-progress', { percent: 11 });
  clock.t += 500; updater.emit('download-progress', { percent: 12 });
  assert.equal(sent.length - before, 1);
  assert.equal(c.status().percent, 10);
  clock.t += 600; updater.emit('download-progress', { percent: 50.2 });
  assert.equal(c.status().percent, 50);
  updater.emit('update-downloaded', { version: '0.1.9' });
  assert.equal(c.status().state, 'ready');
  assert.equal(c.status().next, '0.1.9');
  assert.deepEqual(memo(), { version: '0.1.9' });
});

test('install: closeCore finishes BEFORE quitAndInstall; second call harmless; memo marks the attempt', async () => {
  const order = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const { c, updater, memo } = make({ deps: { closeCore: async () => { order.push('close-start'); await gate; order.push('close-done'); } } });
  updater.quitAndInstall = (...a) => order.push('quit:' + a.join(','));
  c.start();
  await c.install(); // not ready: nothing
  assert.deepEqual(order, []);
  updater.emit('update-downloaded', { version: '0.1.9' });
  const p1 = c.install(); const p2 = c.install();
  await tick();
  assert.deepEqual(order, ['close-start']);
  release(); await Promise.all([p1, p2]);
  assert.deepEqual(order, ['close-start', 'close-done', 'quit:true,true']);
  assert.ok(memo().triedAt);
});

test('portable never installs and reports available-portable', async () => {
  const { c, updater, opened } = make({ deps: { portable: true } });
  c.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit('update-available', { version: '0.1.9' });
  assert.equal(c.status().state, 'available-portable');
  assert.match(c.status().releasesUrl, /github\.com\/defmellow\/matinee-app\/releases\/latest/);
  await c.install(); c.noteQuit();
  assert.ok(!updater.calls.some(x => x.startsWith('quit')));
  c.openDownload();
  assert.deepEqual(opened, ['https://github.com/defmellow/matinee-app/releases/download/v0.1.9/Matinee-0.1.9-Windows.exe']);
});

test('other errors only log and keep the state', () => {
  const { c, updater, logs } = make();
  c.start();
  updater.emit('update-downloaded', { version: '0.1.9' });
  updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.equal(c.status().state, 'ready');
  assert.ok(logs.some(l => l.includes('ERR_INTERNET')));
});

test('memo: attempted install of a newer version shows stalled; installed version clears the memo', () => {
  const a = make({ memo: { version: '0.1.9', triedAt: 'x' } });
  a.c.start();
  assert.equal(a.c.status().state, 'stalled');
  assert.equal(a.c.status().next, '0.1.9');
  a.updater.emit('update-available', { version: '0.1.9' });
  assert.equal(a.c.status().state, 'stalled');
  const b = make({ memo: { version: '0.1.5', triedAt: 'x' } });
  b.c.start();
  assert.equal(b.c.status().state, 'idle');
  assert.equal(b.memo(), null);
});

test('noteQuit marks a ready update as tried', () => {
  const { c, updater, memo } = make();
  c.start();
  c.noteQuit();
  assert.equal(memo(), null);
  updater.emit('update-downloaded', { version: '0.1.9' });
  c.noteQuit();
  assert.ok(memo().triedAt);
});

test('helpers', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
});

test('cleanNotes turns release bodies into plain text', () => {
  assert.equal(cleanNotes('<p>Faster <b>fetching</b></p><ul><li>One</li><li>Two &amp; three</li></ul>'), 'Faster fetching\nOne\nTwo & three');
  assert.equal(cleanNotes([{ note: '- a' }, { note: '- b' }]), '- a\n- b');
  assert.equal(cleanNotes('## Next\n**Bold** line'), 'Next\nBold line');
  assert.equal(cleanNotes(''), null);
  assert.equal(cleanNotes(undefined), null);
  assert.equal(cleanNotes('x'.repeat(5000)).length, 2000);
});

test('check() resolves the status, records the time, and never runs two at once', async () => {
  const clock = { t: 1000 };
  const { c, updater } = make({ clock });
  c.start();
  const a = c.check(), b = c.check();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(updater.calls.filter(x => x === 'check').length, 1);
  assert.equal(ra.lastCheckedAt, 1000);
  assert.equal(rb.checking, true); // the second call saw the first still running
  assert.equal(c.status().checking, false);
});

test('check() with a failing lookup flags checkFailed', async () => {
  const { c, updater } = make();
  updater.checkError = new Error('offline');
  c.start();
  const s = await c.check();
  assert.equal(s.checkFailed, true);
});

test('channel: experimental allows pre-releases, main allows stepping back; choice is saved and restored', async () => {
  const first = make();
  first.c.start();
  assert.equal(first.c.status().channel, 'main');
  assert.deepEqual(first.c.setChannel('nope'), { ok: false, reason: 'invalid' });
  assert.deepEqual(first.c.setChannel('experimental'), { ok: true });
  await tick();
  assert.equal(first.updater.allowPrerelease, true);
  assert.equal(first.updater.allowDowngrade, false);
  assert.equal(first.memo().channel, 'experimental');
  assert.ok(first.updater.calls.includes('check')); // switching checks straight away
  first.c.setChannel('main');
  await tick();
  assert.equal(first.updater.allowPrerelease, false);
  assert.equal(first.updater.allowDowngrade, true);
  assert.equal(first.memo(), null); // back to defaults: nothing stored

  const second = make({ memo: { channel: 'experimental' } });
  second.c.start();
  assert.equal(second.c.status().channel, 'experimental');
  assert.equal(second.updater.allowPrerelease, true);
});

test('stalled: retry forgets the failed attempt and checks again; the installer link points at the known version', async () => {
  const { c, updater, memo, opened } = make({ memo: { version: '0.4.1', triedAt: 'x' } });
  c.start();
  assert.equal(c.status().state, 'stalled');
  c.openDownload();
  assert.equal(opened[0], 'https://github.com/defmellow/matinee-app/releases/download/v0.4.1/Matinee-0.4.1-Windows.exe');
  await c.retry();
  assert.equal(memo(), null);
  assert.equal(c.status().state, 'idle');
  assert.ok(updater.calls.includes('check'));
});

test('manualUpdateKind: which copies cannot install an update themselves', () => {
  assert.equal(manualUpdateKind({ platform: 'win32', env: {} }), null);
  assert.equal(manualUpdateKind({ platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\x.exe' } }), 'portable');
  assert.equal(manualUpdateKind({ platform: 'darwin', env: {} }), 'mac'); // unsigned apps cannot be updated in place
  assert.equal(manualUpdateKind({ platform: 'linux', env: { APPIMAGE: '/home/a/Matinee.AppImage' } }), null);
  assert.equal(manualUpdateKind({ platform: 'linux', env: {} }), 'deb');
  assert.equal(manualUpdateKind({ platform: 'freebsd', env: {} }), null);
});

test('downloadFileFor: the right release file for each kind of copy', () => {
  assert.equal(downloadFileFor('0.55.0', 'portable'), 'Matinee-0.55.0-Windows.exe');
  assert.equal(downloadFileFor('0.55.0', null), 'Matinee-0.55.0-Windows.exe');
  assert.equal(downloadFileFor('0.55.0', 'mac', 'arm64'), 'Matinee-0.55.0-Mac.dmg');
  assert.equal(downloadFileFor('0.55.0', 'mac', 'x64'), 'Matinee-0.55.0-Mac-Intel.dmg');
  assert.equal(downloadFileFor('0.55.0', 'mac', 'ia32'), 'Matinee-0.55.0-Mac-Intel.dmg');
  assert.equal(downloadFileFor('0.56.0-exp.70', 'deb'), 'Matinee-0.56.0-exp.70-Linux.deb');
  assert.equal(downloadFileFor('0.58.0', 'appimage'), 'Matinee-0.58.0-Linux.AppImage');
  assert.equal(downloadFileFor('../evil', 'mac', 'arm64'), null);
  assert.equal(downloadFileFor(null, 'deb'), null);
});

test('Mac copy: checks only, shows Download, opens the .dmg for this chip', async () => {
  const { c, updater, opened } = make({ deps: { manual: 'mac', arch: 'arm64' } });
  c.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  updater.emit('update-available', { version: '0.1.9' });
  assert.equal(c.status().state, 'available-portable');
  assert.equal(c.status().manual, 'mac');
  assert.match(c.status().releasesUrl, /releases\/latest/);
  await c.install(); c.noteQuit();
  assert.ok(!updater.calls.some(x => x.startsWith('quit')));
  c.openDownload();
  assert.deepEqual(opened, ['https://github.com/defmellow/matinee-app/releases/download/v0.1.9/Matinee-0.1.9-Mac.dmg']);
});

test('Linux .deb copy: opens the .deb; before any version is known it opens the releases page', () => {
  const { c, updater, opened } = make({ deps: { manual: 'deb' } });
  c.start();
  c.openDownload();
  assert.deepEqual(opened, ['https://github.com/defmellow/matinee-app/releases/latest']);
  updater.emit('update-available', { version: '0.1.9' });
  c.openDownload();
  assert.equal(opened[1], 'https://github.com/defmellow/matinee-app/releases/download/v0.1.9/Matinee-0.1.9-Linux.deb');
});

test('an AppImage or installed Windows copy (no manual kind) still downloads and installs itself', () => {
  const { c, updater } = make({ deps: { manual: null } });
  c.start();
  assert.equal(updater.autoDownload, true);
  assert.equal(c.status().manual, null);
});
