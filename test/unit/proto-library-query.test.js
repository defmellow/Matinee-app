// PROTOTYPE (proto/library-feel): the merged Library's query model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, hasFeel, ranks, sortOf, toggle, leaveOut, include, drop, stateOf, fromParam, resolveKinds, activePills, clearAll, narrowed } from '../../ui/screens/proto/shared/query.js';

test('normalise keeps library fields and feel fields', () => {
  const q = normalise({ status: 'watchlist', feel: ['eerie'], themes: ['grief', 'grief'], avoid: ['silly'], feelText: 'quietly sad', like: 'k1', likeEmphasis: 'nope' });
  assert.equal(q.status, 'watchlist');
  assert.deepEqual(q.feel, ['eerie']);
  assert.deepEqual(q.themes, ['grief']);
  assert.deepEqual(q.avoid, ['silly']);
  assert.equal(q.feelText, 'quietly sad');
  assert.equal(q.like, 'k1');
  assert.equal(q.likeEmphasis, 'overall');
});

test('leave-out wins over include for the same id', () => {
  const q = normalise({ feel: ['eerie'], avoid: ['eerie'] });
  assert.deepEqual(q.feel, []);
  assert.deepEqual(q.avoid, ['eerie']);
});

test('sort: Best match by default only when something ranks', () => {
  assert.equal(sortOf(normalise({})), 'recent');
  assert.equal(sortOf(normalise({ feel: ['eerie'] })), 'match');
  assert.equal(sortOf(normalise({ feel: ['eerie'], sort: 'year' })), 'year');
  assert.equal(sortOf(normalise({ sort: 'match' })), 'recent'); // a saved Best match with nothing to match
  assert.equal(sortOf(normalise({ avoid: ['silly'] })), 'recent'); // leave-outs narrow, they don't rank
  assert.equal(hasFeel(normalise({ avoid: ['silly'] })), true);
  assert.equal(ranks(normalise({ avoid: ['silly'] })), false);
});

test('chip actions', () => {
  let q = normalise({});
  q = toggle(q, 'descriptors', 'eerie');
  assert.equal(stateOf(q, 'eerie'), 'in');
  q = leaveOut(q, 'eerie');
  assert.equal(stateOf(q, 'eerie'), 'out');
  q = include(q, 'descriptors', 'eerie');
  assert.equal(stateOf(q, 'eerie'), 'in');
  q = toggle(q, 'descriptors', 'eerie');
  assert.equal(stateOf(q, 'eerie'), 'off');
  q = include(q, 'themes', 'lb:grief');
  assert.deepEqual(q.themes, ['lb:grief']);
  assert.equal(stateOf(drop(q, 'lb:grief'), 'lb:grief'), 'off');
});

test('links: Library forms and the old By feel forms', () => {
  assert.deepEqual(fromParam('genre:Horror').genres, ['Horror']);
  assert.deepEqual(fromParam('feel:d:eerie').feel, ['eerie']);
  assert.deepEqual(fromParam('feel:lb:grief').themes, ['lb:grief']);
  assert.equal(fromParam('feel:film:abc').like, 'abc');
  assert.equal(fromParam('feel:q:quietly sad').feelText, 'quietly sad');
  assert.deepEqual(fromParam('feel:twin-brothers').themes, ['twin-brothers']); // a bare id (film-page Subjects chips)
  assert.equal(fromParam('nonsense'), null);
});

test('a bare id that is a feeling moves to feelings once facets are known', () => {
  const q = resolveKinds(normalise({ themes: ['eerie', 'grief'] }), { descriptors: [{ id: 'eerie' }] });
  assert.deepEqual(q.feel, ['eerie']);
  assert.deepEqual(q.themes, ['grief']);
});

test('pills: feelings first, then library filters; clear keeps the sort', () => {
  const q = normalise({ feel: ['eerie'], avoid: ['silly'], genres: ['Drama'], like: 'k', sort: 'year' });
  const pills = activePills(q, { labels: new Map([['eerie', 'Eerie'], ['silly', 'Silly']]), filmTitle: () => 'Paris, Texas' });
  assert.deepEqual(pills.map(p => p.label), ['Feels like Paris, Texas', 'Eerie', 'Silly', 'Drama']);
  assert.deepEqual(pills.map(p => p.kind), ['like', 'feel', 'avoid', 'lib']);
  assert.deepEqual(pills[1].patch(q).feel, []);
  const c = clearAll(q);
  assert.equal(c.sort, 'year');
  assert.equal(c.like, null);
  assert.equal(narrowed(c), false);
  assert.equal(clearAll(normalise({ sort: 'match', feel: ['x'] })).sort, null);
});
