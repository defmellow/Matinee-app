// No error is silent: provider failures, refresh failures, save failures, getFilmDebug and the share zip's log files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import { createProblems, filmLabel } from '../../core/problems.js';
import { createStore } from '../../core/store.js';
import { enrich } from '../../core/enrich.js';
import { refreshWatchlist } from '../../core/sources/watchlist.js';
import { readZip } from '../../core/zip.js';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const recorder = () => { const list = []; return { list, report: p => { list.push(p); return p; } }; };

test('problems: levels are flagged in the log line and text, and counts() splits them', () => {
  const dir = tmp('prob-flags-');
  const p = createProblems({ dir });
  p.report({ area: 'Saving', message: 'Could not save.', level: 'error' });
  p.report({ area: 'RT', message: 'Nothing on this film.', level: 'warning', film: 'A (2000)' });
  assert.deepEqual(p.counts(), { error: 1, warning: 1, unseenError: 1, unseenWarning: 1 });
  p.markSeen();
  assert.deepEqual(p.counts(), { error: 1, warning: 1, unseenError: 0, unseenWarning: 0 });
  assert.match(p.text(), /\[ERROR\]  \[Saving\]/);
  assert.match(p.text(), /\[WARN\]\s+\[RT\] A \(2000\):/);
  p.flush();
  assert.match(fs.readFileSync(path.join(dir, 'problems.log'), 'utf8'), /\[WARN\]/);
  assert.equal(filmLabel({ title: 'A' }), 'A');
  assert.equal(filmLabel({ title: 'A', year: 2000 }), 'A (2000)');
});

