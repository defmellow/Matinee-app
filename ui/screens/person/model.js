// Person page model: merge the films in the library with the full filmography, then filter, sort and count. Pure functions.
import { STATUS_OPTIONS } from '../library/model.js';

export const ROLE_ORDER = ['director', 'writer', 'cinematography', 'composer', 'editor', 'producer', 'cast'];
export const ROLE_NAMES = { director: 'Director', writer: 'Writer', cinematography: 'Cinematographer', composer: 'Composer', editor: 'Editor', producer: 'Producer', cast: 'Actor' };

// Same wording as the Library's status control, plus "Not seen" (not watched, in your library or not). Liked and Unrated stay in the Library.
export const STATUS_CHOICES = [
  ...STATUS_OPTIONS.filter(([v]) => v === 'all' || v === 'watched' || v === 'watchlist'),
  ['unseen', 'Not seen'],
];

/** Which status options to show: All always, the rest only when they hold films (Not seen also hidden when it is the same as All). The chosen one always stays. */
export function visibleStatuses(counts, current = 'all') {
  return STATUS_CHOICES.filter(([v]) => v === 'all' || v === current || (counts[v] > 0 && !(v === 'unseen' && counts.unseen === counts.all)));
}

/** A saved status that no longer exists here (Liked, Unrated) falls back to All. */
export const validStatus = s => (STATUS_CHOICES.some(([v]) => v === s) ? s : 'all');

export const SORT_CHOICES = [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['score', 'Matinee score'], ['rating', 'Your rating']];

export const DEFAULT_FILTERS = { status: 'all', role: 'all', sort: 'newest', text: '', decade: null };

/** 'cast:Travis' -> 'cast'; 'Director' -> 'director'. */
export const roleKey = r => String(r || '').split(':')[0].trim().toLowerCase();

const normTitle = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * One list of everything they have made. `libraryFilms` is getPerson's [{ film, roles }]; `remoteFilms` is getPersonFilms' films;
 * `byKey` maps library key -> the library summary (fresher than the one inside getPerson). Items:
 * { id, key, title, year, poster, url, roles: [string], user, score, film } where `film` is a library summary or null.
 */
export function mergeFilms(libraryFilms = [], remoteFilms = [], byKey = new Map()) {
  const items = new Map();
  const add = (id, make, roles) => {
    const cur = items.get(id) || make();
    for (const r of roles) if (r && !cur.roles.includes(r)) cur.roles.push(r);
    items.set(id, cur);
    return cur;
  };
  const fromLibrary = (film, roles) => {
    const f = byKey.get(film.key) || film;
    add('k:' + f.key, () => ({ id: 'k:' + f.key, key: f.key, title: f.title, year: f.year ?? null, poster: null, url: null, roles: [], user: f.user || {}, score: f.score ?? null, film: f }), roles);
  };
  for (const { film, roles } of libraryFilms) fromLibrary(film, roles || []);
  for (const r of remoteFilms) {
    const rroles = r.roles && r.roles.length ? r.roles : [r.role]; // a film credited under several jobs arrives once, with all its roles
    const lib = r.key ? byKey.get(r.key) : null;
    if (lib) { fromLibrary(lib, rroles); continue; }
    if (r.key && items.has('k:' + r.key)) { for (const x of rroles) if (!items.get('k:' + r.key).roles.includes(x)) items.get('k:' + r.key).roles.push(x); continue; }
    const id = r.key ? 'k:' + r.key : 'n:' + (r.slug || normTitle(r.title) + '|' + (r.year ?? ''));
    const cur = add(id, () => ({ id, key: r.key || null, title: r.title, year: r.year ?? null, poster: r.poster || null, url: r.url || null, roles: [], user: null, score: null, film: null }), rroles);
    if (!cur.url && r.url) cur.url = r.url;
    if (!cur.poster && r.poster) cur.poster = r.poster;
  }
  return [...items.values()];
}

export const decadeOf = year => (year ? Math.floor(year / 10) * 10 : null);

const matchesStatus = (i, s) => {
  const u = i.user || {};
  switch (s) {
    case 'watched': return !!u.watched;
    case 'watchlist': return !!u.watchlist && !u.watched;
    case 'unseen': return !u.watched;
    case 'liked': return !!u.liked;
    case 'unrated': return !!u.watched && u.rating == null;
    default: return true;
  }
};
const matchesRole = (i, role) => role === 'all' || i.roles.some(r => roleKey(r) === role);
const matchesText = (i, text) => { const t = normTitle(text); return !t || normTitle(i.title).includes(t); };
const matchesDecade = (i, d) => d == null || decadeOf(i.year) === d;

