// Audit perf fixes: slimmer payloads, fewer repeated scans, quieter fetch loop. Synthetic data only; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';
import { enrich, hasPendingWork } from '../../core/enrich.js';
import imdb from '../../core/providers/imdb.js';

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const exportZip = () => zipSync({
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa'], ['2024-02-02', 'Beta Film', '2005', 'https://boxd.it/bbb']])),
  'diary.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/1aaaaB', '4.5', '', '', '2024-02-01'], ['2024-02-03', 'Beta Film', '2005', 'https://boxd.it/1bbbbB', '3', '', '', '2024-02-02']])),
  'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
});
const fake404 = async () => new Response('not found', { status: 404 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idle = async core => { for (let i = 0; i < 200; i++) { if (!(await core.call('getState')).job) return; await sleep(10); } };

async function setup(providers = [], events = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-perf-'));
  const core = createCore({ dataDir: dir, fetch: fake404, providers, onEvent: (e, p) => events.push([e, p]) });
  await core.call('importExport', { bytes: exportZip() });
  await idle(core);
  return core;
}

test('getDiary rows are the slim library rows, without the heavy fields', async () => {
  const core = await setup();
  try {
    const diary = await core.call('getDiary');
    assert.equal(diary.entries.length, 2);
    const lib = await core.call('getLibrary');
    for (const e of diary.entries) {
      assert.deepEqual(e.film, lib.films.find(f => f.key === e.key), 'same object shape as getLibrary');
      for (const k of ['people', 'scoreParts', 'awards', 'ids', 'keywords', 'subjects']) assert.ok(!(k in e.film), k);
      assert.ok(e.film.title && 'poster' in e.film);
    }
  } finally { core.close(); }
});

test('getFilm related rows are slim', async () => {
  const core = await setup();
  try {
    const lib = await core.call('getLibrary');
    const film = await core.call('getFilm', { key: lib.films[0].key });
    for (const r of film.related) { assert.ok(r.film.title); assert.ok(!('people' in r.film) && !('scoreParts' in r.film)); }
  } finally { core.close(); }
});

test('getTonight pick films are slim', async () => {
  const core = await setup();
  try {
    const t = await core.call('getTonight', {});
    assert.equal(t.picks.length, 1);
    assert.ok(t.picks[0].film.title && !('people' in t.picks[0].film));
  } finally { core.close(); }
});

test('getState counts: filled per provider and enriched, in one pass, still match what the providers stored', async () => {
  const some = { id: 'a', label: 'A', gives: [], async enrich(films, ctx) { for (const f of films) ctx.done(f, { x: 1 }); } };
  const none = { id: 'b', label: 'B', gives: [], async enrich(films, ctx) { for (const f of films) ctx.done(f, null); } };
  const half = { id: 'c', label: 'C', gives: [], async enrich(films, ctx) { films.forEach((f, i) => ctx.done(f, i ? null : { x: 1 })); } };
  const core = await setup([some, none, half]);
  try {
    const s = await core.call('getState');
    assert.equal(s.counts.enriched, 3);
    assert.deepEqual(s.providers.map(p => [p.id, p.filled]), [['a', 3], ['b', 0], ['c', 1]]);
  } finally { core.close(); }
});

test('getFit without keys returns at most the default number of films, and honours keys', async () => {
  const core = await setup();
  try {
    const lib = await core.call('getLibrary');
    const some = await core.call('getFit', {});
    assert.ok(some.ranked.length <= 20 && Object.keys(some.byKey).length <= 20);
    const one = await core.call('getFit', { keys: [lib.films[0].key] });
    assert.ok(Object.keys(one.byKey).length <= 1);
  } finally { core.close(); }
});

test('fetchNow leaves bulk providers (imdb) out, even for a full fetch', async () => {
  const ran = [];
  const mk = (id, extra = {}) => ({ id, label: id, wants: () => true, async enrich(films, ctx) { ran.push(id); for (const f of films) ctx.done(f, { x: 1 }); }, ...extra });
  const core = await setup([mk('boxd'), mk('wikidata'), mk('imdb', { bulk: imdb.bulk })]);
  try {
    ran.length = 0; // the background run after the import
    const lib = await core.call('getLibrary');
    await core.call('fetchNow', { keys: [lib.films[2].key], tier: 'full' });
    await sleep(100);
    assert.ok(ran.includes('wikidata'), 'a normal provider still runs');
    assert.ok(!ran.includes('imdb'));
  } finally { core.close(); }
});

test('a refresh run writes sync.lastRefresh even without a username', async () => {
  const core = await setup();
  try {
    // the import's own run has no username either, and still stamps the time
    const at = (await core.call('getState')).sync.lastRefresh;
    assert.ok(at && Number.isFinite(Date.parse(at)));
    assert.deepEqual((await core.call('autoRefresh', {})), { started: false }, 'a launch right after does not start another run');
  } finally { core.close(); }
});

test('the end-of-run library event is skipped when the run recorded nothing, and sent when it did', async () => {
  const events = [];
  const quiet = { id: 'q', label: 'Q', gives: [], async enrich() {} };
  const core = await setup([quiet], events);
  try {
    events.length = 0;
    await core.call('refresh', {});
    await idle(core);
    assert.ok(!events.some(([e]) => e === 'library'), 'no library event');
    assert.ok(events.some(([e]) => e === 'state'), 'state events still go out');

    // a provider that records something: the keyless event still goes out at the end
    const busy = { id: 'busy', label: 'Busy', gives: [], wants: () => true, async enrich(films, ctx) { for (const f of films) ctx.done(f, { x: 1 }); } };
    const ev2 = [];
    const core2 = await setup([busy], ev2);
    try {
      ev2.length = 0;
      await core2.call('refresh', {});
      await idle(core2);
      assert.ok(ev2.some(([e, p]) => e === 'library' && p === undefined), 'keyless library event after a run that saved');
    } finally { core2.close(); }
  } finally { core.close(); }
});

// ---- the IMDb bulk download ----
const film = (i, extra = {}) => ({ key: 'f' + i, title: 'F' + i, ids: { imdb: 'tt' + i }, ...extra });
const fakeStore = (films, cache = {}) => ({
  library: { settings: {}, films: {} }, films: Object.fromEntries(films.map(f => [f.key, f])), touch() {}, flush() {},
  cached(name, maxAge) { const c = cache[name]; return c && Date.now() - Date.parse(c.at) < maxAge ? c.value : undefined; },
  setCached(name, value) { cache[name] = { at: new Date().toISOString(), value }; },
});
const spy = calls => ({ ...imdb, async enrich(films, ctx) { calls.push(films.length); for (const f of films) ctx.done(f, null); } });

test('imdb: retries a missed film monthly, not weekly', () => {
  assert.equal(imdb.retryMissDays, 30);
  assert.ok(imdb.bulk && imdb.bulk.minFilms > 1);
});

test('imdb: a few films do not trigger a download soon after the last one; many films, or an old download, do', async () => {
  const calls = [];
  const few = [film(1), film(2)];
  const recent = { imdbDownload: { at: new Date().toISOString(), value: true } };
  await enrich({ store: fakeStore(few, recent), http: {}, providers: [spy(calls)] });
  assert.deepEqual(calls, []);
  assert.equal(hasPendingWork({ store: fakeStore(few, recent), providers: [imdb] }), false);

  const many = [1, 2, 3, 4, 5, 6].map(i => film(i));
  await enrich({ store: fakeStore(many, recent), http: {}, providers: [spy(calls)] });
  assert.deepEqual(calls, [6]);

  const old = { imdbDownload: { at: new Date(Date.now() - 9 * 864e5).toISOString(), value: true } };
  await enrich({ store: fakeStore(few, old), http: {}, providers: [spy(calls)] });
  assert.deepEqual(calls, [6, 2]);
});

test('imdb: never downloaded before means the first run goes ahead, and records the time', async () => {
  const calls = [], cache = {};
  const store = fakeStore([film(1)], cache);
  await enrich({ store, http: {}, providers: [spy(calls)] });
  assert.deepEqual(calls, [1]);
  assert.ok(cache.imdbDownload);
});

test('imdb: a download that fails or is stopped is not recorded', async () => {
  const cache = {};
  const bad = { ...imdb, async enrich() { throw new Error('down'); } };
  await enrich({ store: fakeStore([film(1)], cache), http: {}, providers: [bad] });
  assert.equal(cache.imdbDownload, undefined);
});
