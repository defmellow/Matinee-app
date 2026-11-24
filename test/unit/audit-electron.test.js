// Audit fixes for the Electron shell: updater recovery and error classes, image redirects, log safety, crash guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createUpdateController, compareVersions, isRateLimitError } from '../../electron/updater.js';
import { createImageCache } from '../../electron/image-cache.js';
import { formatLogLine, createRateGuard, shouldReloadAfter, isTheme, backgroundFor, overlayFor, nativeSourceFor } from '../../electron/shell-util.js';

const tick = () => new Promise(r => setTimeout(r, 0));

function rig(over = {}) {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = async () => { u.calls.push('check'); if (u.checkError) throw u.checkError; };
  u.setFeedURL = () => {};
  u.quitAndInstall = () => { u.calls.push('quit'); };
  const timers = [];
  let memo = null, stalled = 0;
  const logs = [];
  const c = createUpdateController({
    updater: u, currentVersion: '0.1.5',
    readMemo: () => memo, writeMemo: m => { memo = m; }, log: (...a) => logs.push(a.join(' ')),
    setTimeout: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimeout: h => { h.cleared = true; }, setInterval: () => ({}), clearInterval() {},
    onInstallStalled: () => { stalled++; }, ...over,
  });
  return { c, u, timers, logs, memo: () => memo, stalled: () => stalled };
}

// ---------- electron-shell-2 ----------
test('install that never quits the app: recovers after the watch time (stalled + restart + log)', async () => {
  const r = rig();
  r.c.start();
  r.u.emit('update-downloaded', { version: '0.1.9' });
  await r.c.install();
  const watch = r.timers.find(t => t.ms === 15_000);
  assert.ok(watch, 'a watch timer is set after quitAndInstall');
  assert.equal(r.stalled(), 0);
  watch.fn();
  assert.equal(r.stalled(), 1);
  assert.equal(r.c.status().state, 'stalled');
  assert.ok(r.memo().triedAt);
  assert.ok(r.logs.some(l => l.includes('0.1.5 -> 0.1.9')));
  assert.ok(r.logs.some(l => l.includes('did not install')));
  // the retry button still works afterwards
  await r.c.retry();
  assert.notEqual(r.c.status().state, 'stalled');
});

test('an updater error while installing recovers at once, once', async () => {
  const r = rig();
  r.c.start();
  r.u.emit('update-downloaded', { version: '0.1.9' });
  await r.c.install();
  r.u.emit('error', new Error('spawn EACCES'));
  assert.equal(r.stalled(), 1);
  assert.ok(r.logs.some(l => l.includes('EACCES')));
  r.timers.find(t => t.ms === 15_000).fn();
  assert.equal(r.stalled(), 1);
});

test('a check that fails while the core is closing does not stall the install, and new checks wait', async () => {
  let release, failCheck;
  const r = rig({ closeCore: () => new Promise(res => { release = res; }) });
  r.u.checkForUpdates = () => { r.u.calls.push('check'); return new Promise((_, rej) => { failCheck = rej; }); };
  r.c.start();
  r.u.emit('update-downloaded', { version: '0.1.9' });
  const check = r.c.check(); // already in flight when the user clicks Restart to update
  await tick();
  const installing = r.c.install();
  await r.c.check(); // refused while installing
  assert.equal(r.u.calls.filter(c => c === 'check').length, 1);
  failCheck(new Error('getaddrinfo ENOTFOUND api.github.com'));
  await check;
  release();
  await installing;
  assert.equal(r.u.calls.includes('quit'), true, 'the install carries on');
  assert.equal(r.stalled(), 0);
});

test('an install that stalled while the core was closing never calls quitAndInstall', async () => {
  let release;
  const r = rig({ closeCore: () => new Promise(res => { release = res; }) });
  r.c.start();
  r.u.emit('update-downloaded', { version: '0.1.9' });
  const installing = r.c.install();
  r.u.emit('error', new Error('spawn EACCES'));
  assert.equal(r.stalled(), 1);
  release();
  await installing;
  assert.equal(r.u.calls.includes('quit'), false);
  assert.equal(r.timers.some(t => t.ms === 15_000), false, 'no watch timer is armed for an install that already stalled');
});

test('quitAndInstall throwing also recovers; dispose clears the watch timer', async () => {
  const r = rig();
  r.u.quitAndInstall = () => { throw new Error('nope'); };
  r.c.start();
  r.u.emit('update-downloaded', { version: '0.1.9' });
  await r.c.install();
  assert.equal(r.stalled(), 1);
  const r2 = rig();
  r2.c.start();
  r2.u.emit('update-downloaded', { version: '0.1.9' });
  await r2.c.install();
  r2.c.dispose();
  assert.ok(r2.timers.find(t => t.ms === 15_000).cleared);
});

// ---------- electron-shell-3 ----------
test('rate limit detection', () => {
  assert.equal(isRateLimitError({ headers: { 'x-ratelimit-remaining': ['0'] } }), true);
  assert.equal(isRateLimitError(new Error('HttpError: 403 API rate limit exceeded')), true);
  assert.equal(isRateLimitError({ statusCode: 404 }), false);
});

