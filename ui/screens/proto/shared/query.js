// PROTOTYPE: the one query behind the merged Library. The Library's saved query plus the feel parts that used to live in By feel.
// Pure functions, no UI.
import { normalise as libNormalise, DEFAULT_QUERY as LIB_DEFAULT, activeFilters as libActive, queryFromParam, toCoreQuery, effectiveDir } from '../../library/model.js';
import { parseParam } from '../../feel/model.js';
import { canonicalFeelId, canonicalFeelIds } from '../../../../core/analysis/feel/aliases.js';

export const FEEL_DEFAULT = {
  // feel descriptors (Mood, Tone, Pace, Craft, Emotional impact, theme descriptors). The Library's old `feel` field, same ids.
  feel: [],
  themes: [], // theme ids: Matinee themes, subjects, kinds, places (set:), Letterboxd groups (lb:)
  avoid: [], // ids to leave out (either kind)
  feelText: '', // a typed feeling, e.g. "quietly sad"
  like: null, // a film key: films that feel like this one
  likeEmphasis: 'overall', // By feel's EMPHASIS values
  likeShift: null, // { axis, dir } "like this one, but…"
};
// Filters the merged Library adds to the old Library's query (the new Library's Length range, 23 Nov).
export const EXTRA_DEFAULT = { runtimeMin: null }; // shortest runtime in minutes (runtimeMax is the old Library's)
export const DEFAULT = { ...LIB_DEFAULT, ...FEEL_DEFAULT, ...EXTRA_DEFAULT };

const ids = x => (Array.isArray(x) ? [...new Set(x.filter(v => typeof v === 'string' && v))] : []);

/** Sorts the Library no longer offers (Your hot takes). */
export const DROPPED_SORTS = new Set(['yourTake']);

export function normalise(q) {
  const src = q && typeof q === 'object' ? q : {};
  const out = { ...FEEL_DEFAULT, ...libNormalise(src) };
  if (DROPPED_SORTS.has(out.sort)) out.sort = null; // no longer Library sorts (23 Nov): an old saved view or link falls back to the default
  out.runtimeMin = Number.isFinite(src.runtimeMin) && src.runtimeMin > 0 ? Math.round(src.runtimeMin) : null;
  out.themes = ids(src.themes);
  out.avoid = canonicalFeelIds(ids(src.avoid)); // renamed feelings keep working, as in the Library
  out.feelText = typeof src.feelText === 'string' ? src.feelText : '';
  out.like = typeof src.like === 'string' && src.like ? src.like : null;
  out.likeEmphasis = ['overall', 'themes', 'craft', 'people'].includes(src.likeEmphasis) ? src.likeEmphasis : 'overall';
  out.likeShift = src.likeShift && src.like && typeof src.likeShift.axis === 'string' ? { axis: src.likeShift.axis, dir: src.likeShift.dir < 0 ? -1 : 1 } : null;
  // an id can't be both wanted and left out: leave-out wins (it was the later click)
  const out2 = new Set(out.avoid);
  out.feel = out.feel.filter(id => !out2.has(id));
  out.themes = out.themes.filter(id => !out2.has(id));
  return out;
}

/** True when anything asks "how does it feel": then results are ranked and badged. */
export const hasFeel = q => !!(q.feel.length || q.themes.length || q.avoid.length || q.feelText.trim() || q.like);
/** Only leave-outs: they narrow but don't rank, so no badges. */
export const ranks = q => !!(q.feel.length || q.themes.length || q.feelText.trim() || q.like);

/** The sort in force. Best match is the default whenever something ranks; else the Library's own default. */
export const sortOf = q => (q.sort === 'match' && !ranks(q) ? 'recent' : q.sort || (ranks(q) ? 'match' : 'recent'));
export const dirOf = q => (sortOf(q) === 'match' ? 'desc' : effectiveDir({ ...q, sort: sortOf(q) }));

/** The Library's core query (the sort 'match' is ours: core gets a neutral sort and we reorder). */
export function coreQuery(q) {
  const s = sortOf(q);
  const out = toCoreQuery({ ...q, sort: s === 'match' ? 'recent' : s });
  if (q.runtimeMin != null && out.runtimeMin == null) out.runtimeMin = q.runtimeMin; // the old Library's normalise drops it
  return out;
}

/** By feel's filter shape, for its chip helpers (cycleChip, chipState, pickTag). */
export const asFilters = q => ({ text: q.feelText, descriptors: q.feel, themes: q.themes, avoid: q.avoid });
export const fromFilters = (q, f) => ({ ...q, feelText: f.text, feel: f.descriptors, themes: f.themes, avoid: f.avoid });

