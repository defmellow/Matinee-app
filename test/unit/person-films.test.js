// Person pages: the Letterboxd films-grid parser (synthetic fixtures; real markup unverified) and the person-films feature with a fake http.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { parsePersonPage, explicitSlug, slugsFor, createPersonFilms, MAX_PAGES } from '../../core/features/person-films.js';

const fx = n => fs.readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8');
const keyOf = name => 'p:' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

test('parser: newer griditem tiles, titles with years, entities, next page', () => {
  const p = parsePersonPage(fx('lbperson-p1.html'));
  assert.equal(p.isPage, true);
  assert.equal(p.name, 'Ada Fictional');
  assert.deepEqual(p.films, [
    { title: 'Example Harbour', year: 2001, slug: 'example-harbour' },
    { title: 'Rock & Roll Lamps', year: 1999, slug: 'rock-roll-lamps' },
    { title: 'No Year Film', year: null, slug: 'no-year-film' },
  ]);
  assert.equal(p.next, '/director/ada-fictional/page/2/');
});

test('parser: older poster-container tiles; a disabled "next" is not a next page', () => {
  const p = parsePersonPage(fx('lbperson-p2.html'));
  assert.deepEqual(p.films.map(f => [f.slug, f.title, f.year]), [['old-style-film', 'Old Style Film', 1987], ['example-harbour', 'Example Harbour', 2001]]);
  assert.equal(p.next, null);
});

test('parser: empty page is a page with no films; a check page is not a page; junk is safe', () => {
  const e = parsePersonPage(fx('lbperson-empty.html'));
  assert.equal(e.isPage, true); assert.deepEqual(e.films, []);
  assert.equal(parsePersonPage(fx('lbperson-check.html')).isPage, false);
  assert.equal(parsePersonPage(null).isPage, false);
  assert.deepEqual(parsePersonPage('<div data-item-slug="../etc"></div>').films, []);
});

test('explicit Letterboxd ids', () => {
  assert.deepEqual(explicitSlug('lb:ada-fictional'), { role: null, slug: 'ada-fictional' });
  assert.deepEqual(explicitSlug('letterboxd:writer/wri-one'), { role: 'writer', slug: 'wri-one' });
  assert.deepEqual(explicitSlug('https://letterboxd.com/actor/act-one/'), { role: 'actor', slug: 'act-one' });
  assert.equal(explicitSlug('wd:Q5'), null);
  assert.equal(explicitSlug(undefined), null);
});

function setup({ handler, films = {}, filmographyFn } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-pf-'));
  const store = createStore(dir);
  Object.assign(store.films, {
    'lid:h': { key: 'lid:h', slug: 'example-harbour', title: 'Example Harbour', year: 2001, ids: {}, src: { lbpage: { people: { director: [{ name: 'Ada Fictional', slug: 'ada-fictional' }], cast: [{ name: 'Cast One', slug: 'cast-one' }] } } } },
    'lid:r': { key: 'lid:r', slug: 'rock-roll-lamps-x', title: 'Rock & Roll Lamps', year: 1999, ids: {}, src: { lbpage: { people: { director: [{ name: 'Ada Fictional', slug: 'ada-fictional' }] } } } },
    ...films,
  });
  store.library.films['lid:h'] = { watched: true, rating: 8, liked: true, watchlist: false, tags: [] };
  store.library.films['lid:r'] = { watched: false, rating: null, liked: false, watchlist: true, tags: [] };
  const summaries = () => Object.values(store.films).map(f => ({ key: f.key, slug: f.slug, title: f.title, year: f.year, poster: { url: 'p' + f.key, thumb: 't' + f.key },
    people: { director: (f.src.lbpage.people.director || []).map(p => ({ id: keyOf(p.name), name: p.name, sourceId: p.name === 'Ada Fictional' ? 'wd:Q42' : null })), cast: (f.src.lbpage.people.cast || []).map(p => ({ id: keyOf(p.name), name: p.name })) } }));
  const calls = [], events = [];
  const http = { browserText: async url => { calls.push(['plain', url]); return handler('plain', url); }, page: async url => { calls.push(['page', url]); return handler('page', url); } };
  const pf = createPersonFilms({ store, http, summaries, keyOf, emit: (e, p) => events.push([e, p]), filmographyFn: filmographyFn && (o => filmographyFn(o, store)) });
  return { store, pf, calls, events };
}
const page = text => ({ status: 200, text });
const byPath = pages => (_how, url) => { const p = new URL(url).pathname; return pages[p] ? page(pages[p]) : { status: 404, text: 'nope' }; };

