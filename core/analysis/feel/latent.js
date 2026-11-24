// Latent layer: TF-IDF over each film's combined text, reduced to `dims` with a seeded sparse random projection. Pure and deterministic.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Sparse +-1 (Achlioptas, s = 3) row for a token, scaled by sqrt(3). Depends only on token + seed. Kept sparse: only the
 * non-zero places (about a third) and their values, so projecting skips the zeros. Adding w * 0 never changes a sum here
 * (sums start at +0 and every weight is positive), so the result is bit-for-bit the dense one.
 */
const R3 = Math.fround(Math.sqrt(3)); // the value a Float32Array row held
function projectionRow(token, dims, seed) {
  const rnd = mulberry32(hash(token) ^ seed);
  const idx = [], val = [];
  for (let i = 0; i < dims; i++) {
    const u = rnd();
    if (u < 1 / 6) { idx.push(i); val.push(R3); } else if (u < 2 / 6) { idx.push(i); val.push(-R3); }
  }
  return { idx: Uint8Array.from(idx), val: Float32Array.from(val) };
}

// Rows depend only on (token, dims, seed), so they are kept between builds instead of drawn again for every film each time.
const ROW_CACHE = new Map(); // `${dims}:${seed}` -> Map(token -> row)
function rowCache(dims, seed) {
  const k = dims + ':' + seed;
  let m = ROW_CACHE.get(k);
  if (!m) { m = new Map(); ROW_CACHE.set(k, m); }
  return m;
}

function normalise(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  if (s > 0) { const n = 1 / Math.sqrt(s); for (let i = 0; i < v.length; i++) v[i] *= n; }
  return v;
}

/** A token list as counts, in order of first appearance: { terms: string[], counts: number[] }. */
export function termCounts(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return { terms: [...m.keys()], counts: [...m.values()] };
}

const asCounts = (doc) => (Array.isArray(doc) ? termCounts(doc) : doc);

/**
 * The library-wide half of buildLatent: which words count and how much (IDF), and a projector for one film's counts.
 * @param {Array<string[] | {terms: string[], counts: number[]}>} docs  token arrays or term counts (termCounts), one per film
 * @returns {{ dims, vocabSize, project(tokens: string[]): Float32Array, projectCounts(doc): Float32Array }}
 */
export function prepareLatent(docs, opts = {}) {
  const steps = prepareLatentSteps(docs, opts);
  for (;;) { const s = steps.next(); if (s.done) return s.value; }
}

/** prepareLatent as steps: it yields every few films while counting, so a sliced build (feel/index.js) can pause there. */
export function* prepareLatentSteps(docs, { dims = 48, seed = 0x5eed } = {}) {
  dims = Math.max(2, Math.min(64, dims | 0));
  const N = docs.length;
  const df = new Map();
  let n = 0;
  for (const doc of docs) {
    for (const t of asCounts(doc).terms) df.set(t, (df.get(t) || 0) + 1);
    if (++n % 25 === 0) yield;
  }
  const maxDf = Math.max(3, 0.4 * N);
  const idf = new Map();
  for (const [t, c] of df) if (c >= 2 && c <= maxDf) idf.set(t, Math.log(1 + N / c));
  const rows = rowCache(dims, seed);
  // words that left the library are let go once the kept rows clearly outnumber the vocabulary
  if (rows.size > 2 * idf.size + 5000) for (const t of [...rows.keys()]) if (!idf.has(t)) rows.delete(t);
  const row = (t) => { let r = rows.get(t); if (!r) { r = projectionRow(t, dims, seed); rows.set(t, r); } return r; };

  function projectCounts(doc) {
    const { terms, counts } = asCounts(doc);
    const v = new Float32Array(dims);
    for (let j = 0; j < terms.length; j++) {
      const t = terms[j];
      const f = idf.get(t);
      if (f === undefined) continue;
      const w = (1 + Math.log(counts[j])) * f;
      const { idx, val } = row(t);
      for (let k = 0; k < idx.length; k++) v[idx[k]] += w * val[k];
    }
    return normalise(v);
  }
  return { dims, vocabSize: idf.size, projectCounts, project: (tokens) => projectCounts(termCounts(tokens)) };
}

/**
 * @param {Array<string[] | {terms, counts}>} docs  token arrays (or term counts), one per film
 * @returns {{ dims, vecs: Float32Array[], project(tokens: string[]): Float32Array, vocabSize }}
 */
export function buildLatent(docs, opts = {}) {
  const L = prepareLatent(docs, opts);
  const vecs = docs.map(L.projectCounts);
  return { dims: L.dims, vecs, project: L.project, vocabSize: L.vocabSize };
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
