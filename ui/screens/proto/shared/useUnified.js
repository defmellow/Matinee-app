// PROTOTYPE: the merged Library's data. Library filters narrow (instant, in the browser); feel parts rank (one core call, cached).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyQuery } from '../../../../core/analysis/query.js';
import { call } from '../../../api.js';
import { useLibrary, useLibraryError, usePref } from '../../../state.js';
import { facetSections, labelIndex, emphasisFor, tierFor, reasonLines, TIERS } from '../../feel/model.js';
import { normalise, hasFeel, ranks, sortOf, coreQuery, fromParam, resolveKinds } from './query.js';

// A film counts as a match when it clearly has part of what was asked, or scores at least this share of the best film.
// DECISION (prototype): keeps "Some overlap" honest without a wall of faint traces; tune on real data.
export const FAINT = 0.25;
// Feel answers are asked again as films fill in, but only every this many newly filled-in films (not on each one).
const REFRESH_EVERY = 25;

const scopeOf = status => (status === 'watched' || status === 'watchlist' ? status : 'all');
const feelSig = q => JSON.stringify([q.feel, q.themes, q.avoid, q.feelText.trim(), q.like, q.like && q.likeEmphasis, q.like && q.likeShift, scopeOf(q.status)]);
const tierRank = id => TIERS.findIndex(t => t.id === id);

/** One call for the feel parts: search, similar or shift. Returns Map key → { score, why, reasons, covers, rough }. */
export async function loadMatches(q) {
  const scope = scopeOf(q.status);
  const asked = q.feel.length || q.themes.length || q.avoid.length || q.feelText.trim();
  const search = asked ? call('searchFeel', { descriptors: q.feel, themes: q.themes, avoid: q.avoid, text: q.feelText.trim(), limit: 100000, scope }) : null;
  const near = q.like ? (q.likeShift
    ? call('shiftFeel', { key: q.like, axis: q.likeShift.axis, dir: q.likeShift.dir, limit: 3000, scope })
    : call('getFeelSimilar', { key: q.like, emphasis: emphasisFor(q.likeEmphasis), limit: 3000, scope })) : null;
  const [s, n] = await Promise.all([search, near]);
  const m = new Map();
  if (n) {
    // "Feels like" ranks; anything else asked only narrows (a film must carry it).
    const onlyAvoid = !(q.feel.length || q.themes.length || q.feelText.trim());
    const keep = s ? new Set(s.filter(r => onlyAvoid || (r.covers ?? 1) > 0).map(r => r.key)) : null;
    for (const r of n) if (!keep || keep.has(r.key)) m.set(r.key, { score: r.score, reasons: r.reasons, rough: r.rough });
  } else if (s) {
    for (const r of s) m.set(r.key, { score: r.score, why: r.why, covers: r.covers, rough: r.rough });
  }
  return m;
}

/** Ranked list from the films that pass the Library filters and the feel answers. */
export function rank(base, q, m) {
  const kept = base.filter(f => m.has(f.key) && f.key !== q.like);
  if (!ranks(q)) return { results: kept.map(film => ({ film })), best: 0, ranked: false }; // only leave-outs: narrowed, not ranked
  let top = 0;
  for (const f of kept) top = Math.max(top, m.get(f.key).score || 0);
  const out = [];
  for (const film of kept) {
    const r = m.get(film.key);
    if (!((r.covers != null && r.covers > 0) || (r.score || 0) >= FAINT * top)) continue;
    const tier = tierFor(r.score, top, r.covers != null ? r : null);
    out.push({ film, match: { score: r.score, tier, rough: !!r.rough, lines: reasonLines(r, 2), allLines: reasonLines(r, 6) } });
  }
  // Best match: tier first (a film missing part of the ask never sits above one that has all of it), then score.
  if (sortOf(q) === 'match') out.sort((a, b) => tierRank(a.match.tier.id) - tierRank(b.match.tier.id) || b.match.score - a.match.score || a.film.title.localeCompare(b.film.title));
  return { results: out, best: top, ranked: true };
}

