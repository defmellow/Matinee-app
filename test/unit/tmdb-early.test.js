import test from 'node:test';
import assert from 'node:assert/strict';
import tmdb, { needsReconcile } from '../../core/providers/tmdb.js';

// Synthetic TMDB answers (clearly fake): the early guess from a title + year search, and settling it against the real id.
const settings = { keys: { tmdb: 'a'.repeat(32) } };
const detail = (id, title, year) => ({ id, title, original_title: title, overview: `About ${title}`, poster_path: `/p${id}.jpg`, release_date: `${year}-05-01`, external_ids: { imdb_id: `tt00${id}` } });

function fakeApi({ results = [], details = {}, found = null } = {}) {
  const calls = [];
  return {
    calls,
    async json(url) {
      const u = new URL(url), path = u.pathname.replace(/^\/3/, '');
      calls.push(path);
      if (path === '/search/movie') return { results };
      if (path.startsWith('/find/')) return { movie_results: found ? [{ id: found }] : [] };
      const id = Number(path.split('/').pop());
      if (details[id]) return details[id];
      const e = new Error('nope'); e.status = 404; throw e;
    },
  };
}
function run(films, http, { early = false, memo } = {}) {
  const rec = { done: [], fail: [] };
  const ctx = { http, settings, early, memo, progress() {}, log() {}, done: (f, data, ids) => rec.done.push({ f, data, ids }), fail: (f, e) => rec.fail.push({ f, e }) };
  return tmdb.enrich(films, ctx).then(() => rec);
}
const film = (o = {}) => ({ key: 'k', title: 'Harbour Lights', year: 2019, ids: {}, ...o });

test('early: a film with no ids is searched by title and year, stored as a guess without any ids', async () => {
  const http = fakeApi({ results: [{ id: 7, title: 'Harbour Lights', release_date: '2019-03-01' }], details: { 7: detail(7, 'Harbour Lights', 2019) } });
  const rec = await run([film()], http, { early: true });
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data.guessId, 7);
  assert.ok(rec.done[0].data.poster && rec.done[0].data.synopsis, 'poster and basics are there at once');
  assert.deepEqual(rec.done[0].ids, {}, 'a guess never writes ids, so Wikidata\'s ids still land');
  assert.deepEqual(http.calls, ['/search/movie', '/movie/7']);
});

test('early: a film that already has an id goes straight to its details, one request, no guess', async () => {
  const http = fakeApi({ details: { 9: detail(9, 'Harbour Lights', 2019) } });
  const rec = await run([film({ ids: { tmdb: 9 } })], http, { early: true });
  assert.deepEqual(http.calls, ['/movie/9']);
  assert.equal(rec.done[0].data.guessId, undefined);
  assert.equal(rec.done[0].ids.tmdb, 9);
});

test('early: a search hit with the wrong year or a different title is rejected, nothing is recorded', async () => {
  const wrongYear = fakeApi({ results: [{ id: 7, title: 'Harbour Lights', release_date: '2012-03-01' }] });
  let rec = await run([film()], wrongYear, { early: true });
  assert.equal(rec.done.length + rec.fail.length, 0);
  assert.deepEqual(wrongYear.calls, ['/search/movie'], 'one search only, no details fetched');
  const otherTitle = fakeApi({ results: [{ id: 8, title: 'Harbour Lights 2', release_date: '2019-03-01', popularity: 99 }] });
  rec = await run([film()], otherTitle, { early: true });
  assert.equal(rec.done.length + rec.fail.length, 0, 'the most popular near miss is not good enough for a guess');
  rec = await run([film({ year: undefined })], fakeApi({ results: [{ id: 7, title: 'Harbour Lights', release_date: '2019-03-01' }] }), { early: true });
  assert.equal(rec.done.length, 0, 'no year, no guess');
});

test('reconcile with the same id: the guess is kept, no request is made', async () => {
  const f = film({ ids: { tmdb: 7 }, src: { tmdb: { title: 'Harbour Lights', guessId: 7 } } });
  const http = fakeApi();
  const rec = await run([f], http);
  assert.deepEqual(http.calls, []);
  assert.equal(f.src.tmdb.guessId, undefined);
  assert.equal(f.src.tmdb.title, 'Harbour Lights');
  assert.deepEqual([rec.done.length, rec.done[0].data], [1, null]);
});

