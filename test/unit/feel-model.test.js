import test from 'node:test';
import assert from 'node:assert/strict';

test('aboutChips: darker (higher tier) chips come first, then by centrality', async () => {
  const { aboutChips } = await import('../../ui/screens/film/feelModel.js');
  const out = aboutChips([{ id: 'a', label: 'A', tier: 0, centrality: 0.9 }, { id: 'b', label: 'B', tier: 2, centrality: 0.5 }, { id: 'c', label: 'C', tier: 1, centrality: 0.7 }, { id: 'd', label: 'D', tier: 2, centrality: 0.6 }]);
  assert.deepEqual(out.map(t => t.id), ['d', 'b', 'c', 'a']);
});
