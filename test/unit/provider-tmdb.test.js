// TMDB provider tests. All responses are hand-written synthetic fixtures (test/fixtures/synthetic/tmdb-*.json),
// shaped from the public API docs: no live calls, no real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tmdb, { authFor, validateKey, mapMovie, ATTRIBUTION } from '../../core/providers/tmdb.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';
import { compose } from '../../core/model.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));
const full = load('tmdb-movie-full');
const sparse = load('tmdb-movie-sparse');
const bare = load('tmdb-movie-bare');
const search = load('tmdb-search');
const searchEmpty = load('tmdb-search-empty');
const find = load('tmdb-find');
const findEmpty = load('tmdb-find-empty');
const configuration = load('tmdb-configuration');

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // made-up 32-hex key
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl'; // made-up JWT-looking token
const settings = (extra = {}) => ({ keys: { tmdb: KEY }, region: 'AU', ...extra });

/** A fake http whose route(call) returns the response body (or throws an HttpError). */
function fakeHttp(route) {
  const calls = [];
  return {
    calls,
    async json(url, opts = {}) {
      const u = new URL(url);
      const call = { url, host: u.host, path: u.pathname.replace(/^\/3/, ''), q: Object.fromEntries(u.searchParams), headers: opts.headers || {}, signal: opts.signal };
      calls.push(call);
      return route(call);
    },
  };
}

function makeCtx(http, { settings: s = settings(), signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, settings: s, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: (...a) => rec.log.push(a.join(' ')),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}

const film = (o = {}) => ({ key: 'lid:abc', title: 'Harbour Lights', year: 2019, ids: {}, ...o });
const run = async (films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await tmdb.enrich(films, ctx); return rec; };

/** Route helper: details for any /movie/<id>, plus per-test search/find handlers. */
const movieRoute = (details = full, { searchFn, findFn } = {}) => call => {
  if (call.path.startsWith('/movie/')) return details;
  if (call.path === '/search/movie') return searchFn ? searchFn(call) : searchEmpty;
  if (call.path.startsWith('/find/')) return findFn ? findFn(call) : findEmpty;
  throw new HttpError(404, call.url);
};

// ---------- contract ----------

test('provider shape: key provider with plain-English help and the required attribution', () => {
  assert.equal(tmdb.id, 'tmdb');
  assert.equal(tmdb.label, 'TMDB');
  assert.equal(tmdb.needsKey, true);
  assert.equal(tmdb.refreshDays, 21);
  assert.equal(tmdb.keyHelp.url, 'https://www.themoviedb.org/settings/api');
  assert.ok(tmdb.keyHelp.steps.length >= 3 && tmdb.keyHelp.steps.length <= 4);
  assert.ok(tmdb.keyHelp.steps.some(s => /Developer/.test(s)) && tmdb.keyHelp.steps.some(s => /personal/i.test(s)));
  assert.ok(Array.isArray(tmdb.gives) && tmdb.gives.length > 0);
  assert.ok(tmdb.attribution.includes('This product uses the TMDB API but is not endorsed or certified by TMDB.'));
  assert.equal(tmdb.attribution, ATTRIBUTION);
  assert.equal(typeof tmdb.enrich, 'function');
});

test('enabled() needs a key, and ignores blanks', () => {
  assert.equal(tmdb.enabled({ keys: { tmdb: KEY } }), true);
  assert.equal(tmdb.enabled({ keys: { tmdb: `  ${KEY}\n` } }), true);
  assert.equal(tmdb.enabled({ keys: { tmdb: '   ' } }), false);
  assert.equal(tmdb.enabled({ keys: {} }), false);
  assert.equal(tmdb.enabled({}), false);
  assert.equal(tmdb.enabled(undefined), false);
});

test('default freshness rules work with it (no key-specific wants())', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(defaultWants(tmdb, film(), { now }), true);
  const fresh = film({ checked: { tmdb: '2026-09-20T00:00:00Z' } });
  assert.equal(defaultWants(tmdb, fresh, { now, full: true }), false);
  const stale = film({ checked: { tmdb: '2026-07-01T00:00:00Z' } }); // an older film being opened: due after 45 days
  assert.equal(defaultWants(tmdb, stale, { now, full: true }), true);
});

// ---------- auth ----------

test('authFor: a 32-hex v3 key goes in the query string', () => {
  assert.deepEqual(authFor(KEY), { params: { api_key: KEY }, headers: {} });
});

test('authFor: a JWT-looking v4 token goes in a Bearer header', () => {
  assert.deepEqual(authFor(TOKEN), { params: {}, headers: { authorization: `Bearer ${TOKEN}` } });
});