test('reconcile with a different id: the guessed film\'s data is dropped and the right film is fetched', async () => {
  const f = film({ ids: { tmdb: 12 }, src: { tmdb: { title: 'Wrong Film', synopsis: 'wrong', guessId: 7 } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  const http = fakeApi({ details: { 12: detail(12, 'Harbour Lights', 2019) } });
  const rec = await run([f], http);
  assert.deepEqual(http.calls, ['/movie/12']);
  assert.equal(f.src.tmdb, undefined, 'the wrong data is gone before the new data is written');
  assert.equal(rec.done[0].data.title, 'Harbour Lights');
  assert.equal(rec.done[0].data.guessId, undefined);
  assert.equal(rec.done[0].ids.tmdb, 12);
});

test('reconcile from an IMDb id only: TMDB\'s own lookup decides', async () => {
  const f = film({ ids: { imdb: 'tt0012' }, src: { tmdb: { guessId: 7 } } });
  const http = fakeApi({ found: 12, details: { 12: detail(12, 'Harbour Lights', 2019) } });
  const rec = await run([f], http);
  assert.deepEqual(http.calls, ['/find/tt0012', '/movie/12']);
  assert.equal(rec.done[0].ids.tmdb, 12);
});

test('wants: a guessed film comes back only once an authoritative id exists', () => {
  const guessed = { ids: {}, src: { tmdb: { guessId: 7 } }, checked: { tmdb: new Date().toISOString() } };
  assert.equal(needsReconcile(guessed), false);
  assert.equal(tmdb.wants(guessed, {}), false);
  guessed.ids.tmdb = 12;
  assert.equal(needsReconcile(guessed), true);
  assert.equal(tmdb.wants(guessed, {}), true);
});

test('reconcile: an empty /find means the guessed film does not carry the IMDb id, so the guess is dropped and the film is matched again', async () => {
  const f = film({ ids: { imdb: 'tt0099' }, src: { tmdb: { title: 'Wrong Film', synopsis: 'wrong', guessId: 7, guessImdb: 'tt0007' } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  const http = fakeApi({ found: null, results: [{ id: 12, title: 'Harbour Lights', release_date: '2019-03-01' }], details: { 12: detail(12, 'Harbour Lights', 2019) } });
  const rec = await run([f], http);
  assert.deepEqual(http.calls, ['/find/tt0099', '/search/movie', '/movie/12'], 'the empty /find is not repeated');
  assert.equal(f.src.tmdb, undefined, 'nothing of the wrong film is left to be kept');
  assert.equal(rec.done[0].data.title, 'Harbour Lights');
  assert.equal(rec.done[0].ids.tmdb, 12);
  assert.notEqual(f.ids.tmdb, 7, 'the guess never becomes the film\'s id');
});

test('reconcile: an empty /find is fine when the guessed film reported that very IMDb id', async () => {
  const f = film({ ids: { imdb: 'tt0007' }, src: { tmdb: { title: 'Harbour Lights', guessId: 7, guessImdb: 'tt0007' } } });
  const http = fakeApi({ found: null });
  const rec = await run([f], http);
  assert.deepEqual(http.calls, ['/find/tt0007']);
  assert.equal(f.ids.tmdb, 7);
  assert.equal(f.src.tmdb.guessId, undefined);
  assert.equal(f.src.tmdb.guessImdb, undefined);
  assert.equal(rec.done[0].data, null);
});

test('early guess keeps the guessed film\'s IMDb id beside the guess, but still writes no ids', async () => {
  const http = fakeApi({ results: [{ id: 7, title: 'Harbour Lights', release_date: '2019-03-01' }], details: { 7: detail(7, 'Harbour Lights', 2019) } });
  const rec = await run([film()], http, { early: true });
  assert.equal(rec.done[0].data.guessImdb, 'tt007');
  assert.deepEqual(rec.done[0].ids, {});
});

test('reconcile: a request that fails part-way leaves the guess exactly as it was, still flagged, for the next run', async () => {
  const f = film({ ids: { tmdb: 12 }, src: { tmdb: { title: 'Wrong Film', synopsis: 'wrong', guessId: 7 } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  const http = { async json() { throw Object.assign(new Error('busy'), { status: 503 }); } };
  const rec = await run([f], http);
  assert.equal(rec.fail.length, 1);
  assert.equal(rec.done.length, 0);
  assert.equal(f.src.tmdb.guessId, 7);
  assert.equal(f.src.tmdb.title, 'Wrong Film');
  assert.ok(f.checked.tmdb);
  assert.equal(needsReconcile(f), true, 'it will be settled next time');
});

test('reconcile: when nothing matches, the guess\'s data goes too, so it never stays as unflagged data', async () => {
  const f = film({ ids: { tmdb: 12 }, src: { tmdb: { title: 'Wrong Film', synopsis: 'wrong', guessId: 7 } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  const http = fakeApi({ details: {} }); // /movie/12 is a 404
  const rec = await run([f], http);
  assert.equal(f.src.tmdb, undefined);
  assert.equal(f.checked.tmdb, undefined);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
});

test('a full lookup that finds the guessed film keeps its data and only drops the flags; a different film replaces it', async () => {
  // no authoritative id, so this is the plain (non-reconcile) path with a standing guess
  const same = film({ src: { tmdb: { title: 'Harbour Lights', guessId: 7, guessImdb: 'tt007' } } });
  const searchHit = id => fakeApi({ results: [{ id, title: 'Harbour Lights', release_date: '2019-03-01' }], details: { [id]: detail(id, 'Harbour Lights', 2019) } });
  await run([same], searchHit(7));
  assert.equal(same.src.tmdb.guessId, undefined);
  assert.equal(same.src.tmdb.guessImdb, undefined);
  const other = film({ src: { tmdb: { title: 'Wrong Film', guessId: 5 } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  await run([other], searchHit(7));
  assert.equal(other.src.tmdb, undefined);
  const none = film({ src: { tmdb: { title: 'Wrong Film', guessId: 5 } }, checked: { tmdb: '2026-11-01T00:00:00Z' } });
  const rec = await run([none], fakeApi({ results: [] }));
  assert.equal(none.src.tmdb, undefined);
  assert.equal(rec.done[0].data, null);
});

test('ctx.memo: a search the early guess made is not repeated by the chain step', async () => {
  const memo = new Map();
  const http = fakeApi({ results: [{ id: 8, title: 'Harbour Lights 2', release_date: '2019-03-01' }] });
  const f1 = film();
  await run([f1], http, { early: true, memo });
  assert.deepEqual(http.calls, ['/search/movie']);
  await run([f1], http, { memo });
  assert.equal(http.calls.filter(c => c === '/search/movie').length, 1 + 3, 'only the year-1, year+1 and primary_release_year attempts are new');
});
