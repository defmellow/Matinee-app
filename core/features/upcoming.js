// Upcoming: films in the library that open (or just opened) in cinemas in the user's country (Settings → Country). A release calendar:
// for Australia it reads the cinema date stored from the Letterboxd film page (summary.ausRelease = {date, type}), with TMDB's
// date for the country as a fallback (summary.regionRelease = {date, type, region}); for any other country only TMDB's.
// It never uses a film's year to recommend anything. Pure: the caller passes the summaries and today's date.
import { localDay } from '../util/localday.js';

const DAY = 864e5;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** ISO date `months` calendar months on (day clamped to the end of a shorter month). */
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return iso(t.getTime());
}

/** The cinema date Upcoming uses for one film in `region`, or null. */
export function releaseFor(s, region = 'AU') {
  const own = s?.regionRelease && String(s.regionRelease.region || '').toUpperCase() === region ? s.regionRelease : null;
  return (region === 'AU' && s?.ausRelease) || own || null;
}

/**
 * @param {object} o
 * @param {object[]} o.summaries  library summaries (need .key, .title, .user.{watched,watchlist}, .ausRelease)
 * @param {string|Date} o.today   injected "today" (ISO date or Date)
 * @param {string} [o.region='AU']  ISO country code
 * @param {number} [o.months=6]
 * @param {number} [o.justOpenedDays=21]
 * @returns {{today:string, until:string, groups:{id:string,label:string,items:object[]}[], justOpened:object[], total:number}}
 *   items: { film: summary, date, type, onWatchlist }
 */
export function upcoming({ summaries = [], today, region = 'AU', months = 6, justOpenedDays = 21 } = {}) {
  region = String(region || 'AU').toUpperCase();
  const from = today instanceof Date ? localDay(today) : String(today || localDay()).slice(0, 10);
  const until = addMonths(from, months);
  const recentFrom = iso(Date.parse(from + 'T00:00:00Z') - justOpenedDays * DAY);
  const soon = [], recent = [];
  for (const s of summaries) {
    const r = releaseFor(s, region);
    if (!r || !isIso(r.date) || s.user?.watched) continue;
    const item = { film: s, date: r.date, type: r.type || 'Theatrical', onWatchlist: !!s.user?.watchlist };
    if (r.date >= from && r.date <= until) soon.push(item);
    else if (r.date < from && r.date >= recentFrom) recent.push(item);
  }
  // By date; on the same day watchlist films come first, then title.
  const byDate = (a, b) => a.date.localeCompare(b.date) || (b.onWatchlist - a.onWatchlist) || String(a.film.title).localeCompare(String(b.film.title));
  soon.sort(byDate);
  // Most recent first: flip only the date, keep watchlist-first then title for same-day ties.
  recent.sort((a, b) => b.date.localeCompare(a.date) || (b.onWatchlist - a.onWatchlist) || String(a.film.title).localeCompare(String(b.film.title)));
  const groups = [];
  for (const it of soon) {
    const id = it.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.id !== id) groups.push(g = { id, label: `${MONTH_NAMES[Number(id.slice(5)) - 1]} ${id.slice(0, 4)}`, items: [] });
    g.items.push(it);
  }
  return { today: from, until, groups, justOpened: recent, total: soon.length };
}
