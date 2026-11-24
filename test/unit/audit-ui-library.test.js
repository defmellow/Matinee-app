import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneKeys, querySignature } from '../../ui/screens/library/select.js';
import { n } from '../../ui/format.js';

test('pruneKeys drops keys that left the library and keeps the same Set when nothing changed', () => {
  const byKey = new Map([['a', {}], ['b', {}]]);
  const same = new Set(['a', 'b']);
  assert.equal(pruneKeys(same, byKey), same);
  const pruned = pruneKeys(new Set(['a', 'x', 'y']), byKey);
  assert.deepEqual([...pruned], ['a']);
});

test('querySignature changes with the query or mode, not with object identity', () => {
  const q1 = { text: 'a', status: 'all' }, q2 = { text: 'a', status: 'all' };
  assert.equal(querySignature(q1, 'grid'), querySignature(q2, 'grid'));
  assert.notEqual(querySignature(q1, 'grid'), querySignature(q1, 'list'));
  assert.notEqual(querySignature(q1, 'grid'), querySignature({ ...q1, text: 'b' }, 'grid'));
});

test('n formats counts with en-AU thousands separators', () => {
  assert.equal(n(1234), '1,234');
  assert.equal(n(0), '0');
  assert.equal(n(12), '12');
  assert.equal(n(null), null);
});