test('authFor: trims whitespace and newlines from pasted keys', () => {
  assert.equal(authFor(`  ${KEY}\n`).params.api_key, KEY);
  assert.equal(authFor(`\t${TOKEN} `).headers.authorization, `Bearer ${TOKEN}`);
});

test('a v3 key is sent as api_key and no Authorization header', async () => {
  const http = fakeHttp(movieRoute());
  await run([film({ ids: { tmdb: 900001 } })], http);
  assert.equal(http.calls[0].q.api_key, KEY);
  assert.equal(http.calls[0].headers.authorization, undefined);
});

test('a v4 token is sent as a Bearer header and never in the URL', async () => {
  const http = fakeHttp(movieRoute());
  await run([film({ ids: { tmdb: 900001 } })], http, { settings: settings({ keys: { tmdb: TOKEN } }) });
  assert.equal(http.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(http.calls[0].q.api_key, undefined);
  assert.ok(!http.calls[0].url.includes(TOKEN));
});

test('no key: does nothing and makes no calls', async () => {
  const http = fakeHttp(movieRoute());
  const rec = await run([film()], http, { settings: { keys: {} } });
  assert.equal(http.calls.length, 0);
  assert.equal(rec.done.length, 0);
});

// ---------- matching ----------

test('match by TMDB id: one details call with every section appended, nothing else', async () => {
  const http = fakeHttp(movieRoute());
  const rec = await run([film({ ids: { tmdb: '900001' } })], http);
  assert.equal(http.calls.length, 1);
  const c = http.calls[0];
  assert.equal(c.host, 'api.themoviedb.org');
  assert.equal(c.path, '/movie/900001');
  assert.deepEqual(c.q.append_to_response.split(','), ['credits', 'keywords', 'release_dates', 'recommendations', 'reviews', 'external_ids']);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data.title, 'Harbour Lights');
});

test('match by IMDb id: /find then details, no title search', async () => {
  const http = fakeHttp(movieRoute(full, { findFn: () => find }));
  const rec = await run([film({ ids: { imdb: 'tt9000001' } })], http);
  assert.deepEqual(http.calls.map(c => c.path), ['/find/tt9000001', '/movie/900001']);
  assert.equal(http.calls[0].q.external_source, 'imdb_id');
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('an IMDb id TMDB does not know falls back to searching by title and year', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => search }));
  const rec = await run([film({ ids: { imdb: 'tt9000001' } })], http);
  assert.deepEqual(http.calls.map(c => c.path), ['/find/tt9000001', '/search/movie', '/movie/900001']);
  assert.equal(rec.done[0].data.title, 'Harbour Lights');
});

test('a malformed IMDb id is not sent to /find', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => search }));
  await run([film({ ids: { imdb: 'not-an-id' } })], http);
  assert.ok(!http.calls.some(c => c.path.startsWith('/find/')));
});

test('a TMDB id that 404s falls back to the IMDb id', async () => {
  const http = fakeHttp(call => {
    if (call.path === '/movie/111') throw new HttpError(404, call.url);
    return movieRoute(full, { findFn: () => find })(call);
  });
  const rec = await run([film({ ids: { tmdb: '111', imdb: 'tt9000001' } })], http);
  assert.deepEqual(http.calls.map(c => c.path), ['/movie/111', '/find/tt9000001', '/movie/900001']);
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('search by title and year: first try uses year=, exact title wins over a more popular decoy', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => search }));
  const rec = await run([film()], http);
  assert.deepEqual(http.calls.map(c => c.path), ['/search/movie', '/movie/900001']);
  assert.equal(http.calls[0].q.query, 'Harbour Lights');
  assert.equal(http.calls[0].q.year, '2019');
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('search tries year, then primary_release_year, then year-1, then year+1', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => searchEmpty }));
  const rec = await run([film()], http);
  const searches = http.calls.filter(c => c.path === '/search/movie');
  assert.deepEqual(searches.map(c => [c.q.year, c.q.primary_release_year]), [['2019', undefined], [undefined, '2019'], ['2018', undefined], ['2020', undefined]]);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
});

