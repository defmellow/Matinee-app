// "Never go silent" in the Electron layer: logs folder helpers, the problem reporter and the places that report into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { moveOldLogs, rollLog, createReporter, parseConsoleMessage, detailFrom, LOG_NAME } from '../../electron/problem-log.js';
import { createCoreHost, createCoreClient } from '../../electron/core-bridge.js';
import { runCall, friendlyError } from '../../electron/rpc.js';
import { createElectronFetch } from '../../electron/net-adapter.js';
import { createImageCache } from '../../electron/image-cache.js';
import { createUpdateController } from '../../electron/updater.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-logs-'));
const tick = () => new Promise(r => setTimeout(r, 5));

// ---------- logs folder ----------
test('moveOldLogs moves matinee.log and matinee.log.old into the logs folder', () => {
  const user = tmp(), logs = path.join(user, 'logs');
  fs.writeFileSync(path.join(user, LOG_NAME), 'a'); fs.writeFileSync(path.join(user, LOG_NAME + '.old'), 'b');
  const r = moveOldLogs({ fs, fromDir: user, logsDir: logs, join: path.join });
  assert.deepEqual(r.moved, [LOG_NAME, LOG_NAME + '.old']);
  assert.deepEqual(r.failed, []);
  assert.equal(fs.readFileSync(path.join(logs, LOG_NAME), 'utf8'), 'a');
  assert.equal(fs.existsSync(path.join(user, LOG_NAME)), false);
});

test('moveOldLogs: nothing to move is fine; an existing new log keeps the old one as .previous', () => {
  const user = tmp(), logs = path.join(user, 'logs');
  assert.deepEqual(moveOldLogs({ fs, fromDir: user, logsDir: logs, join: path.join }), { moved: [], failed: [] });
  fs.writeFileSync(path.join(user, LOG_NAME), 'old'); fs.writeFileSync(path.join(logs, LOG_NAME), 'new');
  const r = moveOldLogs({ fs, fromDir: user, logsDir: logs, join: path.join });
  assert.equal(fs.readFileSync(path.join(logs, LOG_NAME), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(logs, LOG_NAME + '.previous'), 'utf8'), 'old');
  assert.equal(r.moved.length, 1);
});

test('moveOldLogs reports failures instead of throwing', () => {
  const bad = { mkdirSync() {}, existsSync: () => true, renameSync() { throw Object.assign(new Error('locked'), { code: 'EBUSY' }); } };
  const r = moveOldLogs({ fs: bad, fromDir: '/u', logsDir: '/u/logs', join: path.join });
  assert.equal(r.failed.length, 2);
  assert.equal(r.failed[0].error.code, 'EBUSY');
  const noDir = { mkdirSync() { throw new Error('read-only'); } };
  assert.equal(moveOldLogs({ fs: noDir, fromDir: '/u', logsDir: '/u/logs', join: path.join }).failed.length, 1);
});

test('rollLog rolls only past the limit; a missing file is not an error; other failures are returned', () => {
  const dir = tmp(), file = path.join(dir, LOG_NAME);
  assert.deepEqual(rollLog({ fs, file }), { rolled: false });
  fs.writeFileSync(file, 'x'.repeat(10));
  assert.deepEqual(rollLog({ fs, file, limit: 100 }), { rolled: false });
  assert.deepEqual(rollLog({ fs, file, limit: 5 }), { rolled: true });
  assert.equal(fs.existsSync(file + '.old'), true);
  const r = rollLog({ fs: { statSync() { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }, file });
  assert.equal(r.error.code, 'EPERM');
});

// ---------- reporter ----------
test('reporter queues before the core is up, then sends; repeats within the gap are dropped', async () => {
  const sent = [];
  let t = 1000;
  const rp = createReporter({ now: () => t });
  rp.report({ area: 'App', message: 'one', error: new Error('boom') });
  rp.report({ area: 'App', message: 'one' });
  assert.equal(rp.queued, 1);
  rp.attach(async p => { sent.push(p); });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].level, 'error');
  assert.match(sent[0].detail, /boom/);
  rp.report({ area: 'App', message: 'one' });
  assert.equal(sent.length, 1);
  t += 61_000;
  rp.report({ area: 'App', message: 'one', level: 'warning' });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].level, 'warning');
});

