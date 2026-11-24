import test from 'node:test';
import assert from 'node:assert/strict';
import { normTitle, titleYearKey, filmKey, lidFromUri, emptyFilm, compose, addIds, PRIORITY, RATING_PROVIDER_ORDER } from '../../core/model.js';

test('normTitle lowercases, strips accents, expands & and collapses punctuation', () => {
  assert.equal(normTitle('Amélie'), 'amelie');
  assert.equal(normTitle('Fast & Furious'), 'fast and furious');
  assert.equal(normTitle("Schindler's List"), 'schindlers list');
  assert.equal(normTitle('Mad-Max: Fury   Road!'), 'mad max fury road');
  assert.equal(normTitle(null), '');
  assert.equal(normTitle(undefined), '');
});

test('titleYearKey joins the normalised title and year', () => {
  assert.equal(titleYearKey('The Thing', 1982), 'the thing|1982');
  assert.equal(titleYearKey('The Thing'), 'the thing|');
});

test('filmKey prefers lid, then slug, then title and year', () => {
  assert.equal(filmKey({ lid: '29Ts', slug: 'paris-texas', title: 'Paris, Texas', year: 1984 }), 'lid:29Ts');
  assert.equal(filmKey({ slug: 'paris-texas', title: 'Paris, Texas', year: 1984 }), 'slug:paris-texas');
  assert.equal(filmKey({ title: 'Paris, Texas', year: 1984 }), 'ty:paris texas|1984');
});

test('lidFromUri extracts the short code from boxd.it links', () => {
  assert.equal(lidFromUri('https://boxd.it/29Ts'), '29Ts');
  assert.equal(lidFromUri('https://letterboxd.com/film/paris-texas/'), null);
  assert.equal(lidFromUri(null), null);
});

test('emptyFilm returns the documented shape and derives the key', () => {
  const f = emptyFilm({ title: 'Paris, Texas', year: 1984 });
  assert.deepEqual(f, {
    key: 'ty:paris texas|1984', lid: null, slug: null, title: 'Paris, Texas', year: 1984,
    ids: {}, src: {}, checked: {}, missed: {},
  });
  assert.equal(emptyFilm({ key: 'custom', lid: '29Ts', title: 'x' }).key, 'custom');
  assert.equal(emptyFilm({ lid: '29Ts', title: 'x' }).key, 'lid:29Ts');
});

test('compose: the higher-priority source wins, and falls back when it is missing or empty', () => {
  const film = emptyFilm({ title: 'Paris, Texas', year: 1984 });
  film.src = { wikidata: { runtime: 100 }, tmdb: { runtime: 105 } };
  const c = compose(film);
  assert.equal(c.runtime, 105);
  assert.equal(c.sources.runtime, 'tmdb');

  film.src = { wikidata: { runtime: 100 }, tmdb: {} };
  assert.equal(compose(film).runtime, 100);
  assert.equal(compose(film).sources.runtime, 'wikidata');

  film.src = { wikidata: { genres: ['Drama'] }, tmdb: { genres: [] } };
  assert.deepEqual(compose(film).genres, ['Drama']);
  assert.equal(compose(film).sources.genres, 'wikidata');

  film.src = { wikidata: { tagline: 'x' }, tmdb: { tagline: '' } };
  assert.equal(compose(film).tagline, null);
});

test('compose: people are picked per role, independently', () => {
  const film = emptyFilm({ title: 'Paris, Texas', year: 1984 });
  film.src = {
    tmdb: { people: { director: [{ name: 'Wim Wenders' }] } },
    wikidata: { people: { director: [{ name: 'Other' }], composer: [{ name: 'Ry Cooder' }] } },
  };
  const c = compose(film);
  assert.deepEqual(c.people.director, [{ name: 'Wim Wenders' }]);
  assert.deepEqual(c.people.composer, [{ name: 'Ry Cooder' }]);
  assert.deepEqual(c.people.writer, []);
  assert.deepEqual(c.people.cast, []);
});

test('compose: an omdb copy of an IMDb rating does not override the imdb provider', () => {
  const film = emptyFilm({ title: 'Paris, Texas', year: 1984 });
  film.src = {
    imdb: { ratings: { imdb: { value: 8, votes: 100 } } },
    omdb: { ratings: { imdb: { value: 7, votes: 90 }, rt: { critics: 90 } } },
  };
  const c = compose(film);
  assert.deepEqual(c.ratings.imdb, { value: 8, votes: 100 });
  assert.deepEqual(c.ratings.rt, { critics: 90 });
});