/**
 * The merged Library state for a prototype screen.
 * results: [{ film, match? }] where match = { score, tier, lines, allLines, rough }.
 * `link`: a filter link to apply once (Library forms, or feel:<old By feel param>); `onLinkUsed` lets the screen tidy the URL.
 */
export function useUnified(link, onLinkUsed) {
  const lib = useLibrary();
  const libError = useLibraryError();
  const [stored, setStored] = usePref('proto.library.query', null);
  useEffect(() => {
    const fromLink = link ? fromParam(link) : null;
    if (!fromLink) return;
    setStored(fromLink);
    if (onLinkUsed) onLinkUsed(); // the filter now lives in the Library; Back skips the link form (as the Library does)
  }, [link]); // eslint-disable-line react-hooks/exhaustive-deps

  // The full list of feelings (labels, kinds, the "Like this one, but…" axes): once.
  const [facets, setFacets] = useState(null);
  useEffect(() => {
    let live = true;
    // a failure is recorded by api.call; the screen carries on without feelings
    call('getFeelFacets').then(f => live && setFacets(f), () => live && setFacets({ descriptors: [], themes: [], settings: [], axes: [] }));
    return () => { live = false; };
  }, []);

  const qStored = useMemo(() => resolveKinds(normalise(stored), facets), [stored, facets]);
  // Best match follows the feelings: adding the first one switches to it, taking the last one off switches back.
  const setQ = next => setStored(prev => {
    const before = normalise(prev);
    const after = normalise(typeof next === 'function' ? next(before) : next);
    if (!ranks(before) && ranks(after) && after.sort === before.sort) { after.sort = null; after.dir = null; }
    if (ranks(before) && !ranks(after) && after.sort === 'match') { after.sort = null; after.dir = null; }
    return after;
  });
  const set = patch => setQ(prev => ({ ...prev, ...patch }));

  const films = lib ? lib.films : null;
  const enrichedN = films ? films.reduce((n, f) => n + (f.enriched ? 1 : 0), 0) : 0;
  const stamp = Math.floor(enrichedN / REFRESH_EVERY);

  // The search box looks at titles and people only; feelings typed as words go in the panel's own search.
  const textBase = useMemo(() => (films ? applyQuery(films, coreQuery(qStored)) : []), [films, qStored]);
  const asFeel = false;
  const q = qStored;
  // Films passing the Library filters (no feel parts): the base for ranking and for counting chips in view.
  const base = useMemo(() => (asFeel ? (films ? applyQuery(films, coreQuery(q)) : []) : textBase), [asFeel, films, q, textBase]);

  // Chip counts for the films in view (the films on show, not the whole library), debounced.
  const baseSig = useMemo(() => base.map(f => f.key).join('|'), [base]);
  const [viewFacets, setViewFacets] = useState(null);
  useEffect(() => {
    if (!films) return;
    if (base.length === films.length) { setViewFacets(null); return; } // everything in view: the full counts
    let live = true;
    const keys = base.map(f => f.key);
    const t = setTimeout(() => call('getFeelFacets', { keys }).then(f => live && setViewFacets(f), () => live && setViewFacets(null)), 200);
    return () => { live = false; clearTimeout(t); };
  }, [baseSig, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feel answers, cached per question. Kept with the question they answer, so a new question never shows old scores as current.
  const cache = useRef({ stamp: -1, by: new Map() });
  const [answer, setAnswer] = useState({ sig: null, m: null, error: null });
  const [tries, setTries] = useState(0);
  const sig = feelSig(q);
  useEffect(() => {
    if (!hasFeel(q) || !films || !facets) return;
    const c = cache.current;
    if (c.stamp !== stamp) { c.stamp = stamp; c.by = new Map(); }
    if (!c.by.has(sig)) c.by.set(sig, loadMatches(q));
    let live = true;
    c.by.get(sig).then(m => { if (live) setAnswer({ sig, m, error: null }); },
      error => { c.by.delete(sig); if (live) setAnswer({ sig, m: null, error }); }); // recorded by api.call
    return () => { live = false; };
  }, [sig, stamp, !!films, !!facets, tries]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = useRef({ results: [], best: 0, ranked: false });
  const current = answer.sig === sig && answer.m ? answer.m : null;
  const out = useMemo(() => {
    if (!films) return { results: [], best: 0, ranked: false };
    if (!hasFeel(q)) return { results: base.map(film => ({ film })), best: 0, ranked: false };
    if (!current) return null; // waiting: the screen keeps the last list, marked stale
    return rank(base, q, current);
  }, [films, base, q, current]);
  if (out) last.current = out;
  // `ranked` describes the list on show, not the ask: while a new feeling loads, the last list (often unranked) stays up,
  // and reading it as ranked crashed the Library on a card with no closeness ("reading 'tier'").
  const { results, best, ranked } = out || last.current;

  // Library-wide lists: the panel uses these so its chips never move or vanish while the user clicks (22 Nov).
  const allSections = useMemo(() => facetSections(facets), [facets]);
  const sections = useMemo(() => {
    const all = allSections;
    if (!viewFacets) return all;
    const n = new Map();
    for (const d of viewFacets.descriptors || []) n.set(d.id, d.count);
    for (const t of viewFacets.themes || []) n.set(t.id, Math.max(n.get(t.id) || 0, t.count));
    for (const s of viewFacets.settings || []) n.set(s.id, s.count);
    const chosen = new Set([...q.feel, ...q.themes, ...q.avoid]);
    return all.map(g => ({ ...g, items: g.items.map(it => ({ ...it, count: n.get(it.id) || 0 })).filter(it => it.count > 0 || chosen.has(it.id)) }));
  }, [allSections, viewFacets, q.feel, q.themes, q.avoid]);
  const labels = useMemo(() => labelIndex(facets), [facets]);
  const descIds = useMemo(() => new Set(((facets && facets.descriptors) || []).map(d => d.id)), [facets]);
  const labelsKind = id => (descIds.has(id) ? 'descriptors' : 'themes');

  const likeFilm = q.like && films ? films.find(f => f.key === q.like) || null : null;
  const waiting = hasFeel(q) && !current;
  const error = answer.sig === sig ? answer.error : null;
  return {
    lib, libError, q, typed: qStored.text, asFeel, qStoredAvoid: qStored.avoid, set, setQ, facets, sections, allSections, labels, labelsKind, results, best,
    ranked, feelOn: hasFeel(q), inView: !!viewFacets,
    busy: waiting && !error, stale: waiting && last.current.results.length > 0, error,
    likeFilm, retry: () => setTries(x => x + 1),
  };
}

/** The film's feel (headline and chips) for the "Feels like" panel: undefined while loading, null when there's nothing, 'error'. */
export function useFilmFeel(key) {
  const [data, setData] = useState(undefined);
  useEffect(() => {
    if (!key) { setData(undefined); return; }
    let live = true;
    setData(undefined);
    call('getFeel', { key }).then(d => live && setData(d), () => live && setData('error')); // recorded by api.call
    return () => { live = false; };
  }, [key]);
  return data;
}

/** The feelings and themes a typed phrase names (core's own word matching), for the search dropdown. */
export function useFeelWords(text) {
  const [ids, setIds] = useState([]);
  useEffect(() => {
    const t0 = String(text || '').trim();
    if (t0.length < 3 || t0.includes(':')) { setIds([]); return; }
    let live = true;
    const t = setTimeout(() => call('feelWordsIn', { text: t0 }).then(r => live && setIds(r || []), () => live && setIds([])), 120);
    return () => { live = false; clearTimeout(t); };
  }, [text]);
  return ids;
}
