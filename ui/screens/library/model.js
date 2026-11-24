// Library screen model: the saved query shape, how it becomes a core query, and the labels for active filters.
// Pure functions, no UI. The stored query is what usePref('library.query') and saved views keep.
import { parseQueryText } from '../../../core/analysis/query.js';
import { canonicalFeelIds } from '../../../core/analysis/feel/aliases.js';
import { LISTS_ARCHIVED } from '../../archive.js';

export const DEFAULT_QUERY = {
  text: '', status: 'all', sort: null, dir: null,
  genres: [], countries: [], languages: [], tags: [], autoTags: [],
  decade: null, // decade start year, e.g. 1980
  ratingMin: null, ratingMax: null, // your rating, 1–10 half-star scale
  runtimeMax: null, scoreMin: null,
  feel: [], // feel descriptor ids (e.g. "tense"); a film must match every one
};

export const STATUS_OPTIONS = [
  ['all', 'All'], ['watched', 'Watched'], ['watchlist', 'Watchlist'], ...(LISTS_ARCHIVED ? [] : [['listed', 'On my lists']]), ['liked', 'Liked'], ['unrated', 'Unrated'],
];

/** One plain line under the Show control saying what the chosen option means. */
export const STATUS_HELP = {
  all: 'Watched: in your diary or ratings. Watchlist: you plan to watch it and have not yet.',
  watched: 'Watched: films in your Letterboxd diary or ratings.',
  watchlist: 'Watchlist: films you plan to watch and have not watched yet.',
  listed: 'On my lists: films on any list you made or follow, watched or not.',
};
// Hover text for each option (the line above shows for the chosen one).
export const STATUS_TITLES = {
  ...STATUS_HELP,
  all: 'Every film in your library',
  liked: 'Films you have hearted on Letterboxd.',
  unrated: 'Films you have watched but not rated.',
};

export const SORT_OPTIONS = [
  ['recent', 'Recently watched'], ['title', 'Title'], ['year', 'Year'], ['rating', 'Your rating'],
  ['score', 'Matinee score'], ['letterboxd', 'Letterboxd average'], ['runtime', 'Runtime'], ['popularity', 'Popularity'], ['yourTake', 'Your hot takes'],
];

export const sortLabel = (sort, status) => (sort === 'recent' && status === 'watchlist' ? 'Recently added' : (SORT_OPTIONS.find(o => o[0] === sort) || [])[1] || 'Recently watched');

/** Bring an older or partial stored query up to the current shape. */
export const normalise = q => {
  // Only known fields are kept, so an old or odd saved view can't carry stray settings.
  const src = q && typeof q === 'object' ? q : {};
  const out = { ...DEFAULT_QUERY };
  for (const k of Object.keys(DEFAULT_QUERY)) if (src[k] !== undefined) out[k] = src[k];
  out.feel = Array.isArray(out.feel) ? canonicalFeelIds(out.feel.filter(x => typeof x === 'string' && x)) : []; // renamed feelings (wistful → bittersweet) keep working
  if (out.status === 'unwatched') out.status = 'watchlist'; // the old Unwatched option was the same films
  // Older saved views may hold a status that no longer exists (e.g. "watched + watchlisted"): show everything instead.
  if (!STATUS_OPTIONS.some(([v]) => v === out.status)) out.status = 'all';
  return out;
};

/**
 * A Library link's filter as a stored query, or null when the text isn't one. Forms: tag:<name>, auto:<id>, genre:<name>,
 * country:<name>, language:<name>, decade:<1980>, status:<watched|watchlist|listed|liked|unrated>, q:<search text>.
 */