test('slugsFor: the most common Letterboxd page per role, director first', () => {
  const { store } = setup();
  assert.deepEqual(slugsFor(store, keyOf, 'p:ada-fictional'), [{ role: 'director', slug: 'ada-fictional' }]);
  assert.deepEqual(slugsFor(store, keyOf, 'p:cast-one'), [{ role: 'actor', slug: 'cast-one' }]);
  assert.deepEqual(slugsFor(store, keyOf, 'p:nobody'), []);
});

test('get: loading first (with the library films), then ok from Letterboxd with both pages, matched to the library, cached', async () => {
  const { pf, calls, events } = setup({ handler: byPath({ '/director/ada-fictional/': fx('lbperson-p1.html'), '/director/ada-fictional/page/2/': fx('lbperson-p2.html') }) });
  const first = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(first.status, 'loading');
  assert.equal(first.name, 'Ada Fictional');
  assert.deepEqual(first.films.map(f => f.key).sort(), ['lid:h', 'lid:r']);
  await pf.idle();
  assert.deepEqual(events, [['personFilms', { id: 'p:ada-fictional', name: 'Ada Fictional', status: 'ok' }]]);
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'letterboxd'); assert.deepEqual(r.roles, ['director']);
  assert.ok(r.fetchedAt);
  assert.deepEqual(r.films.map(f => f.slug), ['example-harbour', 'rock-roll-lamps', 'no-year-film', 'old-style-film']);
  const h = r.films[0];
  assert.equal(h.key, 'lid:h'); assert.equal(h.watched, true); assert.equal(h.rating, 8); assert.equal(h.url, 'https://letterboxd.com/film/example-harbour/'); assert.equal(h.role, 'director');
  assert.equal(h.poster, 'plid:h', 'a poster is a plain URL string (or null)');
  assert.equal(r.films[1].key, 'lid:r', 'title + year match when the slug differs'); assert.equal(r.films[1].watchlist, true);
  assert.equal(r.films[2].key, null); assert.equal(r.films[3].poster, null);
  assert.equal(calls.length, 2, 'page 1 and page 2, read once; the second get() came from the 7-day cache');
  assert.equal(calls.every(c => c[0] === 'plain'), true);
});

test('get: by name only, and by a Letterboxd-style id', async () => {
  const { pf } = setup({ handler: byPath({ '/director/ada-fictional/': fx('lbperson-p2.html') }) });
  assert.equal((await pf.get({ name: 'Ada Fictional' })).status, 'loading');
  await pf.idle();
  assert.equal((await pf.get({ name: 'Ada Fictional' })).status, 'ok');
  assert.equal((await pf.get({ id: 'lb:ada-fictional' })).name, 'Ada Fictional');
  assert.equal((await pf.get({ id: 'wd:Q42' })).status, 'ok'); // a source id resolves too
  await assert.rejects(pf.get({ id: 'p:who' }), { code: 'not-found' });
});

test('get: pages are capped at 8 per role', async () => {
  let n = 0;
  const { pf, calls } = setup({ handler: (_h, url) => { n++; const p = new URL(url).pathname; const i = Number(/page\/(\d+)/.exec(p)?.[1] || 1); return page(`<title>X • Letterboxd</title><div data-item-slug="film-${i}" data-item-name="Film ${i} (2000)" data-item-link="/film/film-${i}/"></div><a class="next" href="/director/ada-fictional/page/${i + 1}/">Older</a>`); } });
  await pf.get({ id: 'p:ada-fictional' }); await pf.idle();
  assert.equal(calls.length, MAX_PAGES);
  assert.equal((await pf.get({ id: 'p:ada-fictional' })).films.length, MAX_PAGES);
});

