// Film similarity: weighted features, IDF reweighting, an inverted index and cosine scores.
// Pure functions over plain "summary" objects (see the brief / PLAN.md 2.4); no I/O.
//
// summary = { key, title, year, runtime, genres, countries, languages,
//             people: { director:[{name,id}], writer, cinematography, composer, editor, cast:[{name,id,role}] },
//             keywords, subjects, collection, basedOn, awards, score, ratings, user, ... }
//
// A film becomes a sparse vector of features such as 'director:wd:Q123', 'genre:drama'.
// buildIndex() reweights each feature by log(1 + N/df) so rare things (a director with three films in the
// library) count for more than common ones (drama), and keeps an inverted index so related() only ever
// touches films that share at least one feature.

/** Base weight per feature kind. Cast is handled separately by billing position. */
export const WEIGHTS = {
  director: 5,
  writer: 3,
  cinematography: 2.5,
  composer: 2,
  editor: 1.2,
  collection: 4,
  basedOn: 2,
  keyword: 1.2,
  subject: 1.5,
  genre: 0.8,
  country: 0.5,
  language: 0.7,
};
/** Top 8 billed cast, by billing order. */
export const CAST_WEIGHTS = [1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9];

const CREW_ROLES = ['director', 'writer', 'cinematography', 'composer', 'editor'];
const ENGLISH = new Set(['english', 'en', 'eng']);

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase();

/** 'director:wd:Q123' → 'director'. */
export function featureKind(featureId) {
  const i = featureId.indexOf(':');
  return i < 0 ? featureId : featureId.slice(0, i);
}

/** Person id: the namespaced id when there is one, else the lower-cased name. */
function personId(p) {
  if (!p) return null;
  const id = p.id != null && p.id !== '' ? clean(p.id) : norm(p.name);
  return id || null;
}

/** Genres read better lower-case ("science fiction") unless they hold an acronym ("TV Movie" stays). */
const genreLabel = (g) => (/[A-Z]{2}/.test(g) ? g : g.toLowerCase());

/**
 * Every feature of a film with its base weight and a readable label.
 * @returns {{ id: string, kind: string, weight: number, label: string }[]}
 */
export function extract(summary) {
  const out = new Map();
  const add = (kind, key, weight, label) => {
    if (!key) return;
    const id = `${kind}:${key}`;
    const prev = out.get(id);
    if (prev) { if (weight > prev.weight) prev.weight = weight; return; }
    out.set(id, { id, kind, weight, label });
  };
  const s = summary || {};
  const people = s.people || {};
  for (const role of CREW_ROLES) {
    for (const p of people[role] || []) add(role, personId(p), WEIGHTS[role], clean(p?.name) || personId(p));
  }
  if (s.collection) {
    const name = clean(s.collection).replace(/\s+collection$/i, '');
    if (name) add('collection', norm(name), WEIGHTS.collection, name);
  }
  for (const b of s.basedOn || []) { const t = clean(b); if (t) add('basedOn', t.toLowerCase(), WEIGHTS.basedOn, t); }
  (people.cast || []).slice(0, CAST_WEIGHTS.length).forEach((p, i) => add('cast', personId(p), CAST_WEIGHTS[i], clean(p?.name) || personId(p)));
  for (const k of s.keywords || []) { const t = clean(k); if (t) add('keyword', t.toLowerCase(), WEIGHTS.keyword, t); }
  for (const k of s.subjects || []) { const t = clean(k); if (t) add('subject', t.toLowerCase(), WEIGHTS.subject, t); }
  for (const g of s.genres || []) { const t = clean(g); if (t) add('genre', t.toLowerCase(), WEIGHTS.genre, genreLabel(t)); }
  for (const c of s.countries || []) { const t = clean(c); if (t) add('country', t.toLowerCase(), WEIGHTS.country, t); }
  for (const l of s.languages || []) { const t = clean(l); if (t && !ENGLISH.has(t.toLowerCase())) add('language', t.toLowerCase(), WEIGHTS.language, t); }
  // Release year / decade is deliberately NOT a feature: no film is related to another because of when it came out.
  return [...out.values()];
}

/** Features of one film with their base (un-IDF'd) weights: Map<featureId, weight>. */
export function features(summary) {
  return new Map(extract(summary).map((f) => [f.id, f.weight]));
}

// ---------- index ----------

/**
 * Build the similarity index for a set of films.
 * Standard cosine: features only one film has still count in that film's norm, so a film with lots of
 * detail nobody else shares is (rightly) less alike to a barely-described film that shares one genre.
 *
 * The index is a plain object. Public bits: size, keys[], byKey (Map key → summary), summaries[].
 * The rest is typed arrays used by related()/similarity()/buildGraph().
 */
