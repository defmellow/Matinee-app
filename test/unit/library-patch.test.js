// Pure helpers behind the UI's incremental library updates (ui/libraryPatch.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { patchFilms, chunk, isKeyed, touchesKey, libraryAction, PATCH_CHUNK } from '../../ui/libraryPatch.js';

const f = (key, v = 0) => ({ key, v });

test('patchFilms replaces by key, keeps order, appends new films, reuses untouched objects', () => {
  const films = [f('a'), f('b'), f('c')];
  const out = patchFilms(films, [f('b', 1), f('z', 9)]);
  assert.deepEqual(out.map(x => x.key), ['a', 'b', 'c', 'z']);
  assert.equal(out[1].v, 1);
  assert.equal(out[0], films[0]);
  assert.equal(out[2], films[2]);
  assert.equal(films[1].v, 0, 'input array untouched');
  assert.equal(films.length, 3);
});

test('patchFilms: the last update for a key wins, duplicates of a new film do not double up, empty is a no-op', () => {
  const films = [f('a')];
  assert.deepEqual(patchFilms(films, [f('n', 1), f('n', 2), f('a', 3), f('a', 4)]).map(x => x.v), [4, 2]);
  assert.equal(patchFilms(films, []), films);
  assert.equal(patchFilms(films, null), films);
  assert.deepEqual(patchFilms([], [f('x')]).length, 1);
  assert.equal(patchFilms(films, [null, {}])[0], films[0], 'junk entries ignored');
});

test('chunk splits into runs of at most the size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
  assert.equal(chunk(Array.from({ length: 120 }, (_, i) => i)).length, Math.ceil(120 / PATCH_CHUNK));
});

test('keyed vs keyless events, and which ones a film page cares about', () => {
  assert.equal(isKeyed({ keys: [] }), true);
  assert.equal(isKeyed(undefined), false);
  assert.equal(isKeyed({}), false);
  assert.equal(touchesKey(undefined, 'k'), true, 'keyless: anything may have changed');
  assert.equal(touchesKey({ keys: ['a', 'k'] }, 'k'), true);
  assert.equal(touchesKey({ keys: ['a'] }, 'k'), false);
  assert.equal(touchesKey({ keys: [] }, 'k'), false);
});

test('libraryAction: keyless means a full reload; keyed patches until the last full reload is old', () => {
  const o = { now: 100000, lastFull: 90000, fullEvery: 60000 };
  assert.equal(libraryAction(undefined, o), 'full');
  assert.equal(libraryAction({ keys: ['a'] }, o), 'patch');
  assert.equal(libraryAction({ keys: ['a'] }, { ...o, lastFull: 40000 }), 'full');
  assert.equal(libraryAction({ keys: ['a'] }, { ...o, lastFull: 0, now: 59999 }), 'patch');
});