test('get: a 404 or empty person page is "none"', async () => {
  const { pf } = setup({ handler: byPath({}) });
  await pf.get({ id: 'p:ada-fictional' }); await pf.idle();
  assert.equal((await pf.get({ id: 'p:ada-fictional' })).status, 'none');
  const e = setup({ handler: byPath({ '/director/ada-fictional/': fx('lbperson-empty.html') }) });
  await e.pf.get({ id: 'p:ada-fictional' }); await e.pf.idle();
  assert.equal((await e.pf.get({ id: 'p:ada-fictional' })).status, 'none');
});

test('get: Wikidata answers before Letterboxd is asked at all (the real filmography caches itself)', async () => {
  const wiki = { films: [{ title: 'Example Harbour', year: 2001, roles: ['director'], key: 'lid:h', poster: null, watched: true }, { title: 'Wiki Only', year: 1990, roles: ['writer'], key: null, poster: null }] };
  const { pf, calls } = setup({ handler: () => page(fx('lbperson-check.html')), filmographyFn: async (_o, store) => { store.setCached('filmography:Q42', { films: [] }); return wiki; } });
  assert.equal((await pf.get({ id: 'p:ada-fictional' })).status, 'loading');
  await pf.idle();
  assert.deepEqual(calls, [], 'Letterboxd is never read when Wikidata worked');
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'wikidata');
  assert.deepEqual(r.films.map(f => f.title), ['Example Harbour', 'Wiki Only']);
  assert.equal(r.films[0].key, 'lid:h');
  assert.equal(r.films[1].url, 'https://letterboxd.com/search/Wiki%20Only%201990/');
});

test('get: when Wikidata fails, a check page on Letterboxd goes plain request, then the page window, then fails plainly', async () => {
  const { pf, calls } = setup({ handler: () => page(fx('lbperson-check.html')), filmographyFn: async () => { throw new Error('wikidata down'); } });
  assert.equal((await pf.get({ id: 'p:ada-fictional' })).status, 'loading');
  await pf.idle();
  assert.deepEqual(calls.map(c => c[0]), ['plain', 'page'], 'plain request first, then the page window');
  const r = await pf.get({ id: 'p:ada-fictional' });
  assert.equal(r.status, 'failed');
  assert.match(r.reason, /check you.re human/);
});

test('get: a failure is remembered for 30 minutes, with a plain reason, and does not hit the site again', async () => {
  const s = setup({ handler: () => { const e = new Error('x'); e.status = 429; e.code = 'host-paused'; throw e; } });
  const calls0 = () => s.calls.length;
  const r1 = await s.pf.get({ id: 'p:cast-one' });
  assert.equal(r1.status, 'loading');
  await s.pf.idle();
  const n = calls0();
  const r2 = await s.pf.get({ id: 'p:cast-one' });
  assert.equal(r2.status, 'failed');
  assert.match(r2.reason, /slow down/);
  assert.equal(calls0(), n, 'no new request');
  assert.deepEqual(s.events.at(-1), ['personFilms', { id: 'p:cast-one', name: 'Cast One', status: 'failed' }]);
});

test('get: a person with no Letterboxd page known and no Wikidata id: failed, with the library films', async () => {
  const { pf, store } = setup({ handler: byPath({}) });
  store.films['lid:x'] = { key: 'lid:x', slug: 'x', title: 'X', year: 2000, ids: {}, src: { lbpage: { people: { cast: [{ name: 'Plain Person' }] } } } };
  const r = await pf.get({ name: 'Plain Person' });
  assert.equal(r.status, 'failed');
  assert.equal(r.films.length, 1);
  assert.equal(r.films[0].key, 'lid:x');
});

