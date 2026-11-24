// Fetch progress for people: percent done per kind of detail, and a rough "time left".
// Pure helpers over data the app already has (which films each source has checked); no network calls.
import { wantsFor, isRefresh } from './enrich.js';
import { siteForHost, siteForProvider } from './fetchlog.js';

// Every source sits in exactly one group, so the percentages never count a film twice.
// Judgement calls: wikipedia is the covers source (poster + synopsis); tmdb (needs a key) is counted with details;
// lbpage is counted with reviews (its crowd themes and popular reviews), although it also gives the Letterboxd score;
// rt counts as ratings (its consensus line is a small extra). Sources not listed here are left out of the bars.
export const CATEGORIES = [
  { id: 'covers', label: 'Covers', providers: ['wikipedia'] },
  { id: 'details', label: 'Details', providers: ['boxd', 'wikidata', 'tmdb', 'wikicats', 'allmovie'] },
  { id: 'reviews', label: 'Reviews', providers: ['lbpage', 'mcreviews', 'imdbpage'] },
  { id: 'ratings', label: 'Ratings', providers: ['imdb', 'rt', 'metacritic', 'omdb'] },
];

const MIN = 6e4, HOUR = 36e5;

/** "a few minutes", "about 20 minutes", "about 3 hours"; null while we can't tell. */
export function formatEta(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < MIN) return 'less than a minute';
  if (ms < 5 * MIN) return 'a few minutes';
  if (ms < 90 * MIN) { const m = Math.round(ms / MIN / 5) * 5; return m >= 60 ? 'about an hour' : `about ${m} minutes`; }
  const h = Math.round(ms / HOUR);
  if (h >= 48) return 'more than 2 days';
  return `about ${h} hours`;
}

/**
 * Remembers when each source finished a film, so the rate can be measured over a rolling window.
 * rate(id) is films per millisecond, or null until there are enough recent samples to trust.
 */
export function createRateTracker({ windowMs = 5 * MIN, minSamples = 5, minSpanMs = 15e3, now = Date.now } = {}) {
  const times = new Map(); // provider id -> ascending completion times
  const recent = id => {
    const cut = now() - windowMs;
    const list = (times.get(id) || []).filter(t => t >= cut);
    times.set(id, list);
    return list;
  };
  return {
    note(id, count = 1) { const t = now(), list = times.get(id) || []; for (let i = 0; i < count; i++) list.push(t); times.set(id, list); },
    rate(id) {
      const list = recent(id);
      if (list.length < minSamples) return null;
      const span = now() - list[0];
      return span < minSpanMs ? null : list.length / span;
    },
    reset() { times.clear(); },
  };
}

// Rough seconds per film for a source that has not finished enough films to measure yet. From each site's pacing (core/net.js)
// plus a typical page time; only used until a measured rate exists, so the estimate can appear as soon as a run starts.
export const GUESS_SECONDS = { boxd: 0.3, wikidata: 0.25, tmdb: 0.1, omdb: 0.4, wikipedia: 0.5, wikicats: 0.5, lbpage: 3.5, rt: 2.5, metacritic: 2.5, mcreviews: 3, imdbpage: 8, allmovie: 4, imdb: 0 };
// These run one after the other (ids first), so their times add up; everything else runs alongside.
const ID_STAGE = ['boxd', 'wikidata', 'tmdb'];

/**
 * Time left = the slowest source, with the id-finding sources (which run in turn) added together.
 * A source's measured rate is used when there is one, else a rough guess for that site (guessMsOf, ms per film), so the answer is
 * null only when nothing waiting has either. Sources with no films waiting are ignored.
 * @param {Record<string, number>} pending  films still to do, by provider id (zeros ignored)
 * @param {(id: string) => number | null} rateOf  measured films per millisecond
 * @param {(id: string) => number | null} [guessMsOf]
 */
