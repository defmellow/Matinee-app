// How much each data source matters to the feel engine: take a source's data away from some films, rebuild the feel index,
// and see how much their feel profiles and nearest neighbours move. Pure (no I/O); used by the Test fetch report and by
// scripts/feel-ablation.mjs, so both give the same kind of answer.
import { buildFeelIndex, profileOf, similar, describe } from '../analysis/feel/index.js';
import { gatherFeelInput } from '../analysis/feel/gather.js';
import { compose } from '../model.js';

/**
 * Source groups, each a set of [provider, field] pairs inside film.src.
 *   kind: 'viewers' | 'critics' | 'editors' (whose voice the text is, see docs/briefs/w6-feel-contracts.md),
 *         'tags' (keywords, categories), 'structure' (people and genres: not text, shown for comparison).
 *   slow: the source is read from a web page one film at a time (the expensive ones).
 * DECISION: personal tags and auto tags are not read by the feel engine (gather.js never sees them), so "tags" here means
 * the keyword and category sources (Wikidata keywords, Wikipedia categories, IMDb and TMDB keywords).
 */
export const GROUPS = [
  { id: 'lbpage.reviews', label: 'Letterboxd review excerpts', kind: 'viewers', slow: true, fields: [['lbpage', 'reviews']] },
  { id: 'lbpage.themes', label: 'Letterboxd crowd themes', kind: 'viewers', slow: true, fields: [['lbpage', 'themes'], ['lbpage', 'miniThemes']] },
  { id: 'imdbpage.reviews', label: 'IMDb review excerpts', kind: 'viewers', slow: true, fields: [['imdbpage', 'reviews']] },
  { id: 'imdbpage.keywords', label: 'IMDb plot keywords', kind: 'tags', slow: true, fields: [['imdbpage', 'keywords']] },
  { id: 'mcreviews.users', label: 'Metacritic user reviews', kind: 'viewers', slow: true, fields: [['mcreviews', 'users']] },
  { id: 'mcreviews.critics', label: 'Metacritic critic quotes', kind: 'critics', slow: true, fields: [['mcreviews', 'critics']] },
  { id: 'allmovie', label: 'AllMovie moods, tone and themes', kind: 'critics', slow: true, fields: [['allmovie', 'moods'], ['allmovie', 'tone'], ['allmovie', 'flags'], ['allmovie', 'themes']] },
  { id: 'rt.consensus', label: 'Rotten Tomatoes consensus', kind: 'critics', slow: false, fields: [['rt', 'consensus']] },
  { id: 'wikicats', label: 'Wikipedia categories', kind: 'tags', slow: false, fields: [['wikicats', 'categories']] },
  { id: 'wikipedia.reception', label: 'Wikipedia reception section', kind: 'critics', slow: false, fields: [['wikipedia', 'sections', 'reception']] },
  { id: 'wikipedia.plot', label: 'Wikipedia plot and themes sections', kind: 'editors', slow: false, fields: [['wikipedia', 'sections', 'themes'], ['wikipedia', 'sections', 'plot']] },
  { id: 'synopsis', label: 'Synopsis and tagline', kind: 'editors', slow: false, fields: [['wikipedia', 'synopsis'], ['tmdb', 'synopsis'], ['lbpage', 'synopsis'], ['tmdb', 'tagline']] },
  { id: 'wikidata.tags', label: 'Wikidata keywords, subjects and settings', kind: 'tags', slow: false, fields: [['wikidata', 'keywords'], ['wikidata', 'subjects'], ['wikidata', 'locations'], ['wikidata', 'basedOn']] },
  { id: 'tmdb.reviews', label: 'TMDB reviews', kind: 'viewers', slow: false, fields: [['tmdb', 'reviews']] },
  { id: 'tmdb.keywords', label: 'TMDB keywords', kind: 'tags', slow: false, fields: [['tmdb', 'keywords']] },
  { id: 'people', label: 'Cast and crew', kind: 'structure', slow: false, fields: [['wikidata', 'people'], ['tmdb', 'people'], ['lbpage', 'people']] },
  { id: 'genres', label: 'Genres', kind: 'structure', slow: false, fields: [['wikidata', 'genres'], ['tmdb', 'genres'], ['lbpage', 'genres']] },
];

const nonEmpty = v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0) && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const groupById = id => GROUPS.find(g => g.id === id);
const valueAt = (src, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), src);

/** True when this film's src holds data for the group. */
export function groupPresent(src, group) {
  const g = typeof group === 'string' ? groupById(group) : group;
  return !!g && g.fields.some(path => nonEmpty(valueAt(src || {}, path)));
}

/** A copy of `src` with the given groups' fields removed. The original is never touched. */
export function ablateSrc(src, groupIds) {
  const out = { ...(src || {}) };
  for (const id of groupIds) {
    const g = groupById(id);
    if (!g) continue;
    for (const path of g.fields) {
      const [provider, ...rest] = path;
      if (!out[provider]) continue;
      out[provider] = { ...out[provider] };
      if (rest.length === 1) delete out[provider][rest[0]];
      else if (out[provider][rest[0]] && typeof out[provider][rest[0]] === 'object') {
        out[provider][rest[0]] = { ...out[provider][rest[0]] };
        delete out[provider][rest[0]][rest[1]];
      }
    }
  }
  return out;
}

