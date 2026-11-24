// 29 Oct: sources covered by TMDB / OMDb are left out of urgent reads; OMDb's daily counter persists; error codes survive wrapping; PRIORITY additions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coveredBy, coveredKeywords, wantsFor, enrich, createTrouble } from '../../core/enrich.js';
import { PRIORITY, compose } from '../../core/model.js';
import { createStore } from '../../core/store.js';
import wikipedia from '../../core/providers/wikipedia.js';
import rt from '../../core/providers/rottentomatoes.js';
import metacritic from '../../core/providers/metacritic.js';
import omdb from '../../core/providers/omdb.js';
import lbpage from '../../core/providers/lbpage.js';
import wikidata from '../../core/providers/wikidata.js';

const film = (src = {}) => ({ key: 'lid:x', slug: 'x', title: 'X', year: 2000, ids: { enwiki: 'X', imdb: 'tt1' }, src, checked: {}, missed: {} });
const tmdbFull = { poster: { url: 'p' }, synopsis: 'text' };

test('wikipedia is left out of the hover and on-screen lanes when TMDB has poster and synopsis, never for lane 0, background or force', () => {
  const f = film({ tmdb: tmdbFull });
  assert.ok(coveredBy(wikipedia, f, { lane: 2 })); assert.ok(coveredBy(wikipedia, f, { lane: 1 }));
  assert.equal(coveredBy(wikipedia, f, { lane: 0 }), null, 'an opened film reads everything');
  assert.equal(coveredBy(wikipedia, f, { lane: 3 }), null);
  assert.equal(coveredBy(wikipedia, f, { lane: null }), null);
  assert.equal(coveredBy(wikipedia, f, { lane: 2, force: true }), null);
  assert.equal(coveredBy(wikipedia, film({ tmdb: { poster: { url: 'p' } } }), { lane: 2 }), null, 'a synopsis is also needed');
  assert.equal(wantsFor(wikipedia, f, { lane: 2 }), false);
  assert.equal(wantsFor(wikipedia, f, { lane: 3 }), true);
  assert.equal(wantsFor(wikipedia, f, {}), true, 'checks that do not know a lane still see the work (it is only put off, not dropped)');
  assert.equal(wantsFor(wikipedia, f, { lane: 2, force: true }), true);
});

test('rt and metacritic: when OMDb holds the critics score they never hold up a film the user can see, but the background crawl still reads them for every film', () => {
  const f = film({ omdb: { ratings: { rt: { critics: 91 }, metacritic: { critics: 80 } } } });
  for (const p of [rt, metacritic]) {
    assert.ok(coveredBy(p, f, { lane: 2 }), p.id);
    assert.ok(coveredBy(p, f, { reread: true }), p.id);
    assert.ok(coveredBy(p, f, { lane: 3 }), p.id);
    // The crawl itself runs with no lane of its own: it reads them (in the last lane), so audience scores and the consensus
    // line no longer depend on whether the user opened the film.
    assert.equal(coveredBy(p, f, { lane: null }), null, p.id + ' is read by the background crawl');
    assert.equal(wantsFor(p, f, {}), true, p.id + ' counts as pending work');
    assert.equal(coveredBy(p, f, { lane: 0 }), null, 'an opened film reads everything, which fills the audience scores');
  }
  assert.equal(coveredBy(rt, film({ omdb: { ratings: { metacritic: { critics: 80 } } } }), { lane: 2 }), null, 'only the matching rating covers');
  assert.equal(coveredBy(metacritic, film({}), { reread: true }), null);
});

test('rt and metacritic: a film in cinemas or opening soon keeps its quiet re-read even when OMDb has the scores', () => {
  const now = Date.parse('2026-10-29T00:00:00Z');
  const hot = film({ omdb: { ratings: { rt: { critics: 91 } } }, tmdb: { released: '2026-11-20' } });
  assert.equal(coveredBy(rt, hot, { reread: true, now }), null);
  assert.ok(coveredBy(rt, hot, { lane: 2, now }), 'still left out of the urgent lanes');
  const old = film({ omdb: { ratings: { rt: { critics: 91 } } }, tmdb: { released: '2001-01-01' } });
  assert.ok(coveredBy(rt, old, { reread: true, now }));
  assert.equal(wantsFor(rt, { ...hot, checked: { rt: '2026-01-01T00:00:00Z' } }, { reread: true, now }), true);
});

