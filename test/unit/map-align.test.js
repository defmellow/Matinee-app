// alignTo: a fresh Map layout is turned to sit where the previous one did. SYNTHETIC points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTo } from '../../core/analysis/feel-map.js';

// a layout fitted into 0..1 the way feelMap leaves it (longest side exactly 0..1)
const fitted = pts => {
  const xs = pts.map(p => p[1]), ys = pts.map(p => p[2]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), span = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0);
  return { total: pts.length, nodes: pts.map(([key, x, y]) => ({ key, x: (x - x0) / span, y: (y - y0) / span, colour: '#abc' })), links: [[0, 1, 0.5]], near: {}, loose: [] };
};
const base = fitted([['a', 0, 0], ['b', 3, 1], ['c', 1, 4], ['d', 5, 5], ['e', 2, 2.5], ['f', 4, 0.5], ['g', 0.5, 3]]);
const move = (layout, f) => ({ ...layout, nodes: layout.nodes.map(p => ({ ...p, ...f(p) })) });
const close = (a, b) => { for (let i = 0; i < a.nodes.length; i++) { assert.equal(a.nodes[i].key, b.nodes[i].key); assert.ok(Math.abs(a.nodes[i].x - b.nodes[i].x) < 1e-6, `x of ${a.nodes[i].key}`); assert.ok(Math.abs(a.nodes[i].y - b.nodes[i].y) < 1e-6, `y of ${a.nodes[i].key}`); } };

test('a turned, mirrored and shifted copy lines up again', () => {
  const th = 0.9;
  const scrambled = move(base, p => ({ x: -(Math.cos(th) * p.x - Math.sin(th) * p.y) * 3 + 7, y: (Math.sin(th) * p.x + Math.cos(th) * p.y) * 3 - 2 }));
  const out = alignTo(scrambled, base);
  close(out, base);
  assert.deepEqual(out.links, base.links, 'everything else rides along');
  assert.equal(out.nodes[0].colour, '#abc');
});

test('a plain turn and a plain shift line up too', () => {
  close(alignTo(move(base, p => ({ x: -p.y + 5, y: p.x + 5 })), base), base);
});

test('films that are new or gone do not stop the others lining up, and new ones land beside them', () => {
  const next = move(base, p => ({ x: p.y * 2 + 1, y: p.x * 2 + 1 })); // a mirror image of the same arrangement
  next.nodes = next.nodes.filter(p => p.key !== 'a').concat([{ key: 'new', x: 2, y: 2, colour: '#abc' }]);
  const out = alignTo(next, base);
  for (const p of out.nodes) assert.ok(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9, 'still in the 0..1 box');
  const was = new Map(base.nodes.map(p => [p.key, p]));
  for (const p of out.nodes) if (p.key !== 'new') assert.ok(Math.hypot(p.x - was.get(p.key).x, p.y - was.get(p.key).y) < 0.2, p.key + ' stays near its old place');
});

test('with fewer than three films in common the layout is returned unchanged', () => {
  const other = fitted([['x', 0, 0], ['y', 1, 3], ['z', 4, 1], ['a', 2, 2], ['b', 3, 3]]);
  assert.equal(alignTo(other, base), other);
  assert.equal(alignTo(other, null), other);
  const same = fitted([['q', 1, 1], ['w', 1, 1], ['e', 1, 1]]);
  assert.equal(alignTo(same, same), same, 'all on one spot: nothing to match');
});
