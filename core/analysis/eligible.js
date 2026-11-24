// Hard eligibility for recommendations: what may be suggested at all, before any ranking. Pure.
//
// Reads these summary fields: released ('YYYY-MM-DD', optional), year, kind ('tv' for series/specials), runtime (minutes),
// genres, ratings.{source}.votes / rt.criticsCount etc.
// NOTE: core/api.js summarize() must pass `released` and `kind` through from compose() for the date and TV rules to see data.

import { localDay } from '../util/localday.js';

export const MIN_RUNTIME = 45;
/** Fewer votes than this and a score says nothing. // DECISION: ~25, per the design doc. */
export const MIN_VOTES = 25;

const COUNT_FIELDS = [
  ['imdb', 'votes'], ['letterboxd', 'votes'], ['tmdb', 'votes'],
  ['rt', 'criticsCount'], ['rt', 'audienceCount'], ['metacritic', 'criticsCount'], ['metacritic', 'usersCount'],
];

/** Largest vote/review count behind any rating, or null when no rating carries a count. */
export function maxVotes(s) {
  let best = null;
  for (const [src, f] of COUNT_FIELDS) {
    const n = Number(s?.ratings?.[src]?.[f]);
    if (Number.isFinite(n) && (best === null || n > best)) best = n;
  }
  return best;
}

/** True when the film has ratings with counts, and every count is below the minimum (so the score should be ignored). */
export function scoreIsTiny(s, minVotes = MIN_VOTES) {
  const m = maxVotes(s);
  return m !== null && m < minVotes;
}

// Local calendar day for Dates; ISO strings are taken as written.
const isoDay = (d) => localDay(typeof d === 'string' ? d : d instanceof Date ? d : new Date(d));

/**
 * @param {object} s summary
 * @param {{ today?: Date|string, includeShorts?: boolean, includeTV?: boolean, maxRuntime?: number|null, minVotes?: number }} [o]
 * @returns {boolean}
 */
export function eligible(s, { today = new Date(), includeShorts = false, includeTV = false, maxRuntime = null, minVotes = MIN_VOTES } = {}) {
  if (!s) return false;
  const day = isoDay(today);
  const thisYear = Number(day.slice(0, 4));

  // Released?
  const rel = typeof s.released === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s.released) ? s.released.slice(0, 10) : null;
  if (rel) {
    if (rel > day) return false;
  } else {
    const y = Number(s.year);
    if (Number.isFinite(y) && y > thisYear) return false;
    // This year with no exact date: only trust it once people have rated it.
    if (Number.isFinite(y) && y === thisYear && !((maxVotes(s) ?? 0) >= minVotes)) return false;
  }

  if (!includeTV && s.kind === 'tv') return false;

  const rt = Number(s.runtime);
  const hasRuntime = Number.isFinite(rt) && rt > 0;
  if (!includeShorts) {
    if (hasRuntime && rt < MIN_RUNTIME) return false;
    if ((s.genres || []).some((g) => String(g).toLowerCase() === 'short')) return false;
  }
  if (maxRuntime != null && Number(maxRuntime) > 0) {
    if (!hasRuntime || rt > Number(maxRuntime)) return false;
  }
  return true;
}