test('search stops at the first attempt that finds an exact match (primary_release_year)', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: c => (c.q.primary_release_year ? search : searchEmpty) }));
  const rec = await run([film()], http);
  assert.equal(http.calls.filter(c => c.path === '/search/movie').length, 2);
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('a film TMDB dates a year earlier is still found (year ±1)', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: c => (c.q.year === '2019' ? search : searchEmpty) }));
  const rec = await run([film({ year: 2020 })], http);
  // searched 2020, primary 2020, then 2019 (hit: the 2019 release is within a year of 2020)
  assert.equal(http.calls.filter(c => c.path === '/search/movie').length, 3);
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('title matching ignores accents, case, punctuation and & / and', async () => {
  const results = { results: [{ id: 5, title: 'Tom & Jerry: The Movie', original_title: 'x', release_date: '2019-01-01', popularity: 1 }] };
  const http = fakeHttp(movieRoute({ ...full, id: 5 }, { searchFn: () => results }));
  const rec = await run([film({ title: 'tom and jerry the movie' })], http);
  assert.equal(rec.done[0].ids.tmdb, 5);
  const accents = { results: [{ id: 6, title: 'Amélie', original_title: 'Le Fabuleux Destin d’Amélie Poulain', release_date: '2001-04-25', popularity: 1 }] };
  const http2 = fakeHttp(movieRoute({ ...full, id: 6 }, { searchFn: () => accents }));
  const rec2 = await run([film({ title: 'Amelie', year: 2001 })], http2);
  assert.equal(rec2.done[0].ids.tmdb, 6);
});

test('an exact match on the original title also counts', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => ({ results: [{ id: 900001, title: 'Harbour Lights', original_title: 'Les Lumières du Port', release_date: '2019-06-14', popularity: 1 }] }) }));
  const rec = await run([film({ title: 'Les Lumieres du Port' })], http);
  assert.equal(rec.done[0].ids.tmdb, 900001);
});

test('with no exact title: the most popular result within ±1 year, ignoring far-off years', async () => {
  const results = { results: [
    { id: 1, title: 'Harbour Lights Revisited', release_date: '2010-01-01', popularity: 500 },
    { id: 2, title: 'Harbour Light', release_date: '2020-01-01', popularity: 10 },
    { id: 3, title: 'The Harbour Lights Story', release_date: '2019-05-05', popularity: 30 },
    { id: 4, title: 'Harbour Nights', release_date: '', popularity: 900 },
  ] };
  const http = fakeHttp(movieRoute({ ...full, id: 3 }, { searchFn: () => results }));
  const rec = await run([film()], http);
  assert.equal(http.calls.at(-1).path, '/movie/3');
  assert.equal(rec.done[0].ids.tmdb, 3);
});

test('an exact title in the wrong decade is not a match', async () => {
  const results = { results: [{ id: 920002, title: 'Harbour Lights', release_date: '2009-02-02', popularity: 60 }] };
  const http = fakeHttp(movieRoute(full, { searchFn: () => results }));
  const rec = await run([film()], http);
  assert.ok(!http.calls.some(c => c.path.startsWith('/movie/')));
  assert.equal(rec.done[0].data, null);
});

test('no year on the film: one title-only search, exact title only', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => search }));
  const rec = await run([film({ year: null })], http);
  assert.equal(http.calls.filter(c => c.path === '/search/movie').length, 1);
  assert.equal(http.calls[0].q.year, undefined);
  assert.equal(rec.done[0].ids.tmdb, 900001); // the more popular exact match of the two "Harbour Lights"
  const http2 = fakeHttp(movieRoute(full, { searchFn: () => ({ results: [{ id: 9, title: 'Something Else', release_date: '2019-01-01', popularity: 99 }] }) }));
  const rec2 = await run([film({ year: null })], http2);
  assert.equal(rec2.done[0].data, null);
});

test('no confident match: ctx.done(film, null) with no ids, not a failure', async () => {
  const http = fakeHttp(movieRoute(full, { searchFn: () => searchEmpty }));
  const f = film();
  const rec = await run([f], http);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].film, f);
  assert.equal(rec.done[0].data, null);
  assert.equal(rec.done[0].ids, undefined);
  assert.equal(rec.fail.length, 0);
});

// ---------- mapping ----------

