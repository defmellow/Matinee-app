// The Matinee score: one 0–100 number blending every rating we have, plus "your take" helpers.
// Pure functions over plain objects. See PLAN.md 2.4.
//
// ratings shape (core/model.js RATING_SOURCES):
//   imdb: { value 0–10, votes }   letterboxd: { value 0–5, votes }   tmdb: { value 0–10, votes }
//   rt: { critics 0–100, criticsCount, audience 0–100, audienceCount }
//   metacritic: { critics 0–100, criticsCount, users 0–10, usersCount }

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = x => Math.round(x * 10) / 10;

/** Fraction of full weight a rating earns, from how many people are behind it. Unknown count → 0.6. */
function confidence(count, divisor) {
  const c = num(count);
  if (c == null) return 0.6;
  if (c <= 0) return 0.25;
  return clamp(Math.log10(c) / divisor, 0.25, 1);
}
const VOTES = c => confidence(c, 4);   // 10,000 votes → full weight
const CRITICS = c => confidence(c, 2); // 100 reviews → full weight

// Platforms run high or low (IMDb users are kind, RT critics split films into extremes), so a raw average would let
// one source drag every film. Each rating is turned into a z-score against a frozen reference [mean, sd] for that
// source on the 0–100 scale and the z-scores are blended (weighted mean z̄).
// Averaging imperfectly agreeing sources shrinks the spread: with k sources that correlate at RHO, the sd of z̄ is
// shrink(k) = sqrt((1 + (k-1)·RHO) / k) times the sd of one source (1 for one source, about 0.87 for five). So z̄ is
// divided by shrink(k) before it is mapped, which makes a film with several sources as spread out as one with a single
// source (and k = 1 is untouched, so single-source films are never inflated). `evidence` is 1, except for a film with a single
// rating, where it is that rating's confidence (1 with plenty of votes/reviews, down to 0.25):
//   score = round(clamp(CENTRE + SPREAD · z̄ / shrink(k) · evidence, 0, 100)),  k = (Σw)² / Σw²  (the "effective" number of sources)
// The references are committed constants, not computed from any one library, so a film's score does not move when the
// library changes. The score is a crowd-quality number only; nothing here is tuned to their own ratings.
// Every z is measured against ALL films (IMDb: 10k+ votes), and the library sits about +1 z above that, so a film that
// is average across the board scores about CENTRE (34) and the user's median film about 69. That is deliberate: it leaves
// room at the top, where scores used to bunch up around 80. SPREAD is 26 points per z.
const IMDB_MEAN = 65.8, IMDB_SD = 10.1; // films with 10k+ votes, measured from the official IMDb dataset
const RHO = 0.7;                        // how well the sources agree (measured 0.5–0.85 pairwise; 0.7 is the middle)
const CENTRE = 34, SPREAD = 26;         // DECISION: picked from a grid on a real library, see the report; one place to change

/**
 * One row per rating source. `scale` turns the raw number into 0–100; `zeroMeansNone` is true where 0 can't be a
 * real rating (a provider returning 0 means "no votes yet"). `ref` is the frozen [mean, sd] on the 0–100 scale.
 */
const SOURCES = [
  // PROVISIONAL ref and weight: no measured Letterboxd distribution yet. Recalibrate with scripts/recalibrate-score.mjs
  // once real data exists, then raise the weight from 0.7 to 1.0.
  { source: 'letterboxd', label: 'Letterboxd', weight: 0.7, ref: [66, 9], read: r => r.letterboxd?.value, count: r => r.letterboxd?.votes, conf: VOTES, scale: v => v * 20, zeroMeansNone: true, display: v => `Letterboxd ${v.toFixed(2)}` },
  // Measured from the official IMDb dataset (films with 10k+ votes). This is the anchor the others are linked to.
  { source: 'imdb', label: 'IMDb', weight: 1.0, ref: [IMDB_MEAN, IMDB_SD], read: r => r.imdb?.value, count: r => r.imdb?.votes, conf: VOTES, scale: v => v * 10, zeroMeansNone: true, display: v => `IMDb ${v.toFixed(1)}` },
  // Metacritic critics: published distribution (Stephen Follows analysis of Metascores).
  // RT critics: 2018 sample of Tomatometer scores. Wide because RT is a percent of positive reviews, not an average.
  { source: 'rt-critics', label: 'Rotten Tomatoes', weight: 0.6, ref: [50, 29], read: r => r.rt?.critics, count: r => r.rt?.criticsCount, conf: CRITICS, scale: v => v, display: v => `Rotten Tomatoes ${Math.round(v)}%` },
  // Popcornmeter and Metacritic users: linearly linked to IMDb on a real library once (sd = 10.1·sd_src/sd_imdb,
  // m = mean_src − (mean_imdb − 65.8)·sd/10.1), then frozen.
  { source: 'rt-audience', label: 'Popcornmeter', weight: 0.5, ref: [65.2, 18.1], read: r => r.rt?.audience, count: r => r.rt?.audienceCount, conf: VOTES, scale: v => v, display: v => `Popcornmeter ${Math.round(v)}%` },
  { source: 'metacritic', label: 'Metacritic', weight: 0.9, ref: [54, 17], read: r => r.metacritic?.critics, count: r => r.metacritic?.criticsCount, conf: CRITICS, scale: v => v, zeroMeansNone: true, display: v => `Metacritic ${Math.round(v)}` },
  { source: 'metacritic-users', label: 'Metacritic users', weight: 0.4, ref: [63.7, 13.3], read: r => r.metacritic?.users, count: r => r.metacritic?.usersCount, conf: VOTES, scale: v => v * 10, zeroMeansNone: true, display: v => `Metacritic users ${v.toFixed(1)}` },
  // PROVISIONAL ref: no measured TMDB distribution yet. Recalibrate with scripts/recalibrate-score.mjs.
  { source: 'tmdb', label: 'TMDB', weight: 0.4, ref: [65, 9], read: r => r.tmdb?.value, count: r => r.tmdb?.votes, conf: VOTES, scale: v => v * 10, zeroMeansNone: true, display: v => `TMDB ${v.toFixed(1)}` },
];