/** A film with some groups removed (other fields shared, not copied). */
export const ablateFilm = (film, groupIds) => ({ ...film, src: ablateSrc(film.src, groupIds) });

/** Every group except `keepIds`, for "only source X" runs. */
export const allGroupsExcept = keepIds => GROUPS.map(g => g.id).filter(id => !keepIds.includes(id));

/** The FeelInput list the app would build for these films. */
export const inputsFor = films => films.map(f => gatherFeelInput(compose(f), f));

export const buildIndexFor = (films, memo = null) => buildFeelIndex(inputsFor(films), memo ? { memo } : {});

// ---------- comparing two indexes ----------

/** A profile as a sparse vector: descriptors by score, themes at 1. */
export function profileVector(profile) {
  const v = new Map();
  if (!profile) return v;
  for (const d of profile.descriptors || []) v.set('d:' + d.id, d.score);
  for (const t of profile.themes || []) v.set('t:' + t.id, 1);
  return v;
}

export function cosine(a, b) {
  if (!a.size && !b.size) return 1;
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of a) { na += x * x; const y = b.get(k); if (y) dot += x * y; }
  for (const y of b.values()) nb += y * y;
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / (A.size + B.size - both);
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const isThin = p => !!p && describe(p).thin;
export const topKeys = (index, key, limit) => similar(index, key, { limit }).map(r => r.key);

/**
 * How far films moved between two indexes: profile cosine, top-N neighbour overlap, and whether the profile became "thin".
 * @returns {{ rows: Array<{key,cosine,overlap,becameThin}>, cosine: number|null, overlap: number|null, becameThin: number }}
 */
export function compareIndexes(base, alt, keys, { limit = 10 } = {}) {
  const rows = keys.map(key => {
    const pa = profileOf(base, key), pb = profileOf(alt, key);
    return {
      key,
      cosine: cosine(profileVector(pa), profileVector(pb)),
      overlap: jaccard(topKeys(base, key, limit), topKeys(alt, key, limit)),
      becameThin: !isThin(pa) && isThin(pb),
    };
  });
  return { rows, cosine: mean(rows.map(r => r.cosine)), overlap: mean(rows.map(r => r.overlap)), becameThin: rows.filter(r => r.becameThin).length };
}

/** 'large' when a film's neighbours or profile change a lot without the source, 'small' when hardly at all. */
export function verdictFor(cos, overlap) {
  if (cos == null || overlap == null) return 'no data';
  if (overlap < 0.6 || cos < 0.85) return 'large';
  if (overlap < 0.85 || cos < 0.95) return 'moderate';
  return 'small';
}

const RANK = { large: 3, moderate: 2, small: 1, 'no data': 0 };

/**
 * For each source group: take its data off the films that have it, rebuild, and measure the change on those films.
 * @param {object} o
 * @param {object[]} o.films  the films just fetched (in-memory copies whose src holds this run's data)
 * @param {{ films: object }} o.store  the library; read only. Its films make up the rest of the index (the copies replace their originals)
 * @param {object[]} [o.groups]
 * @param {number} [o.limit] neighbours compared (10)
 * @param {Map} [o.memo] kept between calls so unchanged films are not re-read
 * @param {AbortSignal} [o.signal] stops between groups; the groups done so far are returned (`stopped: true`)
 * Each rebuild is synchronous, so the loop yields to the event loop between groups to keep the process answering.
 */
export async function feelSourceImpact({ films = [], store, groups = GROUPS, limit = 10, memo = new Map(), signal = null } = {}) {
  const t0 = Date.now();
  const byKey = new Map(Object.values(store?.films || {}).map(f => [f.key, f]));
  for (const f of films) byKey.set(f.key, f);
  const all = [...byKey.values()];
  const keys = new Set(films.map(f => f.key));
  const base = buildIndexFor(all, memo);
  const out = [];
  let stopped = false;
  for (const g of groups) {
    if (signal && signal.aborted) { stopped = true; break; }
    await new Promise(resolve => setImmediate(resolve));
    const have = films.filter(f => groupPresent(f.src, g));
    if (!have.length) { out.push({ id: g.id, label: g.label, kind: g.kind, slow: g.slow, films: 0, profileSimilarity: null, neighbourOverlap: null, becameThin: 0, verdict: 'no data' }); continue; }
    const hit = new Set(have.map(f => f.key));
    const alt = buildIndexFor(all.map(f => (hit.has(f.key) ? ablateFilm(f, [g.id]) : f)), memo);
    const c = compareIndexes(base, alt, have.map(f => f.key).filter(k => keys.has(k)), { limit });
    out.push({ id: g.id, label: g.label, kind: g.kind, slow: g.slow, films: have.length, profileSimilarity: round(c.cosine), neighbourOverlap: round(c.overlap), becameThin: c.becameThin, verdict: verdictFor(c.cosine, c.overlap) });
  }
  out.sort((a, b) => RANK[b.verdict] - RANK[a.verdict] || (a.neighbourOverlap ?? 2) - (b.neighbourOverlap ?? 2));
  return { library: all.length, films: films.length, limit, ms: Date.now() - t0, stopped, groups: out };
}
