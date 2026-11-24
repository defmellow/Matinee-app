import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayText, monthText, monthTotals } from '../../ui/screens/diary/heatmapText.js';

test('dayText reads day, date and count', () => {
  assert.equal(dayText('2025-06-14', 2), 'Sat 14 Jun 2025: 2 films');
  assert.equal(dayText('2025-06-14', 1), 'Sat 14 Jun 2025: 1 film');
  assert.equal(dayText('2025-06-15', 0), 'Sun 15 Jun 2025: no films');
});

test('monthText and monthTotals', () => {
  assert.equal(monthText(2025, 5, 14), 'June 2025: 14 films');
  assert.equal(monthText(2025, 0, 1), 'January 2025: 1 film');
  assert.equal(monthText(2025, 1, 0), 'February 2025: no films');
  const t = monthTotals(new Map([['2025-06-14', 2], ['2025-06-20', 1], ['2025-01-02', 4]]));
  assert.equal(t[5], 3); assert.equal(t[0], 4); assert.equal(t[1], 0);
});
