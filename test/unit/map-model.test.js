// The Map's arithmetic (screen view, colours, filters).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBox, boxOf, zoomAt, toScreen, toWorld, nearestDot, scopeFilter, looseFilter, allOf, fold, sizeTier, sizeChoice, tierRadius, biggestRadius, liveNeighbours, canPoint, TIERS } from '../../ui/screens/map/model.js';

test('fitBox frames a box in the middle of the area', () => {
  const v = fitBox({ x0: 0, y0: 0, x1: 1000, y1: 500 }, { w: 1000, h: 600 }, 50);
  assert.ok(Math.abs(v.k - 0.9) < 1e-9);
  const c = toScreen(v, 500, 250);
  assert.ok(Math.abs(c.x - 500) < 1e-9 && Math.abs(c.y - 300) < 1e-9);
  assert.equal(fitBox({ x0: 0, y0: 0, x1: 1, y1: 1 }, { w: 800, h: 600 }, 10, 5).k, 5);
});

test('zoomAt keeps the point under the pointer still and respects the limits', () => {
  const v = { k: 1, tx: 10, ty: 20 };
  const before = toWorld(v, 300, 200), z = zoomAt(v, 2, 300, 200, 0.5, 8), after = toWorld(z, 300, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
  assert.equal(zoomAt(v, 100, 0, 0, 0.5, 8).k, 8);
  assert.equal(boxOf([]), null);
});

test('nearestDot finds the closest visible dot within reach', () => {
  const xs = [10, 20, 100], ys = [10, 10, 10], v = { k: 1, tx: 0, ty: 0 };
  assert.equal(nearestDot(xs, ys, () => true, v, 12, 10), 0);
  assert.equal(nearestDot(xs, ys, i => i !== 0, v, 12, 10), 1);
  assert.equal(nearestDot(xs, ys, () => true, v, 50, 50), -1);
});

test('filters are predicates that combine', () => {
  const lib = new Map([['a', { user: { watched: true } }], ['b', { user: { watched: false } }]]);
  assert.equal(scopeFilter('watched', lib)('a'), true);
  assert.equal(scopeFilter('watchlist', lib)('a'), false);
  assert.equal(scopeFilter('watchlist', lib)('b'), true);
  assert.equal(scopeFilter('all', lib)('zzz'), true);
  assert.equal(allOf([scopeFilter('watched', lib), () => false])('a'), false);
});

test('size by your rating: four clear steps, no rating or a watchlist film is the smallest', () => {
  const w = r => ({ user: { rating: r, watched: true } });
  assert.equal(sizeTier('mine', w(null)), 0);
  assert.equal(sizeTier('mine', { user: { rating: null, watched: false } }), 0);
  assert.equal(sizeTier('mine', { user: { rating: 8, watched: false } }), 0); // a watchlist film has no rating of hers
  assert.equal(sizeTier('mine', w(5)), 1);
  assert.equal(sizeTier('mine', w(8)), 2);
  assert.equal(sizeTier('mine', w(10)), 3);
  assert.equal(sizeTier('mine', undefined), 0);
});

test('size by the Letterboxd average: films with none (or no details yet) are the smallest', () => {
  const lb = v => ({ ratings: { letterboxd: { value: v, votes: 10 } } });
  assert.equal(sizeTier('letterboxd', lb(0)), 0);
  assert.equal(sizeTier('letterboxd', lb(null)), 0);
  assert.equal(sizeTier('letterboxd', {}), 0);
  assert.equal(sizeTier('letterboxd', { ratings: null }), 0);
  assert.equal(sizeTier('letterboxd', lb(1.9)), 1);
  assert.equal(sizeTier('letterboxd', lb(2.5)), 2);
  assert.equal(sizeTier('letterboxd', lb(3.0)), 3);
  assert.equal(sizeTier('letterboxd', lb(3.6)), 4);
  assert.equal(sizeTier('letterboxd', lb(3.8)), 5);
  assert.equal(sizeTier('letterboxd', lb(4.0)), 6);
  assert.equal(sizeTier('letterboxd', lb(4.3)), 7);
  assert.equal(sizeTier('letterboxd', lb(4.5)), 8);
  assert.equal(sizeTier('matinee', { score: null }), 0);
  assert.equal(sizeTier('matinee', { score: 35 }), 1);
  assert.equal(sizeTier('matinee', { score: 72 }), 5);
  assert.equal(sizeTier('matinee', { score: 86 }), 7);
  assert.equal(sizeTier('matinee', { score: 95 }), 8);
  assert.equal(sizeChoice('matinee'), 'matinee');
  assert.equal(sizeChoice('rating'), 'mine'); // an older saved choice never breaks
  assert.equal(sizeChoice(undefined), 'mine');
  assert.equal(sizeChoice('letterboxd'), 'letterboxd');
});

test('dot radii grow with each step and stay inside the biggest', () => {
  const rs = Array.from({ length: TIERS }, (_, t) => tierRadius(t, 6));
  assert.deepEqual(rs, [...rs].sort((a, b) => a - b));
  assert.equal(rs[TIERS - 1], 6);
  assert.ok(rs[1] - rs[0] >= 1, 'steps are easy to tell apart');
  const nine = Array.from({ length: 9 }, (_, t) => tierRadius(t, 6, 9));
  assert.ok(nine.every((r, k) => k === 0 || r > nine[k - 1]) && nine[8] === 6, 'nine steps, each a little bigger, never past the biggest');
  assert.ok(biggestRadius(960, 700) < biggestRadius(1440, 900) || biggestRadius(960, 700) === 3.6);
  assert.ok(biggestRadius(5000, 5000) <= 6.4 && biggestRadius(10, 10) >= 3.6);
});

test('a film that is filtered out is neither a neighbour nor pointable (the invisible-film bug)', () => {
  const alive = Uint8Array.from([1, 0, 1, 0]), fade = Float64Array.from([1, 0.2, 1, 0]);
  assert.deepEqual([...liveNeighbours(new Set([1, 2, 3]), alive)], [2]);
  assert.equal(liveNeighbours(undefined, alive).size, 0);
  assert.equal(canPoint(alive, fade, 0), true);
  assert.equal(canPoint(alive, fade, 1), false); // fading out
  assert.equal(canPoint(alive, Float64Array.from([1, 1, 1, 1]), 1), false); // gone, even if its fade has not caught up
  assert.equal(canPoint(alive, Float64Array.from([0.3, 1, 1, 1]), 0), false); // not yet faded in
});

test('fold drops accents', () => {
  assert.equal(fold('Amélie'), 'amelie');
});

test('the size key has one row per dot size, for both choices', async () => {
  const { SIZE_ROWS } = await import('../../ui/screens/map/model.js');
  assert.equal(SIZE_ROWS.mine.length, TIERS);
  assert.equal(SIZE_ROWS.letterboxd.length, 9);
  assert.equal(SIZE_ROWS.matinee.length, 9);
});

test('looseFilter hides films with too little written about them unless asked', () => {
  assert.equal(looseFilter(false, ['b'])('b'), false);
  assert.equal(looseFilter(false, ['b'])('a'), true);
  assert.equal(looseFilter(true, ['b'])('b'), true);
  assert.equal(looseFilter(false, [])('b'), true);
  assert.equal(looseFilter(false, null)('b'), true);
});