test('get: the screen passes its route parameter as both id and name; that must still resolve (by id, or a plain name used as the id)', async () => {
  const { pf } = setup({ handler: byPath({ '/director/ada-fictional/': fx('lbperson-p2.html') }) });
  const a = await pf.get({ id: 'p:ada-fictional', name: 'p:ada-fictional' });
  assert.equal(a.name, 'Ada Fictional'); assert.equal(a.status, 'loading');
  await pf.idle();
  const b = await pf.get({ id: 'Ada Fictional', name: 'Ada Fictional' });
  assert.equal(b.name, 'Ada Fictional'); assert.equal(b.status, 'ok');
  await assert.rejects(pf.get({ id: 'p:nobody', name: 'p:nobody' }), { code: 'not-found' });
  await assert.rejects(pf.get({ id: 'wd:Q999', name: 'wd:Q999' }), { code: 'not-found' });
});

test('get: a bare Letterboxd id uses the page kind the film pages showed for that slug', async () => {
  const { pf, calls } = setup({ handler: byPath({ '/actor/cast-one/': fx('lbperson-p2.html') }) });
  const r = await pf.get({ id: 'lb:cast-one' });
  assert.equal(r.name, 'Cast One');
  await pf.idle();
  assert.equal(new URL(calls[0][1]).pathname, '/actor/cast-one/');
  assert.deepEqual((await pf.get({ id: 'lb:cast-one' })).roles, ['cast']);
});

test('photo: a portrait for someone a film credits without one, from one TMDB lookup by name; held answers and misses are not asked for again', async () => {
  const { store, pf } = setup({ handler: () => ({ status: 404, text: '' }) });
  store.library.settings = { ...(store.library.settings || {}), keys: { tmdb: 'k'.repeat(32) } };
  const asked = [];
  const body = { '/3/search/person': q => ({ results: q.includes('Ada') ? [{ id: 7, name: 'Ada Fictional', known_for_department: 'Directing', popularity: 3 }] : [] }),
    '/3/person/7': () => ({ id: 7, name: 'Ada Fictional', known_for_department: 'Directing', profile_path: '/ada.jpg', movie_credits: { cast: [], crew: [] } }) };
  const http = { json: async url => { const u = new URL(url); asked.push(u.pathname); const f = body[u.pathname]; if (!f) throw Object.assign(new Error('404'), { status: 404 }); return f(u.searchParams.get('query') || ''); } };
  const { createPersonFilms } = await import('../../core/features/person-films.js');
  const summaries = () => [{ key: 'lid:h', title: 'Example Harbour', year: 2001, people: { director: [{ id: keyOf('Ada Fictional'), name: 'Ada Fictional' }], cast: [{ id: keyOf('Cast One'), name: 'Cast One' }, { id: keyOf('Has Photo'), name: 'Has Photo', photo: '/held.jpg' }] } }];
  const people = createPersonFilms({ store, http, summaries, keyOf });
  assert.equal(await people.photo({ name: 'Has Photo' }), '/held.jpg', 'a portrait another credit already has needs no lookup');
  assert.deepEqual(asked, []);
  assert.equal(await people.photo({ name: 'Ada Fictional' }), '/ada.jpg');
  assert.deepEqual(asked, ['/3/search/person', '/3/person/7']);
  assert.equal(await people.photo({ name: 'Ada Fictional' }), '/ada.jpg');
  assert.equal(asked.length, 2, 'the saved TMDB answer is used the second time');
  assert.equal(await people.photo({ name: 'Cast One' }), null, 'TMDB does not know them');
  const n = asked.length;
  assert.equal(await people.photo({ name: 'Cast One' }), null);
  assert.equal(asked.length, n, 'a miss is remembered');
  store.library.settings.keys.tmdb = '';
  assert.equal(await people.photo({ name: 'Somebody Else' }), null, 'no key: no lookup');
  assert.equal(asked.length, n);
});