test('IMDb keyword page: covered at 10 or more TMDB keywords', () => {
  assert.equal(coveredKeywords(film({ tmdb: { keywords: Array.from({ length: 10 }, (_, i) => 'k' + i) } })), true);
  assert.equal(coveredKeywords(film({ tmdb: { keywords: ['a'] } })), false);
  assert.equal(coveredKeywords(film({})), false);
});

test('enrich: a lane-2 run skips covered films; providers get ctx.keywordsCovered', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-cov-'));
  const store = createStore(dir);
  store.films['lid:x'] = { ...film({ tmdb: tmdbFull }), key: 'lid:x' };
  const seen = [];
  const p = { ...wikipedia, async enrich(films, ctx) { seen.push(films.length); assert.equal(typeof ctx.keywordsCovered, 'function'); } };
  await enrich({ store, providers: [p], http: {}, only: ['lid:x'], lane: 2 });
  assert.deepEqual(seen, [], 'not asked at all in lane 2');
  await enrich({ store, providers: [p], http: {}, only: ['lid:x'], lane: 3 });
  assert.deepEqual(seen, [1]);
});

test('film page: a covered source reads as "read later in the background", not "not read yet"', async () => {
  const { createCore } = await import('../../core/api.js');
  const core = createCore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-cov-')), providers: [wikipedia], fetch: async () => new Response('x', { status: 404 }) });
  core.store.films['lid:x'] = film({ tmdb: tmdbFull }); core.store.library.films['lid:x'] = { watchlist: true, tags: [] };
  const o = (await core.call('getFetchStatus', { key: 'lid:x' })).outcomes[0];
  assert.equal(o.status, 'deferred'); assert.match(o.reason, /TMDB already has/);
});

test('ctx.quota: counts per UTC day in cache.json, seeds from the old settings counter, and a scratch store never touches the real one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-quota-'));
  const store = createStore(dir);
  const day = new Date().toISOString().slice(0, 10);
  store.library.settings.keys = { omdb: 'k' }; store.library.settings.omdbUsage = { day, n: 7 };
  store.films['lid:x'] = film({});
  let q;
  const p = { id: 'omdb', label: 'OMDb', async enrich(films, ctx) { q = ctx.quota; } };
  await enrich({ store, providers: [p], http: {}, only: ['lid:x'] });
  assert.equal(q.get(), 7, 'the count the app kept before is not lost');
  q.add(3);
  assert.equal(q.get(), 10);
  assert.deepEqual(store.cache['quota:omdb'].value, { day, n: 10 });
  // a new core reading the same files sees the count
  store.flush();
  const again = createStore(dir);
  assert.equal(again.cached('quota:omdb', 864e5).n, 10);
  // another day starts from zero
  store.cache['quota:omdb'].value.day = '2000-01-01'; store.library.settings.omdbUsage = { day: '2000-01-01', n: 99 };
  await enrich({ store, providers: [p], http: {}, only: ['lid:x'], full: true });
  assert.equal(q.get(), 0);
  // a scratch store without cached/setCached just gets no quota (omdb falls back to settings)
  q = 'unset';
  await enrich({ store: { library: { settings: {}, films: {} }, films: { 'lid:x': film({}) }, touch() {}, flush() {} }, providers: [p], http: {}, only: ['lid:x'] });
  assert.equal(q, undefined);
});

test('omdb really uses ctx.quota (the key names line up)', async () => {
  let used = 0;
  const f = film({}); f.ids.imdb = 'tt1';
  const http = { json: async () => ({ Response: 'False', Error: 'Movie not found!' }), text: async () => ({ status: 200, text: JSON.stringify({ Response: 'False', Error: 'Movie not found!' }) }), response: async () => new Response(JSON.stringify({ Response: 'False', Error: 'Movie not found!' })) };
  await omdb.enrich([f], { http, settings: { keys: { omdb: 'abc' } }, quota: { get: () => used, add: n => { used += n; } }, progress() {}, log() {}, skip: () => false, done() {}, fail() {} }).catch(() => {});
  assert.ok(used >= 1);
});