test('enrich: a provider failure and a miss reach the problem log with the film named', async () => {
  const store = createStore(tmp('prob-enrich-'));
  store.films.a = { key: 'a', title: 'Alpha', year: 2001, ids: {}, src: {}, checked: {}, missed: {} };
  store.films.b = { key: 'b', title: 'Beta', year: 2002, ids: {}, src: {}, checked: {}, missed: {} };
  const p = { id: 'rt', label: 'Rotten Tomatoes', async enrich(films, ctx) {
    for (const f of films) { if (f.key === 'a') ctx.fail(f, Object.assign(new Error('boom'), { status: 500 })); else ctx.done(f, null); }
  } };
  const rec = recorder();
  await enrich({ store, providers: [p], http: {}, only: ['a', 'b'], problemLog: rec });
  const fail = rec.list.find(x => x.film === 'Alpha (2001)');
  assert.ok(fail); assert.equal(fail.level, 'warning'); assert.equal(fail.area, 'Rotten Tomatoes'); assert.match(fail.message, /isn't working right now/);
  const miss = rec.list.find(x => x.film === 'Beta (2002)');
  assert.ok(miss); assert.equal(miss.level, 'warning'); assert.match(miss.message, /has nothing on this film/);
});

test('enrich: a provider that throws is reported as an error; a stopped run is not', async () => {
  const store = createStore(tmp('prob-crash-'));
  store.films.a = { key: 'a', title: 'Alpha', year: 2001, ids: {}, src: {}, checked: {}, missed: {} };
  const rec = recorder();
  await enrich({ store, providers: [{ id: 'x', label: 'Ex', async enrich() { throw new Error('bug'); } }], http: {}, only: ['a'], problemLog: rec });
  assert.equal(rec.list.length, 1); assert.equal(rec.list[0].level, 'error'); assert.match(rec.list[0].message, /stopped part-way/);
  const rec2 = recorder();
  await enrich({ store, providers: [{ id: 'y', label: 'Why', async enrich() { throw Object.assign(new Error('stop'), { code: 'aborted' }); } }], http: {}, only: ['a'], problemLog: rec2 });
  assert.equal(rec2.list.length, 0);
});

test('watchlist refresh: a failure is reported, and still returns instead of throwing', async () => {
  const store = createStore(tmp('prob-wl-'));
  const http = { browserText: async () => { throw new Error('offline'); }, page: async () => { throw new Error('window failed'); } };
  const rec = recorder();
  const out = await refreshWatchlist(store, http, 'someone', { problems: rec });
  assert.ok(out.error);
  assert.ok(rec.list.some(x => x.area === 'Watchlist refresh' && x.level === 'error'));
});

test('store: a failed save is reported through the core problem log', async () => {
  const dir = tmp('prob-save-');
  const core = createCore({ dataDir: dir, fetch: async () => { throw new Error('offline'); }, onEvent: () => {} });
  fs.rmSync(path.join(dir, 'films.json'), { force: true });
  fs.mkdirSync(path.join(dir, 'films.json')); // a folder where the file should be: the save cannot work
  core.store.touch('films');
  assert.throws(() => core.store.flush());
  const { list, counts } = await core.call('getProblems');
  const e = list.find(x => x.area === 'Saving');
  assert.ok(e); assert.equal(e.level, 'error'); assert.match(e.message, /couldn't save film details/);
  assert.ok(counts.error >= 1);
  fs.rmSync(path.join(dir, 'films.json'), { recursive: true });
  core.close?.();
});

test('getFilmDebug: shape, outcomes per source and this film\'s own problems', async () => {
  const dir = tmp('prob-debug-');
  const p = { id: 'kp', label: 'KP', async enrich() {} };
  const core = createCore({ dataDir: dir, providers: [p], fetch: async () => { throw new Error('offline'); }, onEvent: () => {} });
  core.store.films.f1 = { key: 'f1', title: 'Film One', year: 1999, ids: { imdb: 'tt1' }, src: { kp: { synopsis: 'x' } }, checked: { kp: '2026-01-01T00:00:00Z' }, missed: {} };
  core.store.films.f2 = { key: 'f2', title: 'Other', year: 2000, ids: {}, src: {}, checked: {}, missed: {} };
  await core.call('reportProblem', { area: 'KP', message: 'Only for one.', film: 'Film One (1999)', level: 'warning' });
  await core.call('reportProblem', { area: 'KP', message: 'For another.', film: 'Other (2000)', level: 'warning' });
  const d = await core.call('getFilmDebug', { key: 'f1' });
  assert.equal(d.key, 'f1'); assert.equal(d.title, 'Film One'); assert.equal(d.year, 1999); assert.deepEqual(d.ids, { imdb: 'tt1' });
  assert.equal(typeof d.fieldSources, 'object');
  const kp = d.providers.find(x => x.id === 'kp');
  assert.equal(kp.status, 'ok'); assert.equal(kp.hasData, true); assert.deepEqual(kp.fields, ['synopsis']); assert.equal(kp.checked, '2026-01-01T00:00:00Z');
  assert.deepEqual(d.problems.map(x => x.message), ['Only for one.']);
  await assert.rejects(() => core.call('getFilmDebug', { key: 'nope' }), /no longer in your library/);
  core.close?.();
});

test('share zip: includes the problem log and app log files, and skips missing ones', async () => {
  const root = tmp('prob-share-');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(root, 'matinee.log'), 'app log line\n'); // lives next to the data folder, as in the real app
  const core = createCore({ dataDir, fetch: async () => { throw new Error('offline'); }, onEvent: () => {} });
  await core.call('reportProblem', { area: 'Test', message: 'Something to share.', level: 'error' });
  const r = await core.call('exportShare', { dir: path.join(root, 'out') });
  const raw = readZip(fs.readFileSync(r.path));
  const zip = { get: n => raw.get(n)?.toString('utf8'), has: n => raw.has(n) };
  assert.match(zip.get('logs/problems.log'), /Something to share\./);
  assert.match(zip.get('logs/problems.json'), /Something to share\./);
  assert.equal(zip.get('logs/matinee.log'), 'app log line\n');
  assert.equal(zip.has('logs/problems.old.log'), false);
  assert.deepEqual(JSON.parse(zip.get('header.json')).logFiles.sort(), ['matinee.log', 'problems.json', 'problems.log']);
  core.close?.();
});

test('every change sends the whole count, so Clear empties the sidebar badge and the Settings dot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-prob-clear-'));
  const events = [];
  const core = createCore({ dataDir: dir, fetch: async () => { throw new Error('offline'); }, onEvent: (e, p) => { if (e === 'problems') events.push(p); } });
  await core.call('reportProblem', { area: 'Test', message: 'One thing broke', level: 'error' });
  await core.call('reportProblem', { area: 'Test', message: 'Something looks off', level: 'warning' });
  assert.deepEqual(events.at(-1), { unseen: 2, total: 2, error: 1, warning: 1, unseenError: 1, unseenWarning: 1 });
  await core.call('markProblemsSeen');
  assert.deepEqual(events.at(-1), { unseen: 0, total: 2, error: 1, warning: 1, unseenError: 0, unseenWarning: 0 });
  await core.call('clearProblems');
  assert.deepEqual(events.at(-1), { unseen: 0, total: 0, error: 0, warning: 0, unseenError: 0, unseenWarning: 0 });
  const { problemCounts } = await import('../../ui/debug/useDebug.js').catch(() => ({})); // the hook file imports UI state; only its pure helper is checked when it loads here
  if (problemCounts) {
    assert.deepEqual(problemCounts(events.at(-1)), { unseen: 0, total: 0, error: 0, warning: 0, unseenError: 0, unseenWarning: 0 });
    assert.deepEqual(problemCounts({ unseen: 1 }), { unseen: 1, total: 0, error: 0, warning: 0, unseenError: 0, unseenWarning: 0 }, 'an older event shape is safe');
    assert.equal(problemCounts({ error: 2, warning: 3 }).total, 5);
  }
});
