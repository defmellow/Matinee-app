import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../../ui/screens/library/select.js';

// Synthetic films, for tests only.
const film = (key, watchlist, tags = []) => [key, { key, user: { watchlist, tags } }];
const byKey = new Map([film('a', true, ['rainy', 'long']), film('b', true, ['rainy']), film('c', false, ['ignored']), film('d', true)]);

test('rangeKeys covers both directions and odd cases', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(s.rangeKeys(order, 'b', 'd'), ['b', 'c', 'd']);
  assert.deepEqual(s.rangeKeys(order, 'd', 'b'), ['b', 'c', 'd']);
  assert.deepEqual(s.rangeKeys(order, 'c', 'c'), ['c']);
  assert.deepEqual(s.rangeKeys(order, 'zz', 'c'), ['c']);
  assert.deepEqual(s.rangeKeys(order, 'a', 'zz'), []);
});

test('withKeys does not mutate the original', () => {
  const a = new Set(['x']);
  const b = s.withKeys(a, ['y', 'z'], true);
  assert.deepEqual([...a], ['x']);
  assert.deepEqual([...b], ['x', 'y', 'z']);
  assert.deepEqual([...s.withKeys(b, ['x', 'q'], false)], ['y', 'z']);
});

test('summarise counts watchlist and watched, and unions watchlist tags', () => {
  const r = s.summarise(byKey, new Set(['a', 'b', 'c', 'gone']));
  assert.equal(r.watchlistCount, 2);
  assert.equal(r.watchedCount, 1);
  assert.equal(r.total, 3);
  assert.deepEqual(r.tagUnion, [{ name: 'rainy', count: 2 }, { name: 'long', count: 1 }]);
  assert.deepEqual(s.summarise(byKey, new Set()).tagUnion, []);
});

test('suggestTags puts prefix matches first and handles blanks', () => {
  const names = ['rainy day', 'sunny', 'brainy', 'rainy day'];
  assert.deepEqual(s.suggestTags(names, 'rain'), ['rainy day', 'brainy']);
  assert.deepEqual(s.suggestTags(names, '  '), ['rainy day', 'sunny', 'brainy']);
  assert.deepEqual(s.suggestTags(names, 'zzz'), []);
  assert.equal(s.suggestTags(names, '', 2).length, 2);
});

test('watchedNote only appears when watched films are selected', () => {
  assert.equal(s.watchedNote({ total: 7, watchlistCount: 5 }), 'Tags apply to watchlist films only — 5 of 7 selected.');
  assert.equal(s.watchedNote({ total: 5, watchlistCount: 5 }), null);
  assert.equal(s.watchedNote({ total: 0, watchlistCount: 0 }), null);
});

test('tagToast wording', () => {
  assert.equal(s.tagToast({ add: 'rainy day' }, { changed: 5, skipped: 2 }), "Tagged 5 films 'rainy day'. 2 watched films were skipped.");
  assert.equal(s.tagToast({ add: 'x' }, { changed: 1, skipped: 1 }), "Tagged 1 film 'x'. 1 watched film was skipped.");
  assert.equal(s.tagToast({ add: 'x' }, { changed: 0, skipped: 0 }), "Those films already have 'x'.");
  assert.equal(s.tagToast({ remove: 'x' }, { changed: 3, skipped: 0 }), "Removed 'x' from 3 films.");
  assert.equal(s.tagToast({ remove: 'x' }, { changed: 0, skipped: 0 }), "None of those films had 'x'.");
});

