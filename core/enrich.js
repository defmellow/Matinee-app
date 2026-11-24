// Runs providers over the films that need them. Providers are independent plug-ins (see providers/index.js).
import { NO_PROBLEMS, filmLabel } from './problems.js';
import { siteForProvider, siteForHost, describeData, cleanText } from './fetchlog.js';
const DAY = 864e5, HOUR = 36e5;
// Page-reading sources are fetched one at a time with a pause between pages; never loosened (see net.js).
// Sources that only feed the feel engine; their requests sit in the last lane.
// DECISION: wikicats, mcreviews, imdbpage and allmovie count as feel extras (lane 4) in the background pass.
const FEEL_EXTRAS = new Set(['wikicats', 'mcreviews', 'imdbpage', 'allmovie']);
// The critic sites' score pages also sit in the last lane while OMDb is on: OMDb gives the critics scores at once, the pages add the rest later.
const CRITIC_PAGES = new Set(['rt', 'metacritic']);
// The first stage finds ids that other sources depend on; LATE sources wait until Wikipedia's pass over every film is finished.
const ID_STAGE = new Set(['boxd', 'wikidata', 'tmdb']);
const LATE = new Set(['imdbpage', 'mcreviews']);
const STRICT_PACING = new Set(['rt', 'metacritic', 'mcreviews', 'lbpage', 'imdbpage', 'allmovie']);
const BLOCKS_IN_A_ROW = 3; // failed reads in a row (across waves) after which a polite-pacing source is left alone for this run

// ---------- how often films are read again (29 Oct) ----------
// Re-reads are slow and sparing: little changes after a film has been out for a while. Films that are in cinemas or about to open
// are the exception (ratings and cinema dates move), so they come first in the quiet queue and are read again more often.
// One place to tune it. Days are between reads of the same source for the same film; a source's own refreshDays never makes
// a hot film wait longer, and never makes an older film go faster than this table.
export const REREAD = {
  hotFromDays: -60,   // released up to 60 days ago ...
  hotToDays: 190,     // ... or opening in the next ~6 months (what Upcoming lists)
  recentDays: 365,    // released within the last year, else settled
  ratingsSources: new Set(['lbpage', 'rt', 'metacritic', 'omdb', 'tmdb']), // scores move; the IMDb ratings file is one download, so it keeps its own rule
  days: {
    hot:     { ratings: 4,  other: 14 },
    recent:  { ratings: 30, other: 90 },
    settled: { ratings: 90, other: 365 },
  },
  // A film the user opens is checked sooner than the quiet pass would get to it: a source is read again once its data is older than
  // this share of the days above. Same table, so an old film is never re-read just because one source had a short fixed interval.
  openShare: 0.5,
};

const isoDay = v => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

/** Release dates we hold for a film (ms, UTC midnight): the Australian cinema date first, their own country's from TMDB, then the world release date. */
export function releaseDates(film) {
  const src = film.src || {};
  return [src.lbpage?.ausRelease?.date, src.tmdb?.regionRelease?.date, src.tmdb?.released, src.wikidata?.released, src.lbpage?.released].map(isoDay).filter(t => t != null);
}

const phaseMemo = new WeakMap(); // film -> { day, phase }
/** 'hot' (in cinemas or opening soon) | 'recent' (out within the last year) | 'settled' (everything else, or no date known). */
export function releasePhase(film, now = Date.now()) {
  const day = Math.floor(now / DAY), memo = phaseMemo.get(film);
  if (memo && memo.day === day && memo.stamp === film.checked?.lbpage) return memo.phase;
  const dates = releaseDates(film);
  const away = dates.map(t => (t - now) / DAY); // days from now; negative = already out
  let phase = 'settled';
  if (away.some(d => d >= REREAD.hotFromDays && d <= REREAD.hotToDays)) phase = 'hot';
  else if (away.some(d => d < REREAD.hotFromDays && d >= -REREAD.recentDays)) phase = 'recent';
  else if (!away.length && Number(film.year) >= new Date(now).getUTCFullYear() - 1) phase = 'recent'; // no date yet, but a new film
  phaseMemo.set(film, { day, phase, stamp: film.checked?.lbpage });
  return phase;
}

/** Days before this source reads this film again. */
export function rereadDays(provider, film, now = Date.now()) {
  const phase = releasePhase(film, now);
  const kind = REREAD.ratingsSources.has(provider.id) ? 'ratings' : 'other';
  const days = REREAD.days[phase][kind];
  return phase === 'hot' ? days : Math.max(days, provider.refreshDays ?? 0);
}

/**
 * Days before a source is read again for a film the user has OPENED (or a full refresh). One timetable for everything (11 Nov):
 * the quiet pass's days for this film's age, shortened by REREAD.openShare because the user is looking at it.
 * Before this, opening a film re-read any source older than that source's own fixed `refreshDays`, whatever the film's age.
 * Rotten Tomatoes and Metacritic had the shortest (14 days), so they were fetched again on nearly every film the user opened,
 * including films decades old whose scores no longer move, while every other source sat untouched.
 * Opened: hot film 2 days (scores) / 7 (other); out under a year 15 / 45; older 45 or more / 6 months or more.
 */
export function openDays(provider, film, now = Date.now()) {
  return Math.max(1, rereadDays(provider, film, now) * REREAD.openShare);
}

/** When this source last looked at the film: a result that changed it, or a re-read that found nothing new (`reread`). */
export const lastLook = (film, id) => Math.max(Date.parse(film.checked?.[id]) || 0, Date.parse(film.reread?.[id]) || 0);

/**
 * Default "does this film need this provider now?" rule, used unless a provider defines wants().
 * `full` = also read films older than the source's own refreshDays. `reread` (the quiet pass) = also read films that are due again
 * by the REREAD table above, which replaces refreshDays there.
 */
export function defaultWants(provider, film, { now = Date.now(), full = false, reread = false } = {}) {
  if (provider.requires && !provider.requires(film)) return false;
  const checked = film.checked?.[provider.id];
  if (!checked) return true;
  const age = now - lastLook(film, provider.id);
  // A provider that starts storing more (provider.since = ISO date) gets re-run once for films last looked at before that.
  if (provider.since && Date.parse(provider.since) <= now && !film.missed?.[provider.id] && lastLook(film, provider.id) < Date.parse(provider.since)) return true;
  // A source whose reader was broken for a while (provider.retryMissSince = ISO date) retries, once, films it found nothing for before that date.
  if (film.missed?.[provider.id] && provider.retryMissSince && Date.parse(provider.retryMissSince) <= now && lastLook(film, provider.id) < Date.parse(provider.retryMissSince)) return true;
  if (film.missed?.[provider.id]) return age > (provider.retryMissDays ?? 30) * DAY;
  if (reread) return age > rereadDays(provider, film, now) * DAY;
  // One big download for every film (the IMDb ratings file) keeps its own rule; everything else follows the film's age.
  return full && age > (provider.bulk ? provider.refreshDays ?? 30 : openDays(provider, film, now)) * DAY;
}