test('maps every field of the full response', async () => {
  const http = fakeHttp(movieRoute());
  const rec = await run([film({ ids: { tmdb: 900001 } })], http);
  const { data, ids } = rec.done[0];

  assert.equal(data.title, 'Harbour Lights');
  assert.equal(data.originalTitle, 'Les Lumières du Port');
  assert.deepEqual(data.poster, {
    url: 'https://image.tmdb.org/t/p/w500/synthPosterAbc123.jpg',
    thumb: 'https://image.tmdb.org/t/p/w342/synthPosterAbc123.jpg',
    width: 500, height: 750,
  });
  assert.equal(data.backdrop, 'https://image.tmdb.org/t/p/w1280/synthBackdropXyz789.jpg');
  assert.match(data.synopsis, /^A night-shift ferry pilot/);
  assert.equal(data.tagline, 'Follow the lights.');
  assert.equal(data.runtime, 118);
  assert.equal(data.released, '2019-06-14');
  assert.deepEqual(data.genres, ['Thriller', 'Drama']);
  assert.deepEqual(data.keywords, ['ferry', 'conspiracy', 'night']);
  assert.deepEqual(data.countries, ['France', 'USA', 'UK']);
  assert.deepEqual(data.languages, ['French', 'English']); // original language first
  assert.deepEqual(data.studios, ['Maison Bleue', 'Tidewater Pictures']);
  assert.equal(data.collection, 'Harbour Lights Collection');
  assert.equal(data.boxOffice, 48500000);
  assert.equal(data.budget, 12000000);
  assert.equal(data.certification, 'M'); // AU cinema release beats the AU DVD re-rating and the US rating
  assert.deepEqual(data.ratings, { tmdb: { value: 7.4, votes: 3210 } });
  assert.deepEqual(ids, { tmdb: 900001, imdb: 'tt9000001', wikidata: 'Q900001' });
});

test('maps people by role: dedupes writers, caps producers and cast, cast roles are characters', async () => {
  const { data } = mapMovie(full);
  const p = data.people;
  assert.deepEqual(Object.keys(p), ['director', 'writer', 'cinematography', 'composer', 'editor', 'producer', 'cast']);
  assert.deepEqual(p.director, [{ name: 'Claire Beaumont', id: 'tmdb:201' }]);
  // Screenplay + Writer by one person collapse to one entry; Story by the director is its own (different person id)
  assert.deepEqual(p.writer.map(w => w.id), ['tmdb:202', 'tmdb:201', 'tmdb:203']);
  assert.equal(p.writer[0].role, 'Screenplay, Writer');
  assert.equal(p.writer[1].role, 'Story');
  assert.equal(p.writer[2].role, 'Novel');
  assert.deepEqual(p.cinematography, [{ name: 'Farid Nasser', id: 'tmdb:204' }]);
  assert.deepEqual(p.composer.map(c => c.name), ['Greta Solheim', 'Hal Brandt']);
  assert.deepEqual(p.editor, [{ name: 'Iris Colbert', id: 'tmdb:207' }]);
  assert.equal(p.producer.length, 6);
  assert.deepEqual(p.producer.map(x => x.id), ['tmdb:208', 'tmdb:209', 'tmdb:210', 'tmdb:211', 'tmdb:212', 'tmdb:213']);
  assert.ok(!p.producer.some(x => x.name === 'Ravi Kulkarni'), 'executive producers are not producers');
  assert.equal(p.cast.length, 15);
  assert.deepEqual(p.cast[0], { name: 'Ana Roux', id: 'tmdb:101', role: 'Mireille Fontaine' });
  assert.equal(p.cast[14].id, 'tmdb:115');
});

test('cast with no character name has no role; cast is ordered by billing', () => {
  const d = { id: 1, credits: { cast: [
    { id: 3, name: 'Third', character: 'C', order: 2 },
    { id: 1, name: 'First', character: '', order: 0 },
    { id: 2, name: 'Second', character: 'B', order: 1 },
  ], crew: [] } };
  const { cast } = mapMovie(d).data.people;
  assert.deepEqual(cast, [{ name: 'First', id: 'tmdb:1' }, { name: 'Second', id: 'tmdb:2', role: 'B' }, { name: 'Third', id: 'tmdb:3', role: 'C' }]);
});

test('similar: top 12 recommendations as { title, year, ids.tmdb }', () => {
  const { similar } = mapMovie(full).data;
  assert.equal(similar.length, 12);
  assert.deepEqual(similar[0], { title: 'Rec One', year: 2017, ids: { tmdb: 910001 } });
  assert.deepEqual(similar[11], { title: 'Rec Twelve', year: null, ids: { tmdb: 910012 } }); // blank date → null year
});

test('where to watch is not asked for or stored (removed from the app)', async () => {
  const http = fakeHttp(movieRoute());
  const rec = await run([film({ ids: { tmdb: 900001 } })], http);
  assert.equal(http.calls[0].q.append_to_response.includes('watch/providers'), false);
  assert.equal('streaming' in mapMovie(full).data, false);
  assert.equal('streaming' in rec.done[0].data, false);
});