test('trouble.raise / resolve: outside notices use the same once-per-six-hours channel', () => {
  let t = 0; const out = [];
  const tr = createTrouble({ now: () => t, emit: (e, n) => out.push([e, n.key]) });
  tr.raise('cinema:dendy', 'Dendy Newtown', 'msg'); tr.raise('cinema:dendy', 'Dendy Newtown', 'msg');
  assert.deepEqual(tr.list().map(n => n.key), ['cinema:dendy']);
  assert.deepEqual(out, [['trouble', 'cinema:dendy']]);
  tr.resolve('cinema:dendy');
  assert.deepEqual(tr.list(), []);
});

test('wikidata and lbpage keep status and code on the errors they rewrap', async () => {
  const fails = [];
  const ctx = { http: { json: async () => { throw Object.assign(new Error('x'), { status: 429, code: 'host-paused' }); }, text: async () => { throw Object.assign(new Error('x'), { status: 429, code: 'host-paused' }); } }, signal: undefined,
    progress() {}, log() {}, skip: () => false, done() {}, fail: (f, e) => fails.push(e), settings: {} };
  await wikidata.enrich([{ key: 'a', title: 'A', year: 2000, ids: { wikidata: 'Q1' }, src: {} }], ctx).catch(() => {});
  assert.ok(fails.length, 'the wikidata lookup failed');
  assert.equal(fails[0].status, 429); assert.equal(fails[0].code, 'host-paused');
  assert.match(fails[0].message, /slow down/);
  const lbFails = [];
  await lbpage.enrich([{ key: 'b', slug: 'b' }], { http: { browserText: async () => { throw Object.assign(new Error('x'), { status: 429, code: 'host-paused' }); } }, progress() {}, log() {}, skip: () => false, done() {}, fail: (f, e) => lbFails.push(e) });
  assert.equal(lbFails[0].status, 429); assert.equal(lbFails[0].code, 'host-paused');
  assert.match(lbFails[0].message, /turned the request away/);
});

test('model: PRIORITY additions (boxOffice, countries, awardsText) and the new poster order', () => {
  assert.deepEqual(PRIORITY.boxOffice, ['tmdb', 'wikidata', 'omdb']);
  assert.deepEqual(PRIORITY.countries, ['tmdb', 'wikidata', 'omdb', 'lbpage']);
  assert.deepEqual(PRIORITY.awardsText, ['omdb']);
  assert.deepEqual(PRIORITY.poster, ['tmdb', 'lbpage', 'wikipedia', 'omdb', 'rss']);
  const c = compose(film({ omdb: { awardsText: 'Won 2 Oscars.', boxOffice: 5, countries: ['Chile'] }, wikidata: { countries: ['Peru'] } }));
  assert.equal(c.awardsText, 'Won 2 Oscars.'); assert.equal(c.boxOffice, 5); assert.deepEqual(c.countries, ['Peru']);
  assert.equal(compose(film({ omdb: { boxOffice: 5, countries: ['Chile'] } })).countries[0], 'Chile');
});

test('debug: scores and feel text are credited to the source that supplied them', async () => {
  const { scoreAndFeelSources } = await import('../../core/model.js');
  const f = { src: {
    omdb: { ratings: { rt: { critics: 90 }, metacritic: { critics: 80 }, imdb: { value: 7.5, votes: 10 } } },
    rt: { ratings: { rt: { critics: 91, audience: 85 } }, consensus: 'A tense ride.' },
    mcreviews: { critics: [{ text: 'Sharp.' }], users: [] },
  } };
  const s = scoreAndFeelSources(f);
  assert.equal(s['Rotten Tomatoes scores'], 'rt');
  assert.equal(s['Rotten Tomatoes audience score'], 'rt');
  assert.equal(s['Metacritic scores'], 'omdb');
  assert.equal(s['Metacritic user score'], undefined);
  assert.equal(s['IMDb score'], 'omdb');
  assert.equal(s['feel: critics consensus'], 'rt');
  assert.equal(s['feel: critic quotes'], 'mcreviews');
  assert.equal(s['feel: Metacritic user reviews'], undefined);
});