/** Read-only view of the source table, for scripts/recalibrate-score.mjs. */
export const SCORE_SOURCES = SOURCES.map(s => ({ ...s }));

/**
 * Blend every available rating into one 0–100 score.
 * Each rating becomes a z-score against its source's frozen reference; the z-scores are averaged with weight
 * = base weight × a confidence that grows with the number of votes/reviews, then rescaled for the shrink from averaging (see above) and mapped onto 0–100.
 * @param {object|null} ratings composed `film.ratings`
 * @returns {{ score: number|null, parts: Array<{source:string,label:string,display:string,value100:number,weight:number}> }}
 *   `value100` is the raw 0–100 value; `weight` is the effective weight (base × confidence), 3 decimals.
 */
export function matineeScore(ratings) {
  const r = ratings || {};
  const parts = [];
  let sum = 0, weights = 0, weightsSq = 0, base = 0;
  for (const s of SOURCES) {
    const raw = num(s.read(r));
    if (raw == null || raw < 0 || (raw === 0 && s.zeroMeansNone)) continue;
    const value = clamp(s.scale(raw), 0, 100);
    const weight = s.weight * s.conf(s.count(r));
    sum += ((value - s.ref[0]) / s.ref[1]) * weight;
    weights += weight; weightsSq += weight * weight; base += s.weight;
    parts.push({ source: s.source, label: s.label, display: s.display(raw), value100: round1(value), weight: Math.round(weight * 1000) / 1000 });
  }
  if (!(weights > 0)) return { score: null, parts };
  const k = (weights * weights) / weightsSq; // effective number of sources, 1 when one source carries it all
  // One rating on very little evidence (a handful of votes or reviews) is pulled toward CENTRE instead of trusted.
  const evidence = parts.length === 1 ? weights / base : 1;
  const zNorm = (sum / weights / Math.sqrt((1 + (k - 1) * RHO) / k)) * evidence;
  return { score: Math.round(clamp(CENTRE + SPREAD * zNorm, 0, 100)), parts };
}

/**
 * Your rating (1–10 half-stars) minus the score, on a 0–100 scale. Positive = you liked it more than the crowd.
 * @returns {number|null}
 */
export function yourTake(userRating, score) {
  const u = num(userRating), s = num(score);
  if (u == null || s == null) return null;
  return u * 10 - s;
}

/**
 * The films you rated furthest above and below the crowd.
 * Only watched films with a rating and a score count. Ties break on title, then key.
 * @returns {{ higher: Array<{key:string,diff:number}>, lower: Array<{key:string,diff:number}> }}
 */
export function hotTakes(summaries, { n = 10 } = {}) {
  const rows = [];
  for (const s of summaries || []) {
    if (!s?.user?.watched) continue;
    const diff = yourTake(s.user.rating, s.score);
    if (diff == null) continue;
    rows.push({ key: s.key, diff, title: String(s.title || '') });
  }
  const byTitle = (a, b) => a.title.localeCompare(b.title) || String(a.key).localeCompare(String(b.key));
  const strip = ({ key, diff }) => ({ key, diff });
  const limit = Math.max(0, n);
  const higher = rows.filter(r => r.diff > 0).sort((a, b) => b.diff - a.diff || byTitle(a, b)).slice(0, limit).map(strip);
  const lower = rows.filter(r => r.diff < 0).sort((a, b) => a.diff - b.diff || byTitle(a, b)).slice(0, limit).map(strip);
  return { higher, lower };
}
