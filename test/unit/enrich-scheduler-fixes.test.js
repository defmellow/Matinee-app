import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich, coveredBy } from '../../core/enrich.js';
import tmdb from '../../core/providers/tmdb.js';
import rt from '../../core/providers/rottentomatoes.js';

// Regression tests for the per-film scheduler (synthetic films and answers, clearly fake).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mkStore = (films, settings = {}) => ({ library: { settings, films: {} }, films: Object.fromEntries(films.map(f => [f.key, f])), touch() {}, flush() {} });
const detail = (id, title, year) => ({ id, title, original_title: title, overview: `About ${title} `.repeat(5), poster_path: `/p${id}.jpg`, release_date: `${year}-05-01`, external_ids: { imdb_id: `tt00${id}` } });
function fakeTmdbHttp(calls) {
  return {
    async json(url) {
      const path = new URL(url).pathname.replace(/^\/3/, '');
      calls.push(path);
      await sleep(5);
      if (path === '/search/movie') return { results: [{ id: 7, title: 'Harbour Lights', release_date: '2019-03-01' }] };
      if (path.startsWith('/find/')) return { movie_results: [] };
      const id = Number(path.split('/').pop());
      if (id === 7) return { ...detail(7, 'Wrong Film', 2019), title: 'Harbour Lights', overview: 'The guessed film. '.repeat(4), keywords: { keywords: [{ name: 'wrong keyword' }] } };
      if (id === 12) return detail(12, 'Harbour Lights', 2019);
      throw Object.assign(new Error('nope'), { status: 404 });
    },
  };
}
const wikidata = (give, delay) => ({ id: 'wikidata', label: 'wd', async enrich(films, ctx) { await sleep(delay); for (const f of films) ctx.done(f, { x: 1 }, give); } });

for (const [name, opts] of [['background pass', {}], ['opened film (only, lane 0, force)', { only: ['a'], lane: 0, force: true, ignoreBackoff: true }]]) {
  test(`a wrong TMDB guess is settled in the run that made it: ${name}`, async () => {
    const calls = [];
    const store = mkStore([{ key: 'a', title: 'Harbour Lights', year: 2019, ids: {} }], { keys: { tmdb: 'a'.repeat(32) } });
    await enrich({ store, http: fakeTmdbHttp(calls), providers: [wikidata({ tmdb: 12 }, 80), tmdb], ...opts });
    const f = store.films.a;
    assert.ok(calls.includes('/movie/12'), 'the authoritative film was fetched: ' + calls);
    assert.equal(f.src.tmdb.guessId, undefined);
    assert.equal(f.src.tmdb.guessImdb, undefined);
    assert.equal(f.ids.tmdb, 12);
    assert.equal(f.src.tmdb.keywords, undefined, 'nothing of the guessed film remains');
    assert.match(f.src.tmdb.synopsis, /About Harbour Lights/);
  });
}

test('Wikipedia is not released for a film while its TMDB guess is waiting to be settled', async () => {
  const calls = [], seen = [];
  const store = mkStore([{ key: 'a', title: 'Harbour Lights', year: 2019, ids: {} }], { keys: { tmdb: 'a'.repeat(32) } });
  const wikipedia = { id: 'wikipedia', label: 'wp', needsIds: ['enwiki'], waitFor: ['tmdb'], async enrich(films, ctx) { for (const f of films) { seen.push(f.src?.tmdb?.guessId ?? 'settled'); ctx.done(f, { x: 1 }); } } };
  await enrich({ store, http: fakeTmdbHttp(calls), providers: [wikidata({ tmdb: 12, enwiki: 'Harbour_Lights' }, 60), tmdb, wikipedia] });
  assert.deepEqual(seen, ['settled']);
});

