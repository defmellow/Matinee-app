import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, emptyForStatus, STATUS_OPTIONS } from '../../ui/screens/library/model.js';
import { statusOf } from '../../ui/components/status.js';

test('old saved views with a removed status read as "all"', () => {
  for (const s of ['both', 'watched+watchlist', 'watchedWatchlisted', 'nonsense', undefined]) assert.equal(normalise({ status: s }).status, 'all');
  assert.equal(normalise(null).status, 'all');
});
test('current statuses are kept, other fields untouched', () => {
  for (const [v] of STATUS_OPTIONS) assert.equal(normalise({ status: v }).status, v);
  assert.deepEqual(normalise({ status: 'both', genres: ['Drama'] }).genres, ['Drama']);
});
test('statusOf: watched wins, else watchlist, else null', () => {
  assert.equal(statusOf({ watched: true, watchlist: true }), 'watched');
  assert.equal(statusOf({ watchlist: true }), 'watchlist');
  assert.equal(statusOf({}), null);
  assert.equal(statusOf(undefined), null);
});
test('status empty states offer a next step', () => {
  assert.ok(emptyForStatus('watchlist')[1].length > 0);
  assert.equal(emptyForStatus('all'), null);
});
