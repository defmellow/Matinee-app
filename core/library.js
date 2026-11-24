// Identity and user-data helpers shared by import, refresh and the API.
import { emptyFilm, filmKey, normTitle, titleYearKey } from './model.js';

/**
 * Find the stored film matching any of the given identifiers, or create it.
 * Matching order: Letterboxd short id → Letterboxd slug → normalised title + year (± 0).
 * When a match is found through a weaker identifier, the stronger ones are recorded on it.
 * @returns {object} the film record in store.films
 */
export function resolveFilm(store, { lid = null, slug = null, title, year = null }) {
  const films = store.films;
  let film = null;
  if (lid) film = films[`lid:${lid}`] || Object.values(films).find(f => f.lid === lid) || null;
  if (!film && slug) film = films[`slug:${slug}`] || Object.values(films).find(f => f.slug === slug || f.ids?.letterboxd === slug) || null;
  // Title + year is a last resort: never on an empty (non-Latin) title, and never onto a film that
  // already has a different Letterboxd id or slug of its own.
  if (!film && title && normTitle(title)) {
    const k = titleYearKey(title, year);
    const other = f => (lid && f.lid && f.lid !== lid) || (slug && (f.slug || f.ids?.letterboxd) && (f.slug || f.ids?.letterboxd) !== slug);
    film = Object.values(films).find(f => titleYearKey(f.title, f.year) === k && !other(f)) || null;
  }
  if (!film) {
    film = emptyFilm({ lid, slug, title, year });
    films[film.key] = film;
    store.touch('films');
    return film;
  }
  let changed = false;
  if (lid && !film.lid) { film.lid = lid; changed = true; }
  if (slug && !film.slug) { film.slug = slug; changed = true; }
  // Upgrade weak keys (slug:/ty:) to lid: once the export tells us the short id.
  const best = filmKey(film);
  if (best !== film.key) rekey(store, film.key, best);
  if (changed) store.touch('films');
  return film;
}

/** Move a film (and everything that points at it) to a new key. */
export function rekey(store, from, to) {
  if (from === to || !store.films[from]) return;
  const film = store.films[from];
  delete store.films[from];
  if (store.films[to]) {
    // Merge into an existing record: keep the richer source data.
    const target = store.films[to];
    target.src = { ...film.src, ...target.src };
    target.ids = { ...film.ids, ...target.ids };
    target.checked = { ...film.checked, ...target.checked };
  } else {
    film.key = to;
    store.films[to] = film;
  }
  const lib = store.library;
  if (lib.films[from]) {
    const a = lib.films[from], b = lib.films[to];
    lib.films[to] = b ? mergeUserFilm(b, a) : a;
    delete lib.films[from];
  }
  for (const e of Object.values(lib.entries)) if (e.key === from) e.key = to;
  // Lists point at films by key too: their order, notes and change history follow the film.
  const swap = k => (k === from ? to : k);
  for (const l of Object.values(lib.lists || {})) {
    if (Array.isArray(l.films) && l.films.includes(from)) l.films = [...new Set(l.films.map(swap))];
    if (l.notes && from in l.notes) { if (!(to in l.notes)) l.notes[to] = l.notes[from]; delete l.notes[from]; }
    for (const h of l.history || []) { h.added = (h.added || []).map(swap); h.removed = (h.removed || []).map(swap); }
  }
  store.touch('films'); store.touch('library');
}

function mergeUserFilm(a, b) {
  return {
    ...b, ...a,
    watched: a.watched || b.watched, liked: a.liked || b.liked, watchlist: a.watchlist || b.watchlist,
    rating: a.rating ?? b.rating, tags: [...new Set([...(a.tags || []), ...(b.tags || [])])],
  };
}

/** The user's data about a film (created on first touch). */
export function userFilm(store, key) {
  const lib = store.library;
  return lib.films[key] || (lib.films[key] = { watched: false, rating: null, liked: false, watchlist: false, tags: [] });
}

/** Diary entries for one film, newest first. */
export function entriesFor(store, key) {
  return Object.values(store.library.entries).filter(e => e.key === key).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------- taking films off the watchlist (in Matinee only; Letterboxd is never changed) ----------
// The user's tags, notes and `mine` stay on the film; only the flag changes. u.watchlistVia says how a film got on ('export' | 'activity' | 'page');
// u.watchlistActivityId / watchlistActivityAt remember the activity row for 'activity' films so a later read can see the row is gone.
const ms = t => { const n = Date.parse(t); return Number.isFinite(n) ? n : null; };
/** True when `t` is strictly later than `than` (either may be missing: then false). */
export const isAfter = (t, than) => { const a = ms(t), b = ms(than); return a != null && b != null && a > b; };

/** @param {'manual'|'activity'} via @returns {boolean} false when the film wasn't on the watchlist */
export function removeFromWatchlist(store, key, { via = 'manual', now } = {}) {
  const u = store.library.films[key];
  if (!u || !u.watchlist) return false;
  u.watchlist = false;
  u.watchlistRemovedAt = new Date(now ?? Date.now()).toISOString();
  u.watchlistRemovedVia = via;
  store.touch('library');
  return true;
}

/** Undo a removal. Only a film that was removed (and isn't watched now) goes back. */
export function restoreToWatchlist(store, key) {
  const u = store.library.films[key];
  if (!u || u.watchlist || !u.watchlistRemovedAt) return false;
  u.watchlist = true;
  delete u.watchlistRemovedAt; delete u.watchlistRemovedVia;
  store.touch('library');
  return true;
}

/** After an export import: the export is the truth, so every film on the watchlist now is there "via export" and no old removal or activity row applies. */
export function resetWatchlistTracking(store) {
  for (const u of Object.values(store.library.films)) {
    if (u.watchlist) {
      u.watchlistVia = 'export';
      delete u.watchlistActivityId; delete u.watchlistActivityAt; delete u.watchlistRemovedAt; delete u.watchlistRemovedVia;
    }
  }
}

export const REIMPORT_AFTER_DAYS = 30;
export const REIMPORT_SNOOZE_DAYS = 90;
const DAY = 86400000;
/**
 * The monthly re-import reminder. due = there is a user, an import older than 30 days, and it isn't snoozed or switched off.
 * @returns {{ due: boolean, off: boolean, snoozeUntil: string|null, days: number|null }}
 */
export function reimportReminder(library, now = Date.now()) {
  const r = library.settings?.reimportReminder || {};
  const last = ms(library.sync?.lastImport);
  const days = last == null ? null : Math.floor((now - last) / DAY);
  const snoozed = ms(r.snoozeUntil) != null && ms(r.snoozeUntil) > now;
  const due = !!library.user?.username && days != null && days > REIMPORT_AFTER_DAYS && !r.off && !snoozed;
  return { due, off: !!r.off, snoozeUntil: r.snoozeUntil || null, days };
}
