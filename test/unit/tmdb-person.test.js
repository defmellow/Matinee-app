// A person's films from TMDB: credit mapping, picking the right person, and the source order in createPersonFilms (fake fetcher).
// Synthetic fixture only; the real network path is unverified (no TMDB key in the cloud).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { mapCredits, pickPerson, fetchTmdbPerson, roleOfDepartment } from '../../core/features/tmdb-person.js';
import { createPersonFilms } from '../../core/features/person-films.js';
import { mergeFilms } from '../../ui/screens/person/model.js';
import { directedBy } from '../../ui/components/posterpop.js';

const FX = JSON.parse(fs.readFileSync(new URL('../fixtures/synthetic/tmdb-person-credits.json', import.meta.url), 'utf8'));
const keyOf = name => 'p:' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('mapCredits: one entry per film with all roles, posters at w342, upcoming kept, placeholders and adult dropped', () => {
  const films = mapCredits(FX.credits);
  const by = Object.fromEntries(films.map(f => [f.title, f]));
  assert.deepEqual(Object.keys(by).sort(), ['Announced Thing', 'Cameo Night', 'Example Harbour', 'Rock & Roll Lamps', 'Score Only']);
  assert.deepEqual(by['Example Harbour'].roles, ['director', 'writer', 'cast:The Pilot']);
  assert.equal(by['Example Harbour'].poster, 'https://image.tmdb.org/t/p/w342/harbour.jpg');
  assert.equal(by['Example Harbour'].year, 2001);
  assert.deepEqual(by['Cameo Night'].roles, ['cast']);
  assert.equal(by['Cameo Night'].poster, null);
  assert.equal(by['Announced Thing'].year, 2027);
  assert.deepEqual(by['Score Only'].roles, ['composer']);
  assert.deepEqual(mapCredits(null), []);
});

test('pickPerson: exact name, wanted department first, then popularity; near-miss names are refused', () => {
  assert.equal(pickPerson(FX.search.results, { name: 'Ada Fictional', departments: ['Directing'] }).id, 902);
  assert.equal(pickPerson(FX.search.results, { name: 'Ada Fictional', departments: ['Acting'] }).id, 901);
  assert.equal(pickPerson(FX.search.results, { name: 'Ada Fictional' }).id, 901); // no preference: most popular exact match
  assert.equal(pickPerson(FX.search.results, { name: 'Somebody Else' }), null);
});

test('fetchTmdbPerson: uses the tmdb id directly, else searches by name; key goes in the query and is scrubbed from errors', async () => {
  const urls = [];
  const http = { json: async url => { urls.push(url); return url.includes('/search/person') ? FX.search : { known_for_department: 'Directing', movie_credits: FX.credits }; } };
  const byId = await fetchTmdbPerson({ http, key: 'k'.repeat(32), tmdbId: 902 });
  assert.equal(byId.films.length, 5);
  assert.equal(urls.length, 1); assert.match(urls[0], /\/person\/902\?api_key=.*append_to_response=movie_credits/);
  assert.equal(byId.knownFor, 'director');
  urls.length = 0;
  const byName = await fetchTmdbPerson({ http, key: 'k'.repeat(32), name: 'Ada Fictional', departments: ['Directing'] });
  assert.equal(byName.tmdbId, 902); assert.equal(urls.length, 2); assert.match(urls[0], /\/search\/person\?.*query=Ada\+Fictional/);
  const bad = { json: async url => { throw Object.assign(new Error('failed ' + url), { status: 500, url }); } };
  await assert.rejects(fetchTmdbPerson({ http: bad, key: 'secretkey123', tmdbId: 1 }), e => !/secretkey123/.test(e.message + e.url));
  await assert.rejects(fetchTmdbPerson({ http: { json: async () => ({ results: [] }) }, key: 'k', name: 'Nobody' }), e => e.code === 'not-found');
});

function setup({ key = 'k'.repeat(32), tmdb, filmographyFn, lb } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-tp-'));
  const store = createStore(dir);
  store.library.settings = { ...(store.library.settings || {}), keys: key ? { tmdb: key } : {} };
  store.films['lid:h'] = { key: 'lid:h', slug: 'example-harbour', title: 'Example Harbour', year: 2001, ids: { tmdb: 10 }, src: {} };
  store.films['lid:l'] = { key: 'lid:l', slug: 'rock-roll-lamps', title: 'Rock & Roll Lamps', year: 1999, ids: {}, src: { lbpage: { people: { director: [{ name: 'Ada Fictional', slug: 'ada-fictional' }] } } } };
  store.library.films['lid:h'] = { watched: true, rating: 8 };
  store.library.films['lid:l'] = { watched: false, watchlist: true };
  const summaries = () => Object.values(store.films).map(f => ({ key: f.key, slug: f.slug, title: f.title, year: f.year, poster: { url: 'p' },
    people: { director: [{ id: keyOf('Ada Fictional'), name: 'Ada Fictional', sourceId: f.key === 'lid:h' ? 'tmdb:902' : 'wd:Q42' }] } }));
  const order = [];
  const http = {
    json: async url => { order.push('tmdb'); if (tmdb) return tmdb(url); return url.includes('/search/') ? FX.search : FX.credits; },
    browserText: async url => { order.push('lb'); return lb ? lb(url) : { status: 404, text: '' }; },
    page: async url => { order.push('lb'); return lb ? lb(url) : { status: 404, text: '' }; },
  };
  const pf = createPersonFilms({ store, http, summaries, keyOf, filmographyFn: filmographyFn && (async o => { order.push('wd'); return filmographyFn(o); }) });
  return { store, pf, order };
}

