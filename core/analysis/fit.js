// "Fit": how likely the user is to enjoy a film, from the crowd's view of it plus how it feels next to films the user has rated.
// fit = 0.5·z(crowd) + 0.5·z(feelKnn), z-scored over the candidate pool. No year or era input anywhere.
// See docs/DESIGN-discovery.md (Ranking). Pure: the feel index and summaries come in, numbers come out.
import { matineeScore } from './scores.js';
import { scoreIsTiny } from './eligible.js';
import { similar as feelSimilar, profileOf } from './feel/index.js';

export const K = 10;                 // nearest rated films that vote
export const KNN_PRIOR = 0.5;        // added to Σ sim so a lone weak neighbour can't swing the score
export const CAUTION_RATING = 5;     // 2.5 stars on the 1–10 half-star scale
export const CAUTION_SIM = 0.22;     // DECISION: "high" similarity. Real neighbour scores run 0.1-0.3 (top decile about 0.23); fires for roughly 1 in 15 films
export const W_CROWD = 0.5;
export const W_FEEL = 0.5;

const num = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** z-score function for a list of numbers (population sd; flat lists map everything to 0). */
export function zFn(values) {
  const vs = values.filter(v => Number.isFinite(v));
  const m = mean(vs);
  const sd = Math.sqrt(mean(vs.map(v => (v - m) ** 2)));
  return v => (sd > 0 && Number.isFinite(v) ? (v - m) / sd : 0);
}

const isRated = s => !!s?.user?.watched && num(s.user.rating) != null;

/** The crowd number for one film: the Matinee score (it already includes Letterboxd), else computed from its ratings. */
export function crowdOf(s) {
  if (scoreIsTiny(s)) return null; // a score from a handful of votes says nothing (design: tiny-count scores ignored)
  const given = num(s?.score);
  if (given != null) return given;
  return matineeScore(s?.ratings).score;
}

/** What the target film has to go on: viewer text → 'know', critic text → 'fair', nothing but articles → 'guess'. */
export function tierOf(coverage) {
  if (coverage?.viewers > 0) return 'know';
  if (coverage?.critics > 0) return 'fair';
  return 'guess';
}

/**
 * @param {object} o
 * @param {Array} o.summaries film summaries ({ key, score, ratings, user: { watched, rating } }); rating on the 1–10 half-star scale
 * @param {object} o.feel feel index from buildFeelIndex
 * @param {string} [o.today] ISO date; accepted for the callers' benefit, fit itself never looks at dates
 * @param {Array<string>} [o.pool] keys the z-scores are computed over (default: films the user has not rated)
 * @param {Function} [o.similarFn] swap for tests: (index, key, { limit, among }) → [{ key, score }]
 * @param {Function} [o.profileFn] swap for tests: (index, key) → { coverage }
 */
export function buildFit({ summaries = [], feel, today = null, pool = null, similarFn = feelSimilar, profileFn = profileOf } = {}) { // eslint-disable-line no-unused-vars
  const byKey = new Map(summaries.map(s => [s.key, s]));
  const rated = summaries.filter(isRated);
  const ratingOf = new Map(rated.map(s => [s.key, num(s.user.rating)]));
  const ratedKeys = [...ratingOf.keys()];
  const herMean = mean([...ratingOf.values()]);

  const knnCache = new Map();
  function knnOf(key) {
    if (knnCache.has(key)) return knnCache.get(key);
    let out = { knn: 0, neighbours: [] };
    const rows = feel && ratedKeys.length ? similarFn(feel, key, { limit: K, among: ratedKeys.filter(k => k !== key) }) : [];
    const nb = rows.filter(r => ratingOf.has(r.key)).slice(0, K);
    if (nb.length) {
      let num_ = 0, den = 0;
      for (const n of nb) { num_ += n.score * (ratingOf.get(n.key) - herMean); den += n.score; }
      out = { knn: den > 0 ? num_ / (den + KNN_PRIOR) : 0, neighbours: nb.map(n => ({ key: n.key, sim: n.score, rating: ratingOf.get(n.key) })) };
    }
    knnCache.set(key, out);
    return out;
  }

  let zs = null;
  function stats() {
    if (zs) return zs;
    let keys = pool || summaries.filter(s => !isRated(s)).map(s => s.key);
    if (!keys.length) keys = summaries.map(s => s.key);
    const crowds = keys.map(k => crowdOf(byKey.get(k))).filter(v => v != null);
    zs = { crowd: zFn(crowds), feel: zFn(keys.map(k => knnOf(k).knn)) };
    return zs;
  }

  function fit(key) {
    const s = byKey.get(key);
    const st = stats();
    const crowd = s ? crowdOf(s) : null;
    const { knn, neighbours } = knnOf(key);
    const zCrowd = crowd == null ? 0 : st.crowd(crowd);
    const zFeel = st.feel(knn);
    const tier = tierOf(feel ? profileFn(feel, key)?.coverage : null);
    // Article-only films: we know little about how they feel, so the crowd carries the whole score.
    const score = tier === 'guess' ? zCrowd : W_CROWD * zCrowd + W_FEEL * zFeel;
    let caution = null;
    for (const n of neighbours) {
      if (n.rating <= CAUTION_RATING && n.sim >= CAUTION_SIM && (!caution || n.sim > caution.sim)) caution = { key: n.key, rating: n.rating, sim: n.sim };
    }
    if (caution) caution = { key: caution.key, rating: caution.rating };
    return { score, z: { crowd: zCrowd, feel: zFeel }, tier, neighbours, caution, raw: { crowd, knn } };
  }

  /** Keys best fit first (ties by key so the order is stable). */
  function rank(keys) {
    const rows = keys.map(k => [k, fit(k).score]);
    rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return rows.map(r => r[0]);
  }

  return { fit, rank, mean: herMean, ratedCount: ratedKeys.length };
}