test('certification: AU first, then US, preferring the cinema release', () => {
  const cert = results => mapMovie({ id: 1, release_dates: { results } }).data.certification;
  const rd = (certification, type) => ({ certification, type, release_date: '2019-01-01T00:00:00.000Z' });
  assert.equal(cert([{ iso_3166_1: 'US', release_dates: [rd('R', 3)] }, { iso_3166_1: 'AU', release_dates: [rd('PG', 3)] }]), 'PG');
  assert.equal(cert([{ iso_3166_1: 'US', release_dates: [rd('R', 3)] }]), 'R');
  assert.equal(cert([{ iso_3166_1: 'AU', release_dates: [rd('', 3)] }, { iso_3166_1: 'US', release_dates: [rd('PG-13', 3)] }]), 'PG-13'); // blank AU → US
  assert.equal(cert([{ iso_3166_1: 'AU', release_dates: [rd('MA15+', 5), rd('M', 3)] }]), 'M');
  assert.equal(cert([{ iso_3166_1: 'AU', release_dates: [rd('MA15+', 5), rd('', 3)] }]), 'MA15+'); // only a home-video rating exists
  assert.equal(cert([{ iso_3166_1: 'FR', release_dates: [rd('-12', 3)] }]), undefined); // other countries are ignored
  assert.equal('certification' in mapMovie({ id: 1, release_dates: { results: [] } }).data, false);
});

test('country names are shortened, others kept as TMDB gives them', () => {
  const { countries } = mapMovie({ id: 1, production_countries: [
    { name: 'United States of America' }, { name: 'United Kingdom' }, { name: 'South Korea' }, { name: 'New Zealand' },
  ] }).data;
  assert.deepEqual(countries, ['USA', 'UK', 'South Korea', 'New Zealand']);
});

test('languages: original language first even when TMDB lists it later; no reordering when it is absent', () => {
  const langs = (d) => mapMovie({ id: 1, ...d }).data.languages;
  assert.deepEqual(langs({ original_language: 'ja', spoken_languages: [{ english_name: 'English', iso_639_1: 'en' }, { english_name: 'Japanese', iso_639_1: 'ja' }, { english_name: 'Korean', iso_639_1: 'ko' }] }), ['Japanese', 'English', 'Korean']);
  assert.deepEqual(langs({ original_language: 'xx', spoken_languages: [{ english_name: 'English', iso_639_1: 'en' }] }), ['English']);
});

test('ratings are left out when nobody has voted', () => {
  assert.equal('ratings' in mapMovie(sparse).data, false);
  assert.equal('ratings' in mapMovie({ id: 1, vote_average: 0, vote_count: 0 }).data, false);
  assert.deepEqual(mapMovie({ id: 1, vote_average: 5.5, vote_count: 3 }).data.ratings, { tmdb: { value: 5.5, votes: 3 } });
});

test('missing fields: a thinly documented film maps cleanly, with no nulls or empty lists stored', () => {
  const { data, ids } = mapMovie(sparse);
  assert.equal(data.title, 'Quiet Fields');
  for (const k of ['poster', 'backdrop', 'synopsis', 'tagline', 'runtime', 'released', 'genres', 'keywords', 'countries', 'languages', 'studios', 'collection', 'boxOffice', 'budget', 'certification', 'similar', 'ratings']) {
    assert.equal(k in data, false, `${k} should be absent`);
  }
  assert.deepEqual(data.people, { director: [], writer: [], cinematography: [], composer: [], editor: [], producer: [], cast: [] });
  assert.ok(Object.values(data).every(v => v !== null && v !== ''), 'no top-level nulls or blanks');
  assert.deepEqual(ids, { tmdb: 900002, imdb: null, wikidata: null });
});

test('missing appended sections: no similar, no people', () => {
  const { data, ids } = mapMovie(bare);
  assert.equal(data.title, 'Bare Bones');
  assert.equal('similar' in data, false);
  assert.equal(data.people.cast.length, 0);
  assert.equal(data.certification, undefined);
  assert.deepEqual(ids, { tmdb: 900003, imdb: null, wikidata: null });
});

test('imdb id falls back to the top-level imdb_id when external_ids lacks it', () => {
  assert.equal(mapMovie({ id: 1, imdb_id: 'tt1', external_ids: {} }).ids.imdb, 'tt1');
});

test('the mapped data feeds compose() as the TMDB source (title, poster, people, ratings)', async () => {
  const http = fakeHttp(movieRoute());
  const f = film({ ids: { tmdb: 900001 } });
  const rec = await run([f], http);
  f.src = { tmdb: rec.done[0].data };
  const c = compose(f);
  assert.equal(c.poster.thumb, 'https://image.tmdb.org/t/p/w342/synthPosterAbc123.jpg');
  assert.equal(c.people.director[0].name, 'Claire Beaumont');
  assert.equal(c.ratings.tmdb.votes, 3210);
  assert.equal(c.sources.poster, 'tmdb');
});