export function applyFilters(items, f) {
  return items.filter(i => matchesStatus(i, f.status) && matchesRole(i, f.role) && matchesText(i, f.text) && matchesDecade(i, f.decade));
}

const byTitle = (a, b) => a.title.localeCompare(b.title);
// Missing values always sit last, whichever way the sort runs.
const num = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  if (x == null && y == null) return byTitle(a, b);
  if (x == null) return 1;
  if (y == null) return -1;
  return (dir === 'asc' ? x - y : y - x) || byTitle(a, b);
};

export function sortItems(items, sort) {
  const list = [...items];
  switch (sort) {
    case 'oldest': return list.sort(num(i => i.year, 'asc'));
    case 'title': return list.sort(byTitle);
    case 'rating': return list.sort(num(i => i.user && i.user.rating, 'desc'));
    case 'score': return list.sort(num(i => i.score, 'desc'));
    default: return list.sort(num(i => i.year, 'desc'));
  }
}

/**
 * The grid in two groups: `mine` (films in the library, in the chosen sort) and `more` (films outside it, which open on Letterboxd).
 * Outside films have no scores or ratings, so they always sort by year: oldest first only when the user asked for that, else newest first.
 * Under Watched / Watchlist nothing outside can match, so `more` is empty then (applyFilters already drops them).
 */
export function groupItems(shown, sort) {
  const mine = sortItems(shown.filter(i => i.film), sort);
  const more = sortItems(shown.filter(i => !i.film), sort === 'oldest' ? 'oldest' : 'newest');
  return { mine, more };
}

/** Counts for the status control, over the films that pass the other filters (role, search, decade). */
export function statusCounts(items, f) {
  const base = applyFilters(items, { ...f, status: 'all' });
  const c = { all: base.length, watched: 0, watchlist: 0, unseen: 0 };
  for (const k of Object.keys(c)) if (k !== 'all') c[k] = base.filter(i => matchesStatus(i, k)).length;
  return c;
}

/** Roles that exist for this person: [{ value, label, count }], most films first. */
export function roleChoices(items) {
  const counts = {};
  for (const i of items) for (const k of new Set(i.roles.map(roleKey).filter(Boolean))) counts[k] = (counts[k] || 0) + 1;
  const known = ROLE_ORDER.filter(k => counts[k]);
  const other = Object.keys(counts).filter(k => !ROLE_ORDER.includes(k));
  return [...known, ...other].sort((a, b) => counts[b] - counts[a]).map(k => ({ value: k, label: ROLE_NAMES[k] || k.charAt(0).toUpperCase() + k.slice(1), count: counts[k] }));
}

/** The role their page opens on when the link names none: the one TMDB says they are best known for, else the one with most films. */
export function mainRole(items, known = null) {
  const roles = roleChoices(items);
  if (known && roles.some(r => r.value === known)) return known;
  return roles.length ? roles[0].value : null; // roleChoices sorts by count, then ROLE_ORDER
}

/**
 * Which role the page shows: 'all', a role key, or null when there are no films yet.
 * A role named in the link is kept while the full list is still arriving, or when they have films in it; otherwise their main role.
 */
export function resolveRole(requested, items, known = null, pending = false) {
  if (requested === 'all') return 'all';
  if (requested && (pending || roleChoices(items).some(r => r.value === requested))) return requested;
  return mainRole(items, known);
}

/** "as a director": how the header says which role the numbers are for. */
export const ROLE_PHRASE = { director: 'as a director', cast: 'as an actor', writer: 'as a writer', cinematography: 'as a cinematographer', composer: 'as a composer', editor: 'as an editor', producer: 'as a producer' };
export const rolePhrase = role => (role === 'all' || !role ? '' : ROLE_PHRASE[role] || 'in this role');

export function decadeChoices(items) {
  const c = {};
  for (const i of items) { const d = decadeOf(i.year); if (d != null) c[d] = (c[d] || 0) + 1; }
  return Object.keys(c).map(Number).sort((a, b) => b - a).map(d => ({ value: d, label: `${d}s`, count: c[d] }));
}

/** Words for a film's roles on its tile: 'Director, Actor (as Travis)'. */
export function roleLine(roles, roleText) {
  return [...new Set(roles.filter(Boolean).map(r => {
    const k = roleKey(r);
    if (k === 'cast' && r.includes(':')) return roleText('cast:' + r.slice(r.indexOf(':') + 1));
    return ROLE_NAMES[k] || roleText(r);
  }))].join(', ');
}
