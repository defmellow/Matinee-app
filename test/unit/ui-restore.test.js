// Session-restored state, closeness tiers and the Library's status options (pure parts only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierFor, matchTitle } from '../../ui/screens/feel/model.js';
import { toCoreQuery, normalise, statusCounts, effectiveSort, STATUS_OPTIONS } from '../../ui/screens/library/model.js';

test('tierFor bands are relative to the best result', () => {
  assert.equal(tierFor(0.9, 0.9).label, 'Very close');
  assert.equal(tierFor(0.6, 0.9).label, 'Close');
  assert.equal(tierFor(0.2, 0.9).label, 'Some overlap');
  assert.equal(tierFor(0, 0).label, 'Some overlap');
});

test('matchTitle carries the number and reasons, tier label leads', () => {
  const t = matchTitle({ score: 0.724, reasons: [{ text: 'both wistful' }, { text: 'same director' }] }, { label: 'Close' });
  assert.equal(t, 'Close feel match\nFeel match 72 out of 100\nWhy: both wistful; same director');
  assert.equal(matchTitle({ score: 0.1 }, { label: 'Some overlap' }), 'Some overlap feel match\nFeel match 10 out of 100');
});

test('Library has no Unwatched option (it was the watchlist) and no watched-and-watchlisted one', () => {
  const values = STATUS_OPTIONS.map(o => o[0]);
  assert.ok(!values.includes('unwatched'));
  assert.ok(!values.some(v => /both|and/.test(v)));
});

test('an old saved Unwatched view becomes the watchlist', () => {
  assert.equal(normalise({ status: 'unwatched' }).status, 'watchlist');
  assert.equal(toCoreQuery({ status: 'unwatched' }).status, 'watchlist');
  assert.equal(statusCounts([{ key: 'a' }]).unwatched, undefined);
  assert.equal(effectiveSort({ status: 'watchlist' }), 'recent');
});
