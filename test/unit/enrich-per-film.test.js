import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich } from '../../core/enrich.js';

// Synthetic stores and providers (clearly fake, controlled delays): these check WHEN each film is handed to each source.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mkStore = films => ({ library: { settings: {}, films: {} }, films: Object.fromEntries(films.map(f => [f.key, f])), touch() {}, flush() {} });
const film = (key, ids = {}) => ({ key, title: 'Film ' + key, year: 2000, ids });
const t0 = () => performance.now();

/** An id provider that resolves films one by one after `delays[key]` ms, giving each the ids in `give[key]` (or failing it). */
function idProvider(id, { delays = {}, give = {}, fail = [], log, wait = 0 }) {
  return {
    id, label: id,
    async enrich(films, ctx) {
      log.push([id + ':start', t0()]);
      await sleep(wait);
      await Promise.all(films.map(async f => {
        await sleep(delays[f.key] ?? 0);
        if (fail.includes(f.key)) ctx.fail(f, new Error('down'));
        else ctx.done(f, { x: 1 }, give[f.key]);
      }));
      log.push([id + ':end', t0()]);
    },
  };
}
/** A source that records when it starts each film. */
function reader(id, log, extra = {}) {
  return {
    id, label: id,
    async enrich(films, ctx) {
      for (const f of films) { log.push([`${id}:${f.key}`, t0()]); ctx.done(f, { y: 1 }); }
    },
    ...extra,
  };
}
const at = (log, name) => log.find(([n]) => n === name)?.[1];
const http = {};

test('a film that already has its ids is read by the id-dependent source before a slow Wikidata batch finishes', async () => {
  const log = [];
  const store = mkStore([film('a', { imdb: 'tt1' }), film('b')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 300, b: 300 }, give: { b: { imdb: 'tt2' } } }),
    reader('omdb', log, { needsIds: ['imdb'], requires: f => !!f.ids?.imdb }),
  ];
  await enrich({ store, http, providers });
  assert.ok(at(log, 'omdb:a') < at(log, 'wikidata:end') - 150, 'omdb did not wait for the batch');
  assert.ok(at(log, 'omdb:b') >= at(log, 'wikidata:end') - 5, 'the film without ids waited for its own chain');
  assert.equal(store.films.b.checked?.omdb !== undefined || store.films.b.src?.omdb !== undefined, true, 'and was read afterwards');
});

test('a film waits for its own id chain only, not for the slowest film in the batch', async () => {
  const log = [];
  const store = mkStore([film('a'), film('b')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 20, b: 400 }, give: { a: { imdb: 'tt1' }, b: { imdb: 'tt2' } } }),
    reader('omdb', log, { needsIds: ['imdb'], requires: f => !!f.ids?.imdb }),
  ];
  await enrich({ store, http, providers });
  assert.ok(at(log, 'omdb:a') > at(log, 'wikidata:start') + 15, 'not before its own result');
  assert.ok(at(log, 'omdb:a') < at(log, 'wikidata:end') - 200, 'long before the slow film resolved');
  assert.ok(at(log, 'omdb:b') >= at(log, 'wikidata:end') - 5);
});

test('a failed id chain still releases the film, so sources that can search by title run', async () => {
  const log = [];
  const store = mkStore([film('a'), film('b')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 10, b: 10 }, fail: ['a'], give: { b: { imdb: 'tt2' } } }),
    reader('omdb', log, { needsIds: ['imdb'], requires: f => !!f.ids?.imdb }),
    reader('rt', log), // no ids needed: searches by title
  ];
  const r = await enrich({ store, http, providers, ignoreBackoff: true });
  assert.ok(at(log, 'rt:a') != null && at(log, 'rt:b') != null, 'rt read both films');
  assert.equal(at(log, 'omdb:a'), undefined, 'omdb has nothing to look up without an id');
  assert.ok(at(log, 'omdb:b') != null);
  assert.ok(Array.isArray(r.problems));
});

