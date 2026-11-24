// Pure helpers for the Lists screens: wording for changes and states, sorting and filtering a list's films.
import { dateText } from '../../components/film.jsx';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Since 2 Nov: 3 added, 1 removed." from a list's history (newest first), or '' when nothing changed. */
export function changeSummary(history) {
  if (!history || !history.length) return '';
  const added = history.reduce((n, h) => n + h.added.length, 0);
  const removed = history.reduce((n, h) => n + h.removed.length, 0);
  if (!added && !removed) return '';
  const since = dateText(history[history.length - 1].at, { day: 'numeric', month: 'short' });
  const bits = [added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(', ');
  return `Since ${since}: ${bits}.`;
}

/** One history entry as a plain sentence. */
export function entryLine(h) {
  const when = dateText(h.at, { day: 'numeric', month: 'short', year: 'numeric' });
  if (h.linked) return h.removed.length ? `${when}: linked to Letterboxd. ${plural(h.removed.length, 'film')} didn't make it onto the Letterboxd list.` : `${when}: linked to Letterboxd.`;
  const bits = [h.added.length && `${h.added.length} added`, h.removed.length && `${h.removed.length} removed`].filter(Boolean).join(', ');
  return `${when}: ${h.back ? 'back on Letterboxd' + (bits ? ', ' + bits : '') : bits}`;
}

/** The notice above a followed list that is not fine, or null. */
export function statusNotice(list) {
  const seen = list.lastSeen ? dateText(list.lastSeen, { day: 'numeric', month: 'short' }) : null;
  switch (list.status) {
    case 'gone': return `This list is no longer on Letterboxd${seen ? ` (last seen ${seen})` : ''}. Showing the last copy.`;
    case 'private': return `This list is private now, so Matinee can't update it${seen ? ` (last seen ${seen})` : ''}. Showing the last copy.`;
    case 'unreadable': return `Matinee couldn't read this list on its last try${seen ? ` (last read ${seen})` : ''}. Showing the last copy.`;
    default: return null;
  }
}

export const STATUS_BADGE = { gone: 'No longer on Letterboxd', private: 'Private', unreadable: "Couldn't read" };

export const SORTS = [['order', 'List order'], ['rating', 'Your rating'], ['year', 'Year']];
export const FILTERS = [['all', 'All'], ['unwatched', 'Not watched yet'], ['watched', 'Watched']];

/** The list's films sorted and filtered. `order` keeps the list's own order; the others fall back to it for ties. */
export function arrange(films, sort = 'order', filter = 'all') {
  let out = films.map((f, i) => ({ f, i }));
  if (filter === 'watched') out = out.filter(x => x.f.user && x.f.user.watched);
  else if (filter === 'unwatched') out = out.filter(x => !(x.f.user && x.f.user.watched));
  const rating = x => (x.f.user && x.f.user.rating != null ? x.f.user.rating : -1);
  if (sort === 'rating') out.sort((a, b) => rating(b) - rating(a) || a.i - b.i);
  else if (sort === 'year') out.sort((a, b) => (b.f.year || 0) - (a.f.year || 0) || a.i - b.i);
  return out.map(x => x.f);
}

/** What the "Add a Letterboxd list" field accepts, for a quick check before asking the core. */
export const looksLikeListLink = s => /(^|\/\/|www\.)boxd\.it\/[A-Za-z0-9]+\/?\s*$|letterboxd\.com\/[^/\s]+\/list\/[^/\s]+/i.test(String(s || '').trim());

export const countText = n => plural(n, 'film', 'films');