test('ids from details are returned for ctx.done to merge (tmdb, imdb, wikidata)', async () => {
  const http = fakeHttp(movieRoute());
  const rec = await run([film({ ids: { tmdb: 900001 } })], http);
  assert.deepEqual(rec.done[0].ids, { tmdb: 900001, imdb: 'tt9000001', wikidata: 'Q900001' });
});

// ---------- running ----------

test('reports progress after every film and handles several films', async () => {
  const http = fakeHttp(movieRoute());
  const films = [1, 2, 3, 4, 5, 6].map(i => film({ key: `k${i}`, ids: { tmdb: 900001 + i } }));
  const rec = await run(films, http);
  assert.equal(rec.done.length, 6);
  assert.deepEqual(rec.progress.map(p => p[0]).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.ok(rec.progress.every(p => p[1] === 6));
});

test('an error on one film is reported with ctx.fail and the rest carry on', async () => {
  const http = fakeHttp(call => {
    if (call.path === '/movie/2') throw new HttpError(500, call.url);
    if (call.path === '/movie/3') throw new Error('fetch failed');
    return full;
  });
  const films = [1, 2, 3, 4].map(i => film({ key: `k${i}`, ids: { tmdb: i } }));
  const rec = await run(films, http);
  assert.deepEqual(rec.done.map(d => d.film.key).sort(), ['k1', 'k4']);
  assert.deepEqual(rec.fail.map(f => f.film.key).sort(), ['k2', 'k3']);
  assert.equal(rec.progress.length, 4);
});

test('a failed film is not marked done (so it is retried next time)', async () => {
  const http = fakeHttp(() => { throw new Error('fetch failed'); });
  const rec = await run([film({ ids: { tmdb: 1 } })], http);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 1);
});

test('a TMDB id TMDB has never heard of (and no other way to find it) counts as "found nothing"', async () => {
  const http = fakeHttp(call => { throw new HttpError(404, call.url); });
  const rec = await run([film({ title: '', year: null, ids: { tmdb: 424242 } })], http);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data, null);
});

test('401: stops the whole provider with a message saying the key stopped working', async () => {
  const http = fakeHttp(call => { throw new HttpError(401, call.url); });
  const films = Array.from({ length: 12 }, (_, i) => film({ key: `k${i}`, ids: { tmdb: i + 1 } }));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => tmdb.enrich(films, ctx), err => {
    assert.match(err.message, /TMDB key stopped working/);
    assert.match(err.message, /Settings/);
    assert.notEqual(err.code, 'aborted');
    return true;
  });
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0, '401 is not a per-film failure');
  assert.ok(http.calls.length < films.length, 'remaining films are not attempted');
});

test('401 part-way through: films already done stay done, later ones are not touched', async () => {
  const http = fakeHttp(call => {
    if (Number(call.path.split('/').pop()) > 2) throw new HttpError(401, call.url);
    return full;
  });
  const films = Array.from({ length: 10 }, (_, i) => film({ key: `k${i}`, ids: { tmdb: i + 1 } }));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => tmdb.enrich(films, ctx), /stopped working/);
  assert.deepEqual(rec.done.map(d => d.film.key).sort(), ['k0', 'k1']);
});

test('an already-aborted signal stops straight away with code "aborted"', async () => {
  const http = fakeHttp(movieRoute());
  const ac = new AbortController(); ac.abort();
  const { ctx, rec } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(() => tmdb.enrich([film({ ids: { tmdb: 1 } })], ctx), err => err.code === 'aborted');
  assert.equal(http.calls.length, 0);
  assert.equal(rec.done.length, 0);
});

test('aborting part-way stops further films and passes the signal to every request', async () => {
  const ac = new AbortController();
  const http = fakeHttp(call => { ac.abort(); return full; });
  const films = Array.from({ length: 20 }, (_, i) => film({ key: `k${i}`, ids: { tmdb: i + 1 } }));
  const { ctx } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(() => tmdb.enrich(films, ctx), err => err.code === 'aborted');
  assert.ok(http.calls.length < films.length);
  assert.ok(http.calls.every(c => c.signal === ac.signal));
});

test('an aborted request surfacing from http (code "aborted") is passed on, not counted as a failure', async () => {
  const http = fakeHttp(() => { throw Object.assign(new Error('Stopped.'), { code: 'aborted' }); });
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => tmdb.enrich([film({ ids: { tmdb: 1 } })], ctx), err => err.code === 'aborted');
  assert.equal(rec.fail.length, 0);
});

