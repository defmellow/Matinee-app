// A member's Letterboxd activity feed: /<user>/activity/ loads its rows from /ajax/activity-pagination/<user>/ as an HTML fragment
// of rows (each with data-activity-id, a sentence like "<name> added <film> to their watchlist" and a <time datetime>).
// Only watchlist additions are picked out; other row types are counted but not used.
// The markup was NOT seen live while writing this (the cloud IP is challenged), so it is read loosely: a row is anything
// with data-activity-id, a watchlist row is one whose sentence says "to their/her/his/your watchlist", the film is the first /film/<slug>/ link.
import { parseHTML } from 'linkedom';
import { splitTitleYear, isChallenge } from './letterboxd.js';

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const WATCHLIST_SENTENCE = /\badded\b.*\bto (?:their|her|his|your|the) watchlist\b/i;

/**
 * @returns {{ ok: boolean, challenge?: boolean, rows: number, newest: string|null, oldest: string|null, items: { id: string, at: string|null, slug: string, title: string, year: number|null }[] }}
 *   items are the watchlist additions in page order (newest first); ok is false for a check page or a page with no activity rows at all.
 */
export function parseActivity(html) {
  const text = String(html || '');
  if (isChallenge(text)) return { ok: false, challenge: true, rows: 0, newest: null, oldest: null, items: [] };
  const d = parseHTML(`<body>${text}</body>`).document;
  const rows = [...d.querySelectorAll('[data-activity-id]')];
  const items = [];
  for (const row of rows) {
    const sentence = clean((row.querySelector('.activity-summary') || row).textContent);
    if (!WATCHLIST_SENTENCE.test(sentence)) continue;
    const link = [...row.querySelectorAll('a[href]')].find(a => /^\/film\/[^/]+\/?$/.test(a.getAttribute('href') || ''));
    const slug = link && /^\/film\/([^/]+)/.exec(link.getAttribute('href'))[1];
    if (!slug) continue;
    const { title, year } = splitTitleYear(clean(link.textContent) || slug);
    items.push({ id: row.getAttribute('data-activity-id'), at: row.querySelector('time[datetime]')?.getAttribute('datetime') || null, slug, title, year });
  }
  const times = rows.map(r => r.querySelector('time[datetime]')?.getAttribute('datetime')).filter(Boolean).sort(); // every row, not just watchlist ones
  return { ok: rows.length > 0, rows: rows.length, newest: times[times.length - 1] || null, oldest: times[0] || null, items };
}
