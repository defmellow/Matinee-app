import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCollection, seriesName, fetchTmdbCollection } from '../../core/features/tmdb-collection.js';
import { letterboxdUrl } from '../../core/features/shared.js';

const MAD_MAX = {
  id: 8945, name: 'Mad Max Collection',
  parts: [
    { id: 76341, title: 'Mad Max: Fury Road', release_date: '2015-05-13', poster_path: '/fr.jpg' },
    { id: 786892, title: 'Furiosa: A Mad Max Saga', release_date: '2024-05-22', poster_path: '/fu.jpg' },
    { id: 9999999, title: 'Mad Max: The Wasteland', release_date: '', poster_path: null },
    { id: 9659, title: 'Mad Max', release_date: '1979-04-12', poster_path: '/mm.jpg' },
    { id: 8810, title: 'Mad Max 2', release_date: '1981-12-24', poster_path: '/m2.jpg' },
    { id: 9355, title: 'Mad Max Beyond Thunderdome', release_date: '1985-06-29', poster_path: '/bt.jpg' },
  ],
};

test('mapCollection: release order, unreleased last, short name, posters', () => {
  const r = mapCollection(MAD_MAX);
  assert.equal(r.name, 'Mad Max');
  assert.deepEqual(r.films.map(f => [f.title, f.year]), [
    ['Mad Max', 1979], ['Mad Max 2', 1981], ['Mad Max Beyond Thunderdome', 1985], ['Mad Max: Fury Road', 2015],
    ['Furiosa: A Mad Max Saga', 2024], ['Mad Max: The Wasteland', null],
  ]);
  assert.equal(r.films[0].poster, 'https://image.tmdb.org/t/p/w342/mm.jpg');
  assert.equal(r.films[5].poster, null);
  assert.equal(mapCollection(null), null);
  assert.equal(seriesName('Toy Story Collection'), 'Toy Story');
});

test('fetchTmdbCollection: finds the collection by its exact name when no id is stored', async () => {
  const asked = [];
  const http = { json: async url => { asked.push(url.split('?')[0]); return url.includes('/search/collection') ? { results: [{ id: 1, name: 'Mad Max Trilogy' }, { id: 8945, name: 'Mad Max Collection' }] } : MAD_MAX; } };
  const r = await fetchTmdbCollection({ http, key: 'k', name: 'Mad Max Collection' });
  assert.equal(r.films.length, 6);
  assert.deepEqual(asked, ['https://api.themoviedb.org/3/search/collection', 'https://api.themoviedb.org/3/collection/8945']);
  const none = await fetchTmdbCollection({ http: { json: async () => ({ results: [{ id: 2, name: 'Mad Maxine' }] }) }, key: 'k', name: 'Mad Max Collection' });
  assert.equal(none, null); // no exact name match: Wikidata is used instead
});

test('letterboxdUrl: slug, then TMDB, then IMDb, then a search with the year', () => {
  assert.equal(letterboxdUrl({ slug: 'mad-max', tmdbId: 9659 }), 'https://letterboxd.com/film/mad-max/');
  assert.equal(letterboxdUrl({ tmdbId: 9659, title: 'Mad Max' }), 'https://letterboxd.com/tmdb/9659/');
  assert.equal(letterboxdUrl({ imdb: 'tt0079501' }), 'https://letterboxd.com/imdb/tt0079501/');
  assert.equal(letterboxdUrl({ title: 'Mad Max', year: 1979 }), 'https://letterboxd.com/search/Mad%20Max%201979/');
});
