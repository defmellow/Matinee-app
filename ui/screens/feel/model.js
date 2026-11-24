// Pure helpers for the "By feel" screen: route parsing, filter state <-> API args, facet grouping, text trimming.
import { fold, bestScore } from './rank.js';
import { canonicalFeelId } from '../../../core/analysis/feel/aliases.js';

export const SCOPES = [
  { value: 'all', label: 'Everything' },
  { value: 'watched', label: 'Watched' },
  { value: 'watchlist', label: 'Watchlist' },
];
export const MAX_RESULTS = 60;

export const FACET_GROUPS = [
  { id: 'mood', label: 'Mood' },
  { id: 'tone', label: 'Tone' },
  { id: 'pace', label: 'Pace' },
  { id: 'craft', label: 'Craft' },
  { id: 'impact', label: 'Emotional impact' },
  { id: 'theme', label: 'Themes' }, // theme descriptors; Letterboxd groups join them (see facetSections)
];

export const EMPHASIS = [
  { value: 'overall', label: 'Overall feel', emphasis: { feel: 1, themes: 1, craft: 0.5, people: 0.4 } },
  { value: 'themes', label: 'Themes', emphasis: { feel: 0.4, themes: 1.6, craft: 0.2, people: 0.2 } },
  { value: 'craft', label: 'Look and craft', emphasis: { feel: 0.4, themes: 0.3, craft: 1.6, people: 0.3 } },
  { value: 'people', label: 'Same people', emphasis: { feel: 0.3, themes: 0.2, craft: 0.3, people: 1.6 } },
];
export const emphasisFor = value => (EMPHASIS.find(e => e.value === value) || EMPHASIS[0]).emphasis;

export const emptyFilters = () => ({ text: '', descriptors: [], themes: [], avoid: [] });

/**
 * '#/feel/<param>' -> { mode, key?, filters }. film:<key> starts from a film; d:<id> / t:<id> pre-filter;
 * lb:<Letterboxd theme group> and set:<place or era id> pre-filter too (kept whole in the themes list, with their prefix);
 * q:<text> starts a text search.
 */
export function parseParam(param) {
  const p = String(param || '');
  const filters = emptyFilters();
  if (p.startsWith('film:')) return { mode: 'film', key: p.slice(5) || null, filters };
  if (p.startsWith('q:')) { filters.text = p.slice(2); return { mode: 'describe', key: null, filters }; } // free text, e.g. a Letterboxd theme group
  const m = /^([dt]):(.+)$/.exec(p);
  if (m) filters[m[1] === 'd' ? 'descriptors' : 'themes'].push(canonicalFeelId(m[2]));
  else if (/^(lb|set):.+/.test(p)) filters.themes.push(p);
  return { mode: 'describe', key: null, filters };
}

/** Inverse of parseParam for the simple cases (used for links). */
export const filmParam = key => 'film:' + key;

export const hasFilters = f => !!(f.text.trim() || f.descriptors.length || f.themes.length || f.avoid.length);

/** Click cycle for a chip: off -> include -> leave out -> off. `kind` is 'descriptors' or 'themes'. */
export function cycleChip(f, kind, id) {
  const inc = f[kind].includes(id), out = f.avoid.includes(id);
  const next = { ...f, descriptors: f.descriptors.filter(x => x !== id), themes: f.themes.filter(x => x !== id), avoid: f.avoid.filter(x => x !== id) };
  if (!inc && !out) next[kind] = [...next[kind], id];
  else if (inc) next.avoid = [...next.avoid, id];
  return next;
}
export const chipState = (f, kind, id) => (f[kind].includes(id) ? 'in' : f.avoid.includes(id) ? 'out' : 'off');

export function removeFilter(f, id) {
  return { ...f, descriptors: f.descriptors.filter(x => x !== id), themes: f.themes.filter(x => x !== id), avoid: f.avoid.filter(x => x !== id) };
}

/** The server knows all / watched / watchlist. A saved "unwatched" choice from an older version meant the watchlist. */
export const apiScope = scope => (scope === 'unwatched' ? 'watchlist' : scope);
export const apiLimit = () => MAX_RESULTS;

export function searchArgs(f, scope) {
  return { descriptors: f.descriptors, themes: f.themes, avoid: f.avoid, text: f.text.trim(), limit: apiLimit(), scope: apiScope(scope) };
}

/** The server already applies the scope; this just trims the list. */
export function applyScope(results) {
  return results.slice(0, MAX_RESULTS);
}

