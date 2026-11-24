// Pure helpers for the "At Dendy Newtown" section of Upcoming. Dates and times from Dendy are Sydney wall-clock text,
// so they are formatted as written (no time-zone conversion).
import { MONTHS_SHORT } from '../../format.js';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null; };
const weekday = p => DAYS[new Date(Date.UTC(p.y, p.mo, p.d)).getUTCDay()];

/** '2026-11-05' -> 'Thu 5 Nov'. */
export function dayText(iso) {
  const p = parts(iso);
  return p ? `${weekday(p)} ${p.d} ${MONTHS_SHORT[p.mo]}` : '';
}

/** '17:30' -> '5:30 pm'. */
export function timeText(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

/** { date:'2026-11-05', time:'17:30' } -> 'Thu 5:30 pm'. */
export function sessionText(s) {
  const p = parts(s && s.date);
  const t = timeText(s && s.time);
  return p ? `${weekday(p)} ${t}`.trim() : t;
}

/** The date line for an item: the next session day, or 'From 16 Dec' when Dendy has no session times yet. */
export function whenText(item) {
  if (item.hasSessions && item.next) return dayText(item.next);
  const p = parts(item.firstDate || item.next);
  return p ? `From ${p.d} ${MONTHS_SHORT[p.mo]}` : 'Date to come';
}

/** Apply the two filters; empty groups disappear. opts: { libraryOnly, events }. */
export function filterGroups(groups, { libraryOnly = false, events = false } = {}) {
  return (groups || [])
    .map(g => ({ ...g, items: g.items.filter(it => (events || it.kind !== 'event') && (!libraryOnly || it.film)) }))
    .filter(g => g.items.length);
}

/** 'As at this morning' for a read from earlier today before noon, otherwise 'Updated 3 hours ago'. */
export function checkedText(fetchedAt, now = Date.now()) {
  const t = typeof fetchedAt === 'number' ? fetchedAt : Date.parse(fetchedAt || '');
  if (!t) return '';
  const d = new Date(t), n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay && d.getHours() < 12 && n.getHours() < 12) return 'As at this morning';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'Updated just now';
  const rtf = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });
  if (s < 3600) return `Updated ${rtf.format(-Math.floor(s / 60), 'minute')}`;
  if (sameDay || s < 86400) return `Updated ${rtf.format(-Math.floor(s / 3600), 'hour')}`;
  return `Updated ${rtf.format(-Math.floor(s / 86400), 'day')}`;
}

/** Plain-words result of a Check again press. */
export function refreshMessage(r) {
  if (!r || r.ok === false) return "Matinee couldn't reach Dendy Newtown just now. Try again in a little while.";
  if (r.partial) return 'Matinee only got part of the Dendy list. Try again in a little while for the rest.';
  return null;
}
