import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, toCoreQuery, activeFilters, isNarrowed, cleared, feelKeySet, applyFeel, feelGroups, feelLabelMap, DEFAULT_QUERY, FEEL_MIN } from '../../ui/screens/library/model.js';

test('normalise: older queries gain an empty feel list', () => {
  assert.deepEqual(normalise({ genres: ['Drama'] }).feel, []);
  assert.deepEqual(normalise(null).feel, []);
});
test('normalise: feel is cleaned, unknown fields are dropped', () => {
  const n = normalise({ feel: ['tender', 'tender', '', 7, 'tense'], bogus: 1 });
  assert.deepEqual(n.feel, ['tender', 'tense']);
  assert.equal('bogus' in n, false);
  assert.deepEqual(normalise({ feel: 'oops' }).feel, []);
  assert.deepEqual(Object.keys(normalise({})).sort(), Object.keys(DEFAULT_QUERY).sort());
});
test('saved view round-trips through normalise', () => {
  const v = normalise({ status: 'watched', feel: ['slow-burn'] });
  assert.deepEqual(normalise(JSON.parse(JSON.stringify(v))), v);
});
test('feel is not sent to the core query', () => {
  assert.equal('feel' in toCoreQuery({ feel: ['tender'] }), false);
});
test('active chips, narrowed and cleared', () => {
  const q = normalise({ feel: ['tender', 'tense'] });
  const chips = activeFilters(q, {}, { tender: 'Tender' });
  assert.deepEqual(chips.map(c => c.label), ['Feels Tender', 'Feels tense']);
  assert.deepEqual(normalise({ ...q, ...chips[0].patch }).feel, ['tense']);
  assert.equal(isNarrowed(q), true);
  assert.equal(isNarrowed(normalise({})), false);
  assert.deepEqual(cleared({ ...q, sort: 'title' }).feel, []);
  assert.equal(cleared({ ...q, sort: 'title' }).sort, 'title');
});
test('feelKeySet: every feel must match, weak scores do not count', () => {
  const a = [{ key: 'x', score: 0.6 }, { key: 'y', score: 0.5 }, { key: 'z', score: FEEL_MIN - 0.01 }];
  const b = [{ key: 'y', score: 0.3 }, { key: 'z', score: 0.9 }];
  assert.deepEqual([...feelKeySet([a])].sort(), ['x', 'y']);
  assert.deepEqual([...feelKeySet([a, b])], ['y']);
  assert.equal(feelKeySet([]), null);
  assert.equal(feelKeySet([[], a]).size, 0);
});
test('applyFeel intersects with a keys set; null leaves the list alone', () => {
  const list = [{ key: 'x' }, { key: 'y' }, { key: 'q' }];
  assert.deepEqual(applyFeel(list, new Set(['y', 'q', 'nope'])).map(f => f.key), ['y', 'q']);
  assert.equal(applyFeel(list, null), list);
  assert.deepEqual(applyFeel(list, new Set()), []);
});
test('feelGroups: grouped, biggest first, chosen kept past the cap, empty when no facets', () => {
  const facets = { descriptors: [
    ...Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, label: 'M' + i, facet: 'mood', count: 20 - i })),
    { id: 'slow', label: 'Slow-burn', facet: 'pace', count: 3 },
  ] };
  const g = feelGroups(facets, ['m9'], { cap: 3 });
  assert.deepEqual(g.map(x => x.id), ['mood', 'pace']);
  assert.deepEqual(g[0].items.map(d => d.id), ['m0', 'm1', 'm2', 'm9']);
  assert.equal(g[0].hidden, 6);
  assert.equal(feelGroups(facets, [], { expanded: true })[0].items.length, 10);
  assert.deepEqual(feelGroups(null), []);
  assert.deepEqual(feelLabelMap(facets).slow, 'Slow-burn');
});

test('normalise: a renamed feeling in a saved view still works (wistful → bittersweet)', () => {
  assert.deepEqual(normalise({ feel: ['wistful', 'bittersweet', 'tense'] }).feel, ['bittersweet', 'tense']);
});