export function buildIndex(summaries = []) {
  const keys = [];
  const list = [];
  const pos = new Map();
  for (const s of summaries || []) {
    if (!s || s.key == null || pos.has(s.key)) continue;
    pos.set(s.key, keys.length);
    keys.push(s.key);
    list.push(s);
  }
  const n = keys.length;

  const featureIndex = new Map();
  const featureIds = [];
  const featureLabels = [];
  const df = [];
  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const ex = extract(list[i]);
    const row = new Array(ex.length);
    for (let t = 0; t < ex.length; t++) {
      const f = ex[t];
      let fi = featureIndex.get(f.id);
      if (fi === undefined) {
        fi = featureIds.length;
        featureIndex.set(f.id, fi);
        featureIds.push(f.id);
        featureLabels.push(f.label);
        df.push(0);
      }
      df[fi]++;
      row[t] = [fi, f.weight];
    }
    raw[i] = row;
  }

  const nf = featureIds.length;
  const idf = new Float64Array(nf);
  for (let f = 0; f < nf; f++) idf[f] = Math.log(1 + n / df[f]);

  const postCount = new Int32Array(nf);
  const vecF = new Array(n);
  const vecW = new Array(n);
  const norms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = raw[i].sort((a, b) => a[0] - b[0]);
    const fa = new Int32Array(row.length);
    const wa = new Float64Array(row.length);
    let sq = 0;
    for (let t = 0; t < row.length; t++) {
      fa[t] = row[t][0];
      wa[t] = row[t][1] * idf[row[t][0]];
      sq += wa[t] * wa[t];
      postCount[fa[t]]++;
    }
    vecF[i] = fa;
    vecW[i] = wa;
    norms[i] = Math.sqrt(sq);
  }
  raw.length = 0;

  const postF = new Array(nf);
  const postW = new Array(nf);
  for (let f = 0; f < nf; f++) {
    postF[f] = new Int32Array(postCount[f]);
    postW[f] = new Float64Array(postCount[f]);
  }
  const fill = new Int32Array(nf);
  for (let i = 0; i < n; i++) {
    const fa = vecF[i];
    const wa = vecW[i];
    for (let t = 0; t < fa.length; t++) {
      const f = fa[t];
      postF[f][fill[f]] = i;
      postW[f][fill[f]] = wa[t];
      fill[f]++;
    }
  }

  return {
    size: n,
    keys,
    summaries: list,
    byKey: new Map(keys.map((k, i) => [k, list[i]])),
    pos,
    featureIndex,
    featureIds,
    featureLabels,
    df: Int32Array.from(df),
    idf,
    vecF,
    vecW,
    norms,
    postF,
    postW,
    scratch: { acc: new Float64Array(n), touched: new Int32Array(n) },
  };
}

/** IDF of a feature in this index; features the index has never seen count as if one film had them. */
export function idfOf(index, featureId) {
  const f = index.featureIndex.get(featureId);
  return f === undefined ? Math.log(1 + index.size) : index.idf[f];
}

/** Readable label for a feature id ("Wim Wenders", "science fiction", "1980s"), or null if unknown. */
export function featureLabel(index, featureId) {
  const f = index.featureIndex.get(featureId);
  return f === undefined ? null : index.featureLabels[f];
}

/** Vector for a summary that may not be in the index (uses the index's features and IDF; unseen features only add to the norm). */
export function vectorFor(index, summary) {
  const row = [];
  let sq = 0;
  for (const f of extract(summary)) {
    const fi = index.featureIndex.get(f.id);
    if (fi === undefined) { const x = f.weight * Math.log(1 + index.size); sq += x * x; } else row.push([fi, f.weight * index.idf[fi]]);
  }
  row.sort((a, b) => a[0] - b[0]);
  const f = Int32Array.from(row, (r) => r[0]);
  const w = Float64Array.from(row, (r) => r[1]);
  for (const x of w) sq += x * x;
  return { f, w, norm: Math.sqrt(sq) };
}

/** Vector of an indexed film by position. */
export function vectorAt(index, i) {
  return { f: index.vecF[i], w: index.vecW[i], norm: index.norms[i] };
}

function dot(fa, wa, fb, wb) {
  let i = 0;
  let j = 0;
  let s = 0;
  while (i < fa.length && j < fb.length) {
    const x = fa[i];
    const y = fb[j];
    if (x === y) { s += wa[i] * wb[j]; i++; j++; } else if (x < y) i++; else j++;
  }
  return s;
}

/** Cosine similarity between two vectors from vectorFor/vectorAt, 0–1. */
export function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  return Math.min(1, dot(a.f, a.w, b.f, b.w) / (a.norm * b.norm));
}

/** Cosine similarity of two indexed films, 0–1. Unknown keys score 0. */
export function similarity(index, keyA, keyB) {
  const a = index.pos.get(keyA);
  const b = index.pos.get(keyB);
  if (a === undefined || b === undefined) return 0;
  return cosine(vectorAt(index, a), vectorAt(index, b));
}

// Ties go to the smaller film key, so the order doesn't depend on where a film sits in the store.
const better = (sa, ja, sb, jb, keys) => sa > sb || (sa === sb && (keys ? keys[ja] < keys[jb] : ja < jb));

/**
 * The k most similar films to a vector, using the inverted index (never all pairs).
 * Positions in, positions out; used by related() and buildGraph().
 * @returns {{ j: number, score: number }[]} best first
 */
