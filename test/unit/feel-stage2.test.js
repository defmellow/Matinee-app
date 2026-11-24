// Stage 2: centrality as the similarity weight for themes, and the strength floor for film-page chips.
// Synthetic films only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { centralityFactor, CENTRALITY } from '../../core/analysis/feel/centrality.js';
import { applyChipFloor, CHIP_FLOOR } from '../../core/analysis/feel/floor.js';
import { buildFeelIndex, similar } from '../../core/analysis/feel/index.js';

const film = (key, over = {}) => ({ key, title: key, year: 2000, texts: [], categories: [], keywords: [], subjects: [], genres: [], people: {}, ...over });
const viewer = (text) => ({ voice: 'viewers', source: 'review', text });

test('centralityFactor rises with C, stays in range, and has a fallback for themes without C', () => {
  const lo = centralityFactor(0.2), mid = centralityFactor(0.5), hi = centralityFactor(0.9);
  assert.ok(lo < mid && mid < hi);
  assert.equal(hi, 1);
  assert.ok(lo > 0);
  assert.equal(centralityFactor(undefined), CENTRALITY.similarity.missing);
  assert.equal(centralityFactor(NaN), CENTRALITY.similarity.missing);
});

test('a theme central to the film counts for more than an incidental one', () => {
  // Source film: "Linguistics" is its main subject and its reviews talk about it; "Gardening" is a bare keyword.
  const a = film('a', {
    subjects: ['Linguistics'], keywords: ['Gardening'],
    texts: [viewer('A film about linguistics and how a language is learned.'), viewer('The linguistics angle carries everything.')],
  });
  const b = film('b', { subjects: ['Linguistics'] });
  const c = film('c', { keywords: ['Gardening'] });
  const idx = buildFeelIndex([a, b, c]);
  const rows = similar(idx, 'a', { limit: 5 });
  const themesOf = (k) => rows.find(r => r.key === k).parts.themes;
  assert.ok(themesOf('b') > themesOf('c'), `central ${themesOf('b')} should beat incidental ${themesOf('c')}`);
});

test('chip floor: absolute minimum drops very weak chips, even the strongest of a facet', () => {
  const kept = applyChipFloor([{ id: 'a', facet: 'mood', score: 0.09 }, { id: 'b', facet: 'tone', score: 0.9 }]);
  assert.deepEqual(kept.map(d => d.id), ['b']);
});

test('theme floor: a theme far behind the strongest goes; one near the top stays', () => {
  const rel = CHIP_FLOOR.relative.default;
  const list = [
    { id: 'a', facet: 'theme', score: 0.5 },
    { id: 'b', facet: 'theme', score: 0.5 * rel + 0.01 },
    { id: 'c', facet: 'theme', score: 0.5 * rel - 0.02 },
  ];
  assert.deepEqual(applyChipFloor(list).map(d => d.id), ['a', 'b']);
});

test('chip floor: the strongest chip of a facet stays whatever the others do, and order is kept', () => {
  const list = [{ id: 'x', facet: 'impact', score: 0.2 }];
  assert.deepEqual(applyChipFloor(list), list);
  const mixed = [{ id: 'a', facet: 'mood', score: 0.6 }, { id: 'b', facet: 'craft', score: 0.5 }, { id: 'c', facet: 'mood', score: 0.4 }];
  assert.deepEqual(applyChipFloor(mixed).map(d => d.id), ['a', 'b', 'c']);
});

test('chip floor: a thin film with only weak evidence shows no feeling chips', () => {
  const thin = [{ id: 'a', facet: 'mood', score: 0.09 }, { id: 'b', facet: 'craft', score: 0.07 }];
  assert.deepEqual(applyChipFloor(thin), []);
});

test('a film with only one keyword still shows that keyword as its chip', () => {
  const idx = buildFeelIndex([film('k', { keywords: ['grim'] })]);
  assert.equal(idx.byKey.get('k').profile.descriptors.length, 1);
});