test('reporter never throws or loops when sending fails, and caps the rate', async () => {
  const logs = [];
  const rp = createReporter({ log: (...a) => logs.push(a.join(' ')), perMinute: 3 });
  rp.attach(() => { throw new Error('sync fail'); });
  rp.report({ message: 'a' });
  rp.attach(() => Promise.reject(new Error('async fail')));
  rp.report({ message: 'b' });
  await tick();
  assert.equal(logs.length, 2);
  assert.ok(logs.every(l => /Could not pass a problem on/.test(l)));
  rp.attach(async () => {});
  assert.equal(rp.report({ message: 'c' }), true);
  assert.equal(rp.report({ message: 'd' }), false); // over 3 a minute
  assert.doesNotThrow(() => rp.report(null));
});

test('parseConsoleMessage handles both Electron shapes and only keeps errors', () => {
  assert.deepEqual(parseConsoleMessage([{ level: 'error', message: 'x is not defined', lineNumber: 7, sourceId: 'file:///app/index.js' }]), { message: 'x is not defined', where: 'index.js:7' });
  assert.deepEqual(parseConsoleMessage([{}, 3, 'bad', 2, 'a.js']), { message: 'bad', where: 'a.js:2' });
  assert.equal(parseConsoleMessage([{ level: 'info', message: 'hi' }]), null);
  assert.equal(parseConsoleMessage([{}, 1, 'hi', 1, '']), null);
  assert.equal(parseConsoleMessage([]), null);
});

test('detailFrom is short, plain and never throws', () => {
  assert.match(detailFrom(Object.assign(new Error('nope'), { code: 'EACCES' })), /EACCES · nope/);
  assert.equal(detailFrom(null), '');
  const circ = {}; circ.self = circ;
  assert.doesNotThrow(() => detailFrom(circ));
  assert.ok(detailFrom('x'.repeat(1000)).length <= 400);
});

// ---------- rpc ----------
test('runCall reports unexpected (bug-like) errors but not friendly ones or aborts', async () => {
  const seen = [];
  const core = { call: async m => { if (m === 'bug') throw new TypeError('x is undefined'); if (m === 'nice') throw new Error('Not a Letterboxd export.'); if (m === 'abort') throw Object.assign(new Error('Stopped.'), { code: 'aborted' }); return 1; } };
  const log = () => {};
  for (const m of ['bug', 'nice', 'abort', 'ok']) await runCall(core, m, {}, log, (method, e) => seen.push([method, e.message]));
  assert.deepEqual(seen, [['bug', 'x is undefined']]);
  // a throwing reporter does not change the answer
  const r = await runCall(core, 'bug', {}, log, () => { throw new Error('reporter broke'); });
  assert.equal(r.error.message, friendlyError(new TypeError('x')));
});

// ---------- core bridge ----------
function fakeProc() {
  const p = new EventEmitter();
  p.sent = []; p.postMessage = m => { p.sent.push(m); if (m.type === 'init') queueMicrotask(() => p.emit('message', { type: 'ready' })); };
  p.kill = () => {}; p.pid = 1;
  queueMicrotask(() => p.emit('message', { type: 'hello' }));
  return p;
}

test('an unexpected core exit is logged and reported once the replacement is up; init carries logsDir', async () => {
  const procs = [], reports = [], logs = [];
  const client = createCoreClient({
    spawn: () => { const p = fakeProc(); procs.push(p); return p; },
    init: { dataDir: '/d', logsDir: '/d/logs' },
    render: async () => ({}), onEvent() {}, log: (...a) => logs.push(a.join(' ')), report: r => reports.push(r),
  });
  await client.start();
  assert.equal(procs[0].sent.find(m => m.type === 'init').logsDir, '/d/logs');
  procs[0].emit('exit', 9);
  assert.equal(reports.length, 0, 'not yet: the core that keeps the list is down');
  await tick();
  assert.equal(procs.length, 2);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].area, 'App');
  assert.match(String(reports[0].error), /exit code 9/);
  assert.equal(reports[0].level, 'error');
  assert.ok(logs.some(l => /stopped unexpectedly/.test(l)));
});

test('a problem message from the child is logged and reported; failed page reads are reported, aborts are not', async () => {
  const procs = [], reports = [];
  let fail = new Error('net::ERR_FAILED');
  const client = createCoreClient({
    spawn: () => { const p = fakeProc(); procs.push(p); return p; },
    init: {}, render: async () => { throw fail; }, onEvent() {}, log() {}, report: r => reports.push(r),
  });
  await client.start();
  procs[0].emit('message', { type: 'problem', area: 'App', message: 'Child trouble', detail: 'TypeError: x', level: 'error' });
  assert.equal(reports[0].message, 'Child trouble');
  assert.equal(reports[0].error, 'TypeError: x');
  procs[0].emit('message', { type: 'render', id: 1, url: 'https://x.test/', opts: {} });
  await tick();
  assert.equal(reports.length, 2);
  assert.equal(reports[1].area, 'Page reading');
  assert.equal(reports[1].level, 'warning');
  fail = Object.assign(new Error('Stopped.'), { code: 'aborted' });
  procs[0].emit('message', { type: 'render', id: 2, url: 'https://x.test/', opts: {} });
  await tick();
  assert.equal(reports.length, 2);
});