/** Include an id (kind 'descriptors' | 'themes'), taking it out of leave-out. */
export function include(q, kind, id) {
  const field = kind === 'descriptors' ? 'feel' : 'themes';
  return { ...q, [field]: q[field].includes(id) ? q[field] : [...q[field], id], avoid: q.avoid.filter(x => x !== id) };
}
export function leaveOut(q, id) {
  return { ...q, feel: q.feel.filter(x => x !== id), themes: q.themes.filter(x => x !== id), avoid: q.avoid.includes(id) ? q.avoid : [...q.avoid, id] };
}
export function drop(q, id) {
  return { ...q, feel: q.feel.filter(x => x !== id), themes: q.themes.filter(x => x !== id), avoid: q.avoid.filter(x => x !== id) };
}
export const stateOf = (q, id) => (q.feel.includes(id) || q.themes.includes(id) ? 'in' : q.avoid.includes(id) ? 'out' : 'off');
/** Plain click on a chip: off → in, in → off. Leave-out is its own action. */
export const toggle = (q, kind, id) => (stateOf(q, id) === 'in' ? drop(q, id) : include(q, kind, id));

export const likeFilm = (q, key) => ({ ...q, like: key, likeShift: null });
export const clearFeel = q => ({ ...q, ...FEEL_DEFAULT });
/** Reset everything except sort/dir (the Library's Clear all), and drop a Best match sort with it. */
export const clearAll = q => ({ ...DEFAULT, sort: q.sort === 'match' ? null : q.sort, dir: q.sort === 'match' ? null : q.dir });

/**
 * Active pills, feel first: [{ id, label, kind: 'feel'|'theme'|'avoid'|'text'|'like'|'lib', patch(q) }].
 * `labels` maps feel id → label; `films` maps key → film (for the like pill).
 */
export function activePills(q, { labels = new Map(), autoLabels = {}, filmTitle = () => null } = {}) {
  const out = [];
  const lab = id => labels.get(id) || id.replace(/^(lb|set):/, '');
  if (q.like) out.push({ id: 'like', kind: 'like', label: `Feels like ${filmTitle(q.like) || 'a film'}`, patch: x => ({ ...x, like: null, likeShift: null }) });
  if (q.feelText.trim()) out.push({ id: 'text', kind: 'text', label: `“${q.feelText.trim()}”`, patch: x => ({ ...x, feelText: '' }) });
  for (const id of q.feel) out.push({ id, kind: 'feel', label: lab(id), patch: x => drop(x, id) });
  for (const id of q.themes) out.push({ id, kind: 'theme', label: lab(id), patch: x => drop(x, id) });
  for (const id of q.avoid) out.push({ id, kind: 'avoid', label: lab(id), patch: x => drop(x, id) });
  for (const c of libActive({ ...q, feel: [] }, autoLabels)) out.push({ id: c.id, kind: 'lib', label: c.label, patch: x => ({ ...x, ...c.patch }) });
  if (q.runtimeMin != null) out.push({ id: 'runtimeMin', kind: 'lib', label: `At least ${q.runtimeMin} min`, patch: x => ({ ...x, runtimeMin: null }) });
  return out;
}

/** Anything narrowing or ranking (for Clear all and Save view). */
export const narrowed = q => hasFeel(q) || !!q.text.trim() || q.status !== 'all' || q.runtimeMin != null || activePills({ ...q, ...FEEL_DEFAULT }).length > 0;

/**
 * A link into the merged Library, or null. Takes the Library's link forms (tag:, genre:, status:, q: …) and By feel's
 * (d:, t:, lb:, set:, film:, q: as feelText via feel:q:, and bare ids such as film-page Subjects chips).
 * The By feel forms arrive as `feel:<their param>`, so `#/feel/d:eerie` becomes `#/library/feel:d:eerie`.
 */
export function fromParam(param) {
  const p = String(param || '');
  if (p.startsWith('feel:')) {
    const rest = p.slice(5);
    const base = { ...DEFAULT };
    if (!rest) return base;
    const f = parseParam(rest);
    if (f.mode === 'film') return f.key ? { ...base, like: f.key } : base;
    const known = f.filters.descriptors.length || f.filters.themes.length || f.filters.text;
    if (known) return { ...base, feel: f.filters.descriptors, themes: f.filters.themes, feelText: f.filters.text };
    return { ...base, themes: [canonicalFeelId(rest)] }; // a bare id (Subjects chips, Insights rows)
  }
  const lib = queryFromParam(p);
  return lib ? { ...DEFAULT, ...lib } : null;
}

/** A bare id from an old link may be a feeling, not a theme: once the facet list is known, put each id where it belongs. */
export function resolveKinds(q, facets) {
  if (!facets || !q.themes.length) return q;
  const desc = new Set((facets.descriptors || []).map(d => d.id));
  const move = q.themes.filter(id => desc.has(id));
  return move.length ? { ...q, themes: q.themes.filter(id => !desc.has(id)), feel: [...new Set([...q.feel, ...move])] } : q;
}