export function etaMs(pending, rateOf, guessMsOf = () => null) {
  let worst = 0, any = false, rated = false, idMs = 0;
  for (const [id, n] of Object.entries(pending)) {
    if (!(n > 0)) continue;
    any = true;
    const r = rateOf(id);
    const per = r ? 1 / r : guessMsOf(id);
    if (per == null || !Number.isFinite(per)) continue;
    rated = true;
    if (ID_STAGE.includes(id)) idMs += n * per; else worst = Math.max(worst, n * per);
  }
  if (!any) return 0;
  return rated ? Math.max(worst, idMs) : null;
}

/** Group per-source counts into the percent bars. stats: [{ id, total, pending }] */
export function categoryProgress(stats) {
  const byId = new Map(stats.map(s => [s.id, s]));
  const cats = [];
  for (const c of CATEGORIES) {
    let total = 0, left = 0;
    for (const id of c.providers) { const s = byId.get(id); if (s) { total += s.total; left += Math.min(s.pending, s.total); } }
    if (!total) continue; // no source in this group is on (or has anything to do)
    const done = total - left;
    cats.push({ id: c.id, label: c.label, done, total, percent: Math.floor((done / total) * 100) });
  }
  const total = cats.reduce((n, c) => n + c.total, 0), done = cats.reduce((n, c) => n + c.done, 0);
  return { categories: cats, percent: total ? Math.floor((done / total) * 100) : 100, complete: cats.every(c => c.done >= c.total) };
}

/**
 * Everything getState needs: bars, overall percent, and the time-left sentence while a run is going.
 * Only first-time work counts (a source's films that have never been checked); quiet re-reads are not progress. Films a source has
 * failed on count as done (they are only retried quietly, and are listed as waiting); films whose site is being left alone (paused,
 * breaker, human check) are `waiting`: they keep the bar honest (not done) but are left out of the time left, which would otherwise be huge.
 * @param {{ host: string, state: string, checkUntil?: number }[]} [o.hostStatus]  from http.hostStatus()
 */
export function computeProgress({ store, providers, tracker, running = false, now = Date.now(), hostStatus = [] }) {
  const settings = store.library.settings || {};
  const films = Object.values(store.films);
  const blockedSites = new Set(hostStatus.filter(h => h.state !== 'ok' || h.checkUntil > 0).map(h => siteForHost(h.host)));
  const stats = [], waitingFilms = new Set(), waitingBy = {};
  for (const p of providers) {
    if (p.enabled && !p.enabled(settings)) continue;
    const eligible = p.requires ? films.filter(f => p.requires(f)) : films;
    const siteDown = blockedSites.has(siteForProvider(p.id, p.label));
    let pending = 0, waiting = 0;
    for (const f of eligible) {
      if (isRefresh(p, f) || !wantsFor(p, f, { now, full: false, ignoreBackoff: true })) continue;
      // A film this source has failed on is parked: it counts as done here (the quiet pass retries it later), so a film that keeps failing
      // can never hold the bar below 100% for good. A site being left alone is temporary, so its films stay pending.
      if (f.failed?.[p.id]) { waitingFilms.add(f.key); continue; }
      pending++;
      if (siteDown) { waiting++; waitingFilms.add(f.key); }
    }
    waitingBy[p.id] = waiting;
    stats.push({ id: p.id, total: eligible.length, pending });
  }
  const out = categoryProgress(stats);
  const grouped = new Set(CATEGORIES.flatMap(c => c.providers));
  const pendingById = Object.fromEntries(stats.filter(s => grouped.has(s.id)).map(s => [s.id, s.pending - (waitingBy[s.id] || 0)]));
  const guess = id => (id in GUESS_SECONDS ? GUESS_SECONDS[id] * 1000 : null);
  const ms = out.complete ? 0 : etaMs(pendingById, id => tracker.rate(id), guess);
  const waiting = waitingFilms.size;
  const workLeft = Object.values(pendingById).some(n => n > 0);
  const etaText = out.complete || !running ? null : !workLeft ? null : (formatEta(ms) || 'working it out…');
  return {
    ...out, running, etaMs: ms, etaText, waiting,
    waitingText: waiting ? `${waiting} ${waiting === 1 ? 'film is' : 'films are'} waiting to be tried again later` : null,
  };
}