test('a source with no declared needs waits for the film\'s id chain, then runs', async () => {
  const log = [];
  const store = mkStore([film('a'), film('b')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 20, b: 300 } }),
    reader('rt', log),
  ];
  await enrich({ store, http, providers });
  assert.ok(at(log, 'rt:a') > at(log, 'wikidata:start') + 15);
  assert.ok(at(log, 'rt:a') < at(log, 'wikidata:end') - 150);
});

test('lanes are still respected in every wave', async () => {
  const lanes = [];
  const fakeHttp = { withPriority: lane => ({ lane }) };
  const spy = (id, extra = {}) => ({ id, label: id, async enrich(films, ctx) { for (const f of films) { lanes.push([id, ctx.http.lane]); ctx.done(f, { z: 1 }); await sleep(5); } }, ...extra });
  const mk = () => mkStore([film('a', { imdb: 'tt1', enwiki: 'A' }), film('b'), film('c')]);
  const providers = () => [idProvider('wikidata', { log: [], delays: { a: 5, b: 40, c: 80 }, give: { b: { imdb: 'tt2' }, c: { imdb: 'tt3' } } }), spy('omdb', { needsIds: ['imdb'], requires: f => !!f.ids?.imdb }), spy('wikicats', { needsIds: ['enwiki'] })];
  await enrich({ store: mk(), http: fakeHttp, providers: providers() });
  assert.ok(lanes.filter(([id]) => id === 'omdb').length === 3 && lanes.filter(([id]) => id === 'omdb').every(([, l]) => l === 3), 'first-time background reads of omdb stay in lane 3: ' + JSON.stringify(lanes));
  assert.ok(lanes.filter(([id]) => id === 'wikicats').every(([, l]) => l === 4), 'feel extras stay in lane 4');
  lanes.length = 0;
  await enrich({ store: mk(), http: fakeHttp, providers: providers(), lane: 1 });
  assert.ok(lanes.length > 0 && lanes.every(([, l]) => l === 1), 'a caller\'s lane applies to every wave: ' + JSON.stringify(lanes));
});

test('progress only moves forward across waves and ends at the film count', async () => {
  const log = [], events = [];
  const store = mkStore([film('a', { imdb: 't1' }), film('b'), film('c')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 5, b: 60, c: 120 }, give: { b: { imdb: 'tt2' }, c: { imdb: 'tt3' } } }),
    { id: 'omdb', label: 'omdb', needsIds: ['imdb'], requires: f => !!f.ids?.imdb, async enrich(films, ctx) { let n = 0; for (const f of films) { await sleep(5); ctx.done(f, { y: 1 }); ctx.progress(++n, films.length); } } },
  ];
  await enrich({ store, http, providers, emit: (e, p) => { if (e === 'progress' && p.provider === 'omdb') events.push(p); } });
  for (let i = 1; i < events.length; i++) assert.ok(events[i].done >= events[i - 1].done, `done went backwards at ${i}: ${JSON.stringify(events.map(e => [e.done, e.total]))}`);
  const last = events[events.length - 1];
  assert.deepEqual([last.done, last.total], [3, 3]);
});

test('a source that stopped early gets no more waves in that run', async () => {
  const log = [];
  const store = mkStore([film('a', { imdb: 't1' }), film('b', { imdb: 't2' }), film('c')]);
  let waves = 0;
  const providers = [
    idProvider('wikidata', { log, delays: { a: 5, b: 80, c: 160 }, give: { c: { imdb: 'tt3' } } }),
    { id: 'omdb', label: 'omdb', needsIds: ['imdb'], requires: f => !!f.ids?.imdb, async enrich(films, ctx) { waves++; ctx.done(films[0], { y: 1 }); /* leaves the rest: a daily limit, say */ } },
  ];
  const outcomes = [];
  await enrich({ store, http, providers, onOutcome: (f, p, o) => { if (p.id === 'omdb') outcomes.push([f.key, o.status]); } });
  assert.equal(waves, 1, 'only the first wave ran');
  assert.deepEqual(outcomes.filter(([, s]) => s === 'deferred').map(([k]) => k).sort(), ['b', 'c']);
});

