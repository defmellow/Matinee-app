import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeId, tallyCountries, colourStep } from '../../ui/screens/insights/countryMap.js';
import { WORLD_MAP } from '../../ui/data/world-map.js';

test('map data has unique ids and paths', () => {
  assert.ok(WORLD_MAP.length > 150);
  assert.equal(new Set(WORLD_MAP.map(c => c.id)).size, WORLD_MAP.length);
  assert.ok(WORLD_MAP.every(c => /^M/.test(c.d)));
});

test('shapeId matches modern, variant and legacy names', () => {
  assert.equal(shapeId('Japan'), 'JP');
  assert.equal(shapeId('USA'), 'US');
  assert.equal(shapeId('United States of America'), 'US');
  assert.equal(shapeId('United Kingdom'), 'GB');
  assert.equal(shapeId('UK'), 'GB');
  assert.equal(shapeId('Soviet Union'), 'RU');
  assert.equal(shapeId('West Germany'), 'DE');
  assert.equal(shapeId('Côte d’Ivoire'), 'CI');
  assert.equal(shapeId('The Netherlands'), 'NL');
  assert.equal(shapeId({ name: 'France' }), 'FR');
  assert.equal(shapeId('Hong Kong'), null);
  assert.equal(shapeId(''), null);
  assert.equal(shapeId(null), null);
});

test('tallyCountries counts watched films once per shape and lists unmatched names', () => {
  const w = countries => ({ user: { watched: true }, countries });
  const films = [
    w(['USA', 'United States']), w(['Japan']), w(['UK', 'Japan']), w(['Hong Kong']),
    { user: { watched: false }, countries: ['Japan'] },
  ];
  const t = tallyCountries(films);
  assert.equal(t.counts.get('US'), 1);
  assert.equal(t.counts.get('JP'), 2);
  assert.deepEqual(t.names.get('US'), ['USA', 'United States']);
  assert.deepEqual([...t.missing], [['Hong Kong', 1]]);
  assert.equal(t.max, 2);
});

test('colourStep: none is 0, the top is 5, steps never fall below 1 for a film', () => {
  assert.equal(colourStep(0, 10), 0);
  assert.equal(colourStep(1, 100), 1);
  assert.equal(colourStep(100, 100), 5);
  assert.ok(colourStep(25, 100) > colourStep(4, 100));
});