test('a 403 rate limit on a check is a failed check', async () => {
  {
    const err = Object.assign(new Error('x'), { statusCode: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const r = rig();
    r.u.checkError = err;
    r.c.start();
    await r.c.check();
    assert.equal(r.c.status().state, 'idle');
    assert.equal(r.c.status().checkFailed, true);
  }
});

// ---------- electron-shell-4 ----------
test('download that errors returns to idle; a repeat check keeps the progress', () => {
  const r = rig();
  r.c.start();
  r.u.emit('update-available', { version: '0.1.9' });
  r.u.emit('download-progress', { percent: 40 });
  assert.equal(r.c.status().percent, 40);
  r.u.emit('update-available', { version: '0.1.9' });
  assert.equal(r.c.status().percent, 40);
  r.u.emit('error', new Error('net::ERR_NETWORK_CHANGED'));
  assert.equal(r.c.status().state, 'idle');
  assert.equal(r.c.status().next, null);
  assert.equal(r.c.status().checkFailed, true);
});

// ---------- electron-shell-9 ----------
test('compareVersions ranks a pre-release below its own stable', () => {
  assert.ok(compareVersions('0.5.0-exp.40', '0.5.0') < 0);
  assert.ok(compareVersions('0.5.0', '0.5.0-exp.40') > 0);
  assert.ok(compareVersions('0.5.0-exp.40', '0.5.0-exp.9') > 0);
  assert.equal(compareVersions('0.5.0-exp.2', '0.5.0-exp.2'), 0);
  assert.ok(compareVersions('0.5.1-exp.1', '0.5.0') > 0);
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
});

test('a memo for the stable is kept while the user is still on its experimental build', () => {
  const r = rig({ currentVersion: '0.5.0-exp.40', readMemo: () => ({ version: '0.5.0', triedAt: 'x' }) });
  r.c.start();
  assert.equal(r.c.status().state, 'stalled');
});

test('log lines never throw', () => {
  const circ = {}; circ.self = circ;
  const line = formatLogLine(['x', circ, 10n, new Error('boom'), undefined, { get a() { throw new Error('g'); } }], new Date(0));
  assert.ok(line.startsWith('1970-01-01T00:00:00.000Z x '));
  assert.ok(line.includes('boom') && line.endsWith('\n'));
});

// ---------- electron-shell-5 ----------
test('crash guard: 3 reloads a minute, then no; clean exits and kills are left alone', () => {
  const clock = { t: 0 };
  const g = createRateGuard({ max: 3, windowMs: 60_000, now: () => clock.t });
  assert.deepEqual([g.allow(), g.allow(), g.allow(), g.allow()], [true, true, true, false]);
  clock.t = 61_000;
  assert.equal(g.allow(), true);
  assert.equal(shouldReloadAfter('crashed'), true);
  assert.equal(shouldReloadAfter('oom'), true);
  assert.equal(shouldReloadAfter('clean-exit'), false);
  assert.equal(shouldReloadAfter('killed'), false);
});

// ---------- theme helpers ----------
test('theme helpers', () => {
  assert.ok(isTheme('dark') && isTheme('system') && isTheme('light'));
  assert.ok(!isTheme('blue') && !isTheme(undefined));
  assert.equal(backgroundFor(true), '#221d1d');
  assert.equal(backgroundFor(false), '#faf5f2');
  assert.ok(isTheme('neutral'));
  assert.equal(backgroundFor(true, 'neutral'), '#1c1c1e');
  assert.equal(backgroundFor(true, 'dark'), '#221d1d');
  assert.equal(backgroundFor(false, 'neutral'), '#faf5f2'); // neutral is dark-only; a light OS never reaches it
  assert.equal(overlayFor(true, 'neutral').color, '#1c1c1e');
  assert.equal(overlayFor(true).color, '#221d1d');
  assert.equal(nativeSourceFor('neutral'), 'dark');
  assert.equal(nativeSourceFor('light'), 'light');
  assert.ok(isTheme('neutral-light'));
  assert.equal(nativeSourceFor('neutral-light'), 'light');
  assert.equal(backgroundFor(false, 'neutral-light'), '#f4f4f5');
  assert.equal(overlayFor(false, 'neutral-light').symbolColor, '#4a4a51');
  assert.equal(backgroundFor(false, 'light'), '#faf5f2');
});

// ---------- electron-shell-7 ----------
const png = () => new Response(Buffer.from('img'), { status: 200, headers: { 'content-type': 'image/png' } });
const redirect = loc => new Response(null, { status: 302, headers: { location: loc } });
async function cacheWith(handler) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matinee-redir-'));
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, redirect: opts.redirect }); return handler(url, calls.length); };
  return { c: createImageCache({ dir, fetch }), calls };
}

test('image redirects: followed by hand within the allowlist', async () => {
  const { c, calls } = await cacheWith((url, n) => (n === 1 ? redirect('https://image.tmdb.org/t/p/w500/b.jpg') : png()));
  const r = await c.handle('https://www.themoviedb.org/a.jpg');
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(x => x.redirect === 'manual'));
});

test('image redirects: a hop to a host off the list is refused', async () => {
  const { c, calls } = await cacheWith(() => redirect('http://192.168.1.1/x.png'));
  const r = await c.handle('https://www.themoviedb.org/a.jpg');
  assert.notEqual(r.status, 200);
  assert.equal(calls.length, 1);
});

test('image redirects: stops after 3 hops', async () => {
  const { c, calls } = await cacheWith(() => redirect('https://image.tmdb.org/loop.jpg'));
  const r = await c.handle('https://image.tmdb.org/start.jpg');
  assert.notEqual(r.status, 200);
  assert.equal(calls.length, 4); // the original + 3 hops
});