test('a bulk source is never split into waves', async () => {
  const log = [];
  let runs = 0;
  const store = mkStore([film('a', { imdb: 't1' }), film('b'), film('c')]);
  const providers = [
    idProvider('wikidata', { log, delays: { a: 5, b: 60, c: 120 }, give: { b: { imdb: 'tt2' }, c: { imdb: 'tt3' } } }),
    { id: 'imdb', label: 'imdb', bulk: { minFilms: 1, cacheKey: 'k', minGapMs: 1 }, requires: f => !!f.ids?.imdb, async enrich(films, ctx) { runs++; for (const f of films) ctx.done(f, { r: 1 }); } },
  ];
  await enrich({ store, http, providers });
  assert.equal(runs, 1);
  assert.ok(store.films.b.src.imdb && store.films.c.src.imdb);
});

test('TMDB starts at once beside the id chain; the chain step only settles what the early run could not', async () => {
  const log = [];
  const calls = [];
  const store = mkStore([film('a', { tmdb: 5 }), film('b'), film('c')]);
  const tmdb = {
    id: 'tmdb', label: 'tmdb', earlyStart: true,
    async enrich(films, ctx) {
      calls.push([ctx.early, films.map(f => f.key).sort()]);
      log.push([ctx.early ? 'tmdb:early' : 'tmdb:chain', t0()]);
      for (const f of films) { if (ctx.early && f.key === 'c') continue; /* no confident hit: nothing recorded */ ctx.done(f, { poster: 'p', synopsis: 's' }); }
    },
  };
  const providers = [idProvider('wikidata', { log, delays: { a: 10, b: 200, c: 200 } }), tmdb];
  await enrich({ store, http, providers });
  assert.ok(at(log, 'tmdb:early') < at(log, 'wikidata:end') - 150, 'the search started with the chain, not after it');
  assert.deepEqual(calls, [[true, ['a', 'b', 'c']], [false, ['c']]], 'the chain step only takes the film the early run left');
});

test('the early TMDB run goes in the crawl\'s own lane (3), so a film the user can see (lane 2) is never queued behind it', async () => {
  const seen = [];
  const store = mkStore([film('a')]);
  const tmdb = { id: 'tmdb', label: 'tmdb', earlyStart: true, async enrich(films, ctx) { seen.push([ctx.early, ctx.http.lane]); for (const f of films) ctx.done(f, { poster: 'p' }); } };
  await enrich({ store, http: { withPriority: lane => ({ lane }) }, providers: [idProvider('wikidata', { log: [], delays: { a: 20 } }), tmdb] });
  assert.deepEqual(seen, [[true, 3]]);
});

test('Wikipedia waits for TMDB\'s step on the same film, so it can see whether TMDB has the poster', async () => {
  const log = [];
  const store = mkStore([film('a', { enwiki: 'A', tmdb: 5 })]);
  const tmdb = { id: 'tmdb', label: 'tmdb', earlyStart: true, async enrich(films, ctx) { await sleep(60); for (const f of films) ctx.done(f, { poster: 'p', synopsis: 's' }); log.push(['tmdb:done', t0()]); } };
  const wiki = reader('wikipedia', log, { needsIds: ['enwiki'], waitFor: ['tmdb'], requires: f => !!f.ids?.enwiki });
  await enrich({ store, http, providers: [idProvider('wikidata', { log, delays: { a: 10 } }), tmdb, wiki] });
  assert.ok(at(log, 'wikipedia:a') >= at(log, 'tmdb:done') - 2, 'wikipedia came after tmdb for the film');
});

test('a forced read of one film (the film page) reads each source once, however many waves it takes', async () => {
  const log = [], reads = [];
  const store = mkStore([film('a', { imdb: 't1' })]);
  store.films.a.checked = { omdb: new Date().toISOString(), wikidata: new Date().toISOString() };
  const providers = [
    idProvider('wikidata', { log, delays: { a: 30 }, give: { a: { imdb: 'tt9' } } }),
    { id: 'omdb', label: 'omdb', needsIds: ['imdb'], requires: f => !!f.ids?.imdb, async enrich(films, ctx) { for (const f of films) { reads.push(f.key); ctx.done(f, { y: 1 }); } } },
  ];
  await enrich({ store, http, providers, only: ['a'], force: true, ignoreBackoff: true });
  assert.deepEqual(reads, ['a']);
});