test('the API key never appears in error messages shown to the user', async () => {
  const http = fakeHttp(call => { throw new HttpError(500, call.url); }); // net.js puts the URL, key included, in the message
  const rec = await run([film({ ids: { tmdb: 1 } })], http);
  assert.equal(rec.fail.length, 1);
  assert.ok(!rec.fail[0].err.message.includes(KEY), rec.fail[0].err.message);
  assert.ok(!String(rec.fail[0].err.url).includes(KEY));
});

// ---------- validateKey ----------

test('validateKey: a working key', async () => {
  const http = fakeHttp(call => { assert.equal(call.path, '/configuration'); return configuration; });
  assert.deepEqual(await validateKey(KEY, http), { ok: true, message: 'That key works.' });
  assert.equal(http.calls[0].q.api_key, KEY);
});

test('validateKey: sends a v4 token as a Bearer header', async () => {
  const http = fakeHttp(() => configuration);
  assert.equal((await validateKey(TOKEN, http)).ok, true);
  assert.equal(http.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(http.calls[0].q.api_key, undefined);
});

test('validateKey: a key TMDB rejects (401)', async () => {
  const http = fakeHttp(call => { throw new HttpError(401, call.url); });
  assert.deepEqual(await validateKey(KEY, http), { ok: false, message: "TMDB didn't accept that key — check you copied all of it." });
});

test('validateKey: no connection', async () => {
  const http = fakeHttp(() => { throw new TypeError('fetch failed'); });
  assert.deepEqual(await validateKey(KEY, http), { ok: false, message: "Couldn't reach TMDB — check your internet connection." });
});

test('validateKey: TMDB having a bad day is not blamed on the key', async () => {
  const http = fakeHttp(call => { throw new HttpError(503, call.url); });
  const r = await validateKey(KEY, http);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /copied/);
});

test('validateKey: empty or whitespace key asks for one without calling TMDB', async () => {
  const http = fakeHttp(() => configuration);
  const r = await validateKey('   ', http);
  assert.equal(r.ok, false);
  assert.equal(http.calls.length, 0);
});

test('validateKey: trims pasted whitespace', async () => {
  const http = fakeHttp(() => configuration);
  assert.equal((await validateKey(`  ${KEY}\n`, http)).ok, true);
  assert.equal(http.calls[0].q.api_key, KEY);
});

// ---------- reviews and recommendations ----------

const longReview = 'This is a quiet film and the performances are the heart of it, with a score that stays with you for days. '.repeat(8);
const withReviews = results => ({ ...full, reviews: { page: 1, results } });

test('mapMovie: reviews keep text and 0–10 rating only, English only, deduped, cut at a word boundary, max 8', () => {
  const rs = [
    { author: 'someone_handle', content: 'A *gentle*, [moving](https://x.test/a) film and the best of its year.', author_details: { username: 'someone_handle', rating: 8 } },
    { author: 'b', content: 'A gentle, moving film and the best of its year.', author_details: { rating: 5 } },
    { author: 'c', content: 'Una película muy lenta que no me gustó nada, la verdad, porque no pasa casi nada en toda la historia.', author_details: { rating: null } },
    { author: 'd', content: longReview, author_details: { rating: null } },
    { author: 'e', content: '   ', author_details: {} },
    ...Array.from({ length: 12 }, (_, i) => ({ author: `u${i}`, content: `Review number ${i} of the film, with the sort of thing that people say.`, author_details: { rating: 11 } })),
  ];
  const { reviews } = mapMovie(withReviews(rs)).data;
  assert.equal(reviews.length, 8);
  assert.deepEqual(reviews[0], { text: 'A gentle, moving film and the best of its year.', rating: 8 });
  assert.equal(reviews.some(r => /película/.test(r.text)), false);
  assert.ok(reviews[1].text.length <= 400 && reviews[1].text.endsWith('…'));
  assert.equal('rating' in reviews[1], false);
  assert.equal('rating' in reviews[2], false); // 11 is out of range
  assert.ok(reviews.every(r => !('author' in r) && !JSON.stringify(r).includes('someone_handle')));
});

test('mapMovie: no reviews block means no reviews field', () => {
  assert.equal('reviews' in mapMovie(full).data, false);
});

test('mapMovie: recommendations are TMDB ids, deduped, at most 20', () => {
  const results = [...Array.from({ length: 25 }, (_, i) => ({ id: 1000 + i, title: `R${i}` })), { id: 1000, title: 'dup' }];
  const { recommendations } = mapMovie({ ...full, recommendations: { results } }).data;
  assert.equal(recommendations.length, 20);
  assert.deepEqual(recommendations.slice(0, 3), [1000, 1001, 1002]);
  assert.deepEqual(mapMovie(full).data.recommendations, [910001, 910002, 910003, 910004, 910005, 910006, 910007, 910008, 910009, 910010, 910011, 910012, 910013, 910014]);
});