export function nearest(index, vec, { self = -1, k = 12, minScore = 0, allow = null } = {}) {
  if (!(k > 0) || !vec.norm) return [];
  const { acc, touched } = index.scratch;
  let nt = 0;
  const { f, w } = vec;
  for (let t = 0; t < f.length; t++) {
    const pf = index.postF[f[t]];
    const pw = index.postW[f[t]];
    const wt = w[t];
    for (let u = 0; u < pf.length; u++) {
      const j = pf[u];
      if (acc[j] === 0) touched[nt++] = j;
      acc[j] += wt * pw[u];
    }
  }
  const top = [];
  try {
    for (let t = 0; t < nt; t++) {
      const j = touched[t];
      if (j === self) continue;
      const nj = index.norms[j];
      if (!nj) continue;
      const s = Math.min(1, acc[j] / (vec.norm * nj));
      if (s < minScore || s <= 0) continue;
      if (allow && !allow(j)) continue;
      if (top.length === k && !better(s, j, top[k - 1].score, top[k - 1].j, index.keys)) continue;
      let p = top.length < k ? top.length : k - 1;
      while (p > 0 && better(s, j, top[p - 1].score, top[p - 1].j, index.keys)) { top[p] = top[p - 1]; p--; }
      top[p] = { j, score: s };
    }
  } finally {
    for (let t = 0; t < nt; t++) acc[touched[t]] = 0; // leave the shared scratch clean even if `allow` throws
  }
  return top;
}

// ---------- reasons ----------

const GROUP_ORDER = ['director', 'collection', 'writer', 'cinematography', 'composer', 'editor', 'basedOn', 'cast', 'theme', 'genre', 'place', 'language'];
const groupOf = (kind) => (kind === 'keyword' || kind === 'subject' ? 'theme' : kind === 'country' ? 'place' : kind);

const joinAnd = (names) => (names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const lc = (s) => (/[A-Z]{2}/.test(s) ? s : s.toLowerCase());

const REASON_TEXT = {
  director: (n) => `Both directed by ${joinAnd(n.slice(0, 2))}`,
  writer: (n) => `Both written by ${joinAnd(n.slice(0, 2))}`,
  cinematography: (n) => `${joinAnd(n.slice(0, 2))} shot both`,
  composer: (n) => `Both scored by ${joinAnd(n.slice(0, 2))}`,
  editor: (n) => `Both edited by ${joinAnd(n.slice(0, 2))}`,
  collection: (n) => `Same series: ${n[0]}`,
  basedOn: (n) => `Both based on ${joinAnd(n.slice(0, 2))}`,
  cast: (n) => `Shared cast: ${n.slice(0, 3).join(', ')}`,
  theme: (n) => `Both about ${joinAnd(n.slice(0, 2).map(lc))}`,
  genre: (n) => `Both are ${joinAnd(n.slice(0, 2).map(lc))} films`,
  place: (n) => `Both from ${joinAnd(n.slice(0, 2))}`,
  language: (n) => `Both in ${joinAnd(n.slice(0, 2))}`,
};

/** Short sentences from the strongest features two vectors share (max `max`). */
export function explain(index, a, b, max = 3) {
  if (!a.norm || !b.norm) return [];
  const groups = new Map();
  let i = 0;
  let j = 0;
  while (i < a.f.length && j < b.f.length) {
    const x = a.f[i];
    const y = b.f[j];
    if (x < y) i++;
    else if (x > y) j++;
    else {
      const id = index.featureIds[x];
      const g = groupOf(featureKind(id));
      const c = (a.w[i] * b.w[j]) / (a.norm * b.norm);
      if (!groups.has(g)) groups.set(g, { g, score: 0, items: [] });
      const grp = groups.get(g);
      grp.score += c;
      grp.items.push({ label: index.featureLabels[x], c });
      i++; j++;
    }
  }
  const ranked = [...groups.values()].sort((p, q) => q.score - p.score || GROUP_ORDER.indexOf(p.g) - GROUP_ORDER.indexOf(q.g));
  return ranked.slice(0, max).map((grp) => {
    if (grp.text) return grp.text;
    const names = grp.items.sort((p, q) => q.c - p.c).map((it) => it.label);
    return REASON_TEXT[grp.g](names);
  });
}

/**
 * Films most like `key`, best first.
 * @param {object} index from buildIndex
 * @param {string} key
 * @param {{ k?: number, filter?: (summary) => boolean }} [opts]
 * @returns {{ key: string, score: number, reasons: string[] }[]}
 */
export function related(index, key, { k = 12, filter } = {}) {
  const i = index.pos.get(key);
  if (i === undefined) return [];
  const vec = vectorAt(index, i);
  const allow = filter ? (j) => !!filter(index.summaries[j]) : null;
  return nearest(index, vec, { self: i, k, allow }).map(({ j, score }) => ({
    key: index.keys[j],
    score,
    reasons: explain(index, vec, vectorAt(index, j)),
  }));
}
