import test from 'node:test';
import assert from 'node:assert/strict';
import { placePop, oneLine } from '../../ui/components/posterpop.js';

const vp = { w: 1200, h: 800 };
const size = { w: 300, h: 360 };
const a = (left, top) => ({ left, top, right: left + 150, bottom: top + 225 });

test('opens to the right of the poster when there is room', () => {
  const p = placePop(a(100, 100), size, vp);
  assert.equal(p.side, 'right'); assert.equal(p.left, 262); assert.equal(p.top, 100); assert.equal(p.ox, 0);
});
test('flips to the left near the right edge', () => {
  const p = placePop(a(1000, 100), size, vp);
  assert.equal(p.side, 'left'); assert.equal(p.left, 1000 - 12 - 300); assert.equal(p.ox, 300);
});
test('stays on screen vertically near the bottom', () => {
  const p = placePop(a(100, 700), size, vp);
  assert.ok(p.top + size.h <= vp.h - 8); assert.ok(p.top >= 8);
});
test('goes below or above when neither side fits', () => {
  const narrow = { w: 400, h: 900 };
  assert.equal(placePop(a(120, 50), size, narrow).side, 'below');
  const b = placePop(a(120, 600), size, narrow);
  assert.equal(b.side, 'above'); assert.ok(b.left >= 8 && b.left + 300 <= 392);
});
test('never leaves the viewport even when it cannot fit', () => {
  const p = placePop(a(10, 10), { w: 300, h: 900 }, { w: 320, h: 500 });
  assert.ok(p.left >= 8); assert.ok(p.top >= 8);
});
test('oneLine takes a first sentence and trims long text', () => {
  assert.equal(oneLine(''), '');
  assert.equal(oneLine('A quiet drama about a lighthouse keeper. More follows here.'), 'A quiet drama about a lighthouse keeper.');
  const long = oneLine('word '.repeat(80));
  assert.ok(long.length <= 141 && long.endsWith('…'));
});