test('the child side: noteCrash logs and posts a problem; core errors that are bugs become problems', async () => {
  const posted = [];
  const core = { call: async () => { throw new TypeError('boom'); }, close() {} };
  const host = createCoreHost({ post: m => posted.push(m), loadCore: async () => ({ createCore: opts => { core.opts = opts; return core; } }), makeFetch: () => () => {}, friendlyError });
  host.onMessage({ type: 'init', dataDir: '/d', logsDir: '/d/logs' });
  await tick();
  assert.equal(core.opts.logsDir, '/d/logs');
  const origError = console.error; console.error = () => {};
  try { host.noteCrash('unhandled rejection', new Error('late')); } finally { console.error = origError; }
  assert.ok(posted.some(m => m.type === 'log' && /unhandled rejection/.test(m.line)));
  const pr = posted.find(m => m.type === 'problem');
  assert.match(pr.detail, /late/);
  host.onMessage({ type: 'call', id: 1, method: 'x', args: {} });
  await tick();
  assert.ok(posted.filter(m => m.type === 'problem').some(m => /\(x\)/.test(m.message)));
});

// ---------- net adapter ----------
test('net adapter: a failing manual request is logged and reported, and still rejects', async () => {
  const logs = [], reports = [];
  const req = new EventEmitter(); req.setHeader = () => {}; req.end = () => queueMicrotask(() => req.emit('error', new Error('net::ERR_CONNECTION_RESET'))); req.abort = () => {};
  const f = createElectronFetch({ fetch: async () => {}, request: () => req, log: (...a) => logs.push(a.join(' ')), report: r => reports.push(r) });
  await assert.rejects(f('https://boxd.it/abc', { redirect: 'manual' }), /ERR_CONNECTION_RESET/);
  assert.ok(logs.some(l => /boxd\.it/.test(l)));
  assert.equal(reports[0].area, 'Network');
  assert.match(reports[0].message, /boxd\.it/);
});

// ---------- image cache ----------
test('image cache: a failed download and a failed disk write are logged and reported; the picture still comes back', async () => {
  const dir = tmp(), logs = [], reports = [];
  const png = Buffer.from([1, 2, 3]);
  let n = 0;
  const cache = createImageCache({
    dir: path.join(dir, 'file-not-folder'), log: (...a) => logs.push(a.join(' ')), report: r => reports.push(r),
    fetch: async () => { if (++n === 1) throw new Error('offline'); return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }); },
  });
  fs.writeFileSync(path.join(dir, 'file-not-folder'), 'x'); // mkdir of the cache folder will fail
  const a = await cache.handle('https://image.tmdb.org/a.jpg');
  assert.equal(a.status, 502);
  assert.ok(reports.some(r => /image\.tmdb\.org/.test(r.message)));
  const b = await cache.handle('https://image.tmdb.org/b.jpg');
  assert.equal(b.status, 200);
  assert.ok(reports.some(r => /save a picture/.test(r.message)), JSON.stringify(reports));
  assert.ok(logs.length >= 2);
});

// ---------- updater ----------
test('updater: a failed check is reported as a warning; a failed install start is an error', async () => {
  const u = new EventEmitter();
  u.checkForUpdates = async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com'); };
  u.setFeedURL = () => {}; u.quitAndInstall = () => { throw new Error('spawn EACCES'); };
  const reports = [];
  const c = createUpdateController({
    updater: u, currentVersion: '0.1.5',
    report: r => reports.push(r), setTimeout: () => ({}), clearTimeout() {}, setInterval: () => ({}), clearInterval() {},
  });
  c.start();
  await c.check();
  assert.equal(reports[0].area, 'Updates');
  assert.equal(reports[0].level, 'warning');
  assert.ok(/ENOTFOUND/.test(reports[0].detail));
  u.emit('update-downloaded', { version: '0.1.9' });
  await c.install();
  assert.ok(reports.some(r => /installer/.test(r.message) && r.level === 'error'));
  assert.ok(reports.some(r => /did not install/.test(r.message)));
});