test('a source that turns requests away is left alone after 3 failed reads in a row, even when films arrive one at a time', async () => {
  const keys = 'abcdefghij'.split('');
  const store = mkStore(keys.map(k => ({ key: k, title: 'Film ' + k, year: 2001, ids: {} })));
  let reqs = 0;
  const http = { async text(url) { reqs++; await sleep(2); return { status: 200, url, text: '<html><body>Just a moment</body></html>' }; } };
  const oneAtATime = { id: 'wikidata', label: 'wd', async enrich(films, ctx) { for (const f of films) { await sleep(30); ctx.done(f, { x: 1 }, { rt: 'm/film_' + f.key }); } } };
  const outcomes = [];
  await enrich({ store, http, providers: [oneAtATime, rt], onOutcome: (f, p, o) => { if (p.id === 'rt') outcomes.push(o.status); } });
  assert.ok(reqs <= 3, `expected at most 3 requests, got ${reqs}`);
  assert.equal(outcomes.length, 10, 'every film still gets an answer');
  assert.ok(outcomes.filter(s => s === 'deferred').length >= 7, 'the films not read are reported as not reached');
});

test('a recorded film resets the block streak (a source that works in between is not stopped)', async () => {
  const keys = 'abcdefgh'.split('');
  const store = mkStore(keys.map(k => ({ key: k, title: 'Film ' + k, year: 2001, ids: {} })));
  let n = 0;
  const strict = { id: 'rt', label: 'rt', needsIds: ['rt'], async enrich(films, ctx) { for (const f of films) { if (++n % 3 === 0) ctx.done(f, { y: 1 }); else ctx.fail(f, Object.assign(new Error('no'), { status: 403 })); } } };
  const oneAtATime = { id: 'wikidata', label: 'wd', async enrich(films, ctx) { for (const f of films) { await sleep(20); ctx.done(f, { x: 1 }, { rt: 'm/' + f.key }); } } };
  await enrich({ store, http: {}, providers: [oneAtATime, strict] });
  assert.equal(n, 8, 'every film was tried');
});

test('early TMDB progress never goes backwards and the early wave reports no false "not reached"', async () => {
  const store = mkStore('abcdefghij'.split('').map(k => ({ key: k, title: 'F' + k, year: 2001, ids: {} })));
  const events = [], oc = [];
  const early = { id: 'tmdb', label: 'tmdb', earlyStart: true, async enrich(films, ctx) { let n = 0; for (const f of films) { await sleep(2); if (!(ctx.early && 'abc'.includes(f.key))) ctx.done(f, { poster: 'p' }); ctx.progress(++n, films.length); } } };
  await enrich({
    store, http: {}, providers: [wikidata({}, 50), early],
    emit: (e, p) => { if (e === 'progress' && p.provider === 'tmdb') events.push([p.done, p.total]); },
    onOutcome: (f, p, o) => { if (p.id === 'tmdb') oc.push([f.key, o.status, o.reason]); },
  });
  for (let i = 1; i < events.length; i++) assert.ok(events[i][0] >= events[i - 1][0], `done went back: ${JSON.stringify(events)}`);
  assert.ok(events.every(([d, t]) => d <= t), `done passed total: ${JSON.stringify(events)}`);
  assert.deepEqual(oc.filter(o => o[2] === 'not reached this time'), []);
  assert.equal(oc.length, 10, 'each film is reported once, by the wave that handled it');
});

test('Wikipedia is left out of the urgent lanes when TMDB has the poster and synopsis, and read in the background crawl', () => {
  const wiki = { id: 'wikipedia' };
  const f = { src: { tmdb: { poster: { url: 'x' }, synopsis: 'text' } } };
  for (const lane of [1, 2]) assert.ok(coveredBy(wiki, f, { lane }), 'lane ' + lane);
  for (const lane of [0, 3, 4, null]) assert.equal(coveredBy(wiki, f, { lane }), null, 'lane ' + lane);
});

test('the early TMDB run and the chain step share one search for a film the guess missed', async () => {
  const calls = [];
  const store = mkStore([{ key: 'a', title: 'Harbour Lights', year: 2019, ids: {} }], { keys: { tmdb: 'a'.repeat(32) } });
  const http = { async json(url) { const path = new URL(url).pathname.replace(/^\/3/, ''); const q = new URL(url).searchParams; calls.push(path + (q.has('year') ? '?year=' + q.get('year') : q.has('primary_release_year') ? '?prim=' + q.get('primary_release_year') : '')); await sleep(2); return { results: [] }; } };
  await enrich({ store, http, providers: [wikidata({}, 40), tmdb] });
  const same = calls.filter(c => c === '/search/movie?year=2019');
  assert.equal(same.length, 1, calls.join(' '));
});
