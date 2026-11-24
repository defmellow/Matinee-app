import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, problemLines } from '../../ui/screens/settings/format.js';
import { countsText } from '../../ui/screens/welcome/counts.js';

test('countsText reads like a sentence and skips zeros', () => {
  assert.equal(countsText({ watched: 135, watchlist: 545, entries: 110 }), '135 films watched · 545 on your watchlist · 110 diary entries');
  assert.equal(countsText({ watched: 1, watchlist: 0, entries: 1 }), '1 film watched · 1 diary entry');
});

test('ago gives relative times in plain words', () => {
  const now = Date.parse('2026-01-10T12:00:00Z');
  assert.equal(ago(null, now), 'never');
  assert.equal(ago('2026-01-10T11:59:40Z', now), 'just now');
  assert.equal(ago('2026-01-10T10:00:00Z', now), '2 hours ago');
  assert.equal(ago('2026-01-09T11:00:00Z', now), 'yesterday');
});

test('problemLines groups by source with counts', () => {
  const providers = [{ id: 'rottentomatoes', label: 'Rotten Tomatoes' }];
  const lines = problemLines([
    { provider: 'rottentomatoes', key: 'a', message: 'x' }, { provider: 'rottentomatoes', key: 'b', message: 'x' }, { provider: 'rottentomatoes', key: 'c', message: 'x' },
  ], providers);
  assert.deepEqual(lines, [{ id: 'rottentomatoes', text: "Rotten Tomatoes didn't answer for 3 films — they'll be retried next time." }]);
  assert.equal(problemLines([], providers).length, 0);
});