test('429 after retries: stops asking, one failure for the film in hand, a plain log line, no throw', async () => {
  const http = fakeHttp(call => { throw Object.assign(new HttpError(429, call.url), { code: 'host-paused' }); });
  const films = Array.from({ length: 12 }, (_, i) => film({ key: `k${i}`, ids: { tmdb: i + 1 } }));
  const { ctx, rec } = makeCtx(http);
  await tmdb.enrich(films, ctx);
  assert.equal(rec.done.length, 0);
  assert.ok(rec.fail.length >= 1 && rec.fail.length <= 4, 'only films already in flight are reported');
  assert.ok(http.calls.length <= 4);
  assert.equal(rec.log.length, 1);
  assert.match(rec.log[0], /slow down/i);
});

test('a plain 429 (no host-paused code) also stops the run rather than failing every film', async () => {
  const http = fakeHttp(call => { throw new HttpError(429, call.url); });
  const films = Array.from({ length: 10 }, (_, i) => film({ key: `k${i}`, ids: { tmdb: i + 1 } }));
  await run(films, http);
  assert.ok(http.calls.length < films.length);
});

test('one request per film when the TMDB id is known: details with every section appended, nothing else', async () => {
  const http = fakeHttp(movieRoute());
  await run([film({ ids: { tmdb: 77, imdb: 'tt9000001' } })], http);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].path, '/movie/77');
  for (const part of ['credits', 'keywords', 'external_ids', 'release_dates', 'recommendations']) assert.ok(http.calls[0].q.append_to_response.split(',').includes(part), part);
});

test('people keep TMDB profile paths as photo (path only); people without one have no photo key', () => {
  const d = { id: 1, credits: {
    cast: [{ id: 1, name: 'Has Photo', character: 'A', order: 0, profile_path: '/abc.jpg' }, { id: 2, name: 'No Photo', character: 'B', order: 1, profile_path: null }],
    crew: [{ id: 3, name: 'Dir Ector', job: 'Director', profile_path: '/dir.jpg' }],
  } };
  const p = mapMovie(d).data.people;
  assert.deepEqual(p.cast[0], { name: 'Has Photo', id: 'tmdb:1', role: 'A', photo: '/abc.jpg' });
  assert.deepEqual(p.cast[1], { name: 'No Photo', id: 'tmdb:2', role: 'B' });
  assert.deepEqual(p.director, [{ name: 'Dir Ector', id: 'tmdb:3', photo: '/dir.jpg' }]);
});

test('people photos: crew and cast keep profile_path as photo; a missing one leaves no photo key', () => {
  const d = { id: 1, credits: {
    crew: [{ id: 5, name: 'Dir One', job: 'Director', profile_path: '/dir.jpg' }, { id: 6, name: 'Comp One', job: 'Original Music Composer', profile_path: null }],
    cast: [{ id: 7, name: 'Act One', order: 0, profile_path: '/act.jpg' }],
  } };
  const { data } = mapMovie(d);
  assert.deepEqual(data.people.director, [{ name: 'Dir One', id: 'tmdb:5', photo: '/dir.jpg' }]);
  assert.deepEqual(data.people.composer, [{ name: 'Comp One', id: 'tmdb:6' }]);
  assert.equal(data.people.cast[0].photo, '/act.jpg');
  assert.equal(data.peopleV, 2);
});

test('wants: stored TMDB people from before photos are read again, whatever date the film was last looked at; once only', () => {
  const recent = new Date().toISOString();
  const old = { src: { tmdb: { people: { cast: [{ name: 'A', id: 'tmdb:1' }] } } }, checked: { tmdb: recent } };
  assert.equal(tmdb.wants(old, { now: Date.now() }), true);
  const done = { src: { tmdb: { peopleV: 2, people: { cast: [{ name: 'A', id: 'tmdb:1' }] } } }, checked: { tmdb: recent } };
  assert.equal(tmdb.wants(done, { now: Date.now() }), false);
  const noPeople = { src: { tmdb: { title: 'X' } }, checked: { tmdb: recent } };
  assert.equal(tmdb.wants(noPeople, { now: Date.now() }), false);
});

test('compose keeps photo on cast and crew', () => {
  const film = { key: 'k', src: { tmdb: { people: { director: [{ name: 'D', id: 'tmdb:1', photo: '/d.jpg' }], cast: [{ name: 'C', id: 'tmdb:2', photo: '/c.jpg' }] } } } };
  const c = compose(film);
  assert.equal(c.people.director[0].photo, '/d.jpg'); assert.equal(c.people.cast[0].photo, '/c.jpg');
});