export function queryFromParam(param) {
  const m = /^(tag|auto|genre|country|language|decade|status|q):([\s\S]+)$/.exec(param || '');
  if (!m) return null;
  const [, kind, value] = m;
  const base = { ...normalise(null), status: 'all' };
  switch (kind) {
    case 'tag': return { ...base, tags: [value] };
    case 'auto': return { ...base, autoTags: [value] };
    case 'genre': return { ...base, genres: [value] };
    case 'country': return { ...base, countries: [value] };
    case 'language': return { ...base, languages: [value] };
    case 'decade': { const d = parseInt(value, 10); return Number.isFinite(d) ? { ...base, decade: Math.floor(d / 10) * 10 } : null; }
    case 'status': if (value === 'unwatched') return { ...base, status: 'watchlist' };
      return STATUS_OPTIONS.some(([v]) => v === value) ? { ...base, status: value } : null;
    default: return { ...base, text: value };
  }
}

/** The sort actually in force: the chosen one, else recently watched (recently added on the watchlist). */
export const effectiveSort = q => q.sort || 'recent';

/** Direction in force for a sort: the natural one unless the person flipped it. */
export function effectiveDir(q) {
  if (q.dir === 'asc' || q.dir === 'desc') return q.dir;
  const s = effectiveSort(q);
  if (s === 'title') return 'asc';
  if (s === 'recent' && q.status === 'watchlist') return 'asc';
  return 'desc';
}

const merge = (a, b) => [...new Set([...(a || []), ...(b || [])])];

/** Turn the stored query (plus any operators typed in the search box) into a core `applyQuery` query. */
export function toCoreQuery(q) {
  q = normalise(q);
  const typed = parseQueryText(q.text);
  const out = {
    ...typed,
    status: typed.status || q.status,
    sort: effectiveSort(q),
    genres: merge(q.genres, typed.genres), countries: merge(q.countries, typed.countries), languages: merge(q.languages, typed.languages),
    tags: merge(q.tags, typed.tags), autoTags: q.autoTags,
  };
  if (q.dir) out.dir = q.dir;
  if (q.decade != null && out.yearMin == null && out.yearMax == null) { out.yearMin = q.decade; out.yearMax = q.decade + 9; }
  if (q.ratingMin != null && out.ratingMin == null) out.ratingMin = q.ratingMin;
  if (q.ratingMax != null && out.ratingMax == null) out.ratingMax = q.ratingMax;
  if (q.runtimeMax != null && out.runtimeMax == null) out.runtimeMax = q.runtimeMax;
  if (q.scoreMin != null && out.scoreMin == null) out.scoreMin = q.scoreMin;
  return out;
}

const stars = v => `${v / 2} star${v === 2 ? '' : 's'}`;

/**
 * The filters the bar controls, as removable chips: [{ id, label, patch }] where `patch` is merged into the query to remove it.
 * `autoLabels` maps auto-tag id → label.
 */
export function activeFilters(q, autoLabels = {}, feelLabels = {}) {
  q = normalise(q);
  const out = [];
  for (const g of q.genres) out.push({ id: 'g:' + g, label: g, patch: { genres: q.genres.filter(x => x !== g) } });
  if (q.decade != null) out.push({ id: 'decade', label: `${q.decade}s`, patch: { decade: null } });
  for (const c of q.countries) out.push({ id: 'c:' + c, label: c, patch: { countries: q.countries.filter(x => x !== c) } });
  for (const l of q.languages) out.push({ id: 'l:' + l, label: l, patch: { languages: q.languages.filter(x => x !== l) } });
  for (const t of q.tags) out.push({ id: 't:' + t, label: `Tag: ${t}`, patch: { tags: q.tags.filter(x => x !== t) } });
  for (const a of q.autoTags) out.push({ id: 'a:' + a, label: autoLabels[a] || a.split(':').pop(), patch: { autoTags: q.autoTags.filter(x => x !== a) } });
  for (const f of q.feel) out.push({ id: 'f:' + f, label: `Feels ${feelLabels[f] || f}`, patch: { feel: q.feel.filter(x => x !== f) } });
  if (q.ratingMin != null || q.ratingMax != null) {
    const lo = q.ratingMin, hi = q.ratingMax;
    const label = lo != null && hi != null ? `You rated ${stars(lo).replace(/ stars?$/, '')}–${stars(hi)}` : lo != null ? `You rated ${stars(lo)}+` : `You rated up to ${stars(hi)}`;
    out.push({ id: 'rating', label, patch: { ratingMin: null, ratingMax: null } });
  }
  if (q.runtimeMax != null) out.push({ id: 'runtime', label: `Under ${q.runtimeMax} min`, patch: { runtimeMax: null } });
  if (q.scoreMin != null) out.push({ id: 'score', label: `Matinee score ${q.scoreMin}+`, patch: { scoreMin: null } });
  return out;
}

