// Plain-English hover text for the diary heatmap (pure, unit-tested).
import { MONTHS_SHORT } from '../../format.js';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const filmsText = n => (n ? `${n} ${n === 1 ? 'film' : 'films'}` : 'no films');

/** "Sat 14 Jun 2025: 2 films" for an ISO day (YYYY-MM-DD). */
export function dayText(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}: ${filmsText(n)}`;
}

/** "June 2025: 14 films" for a 0-based month. */
export function monthText(year, month, n) {
  const name = new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-AU', { month: 'long', timeZone: 'UTC' });
  return `${name} ${year}: ${filmsText(n)}`;
}

/** Total films per month (0-11) from a Map of ISO day -> count. */
export function monthTotals(counts) {
  const out = Array(12).fill(0);
  for (const [iso, n] of counts) out[Number(iso.slice(5, 7)) - 1] += n;
  return out;
}
