import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topLinks } from '../../core/analysis/map-links.js';
import { feelMap, MAP } from '../../core/analysis/feel-map.js';

// film 0's closest are 1, 2, 3 (strongest first); 3 and 4 are each other's closest
const lists = [[[1, 0.9], [2, 0.8], [3, 0.2]], [[0, 0.9]], [[0, 0.8]], [[4, 0.7], [0, 0.2]], [[3, 0.7]]];

test('topLinks: each pair once, at most `top` per film, the floor past the first', () => {
  assert.deepEqual(topLinks(lists, undefined, { top: 2, floor: 0.5 }), [[0, 1, 0.9], [0, 2, 0.8], [3, 4, 0.7]]);
  assert.deepEqual(topLinks(lists, undefined, { top: 5, floor: 0 }), [[0, 1, 0.9], [0, 2, 0.8], [0, 3, 0.2], [3, 4, 0.7]]);
});

test('topLinks: a hidden film loses its lines and the next closest film on show takes its place', () => {
  const keep = i => i !== 1;
  assert.deepEqual(topLinks(lists, keep, { top: 2, floor: 0 }), [[0, 2, 0.8], [0, 3, 0.2], [3, 4, 0.7]]);
  // a film whose first match is hidden still gets its first line on show, whatever the floor
  assert.deepEqual(topLinks([[[1, 0.9], [2, 0.1]], [], []], i => i !== 1, { top: 2, floor: 0.5 }), [[0, 2, 0.1]]);
});

test('feelMap: the screen can rebuild the same lines from near and lines', () => {
  const keys = Array.from({ length: 40 }, (_, i) => 'f' + i);
  const neighbours = new Map(keys.map((k, i) => [k, Array.from({ length: 8 }, (_, d) => ({ key: keys[(i + d + 1) % 40], score: 0.9 - d * 0.1 - (i % 3) * 0.01 }))]));
  const m = feelMap({ keys, neighbours });
  const index = new Map(keys.map((k, i) => [k, i]));
  const rebuilt = topLinks(keys.map(k => (m.near[k] || []).map(([o, s]) => [index.get(o), s])), undefined, m.lines);
  assert.deepEqual(rebuilt, m.links);
  assert.equal(m.lines.top, MAP.linkTop);
});
