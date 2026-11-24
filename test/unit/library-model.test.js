import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUERY, toCoreQuery, activeFilters, isNarrowed, cleared, statusCounts, effectiveDir } from '../../ui/screens/library/model.js';

test('toCoreQuery merges typed operators with filter bar choices', () => {
  const q = toCoreQuery({ ...DEFAULT_QUERY, text: 'dir:wenders year:1980s paris', genres: ['Drama'], decade: 1990 });
  assert.deepEqual(q.directors, ['wenders']);
  assert.equal(q.text, 'paris');
  assert.equal(q.yearMin, 1980); // typed operator wins over the decade chip
  assert.deepEqual(q.genres, ['Drama']);
  assert.equal(q.sort, 'recent');
});

test('decade chip becomes a year range; typed is: overrides status', () => {
  const q = toCoreQuery({ ...DEFAULT_QUERY, decade: 1970, text: 'is:watchlist' });
  assert.equal(q.yearMin, 1970); assert.equal(q.yearMax, 1979); assert.equal(q.status, 'watchlist');
});

test('activeFilters, isNarrowed and cleared', () => {
  const q = { ...DEFAULT_QUERY, genres: ['Drama'], runtimeMax: 120, ratingMin: 8, sort: 'title' };
  const f = activeFilters(q);
  assert.deepEqual(f.map(x => x.id), ['g:Drama', 'rating', 'runtime']);
  assert.equal(f[1].label, 'You rated 4 stars+');
  assert.ok(isNarrowed(q));
  assert.ok(!isNarrowed(cleared(q)));
  assert.equal(cleared(q).sort, 'title');
});

test('statusCounts and default directions', () => {
  const films = [{ user: { watched: true, rating: null } }, { user: { watched: true, rating: 8, liked: true } }, { user: { watchlist: true } }];
  assert.deepEqual(statusCounts(films), { all: 3, watched: 2, watchlist: 1, listed: 0, liked: 1, unrated: 1 });
  assert.equal(effectiveDir({ ...DEFAULT_QUERY, status: 'watchlist' }), 'asc');
  assert.equal(effectiveDir({ ...DEFAULT_QUERY, sort: 'title' }), 'asc');
  assert.equal(effectiveDir(DEFAULT_QUERY), 'desc');
});

test('statusCounts counts films on any list', () => {
  assert.equal(statusCounts([{ user: { listed: true } }, { user: { listed: true, watched: true } }, { user: {} }]).listed, 2);
});