/** How long a film waits after its n-th lookup failure in a row before it is tried again: 1 h, 6 h, 1 day, then 3 days. */
export const backoffMs = n => [HOUR, 6 * HOUR, DAY, 3 * DAY][Math.min(Math.max(n | 0, 1), 4) - 1];

/** True while this film's last failure with this provider is recent enough that it should be left alone. */
export function isBackingOff(film, providerId, now = Date.now()) {
  const f = film.failed?.[providerId];
  if (!f) return false;
  const at = Date.parse(f.at);
  return Number.isFinite(at) && now - at < backoffMs(f.n);
}

// ---------- sources that another source already covers (29 Oct, TMDB / OMDb keys) ----------
// A slow page source is left out of a run when a key source already supplied what that run is for. This lives in wantsFor so every
// "does anything still want this film?" check (pending work, the quiet pass, the film page's status) agrees with it.
// "Urgent lanes" means lanes 1 and 2 (a film the user hovers over or can see); a film the user opened (lane 0) and a force read always read everything,
// and the background crawl (lanes 3 and 4) still reads every source, just later, so no source loses data.
// DECISION: wikipedia (poster + synopsis) is left out of the urgent lanes when TMDB holds both. rt and metacritic, when OMDb holds the matching
// critics score, are left out of the urgent lanes and of the quiet re-read (except for films in cinemas or opening soon), but the background crawl
// reads them once for every film, in the last lane (11 Nov). From 29 Oct to 11 Nov they were read only when a film was opened, which meant a
// film's Matinee score and feel depended on whether the user had clicked it: only these pages hold the audience and user scores and the review
// counts (they move the Matinee score by 2 or more points on 210 of a real 691-film library) and the critics' consensus line (it feeds 235 feel chips).
// The IMDb keyword page needs a change inside imdbpage.js (see coveredKeywords below).
const URGENT_LANES = new Set([1, 2]);
const hasPosterAndSynopsis = d => !!(d && d.poster && d.synopsis);
/** A short reason (for the film page) when `provider` can be left out of this read because another source covers it, else null. */
export function coveredBy(provider, film, { lane = null, reread = false, force = null, now = Date.now() } = {}) {
  if (force) return null;
  const urgent = lane != null && URGENT_LANES.has(lane);
  const omdb = film.src?.omdb?.ratings || {};
  if (provider.id === 'wikipedia' && urgent && hasPosterAndSynopsis(film.src?.tmdb)) return 'TMDB already has the poster and synopsis';
  // Films in cinemas or opening soon ('hot') keep their quiet re-read: their critics scores move, and RT/Metacritic rank ahead of OMDb in the shown score.
  // OMDb comes first for the critic scores (29 Oct), so what the user sees first never waits on the critic sites' own pages.
  // lane null = the background crawl, which reads them (last lane, see laneFor); lanes 1-3 never wait on them.
  const quiet = reread ? releasePhase(film, now) !== 'hot' : lane != null && lane !== 0;
  if (provider.id === 'rt' && quiet && omdb.rt?.critics != null) return 'OMDb already has the critics score';
  if (provider.id === 'metacritic' && quiet && omdb.metacritic?.critics != null) return 'OMDb already has the critics score';
  return null;
}
/** True when TMDB's keywords already stand in for the IMDb keyword page (provided to providers as ctx.keywordsCovered). */
export const coveredKeywords = film => (film.src?.tmdb?.keywords?.length || 0) >= 10;

/** "Does this provider want this film now?" including failure backoff (ignoreBackoff is for a film the user has opened). */
export function wantsFor(provider, film, { now = Date.now(), full = false, reread = false, ignoreBackoff = false, probe = provider, force = null, lane = null } = {}) {
  // `force` (a film's own page asking for specific sources) reads those sources whatever their freshness, as long as they can run.
  if (force && (force === true || force.has(provider.id))) return !(probe.requires && !probe.requires(film));
  if (coveredBy(provider, film, { lane, reread, force, now })) return false;
  if (!ignoreBackoff && isBackingOff(film, provider.id, now)) return false;
  return provider.wants ? provider.wants(film, { now, full, reread }) : defaultWants(probe, film, { now, full, reread });
}

/**
 * A bulk provider (one big download whatever the film count, e.g. IMDb's ratings file) waits until enough films want it,
 * unless its last download is old. The time of the last download lives in cache.json (see runProvider).
 */
export function bulkReady(provider, wantCount, store, now = Date.now()) {
  const b = provider.bulk;
  if (!b || wantCount >= b.minFilms) return true;
  const last = typeof store.cached === 'function' ? store.cached(b.cacheKey, b.minGapMs) : undefined;
  return last === undefined;
}

/** True when something other than the page just read says this film has a score on that site: OMDb's copy, or the source's own earlier read. */
export function scoreExpected(provider, film) {
  const key = provider.id === 'rt' ? 'rt' : provider.id === 'metacritic' ? 'metacritic' : null;
  if (!key) return true; // other sources keep the plain rule
  const has = r => !!r && Object.values(r).some(v => v != null && v !== false);
  return has(film.src?.omdb?.ratings?.[key]) || has(film.src?.[provider.id]?.ratings?.[key]);
}

/** True when this film already has a result from the provider, so another read is a refresh, not first-time work. */
export const isRefresh = (provider, film) => !!film.checked?.[provider.id];

/** True when some enabled provider still has a film it has never checked (refresh work waits until this is false). */
export function hasFirstTimeWork({ store, providers, only = null, now = Date.now(), http = null }) {
  const settings = store.library.settings || {};
  const pool = only ? only.map(k => store.films[k]).filter(Boolean) : Object.values(store.films);
  return providers.some(p => {
    if (p.enabled && !p.enabled(settings)) return false;
    // A site that is being left alone (paused, breaker, human check) has first-time work, but it cannot be done now and must not
    // hold the quiet re-reads of everything else.
    if (http && blockedHost(http, p)) return false;
    const n = pool.filter(f => !isRefresh(p, f) && wantsFor(p, f, { now, full: false })).length;
    return n > 0 && bulkReady(p, n, store, now);
  });
}

