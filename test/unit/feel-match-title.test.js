import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTitle, tierFor } from '../../ui/screens/feel/model.js';

test('matchTitle names the tier, the real figure and the best in the list', () => {
  const r = { score: 0.62, why: ['both wistful'] };
  const t = matchTitle(r, tierFor(0.62, 0.9), 0.9);
  assert.equal(t, 'Close feel match\nFeel match 62 out of 100 (the closest here is 90)\nWhy: both wistful');
});

test('matchTitle for the best result does not repeat the figure', () => {
  assert.equal(matchTitle({ score: 0.9 }, tierFor(0.9, 0.9), 0.9), 'Very close feel match\nFeel match 90 out of 100');
});