test('compose: title wins over provider titles; year falls back to released', () => {
  const film = emptyFilm({ title: 'Mine', year: null });
  film.src = { tmdb: { title: 'Provider title', released: '2019-05-01' } };
  const c = compose(film);
  assert.equal(c.title, 'Mine');
  assert.equal(c.year, 2019);

  const withYear = emptyFilm({ title: 'Mine', year: 1999 });
  withYear.src = { tmdb: { released: '2019-05-01' } };
  assert.equal(compose(withYear).year, 1999);
});

test('addIds adds new ids, never overwrites, ignores null and empty values', () => {
  const film = { ids: { imdb: 'tt0087538' } };
  addIds(film, { imdb: 'tt9999999', tmdb: 806, wikidata: null, rt: '', metacritic: undefined });
  assert.deepEqual(film.ids, { imdb: 'tt0087538', tmdb: 806 });
});

test('PRIORITY and RATING_PROVIDER_ORDER are exported as expected', () => {
  assert.deepEqual(PRIORITY.title, ['tmdb', 'wikidata']);
  assert.equal(RATING_PROVIDER_ORDER[RATING_PROVIDER_ORDER.length - 1], 'omdb');
});

test('compose: each source keeps its own rating key, so RSS (Letterboxd) sits beside IMDb', () => {
  const c = compose({
    key: 'k', title: 'X', year: 2000,
    src: {
      rss: { ratings: { letterboxd: { value: 4.1, votes: 10 } } },
      imdb: { ratings: { imdb: { value: 8, votes: 100 } } },
    },
  });
  assert.deepEqual(c.ratings.letterboxd, { value: 4.1, votes: 10 });
  assert.deepEqual(c.ratings.imdb, { value: 8, votes: 100 });
});

test('defaultWants: provider.since re-runs films checked before it, once', async () => {
  const { defaultWants } = await import('../../core/enrich.js');
  const p = { id: 'x', since: '2026-10-22', refreshDays: 90 };
  const now = Date.parse('2026-10-23');
  assert.equal(defaultWants(p, { checked: { x: '2026-10-01T00:00:00Z' } }, { now }), true);
  assert.equal(defaultWants(p, { checked: { x: '2026-10-22T05:00:00Z' } }, { now }), false);
  assert.equal(defaultWants(p, { checked: { x: '2026-10-01T00:00:00Z' }, missed: { x: true } }, { now }), false);
});

test('http.page uses the injected renderer, paced, and falls back to a browser-style fetch', async () => {
  const { createHttp } = await import('../../core/net.js');
  const seen = [];
  const withRender = createHttp({ render: async (url, o) => { seen.push([url, o.waitFor]); return { status: 200, url, text: '<p>hi</p>' }; }, fetch: async () => { throw new Error('no plain fetch'); } });
  const r = await withRender.page('https://example.org/a', { waitFor: '.x' });
  assert.deepEqual([r.status, r.text], [200, '<p>hi</p>']);
  assert.deepEqual(seen, [['https://example.org/a', '.x']]);
  const plain = createHttp({ fetch: async (u, o) => new Response('plain ' + o.headers['user-agent'].slice(0, 7), { status: 200 }) });
  assert.match((await plain.page('https://example.org/b')).text, /^plain Mozilla/);
});

test('hasPendingWork: true while an enabled provider has unchecked films, false once all are checked or disabled', async () => {
  const { hasPendingWork } = await import('../../core/enrich.js');
  const store = { library: { settings: {} }, films: { a: { key: 'a', ids: {}, checked: {} }, b: { key: 'b', ids: {}, checked: { x: '2026-10-01T00:00:00Z' } } } };
  const x = { id: 'x' };
  const now = Date.parse('2026-10-02');
  assert.equal(hasPendingWork({ store, providers: [x], now }), true);
  store.films.a.checked.x = '2026-10-01T00:00:00Z';
  assert.equal(hasPendingWork({ store, providers: [x], now }), false);
  assert.equal(hasPendingWork({ store, providers: [{ id: 'y', enabled: () => false }], now }), false);
});