/** True when some enabled provider still has films to look up (new sources, or films never checked). */
export function hasPendingWork({ store, providers, now = Date.now() }) {
  const settings = store.library.settings || {};
  const films = Object.values(store.films);
  const wantCount = p => films.filter(f => wantsFor(p, f, { now, full: false })).length;
  return providers.some(p => {
    if (p.enabled && !p.enabled(settings)) return false;
    if (!p.bulk) return films.some(f => wantsFor(p, f, { now, full: false }));
    const n = wantCount(p);
    return n > 0 && bulkReady(p, n, store, now);
  });
}

// ---------- trouble notices and the fetch log the user can hand over ----------
const HOLLOW_UNSURE = 0.25; // what a score-less page counts for when nothing says the film has a score there
const HOLLOW_LIMIT = 5, STREAK_LIMIT = 20, PAUSE_LIMIT_MS = 30 * 60 * 1000, NOTIFY_GAP_MS = 6 * HOUR;
const PAGE_PROVIDERS = new Set(['imdbpage', 'lbpage', 'rt', 'metacritic', 'mcreviews', 'allmovie']);
const clockText = ms => { const d = new Date(ms); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const LOG_HINT = 'Turn on Debug mode in Settings → Debug for a log you can copy.';

/**
 * Remembers recent fetch events (last `max`) and works out when to tell the user something is wrong.
 * A notice appears when a source fails for 20 films in a row, a site's breaker opens, or a site stays paused over 30 minutes;
 * it clears when the source works again. `emit('trouble', notice)` fires once per notice, then at most once per 6 hours per key.
 * @param {{ now?: () => number, emit?: Function, onChange?: Function, max?: number, hostStatus?: (() => Array)|null }} o
 */
export function createTrouble({ now = Date.now, emit = () => {}, onChange = () => {}, max = 300, hostStatus = null } = {}) {
  let events = [];
  const streaks = new Map();   // provider id -> consecutive failed films
  const hollows = new Map();   // provider id -> consecutive released films whose page loaded but had no scores
  const paused = new Map();    // host -> { site, since, until }
  const active = new Map();    // key -> { key, site, message, since }
  const breakers = new Set();  // sites whose breaker is open
  const checks = new Map();    // site -> time the check notice stops applying (a window the user may not have noticed, or a missed check)
  const notified = new Map();  // key -> time of the last 'trouble' event
  const record = ({ site = '', provider = '', outcome, reason = '', title = '' }) => {
    events.push({ t: now(), site: cleanText(site, 40), provider, outcome, reason: cleanText(reason, 100), title: cleanText(title, 80) });
    if (events.length > max) events = events.slice(events.length - max);
  };
  const activate = (key, site, message) => {
    const have = active.get(key);
    if (have) { if (have.message !== message) { have.message = message; onChange(); } return; }
    const entry = { key, site, message, since: new Date(now()).toISOString() };
    active.set(key, entry);
    const last = notified.get(key);
    if (last === undefined || now() - last >= NOTIFY_GAP_MS) { notified.set(key, now()); emit('trouble', { ...entry }); }
    onChange();
  };
  const clear = key => { if (active.delete(key)) onChange(); };
  const hostMessage = (site, until, kind) => {
    const when = until && until > now() ? `It will try again around ${clockText(until)}.` : 'It will try again soon.';
    return kind === 'paused' ? `${site} has asked Matinee to slow down. ${when}` : `${site} isn't answering at the moment. ${when}`;
  };
  const clearSite = site => { breakers.delete(site); for (const [h, v] of paused) if (v.site === site) paused.delete(h); clear('host:' + site); };

  const api = {
    /**
     * A source recorded a film (even "nothing found"): it is working. `gotData` is true when it actually returned data; only then does
     * a "pages load but have no scores" streak end. A plain miss (the site has no such film) neither counts nor resets it.
     */
    ok(provider, title = '', { gotData = false } = {}) {
      const site = siteForProvider(provider.id, provider.label);
      record({ site, provider: provider.id, outcome: 'ok', title });
      streaks.delete(provider.id); clear('provider:' + provider.id); clearSite(site);
      if (gotData) { hollows.delete(provider.id); clear('hollow:' + provider.id); }
    },
    /**
     * A page loaded for a released film but Matinee found no scores on it. Enough of those in a row suggests the site changed.
     * `expected` = something else says this film has a score there (OMDb's copy of it, or this source's own earlier read): such a
     * page counts in full, five in a row raise the notice. A film nothing else has a score for is most likely just too small for
     * the site to score, so it counts for a quarter (twenty in a row). Before 12 Nov every hollow page counted in full, and a
     * batch of small films read back to back (a retry of earlier misses) raised "the site may have changed" on a healthy site.
     */
    hollow(provider, title = '', { expected = true } = {}) {
      const site = siteForProvider(provider.id, provider.label);
      record({ site, provider: provider.id, outcome: 'hollow', reason: 'page had nothing usable', title });
      streaks.delete(provider.id); clear('provider:' + provider.id); clearSite(site); // the site did answer
      const n = (hollows.get(provider.id) || 0) + (expected ? 1 : HOLLOW_UNSURE);
      hollows.set(provider.id, n);
      if (n >= HOLLOW_LIMIT) activate('hollow:' + provider.id, site, `${site} pages load, but Matinee couldn't find the scores on them for a run of films that should have them. The site may have changed. ${LOG_HINT}`);
    },
    /** A lookup for one film failed. Stopped runs and paused sites say nothing about the film or the source. */
    fail(provider, title = '', error = null) {
      const site = siteForProvider(provider.id, provider.label);
      const code = error && error.code;
      const reason = error && error.status ? `HTTP ${error.status}` : code || (error && error.message) || 'no answer';
      if (code === 'aborted' || code === 'quiet') return;
      if (code === 'host-paused') { record({ site, provider: provider.id, outcome: 'paused', reason: 'site paused, will try later', title }); return; }
      record({ site, provider: provider.id, outcome: 'failed', reason, title });
      const n = (streaks.get(provider.id) || 0) + 1;
      streaks.set(provider.id, n);
      if (n >= STREAK_LIMIT) {
        const what = PAGE_PROVIDERS.has(provider.id) ? `${site} pages haven't loaded` : `${site} lookups haven't gone through`;
        activate('provider:' + provider.id, site, `${what} for the last ${STREAK_LIMIT} films. Matinee keeps trying quietly. ${LOG_HINT}`);
      }
    },
    /** From http.observe: { host, kind: 'paused' | 'breaker-open' | 'breaker-closed', until, text } */
    observe(n) {
      if (!n || !n.host || !['paused', 'breaker-open', 'breaker-closed', 'check', 'check-cleared', 'check-missed'].includes(n.kind)) return;
      const site = siteForHost(n.host);
      record({ site, outcome: n.kind, reason: n.text || '' });
      // A human check: a window opened for the user (or the user did not complete it). Completing it clears the notice and the site's trouble.
      if (n.kind === 'check' || n.kind === 'check-missed') { checks.set(site, n.kind === 'check' ? now() + 5 * 60_000 : (n.until || now() + 10 * 60_000)); activate('check:' + site, site, n.kind === 'check' ? `${site} is asking you to check you're human. A window has opened so you can do that.` : (n.text || `${site} still needs a human check.`)); return; }
      if (n.kind === 'check-cleared') { checks.delete(site); clear('check:' + site); clearSite(site); return; }
      if (n.kind === 'paused') { const have = paused.get(n.host); paused.set(n.host, { site, since: have ? have.since : now(), until: n.until || (have && have.until) || 0 }); }
      else if (n.kind === 'breaker-open') { breakers.add(site); activate('host:' + site, site, hostMessage(site, n.until, 'open')); }
      else { paused.delete(n.host); breakers.delete(site); clear('host:' + site); }
      api.check();
    },
    /** Re-evaluates sites that have been paused for a long time, and forgets ones that have recovered. */
    check() {
      for (const [site, until] of [...checks]) if (until <= now()) { checks.delete(site); clear('check:' + site); } // an old check notice goes away by itself
      const status = hostStatus ? hostStatus() : null;
      for (const [host, v] of [...paused]) {
        const st = status && status.find(h => h.host === host);
        if (status && (!st || st.state === 'ok')) { paused.delete(host); if (!breakers.has(v.site)) clear('host:' + v.site); continue; }
        if (now() - v.since > PAUSE_LIMIT_MS) activate('host:' + v.site, v.site, hostMessage(v.site, st && st.until || v.until, 'paused'));
      }
    },
    /** A notice from outside the fetch flow (e.g. a cinema site that has failed for days). Same once-per-6-hours 'trouble' event. */
    raise(key, site, message) { activate(key, site, message); },
    /** Takes such a notice away again. */
    resolve(key) { clear(key); },
    /** True while a site is asking for a human check (so a failed read there is a "check page", not a mystery). */
    hasCheck(site) { return (checks.get(site) || 0) > now(); },
    /** [{ key, site, message, since }] for getState(). */
    list() { api.check(); return [...active.values()].map(e => ({ ...e })); },
    /** The recent events as plain text, newest last, ready to paste. */
    text() {
      const head = 'Matinee fetch log (newest last, times in UTC)';
      if (!events.length) return head + '\nNothing has been fetched yet in this session.';
      return head + '\n' + events.map(e => `${new Date(e.t).toISOString().replace('T', ' ').slice(0, 19)}  ${e.site || '-'}${e.provider ? ' / ' + e.provider : ''}  ${e.outcome}${e.title ? '  ' + e.title : ''}${e.reason ? '  (' + e.reason + ')' : ''}`).join('\n');
    },
  };
  return api;
}

// ---------- what happened to one source for one film (the film page's "failed N sources" pill) ----------
/** A thinner re-read never blanks what is stored: values the new result lacks (null, empty text, empty lists) keep their old value. */
const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
export function keepRicher(old, data) {
  const plain = o => o && typeof o === 'object' && !Array.isArray(o);
  if (!plain(old) || !plain(data)) return data;
  const out = { ...old };
  for (const [k, v] of Object.entries(data)) if (!isEmpty(v)) out[k] = v;
  return out;
}

/** The first host of this provider's site that is not simply "ok" (paused, left alone, or waiting for a human check), else null. */
function blockedHost(http, p) {
  if (!http || typeof http.hostStatus !== 'function') return null;
  const site = siteForProvider(p.id, p.label);
  try { return http.hostStatus().find(h => siteForHost(h.host) === site && (h.state !== 'ok' || h.checkUntil > 0)) || null; } catch { return null; }
}

/**
 * { deferred, reason }: deferred = the site is being left alone (slow-down pause, breaker, check), which says nothing about the film,
 * so it is not counted towards failure backoff. Reasons are short plain English for the film page.
 */
export function classifyFailure(p, error, http = null, trouble = null) {
  const site = siteForProvider(p.id, p.label), code = error && error.code, status = error && error.status, msg = String((error && error.message) || '');
  if (code === 'quiet') return { deferred: true, reason: 'left for a full refresh' };
  const host = blockedHost(http, p);
  if ((trouble && typeof trouble.hasCheck === 'function' && trouble.hasCheck(site)) || (host && (host.checkUntil > 0 || host.reason === 'challenge'))) return { deferred: true, reason: `${site} is showing a check page` };
  if (host && host.state === 'open') return { deferred: true, reason: `${site} keeps turning requests away, so it is being left alone for a while` };
  if (code === 'host-paused' || status === 429 || (host && host.state === 'paused') || /slow down/i.test(msg)) return { deferred: true, reason: `${site} asked Matinee to slow down` };
  if (code === 'timeout' || /took too long/i.test(msg)) return { deferred: false, reason: 'timed out' };
  if (status === 403 || /turned the request away/i.test(msg)) return { deferred: false, reason: `${site} turned the request away` };
  if (status >= 500) return { deferred: false, reason: `${site} isn't working right now` };
  if (status) return { deferred: false, reason: `${site} didn't answer properly (error ${status})` };
  return { deferred: false, reason: `couldn't reach ${site}` };
}

/**
 * @param {object} o
 * @param {object} o.store       from createStore()
 * @param {Array}  o.providers   provider objects
 * @param {object} o.http        from createHttp()
 * @param {Function} [o.emit]    (event, payload)
 * @param {AbortSignal} [o.signal]
 * @param {boolean} [o.full]     also refresh data older than each provider's refreshDays
 * @param {string[]} [o.only]    limit to these film keys
 * @param {object} [o.log]       from createFetchLog(); receives a short readable line per film and per pacing wait
 * @param {Map}  [o.inflight]    "provider|filmKey" -> owner token, shared by runs that may overlap (background crawl + on-demand)
 * @param {Function} [o.onFilm]  (film, providerId) after each film is recorded
 * @param {number} [o.lane]      request priority for providers' http (0 opened, 1 hovered, 2 visible, 3 background first-time, 4 quiet refresh and feel extras)
 * @param {boolean} [o.ignoreBackoff] also try films that failed recently (a film the user has opened)
 * @param {object} [o.trouble]   from createTrouble(); told how each film went
 * @param {Function} [o.onOutcome] (film, provider, { status: 'ok'|'miss'|'failed'|'deferred', reason, at }) as each source finishes a film
 * @param {true|Set<string>} [o.force] read these sources (true = all) for the named films whatever their freshness (a film's own page)
 * @param {{ report: Function }} [o.problemLog] the app-wide problem log (core/problems.js); every real failure is reported to it
 * @param {boolean} [o.keepOrder] with `only`: work through the films in the order given instead of seen-and-best-rated first
 * The result's `skipped` lists 'provider|filmKey' for films another run had in flight (so this run left them alone).
 */
export async function enrich({ store, providers, http, emit = () => {}, signal, full = false, only = null, log = null, inflight = new Map(), onFilm = null, deferQuiet = false, keepOrder = false, lane = null, ignoreBackoff = false, trouble = null, onOutcome = null, force = null, problemLog = NO_PROBLEMS }) {
  const startedAt = Date.now();
  const token = {};
  const problems = [];
  const skipped = new Set();
  const args = { store, providers, signal, full, only, inflight, onFilm, startedAt, token, problems, skipped, keepOrder, lane, ignoreBackoff, trouble, onOutcome, force, problemLog };
  // Films a source has never checked come first, with the usual progress. A run over everything (not a few named films)
  // then re-reads the films that are only due again, quietly, and only once no source has first-time work left.
  await runPass({ ...args, http, emit, log, kind: only ? 'all' : 'first' });
  // The quiet pass is a function so the caller can run it after the visible job has ended (deferQuiet), with its own signal.
  const runQuiet = async quietSignal => {
    const quietEmit = (event, payload) => { if (event === 'library') emit(event, payload); };
    await runPass({ ...args, signal: quietSignal || signal, http, emit: quietEmit, log: null, kind: 'refresh', silent: true, problems: [] });
  };
  const quietDue = !only && !(signal && signal.aborted) && !hasFirstTimeWork({ store, providers, http });
  if (quietDue && !deferQuiet) await runQuiet();
  if (!only) { try { store.flush(); } catch { /* the store itself reports a failed save to the problem log (store.onError) and retries */ } } // on-demand runs rely on the debounce and the job-end flush
  return { problems, skipped: [...skipped], runQuiet: quietDue && deferQuiet ? runQuiet : null };
}

async function runPass({ store, providers, http, emit, signal, full, only, log, inflight, onFilm, startedAt, token, problems, skipped, keepOrder = false, lane = null, ignoreBackoff = false, trouble = null, onOutcome = null, force = null, problemLog = NO_PROBLEMS, kind, silent = false }) {
  const settings = store.library.settings || {};
  const lib = store.library.films || {};
  // Films you've seen first (best rated first), then the watchlist, so the screens people look at fill in first.
  const order = keepOrder && only ? new Map(only.map((k, i) => [k, i])) : null;
  // The quiet re-read queue puts films in cinemas or opening soon first, then the same order as above.
  const rank = f => {
    if (order) return order.get(f.key) ?? 1e9;
    const u = lib[f.key] || {};
    return (kind === 'refresh' && releasePhase(f, Date.now()) === 'hot' ? -1e4 : 0) + (u.watched ? 0 : u.watchlist ? 2 : 1) * 100 - (u.rating || 0);
  };

  const stopWatching = log && http.observe ? http.observe(n => log.add({ site: siteForHost(n.host), kind: n.kind, text: n.text })) : null;
  const say = (p, kind, text, film) => { if (log) log.add({ site: siteForProvider(p.id, p.label), provider: p.id, title: film ? film.title : '', kind, text }); };

  const poolFor = () => (only ? only.map(k => store.films[k]).filter(Boolean) : Object.values(store.films));
  // 'first' = films this source has never checked; 'refresh' = films only due again; 'all' = both (named films).
  const wantsNow = (p, f, now, probe = p) => (kind === 'all' || (kind === 'refresh') === isRefresh(p, f)) && wantsFor(p, f, { now, full, reread: kind === 'refresh', ignoreBackoff, probe, force, lane });
  // Request lane for a provider: the caller's, else 3 for first-time work and 4 for quiet refreshes and feel-only sources.
  // The early TMDB guess runs in the same lane as the rest of the crawl (3), so a film the user can see (lane 2) is never queued behind it.
  const omdbOn = providers.some(p => p.id === 'omdb' && !(p.enabled && !p.enabled(settings)));
  const laneFor = p => (lane != null ? lane : kind === 'refresh' || FEEL_EXTRAS.has(p.id) || (omdbOn && CRITIC_PAGES.has(p.id)) ? 4 : 3);
  const providerHttp = p => {
    const h = http.withPriority ? http.withPriority(laneFor(p)) : http;
    // A quiet re-read never opens the page window; this is not a failure of the film or the site, so it is not counted (code 'quiet').
    return silent ? { ...h, page: async () => { throw Object.assign(new Error('The page window is not used for a quiet refresh.'), { status: 403, code: 'quiet' }); } } : h;
  };
  const labelFor = p => p.progressLabel || `Checking ${p.label}`;

  // Say how much work every source has before any starts, so the combined progress figure only ever moves forward.
  // This is an upper estimate (it ignores `requires`, which depends on ids found earlier); a source corrects it when it starts.
  const announced = new Set(), announcedTotal = new Map();
  const stepSkipped = new Set(); // 'provider|filmKey' for id steps another run held or that failed: the film is not waiting on them
  let idStepEnded = () => {}; // set once the id chain is wired up (below)
  const waveBase = new Map(); // provider id -> { done, total } of its earlier waves, so progress only moves forward across waves
  const strictNoted = new Set();
  const failStreak = new Map(); // provider id -> failed reads in a row across waves (reset by a recorded film)
  const memos = new Map(); // provider id -> scratch Map shared by its waves in this run (ctx.memo)
  {
    const now = Date.now(), pool = poolFor();
    for (const p of providers) {
      if (p.enabled && !p.enabled(settings)) continue;
      const probe = p.wants ? p : { ...p, requires: null };
      const n = pool.filter(f => wantsNow(p, f, now, probe)).length;
      if (!n || !bulkReady(p, n, store, now)) continue;
      announced.add(p.id); announcedTotal.set(p.id, n);
      emit('progress', { phase: 'provider', provider: p.id, label: labelFor(p), done: 0, total: n });
    }
  }

  // A per-day lookup counter for providers with a daily allowance (OMDb), kept in cache.json so it survives a restart.
  // Built from the store this run was given (a test fetch passes a scratch store, so the real counter is never touched).
  function quotaFor(id) {
    if (typeof store.cached !== 'function' || typeof store.setCached !== 'function') return undefined;
    const name = `quota:${id}`, day = () => new Date().toISOString().slice(0, 10); // UTC day, as omdb.js counts
    const get = () => {
      const v = store.cached(name, 2 * DAY), d = day();
      const legacy = id === 'omdb' && settings.omdbUsage?.day === d ? Number(settings.omdbUsage.n) || 0 : 0; // the count the app kept before this existed
      return Math.max(v && v.day === d ? Number(v.n) || 0 : 0, legacy);
    };
    return { get, add(n) { store.setCached(name, { day: day(), n: get() + n }); } };
  }

  /**
   * One run of a provider over its targets. `opts` (all optional) is how a provider is fed in waves:
   * subset = only these film keys; early = ctx.early for providers that can start before the ids are known;
   * final = false while more waves may follow (progress then keeps the announced total); halt = report films as not reached, run nothing.
   * Returns { stopped } = the provider crashed or left films it was given unread, so no further waves should be sent.
   */
  async function runProvider(p, opts = {}) {
    if (p.enabled && !p.enabled(settings)) return;
    if (signal && signal.aborted) return;
    const isFinal = opts.final !== false, base = waveBase.get(p.id) || { done: 0, total: 0 };
    const now = Date.now();
    // A guess whose real id has since arrived (p.unsettled) is settled in this run even though the provider already checked the film.
    const targets = poolFor().filter(f => (!opts.subset || opts.subset.has(f.key)) && (wantsNow(p, f, now) || (!opts.early && !!p.unsettled?.(f)))).sort((a, b) => rank(a) - rank(b));
    let lastDone = 0;
    const reported = new Set(); // film keys this source has said something about in this run
    const progress = (done, total) => {
      // The early wave counts only films it recorded: the ones it found nothing for are done by the chain step, which counts them then.
      if (opts.early) done = reported.size;
      lastDone = done;
      const t = base.total + (total ?? targets.length);
      emit('progress', { phase: 'provider', provider: p.id, label: labelFor(p), done: base.done + done, total: isFinal ? t : Math.max(t, announcedTotal.get(p.id) || 0) });
    };
    if (!targets.length || !bulkReady(p, targets.length, store, now)) { if (isFinal && announced.has(p.id)) progress(0, 0); return; } // announced up front, but nothing to do after all
    if (opts.halt) { // an earlier wave stopped this source: leave the rest for another time, as a stopped run does
      if (onOutcome && !(signal && signal.aborted)) for (const f of targets) { try { onOutcome(f, p, { status: 'deferred', reason: 'not reached this time', at: new Date().toISOString() }); } catch { /* a listener must never break a run */ } }
      return { stopped: true };
    }
    progress(0, targets.length);
    say(p, 'fetch', `checking ${targets.length} ${targets.length === 1 ? 'film' : 'films'}`);
    if (STRICT_PACING.has(p.id) && !strictNoted.has(p.id)) { strictNoted.add(p.id); say(p, 'wait', 'pages are read one at a time with a pause between each (polite pacing)'); }
    let saved = 0, crashed = false;
    const outcome = (film, status, reason) => { reported.add(film.key); if (onOutcome) { try { onOutcome(film, p, { status, reason, at: new Date().toISOString() }); } catch { /* a listener must never break a run */ } } };
    const dirty = new Set(); // keys recorded since the last 'library' event, so the UI can fetch just those
    const flush = () => { emit('library', { keys: [...dirty] }); dirty.clear(); };
    const claims = new Set();
    const isId = ID_STAGE.has(p.id);
    const release = film => { const k = p.id + '|' + film.key; if (claims.delete(k) && inflight.get(k) === token) inflight.delete(k); };
    const ctx = {
      http: providerHttp(p), settings, signal, progress, early: !!opts.early, silent, quota: quotaFor(p.id), keywordsCovered: coveredKeywords, memo: memos.get(p.id) || memos.set(p.id, new Map()).get(p.id),
      log: (...a) => {
        if (silent) return;
        const message = a.join(' ');
        emit('log', { provider: p.id, message });
        say(p, /keeps turning|busy|unavailable|failed|could not|stopped/i.test(message) ? 'error' : 'fetch', message);
      },
      /**
       * True when this film needs no work from this run: the provider recorded it after the run started, or another
       * run has it in flight. Otherwise claims it (released by done/fail) and returns false.
       */
      skip(film) {
        const t = film.checked?.[p.id];
        if (t && Date.parse(t) >= startedAt && !p.unsettled?.(film)) { if (isId) stepSkipped.add(p.id + '|' + film.key); return true; }
        const k = p.id + '|' + film.key, owner = inflight.get(k);
        if (owner && owner !== token) { skipped.add(k); if (isId) stepSkipped.add(k); return true; }
        inflight.set(k, token); claims.add(k);
        return false;
      },
      /** Record a provider's result for one film. data=null means "looked, found nothing"; info.hollow (a short note) means the page loaded but had no scores. */
      done(film, data, ids, info) {
        const t = new Date().toISOString();
        if (film.failed && film.failed[p.id]) { delete film.failed[p.id]; store.touch('films'); } // it worked this time
        const hollow = !data && info?.hollow ? String(info.hollow) : null;
        if (hollow) film.missNote = { ...film.missNote, [p.id]: hollow };
        else if (film.missNote?.[p.id]) { delete film.missNote[p.id]; if (!Object.keys(film.missNote).length) delete film.missNote; }
        if (trouble) { if (hollow) trouble.hollow(p, film.title, { expected: scoreExpected(p, film) }); else trouble.ok(p, film.title, { gotData: !!data }); }
        failStreak.set(p.id, 0);
        const had = film.src?.[p.id];
        // A re-read that finds nothing never wipes what is already stored: the old result and its date stay as they were.
        // We only note that we looked (film.reread), so the film is not read again on every pass.
        if (!data && had) {
          film.reread = film.reread || {}; film.reread[p.id] = t; store.touch('films');
          say(p, 'miss', 'nothing new, kept what was stored', film);
          outcome(film, 'ok', 'nothing new, kept what was stored');
          release(film);
          if (onFilm) onFilm(film, p.id);
          if (isId) idStepEnded(film);
          return;
        }
        if (!data) problemLog.report({ area: siteForProvider(p.id, p.label), film: filmLabel(film), level: 'warning', message: hollow ? `${p.label}'s page for this film has no scores on it.` : `${p.label} has nothing on this film.` });
        film.checked = film.checked || {}; film.missed = film.missed || {}; film.src = film.src || {}; film.ids = film.ids || {};
        film.checked[p.id] = t;
        if (film.reread) delete film.reread[p.id];
        // A thinner answer (a field missing this time) keeps the old value of that field; anything the new answer has replaces it.
        if (data) { film.src[p.id] = keepRicher(had, data); delete film.missed[p.id]; } else film.missed[p.id] = t;
        for (const [k, v] of Object.entries(ids || {})) if (v != null && v !== '' && film.ids[k] == null) film.ids[k] = v;
        store.touch('films');
        say(p, data ? 'ok' : 'miss', data ? `got ${describeData(data)}` : 'nothing found', film);
        outcome(film, data ? 'ok' : 'miss', data ? `got ${describeData(data)}` : hollow ? 'page there, no scores' : `${siteForProvider(p.id, p.label)} has nothing on this film`);
        release(film);
        if (onFilm) onFilm(film, p.id);
        dirty.add(film.key);
        if (++saved % 20 === 0) flush();
        if (isId) idStepEnded(film);
      },
      /**
       * A partial problem a source recovered from (one extra page or field failed but the film still got an answer): goes to the
       * problem log, never changes the film. `message` is plain English; `error` the raw error. Stopped runs are ignored.
       */
      warn(film, message, error = null, level = 'warning') {
        if (error && (error.code === 'aborted' || error.code === 'quiet')) return;
        problemLog.report({ area: siteForProvider(p.id, p.label), film: filmLabel(film), message, error, level });
      },
      /** Record a failure (network etc.) without marking the film as checked, so it's retried next time. */
      fail(film, error) {
        release(film);
        const code = error && error.code;
        const why = classifyFailure(p, error, http, trouble);
        // A stopped run, a quiet re-read that may not open the window, or a site being left alone says nothing about this film or
        // the source: it is deferred, not counted towards backoff or the "keeps failing" notice.
        if (trouble && code !== 'quiet') trouble.fail(p, film.title, why.deferred && code !== 'host-paused' && code !== 'aborted' ? Object.assign(new Error(why.reason), { code: 'host-paused' }) : error);
        if (code !== 'aborted' && code !== 'quiet' && !why.deferred) failStreak.set(p.id, (failStreak.get(p.id) || 0) + 1);
        if (code !== 'aborted' && !why.deferred) {
          film.failed = film.failed || {};
          film.failed[p.id] = { at: new Date().toISOString(), n: (film.failed[p.id]?.n || 0) + 1, why: String(error?.status ? `HTTP ${error.status}${error.message ? ' · ' + error.message : ''}` : error?.code || error?.message || why.reason || '').slice(0, 200) }; // why: for the film page's Debug panel
          store.touch('films');
        }
        if (code !== 'aborted') outcome(film, why.deferred ? 'deferred' : 'failed', why.reason);
        if (!silent && code !== 'quiet') problems.push({ provider: p.id, key: film.key, message: error.message });
        // One lookup for one film: a warning. Stopped runs, quiet refusals and sites being left alone are not failures (the trouble notices cover those).
        if (code !== 'aborted' && code !== 'quiet' && !why.deferred) problemLog.report({ area: siteForProvider(p.id, p.label), film: filmLabel(film), message: `Couldn't read this film: ${why.reason}.`, error, level: 'warning' });
        say(p, 'error', error && error.status ? `didn't answer (HTTP ${error.status}), will try again next time` : "couldn't be reached, will try again next time", film);
        if (isId) { stepSkipped.add(p.id + '|' + film.key); idStepEnded(film); } // a failed step must not hold the film back from the other sources
      },
    };
    try {
      await p.enrich(targets, ctx);
      if (p.bulk && !(signal && signal.aborted) && typeof store.setCached === 'function') store.setCached(p.bulk.cacheKey, true);
    } catch (e) {
      if (e.code === 'aborted') { for (const k of claims) if (inflight.get(k) === token) inflight.delete(k); if (dirty.size) flush(); return; }
      crashed = true;
      problemLog.report({ area: siteForProvider(p.id, p.label), message: `${p.label} stopped part-way through, so some films were not checked this time.`, error: e, level: 'error' });
      if (!silent) problems.push({ provider: p.id, message: e.message });
      say(p, 'error', cleanText(`stopped early: ${e.message}`));
    }
    // Films the source never got to (it stopped early, or another run had them): say so, so no film is left without an answer.
    let unreached = 0;
    if (!(signal && signal.aborted) && !opts.early) { // the early wave leaves films it found nothing for to the id chain: not "not reached"
      for (const f of targets) {
        if (reported.has(f.key)) continue;
        if (skipped.has(p.id + '|' + f.key)) { if (onOutcome) outcome(f, 'deferred', 'already being read, check back in a moment'); }
        else if (Date.parse(f.checked?.[p.id]) >= startedAt) { if (onOutcome) outcome(f, 'ok', 'up to date'); }
        else { unreached++; if (onOutcome) outcome(f, crashed ? 'failed' : 'deferred', crashed ? `${siteForProvider(p.id, p.label)} stopped early` : 'not reached this time'); }
      }
    }
    for (const k of claims) if (inflight.get(k) === token) inflight.delete(k);
    if (dirty.size) flush();
    waveBase.set(p.id, { done: base.done + lastDone, total: base.total + (isFinal ? targets.length : lastDone) });
    // Three failed reads in a row (across waves) from a polite-pacing site: it is turning requests away, so no further waves are sent.
    const blocked = STRICT_PACING.has(p.id) && (failStreak.get(p.id) || 0) >= BLOCKS_IN_A_ROW;
    return { stopped: crashed || unreached > 0 || blocked };
  }

  // Stage 1 finds ids (other sources depend on them) and runs in order: boxd, wikidata, tmdb. Sources that never use those ids
  // (provider.independent) start straight away alongside it. A source that only needs one stage-1 result
  // (provider.startsAfter = 'boxd', the Letterboxd slug) starts as soon as that provider finishes. TMDB (provider.earlyStart)
  // also starts at once: films with ids go straight to TMDB, the rest get a strict title + year guess that the id chain settles later.
  //
  // Every other source is fed film by film (30 Oct+, "per-film early start"): a film is released to a source as soon as it has the ids that
  // source declares (provider.needsIds), or as soon as its own id chain is over (nothing left in boxd / wikidata / tmdb wants it), so one slow film
  // no longer holds back the rest. A source gets its films in waves, one wave at a time; a wave that stopped early (crash, films left unread)
  // ends the waves for that source in this run. Bulk sources (one big download) are never split: they run once, when the whole chain is done.
  // Covers first: Wikipedia (provider.waitFor = ['tmdb'], so it can see whether TMDB already has the poster and synopsis) goes before the slow
  // page-reading sources (LATE), which start once its last wave is finished, so a library shows posters before reviews start to trickle in.
  // allmovie (independent) and lbpage (startsAfter boxd) are left out on purpose: they start early on their own hosts and existing tests pin that.
  const wiki = providers.find(p => p.id === 'wikipedia');
  let openGate; const gate = new Promise(r => { openGate = r; });
  if (!wiki) openGate();
  const crashReport = (p, e) => problemLog.report({ area: siteForProvider(p.id, p.label), message: `${p.label} stopped unexpectedly, so some films were not checked this time.`, error: e, level: 'error' });
  const guarded = (p, opts) => (LATE.has(p.id) ? gate : Promise.resolve()).then(() => runProvider(p, opts)).catch(e => { crashReport(p, e); if (!silent) problems.push({ provider: p.id, message: e.message }); });
  const chained = p => !ID_STAGE.has(p.id) && p.startsAfter;
  const idProviders = providers.filter(p => ID_STAGE.has(p.id));
  const hasWikidata = idProviders.some(i => i.id === 'wikidata');
  const early = providers.filter(p => !ID_STAGE.has(p.id) && p.id !== 'wikipedia' && (p.independent || (chained(p) && !idProviders.some(i => i.id === p.startsAfter)))).map(p => guarded(p));
  const followers = [];
  if (wiki && !hasWikidata) early.push(guarded(wiki).then(openGate));

  // ---- which films each fed source can have now ----
  const hasId = (film, name) => (name === 'letterboxd' ? !!(film.slug || film.ids?.letterboxd) : film.ids?.[name] != null && film.ids[name] !== '');
  const isWanted = (p, film, at) => (!p.enabled || p.enabled(settings)) && wantsNow(p, film, at, p.wants ? p : { ...p, requires: null });
  // A film's id chain is over when no id source still wants it (or has run, or failed, or was skipped for it).
  // A guess that is waiting to be settled (p.unsettled) is not over: the chain's step for it still has work.
  const stepOver = (p, film, at) => returned.has(p.id) || stepSkipped.has(p.id + '|' + film.key) || (!p.unsettled?.(film) && !isWanted(p, film, at));
  const chainOver = (film, at) => idProviders.every(p => stepOver(p, film, at));
  const returned = new Set();
  const dispatchers = [];
  const bulkBarrier = providers.filter(p => !ID_STAGE.has(p.id) && p.id !== 'wikipedia' && !p.independent && !chained(p) && p.bulk);
  const fed = providers.filter(p => !ID_STAGE.has(p.id) && !p.independent && !chained(p) && !p.bulk && (p.id !== 'wikipedia' || hasWikidata));

  function makeDispatcher(p) {
    const d = { p, sent: new Set(), queue: [], halted: false, closed: false, active: null };
    const loop = async () => {
      if (LATE.has(p.id)) await gate;
      await null; // films released in the same moment (one batch's results) go out as one wave
      for (;;) {
        if (!d.queue.length && !d.closed) break; // nothing to send until more films are released
        const keys = new Set(d.queue.splice(0)), last = d.closed; // closed = no more films can come, so this is the final wave
        const r = await runProvider(p, { subset: keys, final: last, halt: d.halted }).catch(e => { crashReport(p, e); if (!silent) problems.push({ provider: p.id, message: e.message }); return { stopped: true }; });
        if (r && r.stopped) d.halted = true;
        if (last) break;
      }
      d.active = null;
    };
    d.pump = () => { if (!d.active) d.active = loop(); };
    d.offer = film => { if (d.sent.has(film.key)) return; d.sent.add(film.key); d.queue.push(film.key); d.pump(); };
    d.close = async () => { d.closed = true; d.pump(); while (d.active) await d.active; };
    return d;
  }
  for (const p of fed) dispatchers.push(makeDispatcher(p));

  /** Releases a film to every fed source that can take it now. */
  function consider(film, at = Date.now()) {
    let over = null;
    for (const d of dispatchers) {
      if (d.sent.has(film.key) || (d.p.enabled && !d.p.enabled(settings))) continue;
      const need = d.p.needsIds || [];
      let ok = need.length > 0 && need.every(n => hasId(film, n)) && !(d.p.requires && !d.p.requires(film));
      if (ok && d.p.waitFor) ok = d.p.waitFor.every(id => { const q = idProviders.find(i => i.id === id); return !q || stepOver(q, film, at); });
      if (!ok) { if (over === null) over = chainOver(film, at); ok = over; }
      if (ok) d.offer(film);
    }
  }
  const considerAll = () => { if (dispatchers.length) { const at = Date.now(); for (const f of poolFor()) consider(f, at); } };
  idStepEnded = film => consider(film);

  const tmdb = idProviders.find(p => p.id === 'tmdb' && p.earlyStart);
  let earlyTmdb = null;
  try {
    considerAll();
    if (tmdb) earlyTmdb = guarded(tmdb, { early: true, final: false });
    for (const p of idProviders) {
      if (p === tmdb) await earlyTmdb;
      await runProvider(p);
      returned.add(p.id);
      for (const q of providers.filter(q => chained(q) && q.startsAfter === p.id)) followers.push(guarded(q));
      considerAll();
    }
    // The chain is over for every film: hand over what is left and let each source finish its last wave.
    for (const d of dispatchers) for (const f of poolFor()) d.offer(f);
    const closing = dispatchers.map(d => d.close().then(() => { if (d.p === wiki) openGate(); }));
    await Promise.all([...bulkBarrier.map(p => guarded(p)), ...closing]);
    await Promise.all([...early, ...followers]);
  } finally { openGate(); if (stopWatching) stopWatching(); }
}
