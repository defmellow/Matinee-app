// The Library (rebuilt 23 Nov from the approved wireframe): pure helpers for the screen. No UI here.
// Groups for the Feelings and filters panel, the film filters as chips, labels for the top-bar buttons, the pills row,
// and the words for an empty result.
import { lbPillLabel } from '../../../core/analysis/feel/lbthemes.js';
import { activeFilters, STATUS_OPTIONS } from '../library/model.js';
import { stateOf } from '../proto/shared/query.js';

// ---------- status tabs ----------
const TAB_LABEL = { all: 'All your films', watched: 'Watched', watchlist: 'Watchlist', listed: 'On my lists', liked: 'Liked', unrated: 'Not rated' };
/** [[value, label]] in the Library's order (Lists stays out while it is archived: STATUS_OPTIONS already knows). */
export const STATUS_TABS = STATUS_OPTIONS.map(([v]) => [v, TAB_LABEL[v] || v]);
const WHERE = { all: 'in your films', watched: "in the films you've watched", watchlist: 'on your watchlist', listed: 'on your lists', liked: 'in the films you liked', unrated: 'in your unrated films' };

// ---------- panel groups ----------
export const TAB_FEEL = 'feel', TAB_ABOUT = 'about', TAB_FILM = 'film';
export const TABS = [[TAB_FEEL, 'Feelings'], [TAB_ABOUT, "What it's about"], [TAB_FILM, 'The film']];
const FEEL_IDS = ['mood', 'tone', 'pace', 'craft', 'impact'];

/**
 * The feel-side groups for the panel from the library-wide facet sections (`facetSections`): Feelings (Mood, Tone, Pace,
 * Craft, Emotional impact) and What it's about (Themes, Letterboxd themes, Kind of film, Subjects, Set in: places, Set in:
 * times). Letterboxd's theme groups and the times a film is set in get their own groups so the big lists stay apart.
 * Each group: { id, label, tab, kind: 'feel', items: [{ id, label, count, kind }] }.
 */
export function feelGroups(sections, facets = null) {
  const eras = new Set(((facets && facets.settings) || []).filter(x => x.kind === 'era').map(x => x.id)); // facetSections drops the place/era kind
  const by = id => (sections || []).find(s => s.id === id);
  const out = [];
  for (const id of FEEL_IDS) { const s = by(id); if (s && s.items.length) out.push({ id, label: s.label, tab: TAB_FEEL, kind: 'feel', items: s.items }); }
  const theme = by('theme');
  if (theme) {
    const own = theme.items.filter(it => !String(it.id).startsWith('lb:'));
    const lb = theme.items.filter(it => String(it.id).startsWith('lb:'));
    if (own.length) out.push({ id: 'theme', label: 'Themes', tab: TAB_ABOUT, kind: 'feel', items: own });
    if (lb.length) out.push({ id: 'lb', label: 'Letterboxd themes', tab: TAB_ABOUT, kind: 'feel', items: lb });
  }
  const kinds = by('kinds'), subjects = by('subjects'), settings = by('settings');
  if (kinds && kinds.items.length) out.push({ id: 'kinds', label: 'Kind of film', tab: TAB_ABOUT, kind: 'feel', items: kinds.items });
  if (subjects && subjects.items.length) out.push({ id: 'subjects', label: 'Subjects', tab: TAB_ABOUT, kind: 'feel', items: subjects.items });
  if (settings && settings.items.length) {
    const times = settings.items.filter(it => eras.has(it.id)), places = settings.items.filter(it => !eras.has(it.id));
    if (places.length) out.push({ id: 'places', label: 'Set in: places', tab: TAB_ABOUT, kind: 'feel', items: places });
    if (times.length) out.push({ id: 'times', label: 'Set in: times', tab: TAB_ABOUT, kind: 'feel', items: times });
  }
  return out;
}

const AUTO = [['award', 'Awards'], ['source', 'Based on'], ['series', 'Series']];
/**
 * The Library's own filters as chip groups for The film tab, library-wide counts: Your tags, Genres, Decades, Countries,
 * Languages, Awards, Based on, Series. (Length lives on the top bar.) Items: { id, label, count, field, value }.
 */
export function filmGroups(lib) {
  if (!lib) return [];
  const f = lib.facets || {};
  const g = (id, label, items) => ({ id, label, tab: TAB_FILM, kind: 'film', items });
  const out = [
    // Your tags first
    g('tags', 'Your tags', (lib.tags || []).filter(t => t.count > 0).map(x => ({ id: 't:' + x.name, label: x.name, count: x.count, field: 'tags', value: x.name }))),
    g('genres', 'Genres', (f.genres || []).map(x => ({ id: 'g:' + x.name, label: x.name, count: x.count, field: 'genres', value: x.name }))),
    g('decades', 'Decades', [...(f.decades || [])].sort((a, b) => b.count - a.count || b.yearMin - a.yearMin).map(x => ({ id: 'd:' + x.yearMin, label: x.name, count: x.count, field: 'decade', value: x.yearMin }))),
    g('countries', 'Countries', (f.countries || []).map(x => ({ id: 'c:' + x.name, label: x.name, count: x.count, field: 'countries', value: x.name }))),
    g('languages', 'Languages', (f.languages || []).map(x => ({ id: 'l:' + x.name, label: x.name, count: x.count, field: 'languages', value: x.name }))),
    ...AUTO.map(([grp, label]) => g(grp, label, (lib.autoTags || []).filter(t => t.group === grp).sort((a, b) => b.count - a.count)
      .map(x => ({ id: 'a:' + x.id, label: x.label, count: x.count, field: 'autoTags', value: x.id })))),
  ];
  return out.filter(x => x.items.length);
}

