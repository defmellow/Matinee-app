import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcoming, addMonths } from '../../core/features/upcoming.js';

// Synthetic summaries.
const s = (key, date, { watched = false, watchlist = false, type = 'Theatrical' } = {}) => ({ key, title: key, user: { watched, watchlist }, ...(date ? { ausRelease: { date, type } } : {}) });

test('addMonths clamps to month end', () => {
  assert.equal(addMonths('2026-10-22', 6), '2027-04-22');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
});

test('window, grouping and ordering with an injected today', () => {
  const r = upcoming({ today: '2026-10-22', summaries: [
    s('c', '2026-12-03'), s('a', '2026-10-22'), s('b', '2026-11-12', { watchlist: true }), s('b2', '2026-11-12'),
    s('far', '2027-04-23'), s('edge', '2027-04-22'), s('none', null), s('seen', '2026-11-01', { watched: true }),
  ] });
  assert.deepEqual(r.groups.map(g => g.id), ['2026-10', '2026-11', '2026-12', '2027-04']);
  assert.equal(r.groups[1].label, 'November 2026');
  assert.deepEqual(r.groups.flatMap(g => g.items.map(i => i.film.key)), ['a', 'b', 'b2', 'c', 'edge']);
  assert.equal(r.groups[1].items[0].onWatchlist, true);
  assert.equal(r.groups[1].items[1].onWatchlist, false);
  assert.equal(r.total, 5);
});

test('just opened: the last 21 days, newest first, not in the upcoming groups', () => {
  const r = upcoming({ today: '2026-10-22', summaries: [s('x', '2026-10-01'), s('y', '2026-10-15'), s('old', '2026-09-30'), s('t', '2026-10-22')] });
  assert.deepEqual(r.justOpened.map(i => i.film.key), ['y', 'x']);
  assert.deepEqual(r.groups.flatMap(g => g.items.map(i => i.film.key)), ['t']);
});

test('empty and bad input', () => {
  const r = upcoming({ today: new Date('2026-10-22T05:00:00Z'), summaries: [s('bad', 'soon')] });
  assert.deepEqual(r, { today: '2026-10-22', until: '2027-04-22', groups: [], justOpened: [], total: 0 });
  assert.equal(upcoming().groups.length, 0);
});