test('TMDB first: films collapse to one row with all roles, match the library by TMDB id, and the answer is cached', async () => {
  const { pf, order } = setup();
  assert.equal((await pf.get({ id: 'p:ada-fictional' })).status, 'loading');
  await pf.idle();
  assert.deepEqual(order, ['tmdb'], 'tmdb id known from the library film, so no search call');
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'tmdb');
  const harbour = r.films.find(f => f.title === 'Example Harbour');
  assert.equal(harbour.key, 'lid:h');
  assert.deepEqual(harbour.roles, ['director', 'writer', 'cast:The Pilot']);
  const lamps = r.films.find(f => f.title === 'Rock & Roll Lamps');
  assert.equal(lamps.key, 'lid:l', 'no tmdb id on the library film: matched by title and year');
  const cameo = r.films.find(f => f.title === 'Cameo Night');
  assert.equal(cameo.key, null); assert.equal(cameo.url, 'https://letterboxd.com/tmdb/11/');
  assert.equal(cameo.poster, null);
  assert.equal(r.films.find(f => f.title === 'Score Only').poster, 'https://image.tmdb.org/t/p/w342/score.jpg');
  const n = order.length;
  await pf.get({ id: 'p:ada-fictional' });
  assert.equal(order.length, n, 'served from the 7-day cache');
  // the person screen merges it into one tile per film with every role
  const merged = mergeFilms([], r.films, new Map());
  assert.deepEqual(merged.find(i => i.title === 'Score Only').roles, ['composer']);
});

test('source order: TMDB fails -> Wikidata answers and Letterboxd is never read', async () => {
  const wiki = { films: [{ title: 'Wiki Film', year: 1990, roles: ['writer'], key: null, poster: null }] };
  const { pf, order, store } = setup({ tmdb: () => { throw Object.assign(new Error('boom'), { status: 500 }); }, filmographyFn: async () => { store.setCached('filmography:Q42', { films: [] }); return wiki; } });
  await pf.get({ id: 'p:ada-fictional' }); await pf.idle();
  assert.deepEqual(order, ['tmdb', 'wd']);
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'wikidata');
  assert.equal(order.filter(x => x === 'tmdb').length, 1, 'TMDB is not asked again straight away');
});

test('source order: TMDB and Wikidata both fail -> Letterboxd is read last; all three failing gives a plain failure', async () => {
  const boom = () => { throw Object.assign(new Error('boom'), { status: 500 }); };
  const { pf, order } = setup({ tmdb: boom, filmographyFn: async () => { throw new Error('wd down'); }, lb: () => ({ status: 500, text: '' }) });
  await pf.get({ id: 'p:ada-fictional' }); await pf.idle();
  assert.deepEqual([...new Set(order)], ['tmdb', 'wd', 'lb']);
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'failed'); assert.ok(r.reason);
});

test('no TMDB key: TMDB is skipped entirely', async () => {
  const { pf, order } = setup({ key: '', filmographyFn: async () => ({ films: [] }), lb: () => ({ status: 404, text: '' }) });
  await pf.get({ id: 'p:ada-fictional' }); await pf.idle();
  assert.ok(!order.includes('tmdb'));
});

test('hover card: "Directed by" for one or two directors, nothing without people', () => {
  assert.equal(directedBy({ director: [{ name: 'A' }] }), 'Directed by A');
  assert.equal(directedBy({ director: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), 'Directed by A and B');
  assert.equal(directedBy({ director: [] }), '');
  assert.equal(directedBy(undefined), '');
});

test('fetchTmdbPerson: main role comes from known_for_department; unknown departments give null', async () => {
  const mk = dept => ({ json: async () => ({ known_for_department: dept, movie_credits: FX.credits }) });
  assert.equal((await fetchTmdbPerson({ http: mk('Acting'), key: 'k', tmdbId: 1 })).knownFor, 'cast');
  assert.equal((await fetchTmdbPerson({ http: mk('Production'), key: 'k', tmdbId: 1 })).knownFor, 'producer');
  assert.equal((await fetchTmdbPerson({ http: mk('Crew'), key: 'k', tmdbId: 1 })).knownFor, null);
  assert.equal(roleOfDepartment('Directing'), 'director');
});

test('fetchTmdbPerson: returns the person photo path (null when TMDB has none)', async () => {
  const mk = profile_path => ({ json: async () => ({ known_for_department: 'Acting', profile_path, movie_credits: FX.credits }) });
  assert.equal((await fetchTmdbPerson({ http: mk('/portrait.jpg'), key: 'k'.repeat(32), tmdbId: 5 })).photo, '/portrait.jpg');
  assert.equal((await fetchTmdbPerson({ http: mk(undefined), key: 'k'.repeat(32), tmdbId: 5 })).photo, null);
});
