import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFeelId, canonicalFeelIds } from '../../core/analysis/feel/aliases.js';
import { parseParam } from '../../ui/screens/feel/model.js';
import { LEXICON } from '../../core/analysis/feel/lexicon.js';

test('wistful maps to bittersweet; other ids are untouched', () => {
  assert.equal(canonicalFeelId('wistful'), 'bittersweet');
  assert.equal(canonicalFeelId('tense'), 'tense');
});
test('lists are deduped when both old and new are present', () => {
  assert.deepEqual(canonicalFeelIds(['wistful', 'tender', 'bittersweet']), ['bittersweet', 'tender']);
  assert.deepEqual(canonicalFeelIds(null), []);
});
test('route d:wistful gives bittersweet', () => {
  assert.deepEqual(parseParam('d:wistful').filters.descriptors, ['bittersweet']);
  assert.deepEqual(parseParam('d:tense').filters.descriptors, ['tense']);
});
test('every alias target is a real descriptor', () => {
  const ids = new Set(LEXICON.map(d => d.id));
  assert.ok(ids.has('bittersweet'));
  assert.ok(!ids.has('wistful'));
});
