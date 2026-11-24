// Poster loading for the zoomed-in Map: a few at a time, a small cache, failures remembered. Fake images, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPosterCache } from '../../ui/screens/map/posters.js';

const fake = () => { const made = []; return { made, make: url => { const i = { url }; made.push(i); return i; } }; };

test('only a few load at once and the rest wait their turn, newest first', () => {
  const f = fake(), c = createPosterCache({ make: f.make, maxLoading: 2 });
  assert.equal(c.get('a'), null); assert.equal(c.get('b'), null); assert.equal(c.get('c'), null); assert.equal(c.get('d'), null);
  assert.equal(c.loading, 2);
  f.made[0].onload();
  assert.equal(c.get('a'), f.made[0]);
  assert.equal(f.made[2].url, 'd', 'the newest request goes next');
});

test('failures are remembered and not retried; no url is a failure', () => {
  const f = fake(), c = createPosterCache({ make: f.make });
  c.get('x'); f.made[0].onerror();
  assert.equal(c.get('x'), false);
  assert.equal(f.made.length, 1);
  assert.equal(c.get(null), false);
});

test('the cache keeps a small number, dropping the least recently used', () => {
  const f = fake(), c = createPosterCache({ make: f.make, keep: 2 });
  for (const u of ['a', 'b']) { c.get(u); f.made.at(-1).onload(); }
  c.get('a'); // a is now recent
  c.get('c'); f.made.at(-1).onload();
  assert.equal(c.size, 2);
  assert.ok(c.get('a')); assert.ok(c.get('c'));
  assert.equal(c.get('b'), null, 'b was dropped, so it loads again');
});
