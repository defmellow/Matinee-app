import test from 'node:test';
import assert from 'node:assert/strict';
import { gatherFeelInput } from '../../core/analysis/feel/gather.js';

// Synthetic fixtures only.
const person = (n) => ({ id: `p${n}`, name: `Person ${n}` });

test('full film', () => {
  const composed = {
    key: 'lid:A', title: 'Test Film', year: 1999, synopsis: ' A synopsis. ', tagline: 'Be bold',
    keywords: ['road trip', 'grief'], subjects: ['atonement'], locations: ['Texas'], basedOn: ['novel'], genres: ['Drama'],
    countries: ['USA'], languages: ['English'], runtime: 145, collection: 'Test Collection',
    people: { director: [person(1)], writer: [person(2)], cinematography: [], composer: [person(3)], editor: [person(4)], producer: [person(9)],
      cast: Array.from({ length: 12 }, (_, i) => person(10 + i)) },
  };
  const film = { key: 'lid:A', src: {
    mcreviews: { users: [{ text: 'Loved it' }, { text: '   ' }], critics: [{ text: 'Quietly devastating' }] },
    tmdb: { reviews: [{ text: 'Slow but good' }] },
    rt: { consensus: 'A fine film.' },
    wikipedia: { sections: { reception: 'Well received.', themes: 'Themes of loss.', plot: 'x'.repeat(5000) } },
    wikicats: { categories: ['Films about atonement', 'Neo-noir'] },
    wikidata: { collectionId: 'wd:Q1' },
  } };
  const f = gatherFeelInput(composed, film);
  assert.equal(f.key, 'lid:A');
  assert.equal(f.year, 1999);
  assert.deepEqual(f.texts.map((t) => t.source), ['mcreviews.users', 'tmdb.reviews', 'rt.consensus', 'mcreviews.critics',
    'wikipedia.reception', 'wikipedia.themes', 'wikipedia.plot', 'synopsis', 'tagline']);
  assert.deepEqual(f.texts.map((t) => t.voice), ['viewers', 'viewers', 'critics', 'critics', 'critics', 'editors', 'editors', 'editors', 'editors']);
  assert.equal(f.texts.find((t) => t.source === 'wikipedia.plot').text.length, 3000);
  assert.equal(f.texts.find((t) => t.source === 'synopsis').text, 'A synopsis.');
  assert.deepEqual(f.categories, ['Films about atonement', 'Neo-noir']);
  assert.deepEqual(f.keywords, ['road trip', 'grief']);
  assert.equal(f.people.cast.length, 8);
  assert.deepEqual(f.people.director, [{ id: 'p1', name: 'Person 1' }]);
  assert.equal('producer' in f.people, false);
  assert.equal(f.runtime, 145);
  assert.equal(f.collection, 'wd:Q1');
  assert.deepEqual(f.countries, ['USA']);
});

test('partial film falls back on composed collection', () => {
  const f = gatherFeelInput({ key: 'k', title: 'T', year: 2001, runtime: '90', collection: { id: 'tmdb:5', name: 'X' }, genres: ['Comedy'] },
    { src: { rt: { consensus: 'Ok.' } } });
  assert.equal(f.texts.length, 1);
  assert.equal(f.runtime, 90);
  assert.equal(f.collection, 'tmdb:5');
  assert.deepEqual(f.keywords, []);
  assert.deepEqual(f.people.director, []);
  assert.equal(gatherFeelInput({ collection: 'Name' }, {}).collection, 'Name');
});

test('empty and malformed input never throws', () => {
  for (const args of [[], [null, null], [{}, {}], [{ keywords: 'nope', people: 5 }, { src: { mcreviews: { users: 'x', critics: [null, 3] }, wikicats: { categories: 'x' } } }]]) {
    const f = gatherFeelInput(...args);
    assert.deepEqual(f.texts, []);
    assert.deepEqual(f.categories, []);
    assert.deepEqual(f.keywords, []);
    assert.equal(f.runtime, null);
    assert.equal(f.collection, null);
    assert.deepEqual(Object.keys(f.people), ['director', 'writer', 'cinematography', 'composer', 'editor', 'cast']);
  }
});
