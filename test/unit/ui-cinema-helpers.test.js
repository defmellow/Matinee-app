import test from 'node:test';
import assert from 'node:assert/strict';
import { checkedText, dayText, filterGroups, refreshMessage, sessionText, timeText, whenText } from '../../ui/screens/upcoming/cinema.js';

test('session and day text read like the cinema listing', () => {
  assert.equal(timeText('17:30'), '5:30 pm');
  assert.equal(timeText('00:05'), '12:05 am');
  assert.equal(timeText('12:00'), '12:00 pm');
  assert.equal(sessionText({ date: '2026-11-05', time: '17:30' }), 'Thu 5:30 pm');
  assert.equal(dayText('2026-12-16'), 'Wed 16 Dec');
  assert.equal(dayText(null), '');
});

test('whenText uses the next session day, or "From" when there are no sessions', () => {
  assert.equal(whenText({ hasSessions: true, next: '2026-11-05', firstDate: '2026-11-01' }), 'Thu 5 Nov');
  assert.equal(whenText({ hasSessions: false, next: null, firstDate: '2026-12-16' }), 'From 16 Dec');
  assert.equal(whenText({ hasSessions: false, next: null, firstDate: null }), 'Date to come');
});

const groups = [
  { id: 'now', label: 'Showing this week', items: [{ slug: 'a', kind: 'film', film: { key: 'k' } }, { slug: 'b', kind: 'film', film: null }, { slug: 'c', kind: 'event', film: null }] },
  { id: 'later', label: 'Further ahead', items: [{ slug: 'd', kind: 'event', film: null }] },
];

test('filterGroups hides events by default and drops empty groups', () => {
  const g = filterGroups(groups);
  assert.deepEqual(g.map(x => x.items.map(i => i.slug)), [['a', 'b']]);
});

test('filterGroups: library only and events on', () => {
  assert.deepEqual(filterGroups(groups, { libraryOnly: true }).map(x => x.items.map(i => i.slug)), [['a']]);
  assert.deepEqual(filterGroups(groups, { events: true }).map(x => x.items.map(i => i.slug)), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(filterGroups(null), []);
});

test('checkedText', () => {
  const at = (h, m = 0) => new Date(2026, 9, 29, h, m).getTime();
  assert.equal(checkedText(at(7), at(9)), 'As at this morning');
  assert.equal(checkedText(at(8), at(15)), 'Updated 7 hours ago');
  assert.equal(checkedText(at(14, 50), at(15)), 'Updated 10 minutes ago');
  assert.equal(checkedText(at(15) - 30000, at(15)), 'Updated just now');
  assert.equal(checkedText(new Date(2026, 9, 27, 9).toISOString(), at(15)), 'Updated 2 days ago');
  assert.equal(checkedText(null), '');
});

test('refreshMessage is plain and never leaks the raw error', () => {
  assert.equal(refreshMessage({ ok: true, partial: false }), null);
  assert.match(refreshMessage({ ok: false, error: 'HTTP 503 at https://x' }), /couldn't reach Dendy Newtown/);
  assert.doesNotMatch(refreshMessage({ ok: false, error: 'HTTP 503' }), /503/);
  assert.match(refreshMessage({ ok: true, partial: true }), /part of the Dendy list/);
});