/** Is a film-tab chip on? */
export function filmOn(q, item) {
  if (item.field === 'decade') return q.decade === item.value;
  return (q[item.field] || []).includes(item.value);
}
/** Flip a film-tab chip. */
export function filmToggle(q, item) {
  if (item.field === 'decade') return { ...q, decade: q.decade === item.value ? null : item.value };
  const list = q[item.field] || [];
  return { ...q, [item.field]: list.includes(item.value) ? list.filter(x => x !== item.value) : [...list, item.value] };
}

/** How many things are picked in each panel tab, and in all three (the button's count). */
export function pickedCounts(q, groups) {
  const where = new Map();
  for (const g of groups) if (g.kind === 'feel') for (const it of g.items) if (!where.has(it.id)) where.set(it.id, g.tab);
  const c = { [TAB_FEEL]: 0, [TAB_ABOUT]: 0, [TAB_FILM]: 0 };
  for (const id of [...q.feel, ...q.themes, ...q.avoid]) c[where.get(id) || (q.feel.includes(id) ? TAB_FEEL : TAB_ABOUT)]++;
  if (q.feelText.trim()) c[TAB_FEEL]++;
  c[TAB_FILM] = q.genres.length + q.countries.length + q.languages.length + q.tags.length + (q.decade != null ? 1 : 0)
    + q.autoTags.filter(id => !id.startsWith('length:')).length;
  return { ...c, total: c[TAB_FEEL] + c[TAB_ABOUT] + c[TAB_FILM] };
}

const STOP = new Set(['and', 'but', 'the', 'not', 'with', 'very', 'bit', 'that', 'feel', 'feels', 'like', 'about', 'films', 'film', 'kind']);
// "lonely" finds Loneliness, "warmth" finds Warm: a word is matched by its stem (common endings off, at least four letters left)
const stem = w => { const s = w.replace(/(iness|ness|ly|ing|ed|es|s|y)$/, ''); return s.length >= 4 ? s : w; };

/** What the find box in the panel finds: items whose name holds the words, or that core's word matching reads in them. */
export function findIn(groups, text, lexIds = new Set(), perTab = 40) {
  const t = String(text || '').trim().toLowerCase();
  if (t.length < 2) return null;
  const words = /\s/.test(t) ? t.split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)).map(stem) : [];
  const out = [];
  for (const [tab, label] of TABS) {
    const hits = [];
    for (const g of groups) {
      if (g.tab !== tab) continue;
      for (const it of g.items) {
        const l = it.label.toLowerCase();
        const lw = l.split(/[\s,–-]+/);
        const rank = l.startsWith(t) ? 0 : lw.some(w => w.startsWith(t)) ? 1 : l.includes(t) ? 2 : lexIds.has(it.id) ? 3
          : words.length && lw.some(w => words.some(x => w.startsWith(x))) ? 4 : -1;
        if (rank >= 0) hits.push({ item: it, group: g, rank });
      }
    }
    hits.sort((a, b) => a.rank - b.rank || (b.item.count || 0) - (a.item.count || 0) || a.item.label.localeCompare(b.item.label));
    const seen = new Set();
    const uniq = hits.filter(h => (seen.has(h.item.id) ? false : (seen.add(h.item.id), true)));
    if (uniq.length) out.push({ tab, label, hits: uniq.slice(0, perTab), more: Math.max(0, uniq.length - perTab) });
  }
  return out;
}

// ---------- top bar labels ----------
export const halfStars = v => `${Math.floor(v / 2)}${v % 2 ? '½' : ''}`;
/** The Your rating button's value: Any, 4★ and up, Up to 2½★, 3–4½★, 4★. */
export function ratingValue(q) {
  const lo = q.ratingMin, hi = q.ratingMax;
  if (lo == null && hi == null) return 'Any';
  if (lo != null && hi != null) return lo === hi ? `${halfStars(lo)}★` : `${halfStars(lo)}–${halfStars(hi)}★`;
  return lo != null ? `${halfStars(lo)}★ and up` : `Up to ${halfStars(hi)}★`;
}