/** Chips for one list: biggest first, capped unless expanded. Chips already chosen always stay visible. */
export function capFacets(list, { cap = 12, expanded = false, chosen = [] } = {}) {
  const sorted = [...(list || [])].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (expanded || sorted.length <= cap) return { shown: sorted, hidden: 0 };
  const pick = new Set(chosen);
  const shown = sorted.filter((x, i) => i < cap || pick.has(x.id));
  return { shown, hidden: sorted.length - shown.length };
}

export function groupByFacet(descriptors) {
  const out = {};
  for (const d of descriptors || []) (out[d.facet] ||= []).push(d);
  return out;
}

/**
 * The filter lists as sections, in the film page's row order and wording. Each item says which list it goes in
 * (`kind`: 'descriptors' or 'themes'). Letterboxd groups sit with the theme ideas under "Themes".
 */
export function facetSections(facets) {
  if (!facets) return [];
  const byFacet = groupByFacet(facets.descriptors);
  const themes = facets.themes || [];
  const of = (items, kind) => (items || []).map(x => ({ ...x, kind }));
  const sectionOf = name => themes.filter(t => t.section === name);
  // One chip per label in a list: Matinee's own tag wins over the same tag from Letterboxd's theme groups.
  const uniq = items => { const seen = new Set(); return items.filter(x => { const k = String(x.label).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const own = name => themes.filter(t => t.section === name && !String(t.id).startsWith('lb:'));
  const fromLb = name => themes.filter(t => t.section === name && String(t.id).startsWith('lb:'));
  const out = [];
  for (const g of FACET_GROUPS) {
    const items = g.id === 'theme' ? [...of(byFacet.theme, 'descriptors'), ...of(sectionOf('lb'), 'themes')]
      : g.id === 'tone' ? [...of(byFacet.tone, 'descriptors'), ...of(sectionOf('lb-tone'), 'themes')]
      : of(byFacet[g.id], 'descriptors');
    out.push({ id: g.id, label: g.label, items: uniq(items) });
  }
  out.push({ id: 'subjects', label: 'Subjects', items: uniq([...of(own('subject'), 'themes'), ...of(fromLb('subject'), 'themes')]) });
  out.push({ id: 'kinds', label: 'Kind of film', items: uniq([...of(own('kind'), 'themes'), ...of(fromLb('kind'), 'themes')]) });
  out.push({ id: 'settings', label: 'Set in', items: of(facets.settings, 'themes') });
  return out;
}

/**
 * Tags whose label matches what is being typed: word-start matches first, then "contains", biggest first within each.
 * Tries the whole text, then its last word. Returns { term, tags } where term is the piece of text that matched
 * (so picking a tag can take it out of the box); tags are { id, label, kind, section, count }.
 */
export function matchingTags(sections, text, { limit = 12, exclude = [] } = {}) {
  const typed = fold(text);
  if (typed.length < 2) return { term: '', tags: [] };
  const skip = new Set(exclude);
  const run = term => {
    const scored = [];
    const seen = new Set();
    for (const sec of sections || []) {
      for (const it of sec.items || []) {
        const label = fold(it.label);
        if (skip.has(it.id) || seen.has(label)) continue; // one pill per label: the first section wins (a theme over a subject of the same name)
        const rank = bestScore(term, [label]); // 3 starts with it, 2 a word starts with it, 1 inside
        if (!rank) continue;
        seen.add(label);
        scored.push({ rank, tag: { id: it.id, label: it.label, kind: it.kind, section: sec.label, count: it.count || 0 } });
      }
    }
    scored.sort((a, b) => b.rank - a.rank || b.tag.count - a.tag.count || a.tag.label.localeCompare(b.tag.label));
    return scored.slice(0, limit).map(x => x.tag);
  };
  let tags = run(typed), term = typed;
  const lastWord = typed.split(/\s+/).pop();
  if (!tags.length && lastWord !== typed && lastWord.length >= 2) { tags = run(lastWord); term = lastWord; }
  return { term: tags.length ? term : '', tags };
}

/** Choose a tag found by typing: add it as an included pill and take the typed term out of the text box. */
export function pickTag(f, tag) {
  const next = { ...f, descriptors: f.descriptors.filter(x => x !== tag.id), themes: f.themes.filter(x => x !== tag.id), avoid: f.avoid.filter(x => x !== tag.id) };
  next[tag.kind] = [...next[tag.kind], tag.id];
  next.text = ''; // the pick replaces whatever was typed; the tag now shows as a pill
  return next;
}

/** Look a chip up by id so active filters can show their label. */
export function labelIndex(facets) {
  const m = new Map();
  if (!facets) return m;
  for (const d of facets.descriptors || []) m.set(d.id, d.label);
  for (const t of facets.themes || []) m.set(t.id, t.label);
  for (const s of facets.settings || []) m.set(s.id, s.label);
  return m;
}

/** Short readable line: one sentence, no trailing full stop clutter, capped by length. */
export function trimReason(text, max = 110) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
}

/** Up to `n` reason lines from a search result (why[]) or a similarity result (reasons[]). */
export function reasonLines(r, n = 2) {
  const raw = r.reasons ? r.reasons.map(x => x.text) : r.why || [];
  return raw.filter(Boolean).slice(0, n).map(t => trimReason(t));
}

/** Score bars are relative to the best result, never shown as numbers. */
export function barWidths(results) {
  const max = Math.max(0, ...results.map(r => r.score || 0));
  return results.map(r => (max > 0 ? Math.max(8, Math.round(((r.score || 0) / max) * 100)) : 0));
}

/**
 * How close a result is, in words. Scores run 0..1 but sit in different ranges for different queries,
 * so the bands are relative to the best result in the list.
 */
// DECISION: bands at 80% and 55% of the best score; easy to retune here.
export const TIERS = [
  { id: 'very', label: 'Very close', min: 0.8 },
  { id: 'close', label: 'Close', min: 0.55 },
  { id: 'some', label: 'Some overlap', min: 0 },
];
/** A search result is only "Very close" when it is also close in its own right: at least this score (0..1). */
export const VERY_MIN = 0.3;
/**
 * The tier of a score next to the best in its list. For a search result (`r.covers` = how much of what was asked the film has,
 * 0..1) the list alone is not enough: a film missing one of the things asked for is never "Very close", one with half of
 * them or fewer is "Some overlap", and the best of a weak list is not called very close.
 */
export function tierFor(score, best, r = null) {
  const ratio = best > 0 ? (score || 0) / best : 0;
  let i = TIERS.findIndex(t => ratio >= t.min);
  if (i < 0) i = TIERS.length - 1;
  if (r && r.covers != null) {
    if (i === 0 && (r.covers < 0.99 || (score || 0) < VERY_MIN)) i = 1;
    if (r.covers < 0.6) i = TIERS.length - 1; // one of two things asked for is half the ask: overlap, not close
  }
  return TIERS[i];
}

/**
 * Hover text for a result's feel badge: the tier in words, the real closeness figure (the engine's 0..1 score
 * as out of 100, next to the best result in the list so it has a yardstick), then the top reasons in full.
 */
export function matchTitle(r, tier, best) {
  const raw = r.reasons ? r.reasons.map(x => x.text) : r.why || [];
  const why = raw.filter(Boolean).slice(0, 3).map(t => String(t).replace(/\s+/g, ' ').trim());
  const n = Math.round((r.score || 0) * 100);
  const top = best > 0 ? Math.round(best * 100) : 0;
  const figure = top && top !== n ? `Feel match ${n} out of 100 (the closest here is ${top})` : `Feel match ${n} out of 100`;
  return `${tier.label} feel match\n${figure}${why.length ? '\nWhy: ' + why.join('; ') : ''}`;
}

export const VOICE_LABELS = { viewers: 'viewers', critics: 'critics', editors: 'article tags' };
export const voiceLabel = v => VOICE_LABELS[v] || 'article tags';

/** True when most of the sampled summaries lean on article tags / keywords rather than viewer or critic text. */
export function mostlyThin(summaries) {
  const s = (summaries || []).filter(Boolean);
  return s.length > 0 && s.filter(x => x.thin).length * 2 >= s.length;
}

/** Local film search for the picker: titles first, shortest first on ties. */
export function pickFilms(films, query, limit = 8) {
  const q = fold(query);
  if (!q) return [];
  const out = [];
  for (const f of films || []) {
    const s = bestScore(q, [fold(f.title), f.originalTitle ? fold(f.originalTitle) : '']);
    if (s) out.push({ f, s });
  }
  out.sort((a, b) => b.s - a.s || a.f.title.length - b.f.title.length || a.f.title.localeCompare(b.f.title));
  return out.slice(0, limit).map(x => x.f);
}

/** Heading above film-mode results. */
export function filmHeading(title, shift, axes) {
  if (shift) {
    const a = (axes || []).find(x => x.id === shift.axis);
    const word = a ? (shift.dir < 0 ? a.low : a.high) : '';
    return word ? `Like ${title}, but ${word.toLowerCase()}` : `Like ${title}`;
  }
  return `Films that feel like ${title}`;
}