/** True when the query narrows the library in any way (used for "Clear all" and "Save this view"). */
export const isNarrowed = q => { q = normalise(q); return activeFilters(q).length > 0 || !!q.text.trim() || q.status !== 'all'; };

/** Reset every filter, keeping the sort. */
export const cleared = q => ({ ...DEFAULT_QUERY, sort: normalise(q).sort, dir: normalise(q).dir });

/** Per-status counts for the segmented control. */
export function statusCounts(films) {
  const c = { all: films.length, watched: 0, watchlist: 0, listed: 0, liked: 0, unrated: 0 };
  for (const f of films) {
    const u = f.user || {};
    if (u.watched) { c.watched++; if (u.rating == null) c.unrated++; }
    if (u.watchlist) c.watchlist++;
    if (u.listed) c.listed++;
    if (u.liked) c.liked++;
  }
  return c;
}

/** Empty-state wording for a status that matches nothing: [title, hint]. */
export function emptyForStatus(status) {
  switch (status) {
    case 'watched': return ['Nothing watched matches', 'Watched films come from your Letterboxd diary and ratings. Try Watchlist, or loosen a filter.'];
    case 'watchlist': return ['Nothing on your watchlist matches', 'Add films to your watchlist on Letterboxd, then refresh in Settings. Or loosen a filter.'];
    case 'listed': return ['None of your lists match', 'Follow a Letterboxd list or make your own in Lists, and its films will show up here. Or loosen a filter.'];
    case 'liked': return ['No liked films match', 'Heart a film on Letterboxd and it will show up here.'];
    case 'unrated': return ['No unrated films match', 'Every watched film that fits has a rating. Try All.'];
    default: return null;
  }
}

// ---- Feel filter ----
// A film matches a feel when its profile scores at least this much for it (0..1, same scale as By feel).
// DECISION: 0.15, the level By feel already counts as a real hit; easy to retune.
export const FEEL_MIN = 0.15;

/** Keys of films matching EVERY chosen feel. `perFeel` is one list of search results ({ key, score }) per chosen feel. */
export function feelKeySet(perFeel) {
  if (!perFeel.length) return null;
  let keys = null;
  for (const results of perFeel) {
    const mine = new Set((results || []).filter(r => (r.score || 0) >= FEEL_MIN).map(r => r.key));
    keys = keys ? new Set([...keys].filter(k => mine.has(k))) : mine;
  }
  return keys;
}

/** Keep only films whose key is in `keys` (null means no feel filter). */
export const applyFeel = (list, keys) => (keys ? list.filter(f => keys.has(f.key)) : list);

/** id -> label for the feel chips. */
export const feelLabelMap = facets => Object.fromEntries(((facets && facets.descriptors) || []).map(d => [d.id, d.label]));

export const FEEL_GROUPS = [['mood', 'Mood'], ['tone', 'Tone'], ['pace', 'Pace'], ['craft', 'Look and craft'], ['impact', 'How it lands']];

/** Feel descriptors by group, biggest first; chosen ones stay visible even past the cap. */
export function feelGroups(facets, chosen = [], { cap = 8, expanded = false } = {}) {
  const pick = new Set(chosen);
  const by = {};
  for (const d of (facets && facets.descriptors) || []) (by[d.facet] ||= []).push(d);
  return FEEL_GROUPS.map(([id, title]) => {
    const all = [...(by[id] || [])].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const shown = expanded ? all : all.filter((d, i) => i < cap || pick.has(d.id));
    return { id, title, items: shown, hidden: all.length - shown.length };
  }).filter(g => g.items.length);
}
