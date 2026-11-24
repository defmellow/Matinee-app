// Pure helpers for person photos and the person hover card (PersonPop.jsx, Headshot.jsx).
import { placePop } from './posterpop.js';

export const PERSON_POP_W = 292;
export const PERSON_DELAY = 600;   // ms the pointer must rest on a name before the card opens
export const PERSON_WARM_MS = 500; // after a card closes, moving to another name opens at once for this long

const TMDB_IMG = 'https://image.tmdb.org/t/p/';
/** TMDB image URL for a stored profile path ('/abc.jpg') at a width/height size such as 'w185' or 'h632'; null without a path. */
export function photoUrl(path, size = 'w185') {
  return typeof path === 'string' && /^\/[\w.-]+$/.test(path) ? `${TMDB_IMG}${size}${path}` : null;
}

/** "NR", "R" or "" from a name: first letter of the first and last word. */
export function initials(name) {
  const words = String(name || '').replace(/[()"“”]/g, ' ').split(/\s+/).filter(w => /\p{L}/u.test(w));
  if (!words.length) return '';
  const first = [...words[0]].find(c => /\p{L}/u.test(c)) || '';
  const last = words.length > 1 ? [...words[words.length - 1]].find(c => /\p{L}/u.test(c)) || '' : '';
  return (first + last).toLocaleUpperCase('en-AU');
}

/** The person id in a person link's href ('#/person/p:robert-de-niro?role=cast' -> 'p:robert-de-niro'), or null. */
export function personIdOf(href) {
  const m = /^#\/person\/([^?#]+)/.exec(String(href || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** A library film worth showing on the card: it has its own page (key), a title and a poster. */
export const isRich = f => !!(f && f.key && f.title && f.poster && (f.poster.thumb || f.poster.url));

const byRating = (a, b) => (b.user.rating ?? -1) - (a.user.rating ?? -1) || (b.year || 0) - (a.year || 0);
const byYear = (a, b) => (b.year || 0) - (a.year || 0);

/**
 * What the card says about the person's films in the library, from getPerson's films ([{ film: summary }]).
 * Counts cover every library film; `rich` lists the ones with their own page and a poster: watched (your rating high to low, then newest),
 * then watchlist (newest), then anything else in the library (newest).
 */
export function libraryFacts(rows) {
  const films = (rows || []).map(r => r && r.film).filter(Boolean);
  const watched = films.filter(f => f.user?.watched);
  const listed = films.filter(f => f.user?.watchlist && !f.user?.watched);
  const other = films.filter(f => !f.user?.watched && !f.user?.watchlist);
  const rich = [...watched.filter(isRich).sort(byRating), ...listed.filter(isRich).sort(byYear), ...other.filter(isRich).sort(byYear)];
  return { seen: watched.length, onList: listed.length, inLibrary: films.length, rich };
}

/** "You've seen 4 of their films · 2 on your watchlist"; plain words when there is nothing yet. */
export function libraryLine({ seen, onList, inLibrary }) {
  if (!inLibrary) return 'None of their films are in your library yet';
  const parts = [];
  if (seen) parts.push(`You've seen ${seen.toLocaleString('en-AU')} of their films`);
  if (onList) parts.push(`${onList.toLocaleString('en-AU')} on your watchlist`);
  return parts.length ? parts.join(' · ') : "You haven't seen any of their films yet";
}

/** Where the card goes: beside the name (right, else left), top level with the name, clamped on screen. Same rules as the poster card. */
export function placeBeside(rect, size, vp) {
  return placePop(rect, size, vp, { gap: 10, margin: 8 });
}

// DECISION (lead, 10 Nov): the one place hover starts network work. Once the pointer has rested long enough for the card to open, the person's
// full filmography is requested exactly as the person page does (same args), so the page is instant if the user clicks. Once per person per session.
const prefetched = new Set();
export function prefetchPerson(id, send) {
  if (!id || prefetched.has(id)) return false;
  prefetched.add(id);
  try { Promise.resolve(send('getPersonFilms', { id, name: id })).catch(() => {}) /* recorded by api.call */; } catch { /* fire and forget */ }
  return true;
}