export const minutes = m => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`; };
/** One-click lengths in the Length popover (the old Length tags moved here): a range each. */
export const LENGTH_PICKS = [
  { id: 'short', label: 'Short films', min: null, max: 39 },
  { id: 'u90', label: 'Under 90 min', min: null, max: 89 },
  { id: 'u120', label: 'Under 2 hours', min: null, max: 119 },
  { id: 'long', label: '2½ hours or more', min: 150, max: null },
];
/** The Length button's value. */
export function lengthValue(q) {
  const lo = q.runtimeMin, hi = q.runtimeMax;
  if (lo == null && hi == null) return 'Any';
  const pick = LENGTH_PICKS.find(p => p.min === lo && p.max === hi);
  if (pick) return pick.label;
  if (lo != null && hi != null) return `${minutes(lo)} to ${minutes(hi)}`;
  return lo != null ? `At least ${minutes(lo)}` : `Up to ${minutes(hi)}`;
}
export const lengthCount = (films, min, max) => (films || []).filter(f => f.runtime > 0 && (min == null || f.runtime >= min) && (max == null || f.runtime <= max)).length;

export const scoreValue = q => (q.scoreMin != null ? `${q.scoreMin}+` : 'Any');

/** Direction choices whose words fit the sort: [[dir, label], [dir, label]], natural direction first. */
export function dirChoices(sort, status) {
  switch (sort) {
    case 'title': return [['asc', 'A to Z'], ['desc', 'Z to A']];
    case 'year': return [['desc', 'Newest first'], ['asc', 'Oldest first']];
    case 'recent': return status === 'watchlist' ? [['asc', 'Oldest added first'], ['desc', 'Newest added first']] : [['desc', 'Latest first'], ['asc', 'Earliest first']];
    case 'runtime': return [['desc', 'Longest first'], ['asc', 'Shortest first']];
    case 'popularity': return [['desc', 'Most popular first'], ['asc', 'Least popular first']];
    default: return [['desc', 'Highest first'], ['asc', 'Lowest first']];
  }
}

// ---------- pills ----------
const lower = s => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s); // "Eerie" → "eerie", keep "Paris, Texas"
/** A feeling or theme id's label: the facet label, else Letterboxd's short form, else the id itself. */
export const labelFor = (labels, id) => (labels && labels.get(id)) || (String(id).startsWith('lb:') ? lbPillLabel(String(id).slice(3)) : String(id).replace(/^set:/, ''));

/**
 * Every choice as a removable pill, feelings first: [{ key, label, out, patch }]. A feeling reads "Feels tense", a place
 * "Set in Paris", a leave-out "Not eerie", a typed feeling 'Feels "lonely but warm"'. The top-bar ranges are pills too.
 * `where` maps an id to its panel group id (from feelGroups).
 */
export function pillsOf(q, { labels, where = new Map(), autoLabels = {} } = {}) {
  const drop = id => x => ({ ...x, feel: x.feel.filter(v => v !== id), themes: x.themes.filter(v => v !== id), avoid: x.avoid.filter(v => v !== id) });
  const feelish = id => FEEL_IDS.includes(where.get(id));
  const out = [];
  if (q.feelText.trim()) out.push({ key: 'text', label: `Feels “${q.feelText.trim()}”`, patch: x => ({ ...x, feelText: '' }) });
  for (const id of q.feel) out.push({ key: 'f' + id, label: feelish(id) || !where.has(id) ? `Feels ${lower(labelFor(labels, id))}` : labelFor(labels, id), patch: drop(id) });
  for (const id of q.themes) {
    const g = where.get(id) || (String(id).startsWith('set:') ? 'places' : 'theme');
    out.push({ key: 't' + id, label: g === 'places' || g === 'times' ? `Set in ${labelFor(labels, id)}` : labelFor(labels, id), patch: drop(id) });
  }
  for (const id of q.avoid) out.push({ key: 'a' + id, label: `Not ${lower(labelFor(labels, id))}`, out: true, patch: drop(id) });
  for (const c of activeFilters({ ...q, feel: [], ratingMin: null, ratingMax: null, runtimeMax: null, scoreMin: null }, autoLabels)) {
    out.push({ key: 'l' + c.id, label: c.label.replace(/^Tag: /, 'Tagged '), patch: x => ({ ...x, ...c.patch }) });
  }
  if (q.runtimeMin != null || q.runtimeMax != null) out.push({ key: 'len', label: lengthValue(q), patch: x => ({ ...x, runtimeMin: null, runtimeMax: null }) });
  if (q.ratingMin != null || q.ratingMax != null) out.push({ key: 'rat', label: `You rated ${ratingValue(q)}`, patch: x => ({ ...x, ratingMin: null, ratingMax: null }) });
  if (q.scoreMin != null) out.push({ key: 'sco', label: `Matinee score ${q.scoreMin}+`, patch: x => ({ ...x, scoreMin: null }) });
  return out;
}

/** State of a feel chip: 'in' | 'out' | 'off'. */
export const chipState = (q, id) => stateOf(q, id);

// ---------- empty result ----------
const HOW_MANY = ['', 'that', 'both', 'all three', 'all four', 'all five'];
/** "Nothing on your watchlist matches all three", "Nothing in your films matches that". */
export function emptyHeading(status, pills) {
  const n = pills;
  const what = n <= 0 ? '' : n < HOW_MANY.length ? ` ${HOW_MANY[n]}` : ' all of these';
  return `Nothing ${WHERE[status] || WHERE.all} matches${what}`;
}
