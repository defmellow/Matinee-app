// Cinema: what is on at Dendy Newtown, matched to the library. Pure apart from refreshCinema, which uses an injected
// source. Stores facts only (titles, dates/times, directors for matching, a link back, a short label); every item links to Dendy.
//
// Primary source: Dendy's own schedule data (GraphQL): both film lists, then sessions (months ahead) for the films that matter.
// Fallback when that fails: the plain pages, which carry sessions for today and the next two days only. Films with no sessions
// yet are known by their first-showing date, so the view shows them as "From <date>" with a link to Dendy's own page.
import { splitLabel, titleFromSlug, filmUrl } from '../parse/dendy.js';

export const CINEMA = { id: 'dendy-newtown', name: 'Dendy Newtown', url: 'https://newtown.dendy.com.au/' };
const DAY = 864e5;
const HOUR = 3600e3;
const RETRY_AFTER_FAIL_MS = 3 * HOUR;
const MAX_SESSIONS = 6;
const SOON_DAYS = 56; // 8 weeks
const RUNTIME_SLACK = 10; // minutes either way
const REBUILD_HOUR = 6; // Dendy's pages are rebuilt about 06:00 Sydney time
const DUE_HOUR = 7; // the first read of a day is at or after this Sydney hour
const NO_SESSIONS_REREAD_MS = 3 * DAY;
const CACHE_VERSION = 3;
const GQL_REFRESH_MS = 4 * HOUR; // GraphQL data: first look of the Sydney day, then at most every 4 hours
const CONFIG_MAX_AGE_MS = 7 * DAY; // screen and badge names change rarely
const NEAR_DAYS = 7; // every film showing within this many days is fetched, library match or not

// ---- Sydney clock (the site's own times are Sydney local) ----

const SYD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** ms -> { date:'YYYY-MM-DD', time:'HH:MM', now:'YYYY-MM-DDTHH:MM', offsetMs } on the Sydney clock. */
export function sydneyParts(ms) {
  const p = Object.fromEntries(SYD.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, time = `${p.hour}:${p.minute}`;
  return { date, time, now: `${date}T${time}`, offsetMs: Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000 };
}
/** The most recent moment at or before nowMs when the Sydney clock read `hour`:00. */
export function lastSydneyHour(nowMs, hour) {
  const p = sydneyParts(nowMs);
  let t = Date.parse(p.date + 'T00:00:00Z') + hour * HOUR - p.offsetMs;
  if (t > nowMs) t -= DAY;
  return t;
}

// ---- titles and matching ----

/** Lower-case ASCII words only: accents, '&', punctuation and apostrophes dropped, leading 'the' removed. */
function normPlain(raw) {
  let t = String(raw ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ');
  t = t.replace(/['’‘`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return t.replace(/^the /, '');
}

/** 'Alien - Directors Cut' -> 'alien'; 'The Café Society (4K Restoration)' -> 'cafe society'. */
export function normTitle(raw) {
  return normPlain(splitLabel(raw).title);
}

/** Every normalised title worth trying for a listing: its own variants, the printed title and a guess from the slug. */
function variantNorms(l) {
  const out = new Set();
  const add = v => { const n = normPlain(v); if (n) out.add(n); };
  const from = raw => { if (raw) splitLabel(raw).variants.forEach(add); };
  if (Array.isArray(l?.variants)) l.variants.forEach(add);
  from(l?.titleRaw);
  if (!l?.titleRaw) add(splitLabel(l?.title).title);
  if (l?.slug) from(titleFromSlug(l.slug));
  return [...out];
}

const surname = name => {
  const w = normPlain(name).split(' ').filter(Boolean);
  return w.length ? w[w.length - 1] : '';
};
const surnames = list => new Set([].concat(list || []).map(d => surname(typeof d === 'string' ? d : d?.name)).filter(Boolean));

/** Directors of a library summary: summary.directors ([{name}] or strings), else people.director, else director. */
export function defaultDirectorsOf(s) {
  const d = s?.directors?.length ? s.directors : s?.people?.director?.length ? s.people.director : s?.director;
  return [].concat(d || []).map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
}

/**
 * Two-step matching of Dendy films to library summaries.
 * Step 1: a title candidate (any variant of the Dendy title, or the library's original title, matches). Step 2: confirm it
 * with evidence: a director surname in common, a runtime within 10 minutes, or (if the listing gives one) a year within 1.
 * Contradicting evidence (different directors, a runtime far off with no director in common) rejects the candidate.
 * With no evidence at all (film page not read yet) only a recent library film (this year or last) is matched by title.
 * Events (rating E, NT Live, concerts, trivia) are never matched.
 * @param {object[]} listings  { title, titleRaw?, variants?, slug?, kind?, year?, runtimeMin?, directors? }
 * @param {object[]} summaries library summaries
 * @param {{directorsOf?:(s:object)=>string[], todayYear?:number}} [opts]
 * @returns {{listing:object, filmKey:string|null, matchedBy:string|null, candidates:string[]}[]}
 *   candidates: keys of the title candidates (the caller reads the film page for these before trusting a match)
 */
export function matchToLibrary(listings = [], summaries = [], { directorsOf = defaultDirectorsOf, todayYear = new Date().getFullYear() } = {}) {
  const index = new Map();
  const put = (k, s) => { if (!k) return; if (!index.has(k)) index.set(k, new Set()); index.get(k).add(s); };
  for (const s of summaries) { put(normTitle(s?.title), s); put(normPlain(s?.originalTitle), s); }
  return listings.map(listing => {
    const none = { listing, filmKey: null, matchedBy: null, candidates: [] };
    if (!listing || listing.kind === 'event') return none;
    const cands = new Set();
    for (const n of variantNorms(listing)) for (const s of index.get(n) || []) cands.add(s);
    if (!cands.size) return none;
    const dirs = surnames(listing.directors);
    const rt = listing.runtimeMin;
    const ok = [];
    for (const c of cands) {
      const evidence = [];
      if (listing.year && c.year) { if (Math.abs(c.year - listing.year) > 1) continue; evidence.push('year'); }
      const cd = dirs.size ? surnames(directorsOf(c)) : new Set();
      if (dirs.size && cd.size) { if (![...dirs].some(d => cd.has(d))) continue; evidence.push('director'); }
      const rtKnown = rt && c.runtime;
      if (rtKnown) {
        if (Math.abs(c.runtime - rt) <= RUNTIME_SLACK) evidence.push('runtime');
        else if (!evidence.includes('director')) continue;
      }
      if (!evidence.length && !(c.year && c.year >= todayYear - 1)) continue; // unconfirmed, and not a recent film
      ok.push({ c, evidence, gap: rtKnown ? Math.abs(c.runtime - rt) : 999 });
    }
    let best = null;
    if (ok.length) {
      ok.sort((a, b) => b.evidence.length - a.evidence.length || a.gap - b.gap);
      const tied = ok[1] && ok[1].evidence.length === ok[0].evidence.length && ok[1].gap === ok[0].gap;
      if (!tied) best = ok[0];
    }
    return {
      listing, filmKey: best ? best.c.key : null, matchedBy: best ? ['title', ...best.evidence].join('+') : null,
      candidates: [...cands].map(c => c.key),
    };
  });
}

// ---- the view ----

const dayNumber = iso => Date.parse(iso + 'T00:00:00Z') / DAY;
const isIso = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Sessions (already in order) -> [{ date, sessions }] by Sydney date. */
function byDate(list) {
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && last.date === s.date) last.sessions.push(s); else out.push({ date: s.date, sessions: [s] });
  }
  return out;
}

/**
 * @param {object} o
 * @param {object[]} o.listings   films: { title, slug, titleRaw?, label?, kind?, firstDate?, runtimeMin?, directors?, sessions:[{date,time,bookingUrl?,soldOut?,almostSoldOut?,screen?,format?}] }
 *                                (listingsFromCache(cache) makes these; films with no sessions are kept)
 * @param {object[]} o.summaries  library summaries
 * @param {string}   [o.today]    'YYYY-MM-DD'; default: today on the Sydney clock
 * @param {string}   [o.now]      'YYYY-MM-DDTHH:MM' Sydney time, to drop sessions already started today
 * @param {number}   [o.nowMs]    used for today/now when those are not given (Sydney clock)
 * @param {string|number} [o.fetchedAt]
 * @param {(s:object)=>string[]} [o.directorsOf]
 * @returns {{cinema, fetchedAt, groups:{id,label,items:object[]}[], total:number, matchedCount:number}}
 *   groups: now ('Showing this week', next < 7 days), soon ('Booking soon', up to 8 weeks), later ('Further ahead'),
 *   and 'listed' ('Listed, no date yet') only when something is in it. Each item:
 *   { title, slug, kind, label, filmKey|null, film|null, matchedBy, next (date|null), firstDate, hasSessions, sessions (<= 6),
 *     sessionCount, days ([{date, sessions}] for those <= 6), allSoldOut, rating, runtimeMin, url, watched, onWatchlist }.
 *     `next` is the first live session date, else firstDate. Sessions (from Dendy's data) also carry screen, format, soldOut, almostSoldOut.
 */
export function buildCinemaView({ listings = [], summaries = [], today, now, nowMs, fetchedAt = null, directorsOf } = {}) {
  const real = typeof nowMs === 'number' ? nowMs : Date.now();
  const todayIso = isIso(today) ? today : sydneyParts(real).date;
  const stamp = typeof now === 'string' && now.length >= 16 ? now.slice(0, 16) : (!isIso(today) ? sydneyParts(real).now : null);
  const matches = matchToLibrary(listings, summaries, { directorsOf, todayYear: Number(todayIso.slice(0, 4)) });
  const byKey = new Map(summaries.map(s => [s.key, s]));
  const groups = [
    { id: 'now', label: 'Showing this week', items: [] },
    { id: 'soon', label: 'Booking soon', items: [] },
    { id: 'later', label: 'Further ahead', items: [] },
  ];
  const listed = { id: 'listed', label: 'Listed, no date yet', items: [] };
  let matchedCount = 0, total = 0;
  const from = dayNumber(todayIso);
  for (const m of matches) {
    const l = m.listing || {};
    const live = (l.sessions || []).filter(s => isIso(s?.date) && s.date >= todayIso && !(stamp && s.date + 'T' + s.time < stamp));
    const firstDate = isIso(l.firstDate) ? l.firstDate : null;
    // Nothing live and nothing coming (sessions all past, or a first date already past): an old run.
    if (!live.length && !(firstDate && firstDate >= todayIso) && ((l.sessions || []).length || firstDate)) continue;
    const film = m.filmKey ? byKey.get(m.filmKey) || null : null;
    const next = live[0]?.date || firstDate || null;
    const item = {
      title: l.title, slug: l.slug || null, kind: l.kind === 'event' ? 'event' : 'film', filmKey: film ? film.key : null, film,
      matchedBy: film ? m.matchedBy : null, label: l.label || null, next, firstDate, hasSessions: live.length > 0,
      sessions: live.slice(0, MAX_SESSIONS), sessionCount: live.length, days: byDate(live.slice(0, MAX_SESSIONS)),
      allSoldOut: live.length > 0 && live.every(s => s.soldOut), rating: l.rating || null, runtimeMin: l.runtimeMin || null,
      url: l.slug ? filmUrl(l.slug) : CINEMA.url, onWatchlist: !!film?.user?.watchlist, watched: !!film?.user?.watched,
    };
    if (next) {
      const days = dayNumber(next) - from;
      groups[days < 7 ? 0 : days <= SOON_DAYS ? 1 : 2].items.push(item);
    } else listed.items.push(item);
    total++; if (film) matchedCount++;
  }
  // By date; then the user's watchlist, then other library films, then the rest; then title.
  const rank = i => (i.onWatchlist ? 0 : i.film ? 1 : 2);
  const order = (a, b) => String(a.next || '').localeCompare(String(b.next || '')) || rank(a) - rank(b) || String(a.title).localeCompare(String(b.title));
  for (const g of [...groups, listed]) g.items.sort(order);
  if (listed.items.length) groups.push(listed);
  return { cinema: CINEMA, fetchedAt, groups, total, matchedCount };
}

// ---- cache: store.cached('cinema') ----
// { version: 3, source: 'graphql'|'pages', fellBack?, fetchedAt, triedAt?, incomplete?, snapshot: { fetchedAt, windowFrom, windowTo },
//   config?: { fetchedAt, version, screens:{id:name}, badges:{id:name} }, resultVersions: { [request shape]: string },
//   films: { [slug]: { slug, dendyId?, title, titleRaw, titleFrom (1 slug guess, 2 coming-soon link, 3 film page / list / Dendy data), label,
//                      kind: 'film'|'event', rating, runtimeMin, directors, firstDate, status?, showingCount?, lists?, fromDay?,
//                      sessions: [{ date, time, bookingUrl, id?, start?, end?, endTime?, screen?, format?, labels?, seatsLeft?, soldOut?, almostSoldOut?, preview? }],
//                      maybeCut, seen, lastSeenAt, readAt } } }

const ms = v => (typeof v === 'number' ? v : Date.parse(v)) || 0;

/**
 * True when it is time to look again.
 * Dendy's own data (source 'graphql'): at the first look of each Sydney day, then at most every 4 hours.
 * Plain pages (the fallback): once per Sydney day, at or after about 07:00 (the pages are rebuilt about 06:00); after a fallback
 * the next try at Dendy's own data comes 3 h later. Pass maxAgeMs to use a plain age limit instead.
 * After a failed try (or a run that stopped early) it waits 3 h before asking again.
 */
export function needsRefresh(cache, nowMs = Date.now(), maxAgeMs) {
  if (cache?.triedAt && nowMs - ms(cache.triedAt) < RETRY_AFTER_FAIL_MS && nowMs >= ms(cache.triedAt)) return false;
  if (!cache || cache.version !== CACHE_VERSION || !cache.fetchedAt || !cache.films) return true;
  if (cache.incomplete) return true; // the earlier run stopped early (the 3 h wait above has passed)
  if (typeof maxAgeMs === 'number') return nowMs - ms(cache.fetchedAt) >= maxAgeMs;
  if (cache.fellBack) return true; // the 3 h wait above has passed: try Dendy's own data again
  if (cache.source === 'graphql') return ms(cache.fetchedAt) < lastSydneyHour(nowMs, 0) || nowMs - ms(cache.fetchedAt) >= GQL_REFRESH_MS;
  return ms(cache.fetchedAt) < lastSydneyHour(nowMs, DUE_HOUR);
}

const titleRank = { slug: 1, anchor: 2, page: 3 };

/**
 * Fold a refresh into the cache.
 * @param {object|null} cache
 * @param {object[]|null} roster  fresh roster (null when no list could be read: the old data is kept). Entries:
 *   { slug, title?, titleRaw?, titleFrom?: 'slug'|'anchor'|'page', label?, kind?, runtimeMin?, directors?, firstDate?, rating?, sessions?, seen: {sitemap?,comingSoon?,nowShowing?} }
 * @param {Object<string,object>} filmResults  film pages read this time, by slug (parseFilmPage output)
 * @param {{sitemapRead?:boolean, incomplete?:boolean}} [flags]
 */
export function mergeCache(cache, roster, filmResults = {}, nowMs = Date.now(), { sitemapRead = false, incomplete = false, fellBack = false } = {}) {
  const old = cache && cache.version === CACHE_VERSION ? cache : {};
  if (!Array.isArray(roster)) return { ...old, version: CACHE_VERSION, films: old.films || {}, fetchedAt: old.fetchedAt || null, triedAt: nowMs };
  const films = {};
  const inRoster = new Set(roster.map(r => r.slug));
  for (const [slug, f] of Object.entries(old.films || {})) {
    if (inRoster.has(slug)) continue;
    // The sitemap is the roster. Without it nothing is dropped; with it a film missing from this run stays one more day if its page was read.
    if (!sitemapRead || (f.readAt && nowMs - ms(f.lastSeenAt || f.readAt) < DAY + 6 * HOUR)) films[slug] = f;
  }
  for (const r of roster) {
    const o = old.films?.[r.slug] || {};
    const page = filmResults?.[r.slug];
    const from = titleRank[r.titleFrom] || 1;
    const keepTitle = o.title && (o.titleFrom || 1) > from;
    const f = {
      ...o, slug: r.slug,
      title: keepTitle ? o.title : (r.title || o.title || titleFromSlug(r.slug)), titleRaw: keepTitle ? o.titleRaw : (r.titleRaw || o.titleRaw || r.title || titleFromSlug(r.slug)),
      titleFrom: keepTitle ? o.titleFrom : from, label: keepTitle ? o.label : (r.label ?? o.label ?? null),
      kind: r.kind === 'event' || o.kind === 'event' ? 'event' : 'film',
      rating: r.rating ?? o.rating ?? null, runtimeMin: r.runtimeMin ?? o.runtimeMin ?? null,
      directors: r.directors?.length ? r.directors : o.directors || [], firstDate: r.firstDate ?? o.firstDate ?? null,
      seen: { sitemap: false, comingSoon: false, nowShowing: false, ...r.seen }, lastSeenAt: nowMs,
      sessions: o.sessions || [], maybeCut: !!o.maybeCut, readAt: o.readAt || null,
    };
    if (r.sessions?.length) f.sessions = r.sessions; // the list page is today's snapshot
    if (page && Array.isArray(page.sessions)) {
      Object.assign(f, {
        title: page.title || f.title, titleRaw: page.titleRaw || f.titleRaw, titleFrom: 3, label: page.label ?? null,
        kind: page.kind === 'event' || f.kind === 'event' ? 'event' : 'film', rating: page.rating ?? f.rating,
        runtimeMin: page.runtimeMin ?? f.runtimeMin, directors: page.directors?.length ? page.directors : f.directors,
        firstDate: page.firstDate ?? null, sessions: page.sessions, maybeCut: !!page.maybeCut, readAt: nowMs,
      });
    }
    films[r.slug] = f;
  }
  const dates = Object.values(films).flatMap(f => (f.sessions || []).map(s => s.date)).filter(Boolean).sort();
  const snapshot = { fetchedAt: nowMs, windowFrom: dates[0] || null, windowTo: dates[dates.length - 1] || null };
  // Page sessions replace what Dendy's data said, so its change markers no longer describe the cache.
  return { version: CACHE_VERSION, source: 'pages', ...(fellBack ? { fellBack: true } : {}), fetchedAt: nowMs, triedAt: nowMs, incomplete: !!incomplete, snapshot, ...(old.config ? { config: old.config } : {}), resultVersions: {}, films };
}

const sessionDates = films => Object.values(films).flatMap(f => (f.sessions || []).map(s => s.date)).filter(Boolean).sort();

/**
 * Fold a refresh of Dendy's own data into the cache. The roster is complete, so films not in it are dropped.
 * @param {object|null} cache
 * @param {object[]} roster  films (parseRoster shape plus `lists`, `fromDay?`)
 * @param {{movies?:Object<string,object|null>, fetched?:string[], cut?:string[]}} sessions  fetched ids get their sessions replaced
 *   (an empty list when Dendy has none); every other film keeps what it had
 * @param {{config?:object, versions?:Object<string,string>, incomplete?:boolean}} [extra]
 */
export function mergeGraphqlCache(cache, roster, sessions = {}, nowMs = Date.now(), { config, versions = {}, incomplete = false } = {}) {
  const old = cache && cache.version === CACHE_VERSION ? cache : {};
  const fetched = new Set(sessions.fetched || []), cut = new Set(sessions.cut || []);
  const keepFrom = sydneyParts(nowMs - DAY).date; // sessions from before yesterday are history
  const films = {};
  for (const r of roster) {
    const o = old.films?.[r.slug] || {};
    const got = fetched.has(r.dendyId);
    const list = got ? sessions.movies?.[r.dendyId]?.sessions || [] : o.sessions || [];
    films[r.slug] = {
      ...o, slug: r.slug, dendyId: r.dendyId, title: r.title || o.title, titleRaw: r.titleRaw || o.titleRaw || r.title, titleFrom: 3, label: r.label ?? null,
      kind: r.kind === 'event' ? 'event' : 'film', rating: r.rating ?? o.rating ?? null, runtimeMin: r.runtimeMin ?? o.runtimeMin ?? null,
      directors: r.directors?.length ? r.directors : o.directors || [], firstDate: r.firstDate ?? null, status: r.status ?? o.status ?? null,
      showingCount: r.showingCount ?? o.showingCount ?? null, lists: r.lists || o.lists || [], fromDay: r.fromDay || undefined,
      sessions: list.filter(s => s.date >= keepFrom), maybeCut: got ? cut.has(r.dendyId) : !!o.maybeCut,
      seen: { ...(o.seen || {}), graphql: true }, lastSeenAt: nowMs, readAt: got ? nowMs : o.readAt || null,
    };
  }
  const dates = sessionDates(films);
  const snapshot = { fetchedAt: nowMs, windowFrom: dates[0] || null, windowTo: dates[dates.length - 1] || null };
  return {
    version: CACHE_VERSION, source: 'graphql', fetchedAt: nowMs, triedAt: nowMs, incomplete: !!incomplete, snapshot,
    ...((config || old.config) ? { config: config || old.config } : {}), resultVersions: versions, films,
  };
}

/** Listings ready for buildCinemaView / matchToLibrary: one per film in the cache (those with no sessions too). */
export function listingsFromCache(cache) {
  if (!cache || cache.version !== CACHE_VERSION) return [];
  return Object.values(cache.films || {}).filter(f => f && f.title).map(f => {
    const { variants } = splitLabel(f.titleRaw || f.title);
    return {
      title: f.title, titleRaw: f.titleRaw || f.title, slug: f.slug, path: `/movie/${f.slug}/`, label: f.label || null, variants,
      kind: f.kind === 'event' ? 'event' : 'film', rating: f.rating || null, runtimeMin: f.runtimeMin || null, directors: f.directors || [],
      firstDate: f.firstDate || null, sessions: f.sessions || [], maybeCut: !!f.maybeCut, readAt: f.readAt || null,
      dendyId: f.dendyId || null, status: f.status || null, showingCount: f.showingCount ?? null,
    };
  });
}

// ---- refresh ----

const codeOf = e => (e?.code === 'aborted' || e?.name === 'AbortError' ? 'aborted' : e?.code === 'blocked' || e?.code === 'changed' || e?.code === 'http' ? e.code : 'network');
const isBad = c => c === 'blocked' || c === 'aborted' || c === 'network'; // leave Dendy alone

/**
 * The fallback refresh, from the plain pages, with an injected source (needs fetchListing, fetchFilm; fetchSitemap and fetchComingSoon are used when present).
 *  1. Roster: sitemap slugs + coming-soon links + now-showing films. 2. Title candidates against the library (watchlist, then
 *  unseen, then watched). 3. Read the film page of each candidate (at most maxFilms, one at a time), skipping pages read since the
 *  last 06:00 Sydney rebuild (and, for films with no sessions, read in the last 3 days) unless `force`. 4. Merge.
 * Never throws: on failure the old cache is kept and `error` says why ('blocked' | 'http' | 'changed' | 'aborted' | 'network').
 * A list that failed while others worked is named in `partial`; `incomplete` in the cache makes the next check retry after 3 h.
 */
async function refreshFromPages({ source, cache = null, summaries = [], nowMs = Date.now(), signal, force = false, maxFilms = 25, directorsOf, fellBack = false } = {}) {
  let requests = 0;
  const partial = [];
  const fail = error => ({ cache: mergeCache(cache, null, {}, nowMs), error, fetched: 0, skipped: false, requests, partial });

  const roster = new Map();
  const touch = (slug, seenKey, patch = {}) => {
    const r = roster.get(slug) || { slug, seen: {} };
    const rank = titleRank[patch.titleFrom] || 0;
    if (patch.title && rank >= (titleRank[r.titleFrom] || 0)) Object.assign(r, { title: patch.title, titleRaw: patch.titleRaw, titleFrom: patch.titleFrom, label: patch.label });
    if (patch.kind === 'event') r.kind = 'event'; else if (!r.kind) r.kind = patch.kind;
    for (const k of ['runtimeMin', 'directors', 'firstDate', 'rating', 'sessions']) if (patch[k] != null && !(Array.isArray(patch[k]) && !patch[k].length)) r[k] = patch[k];
    r.seen[seenKey] = true;
    roster.set(slug, r);
  };

  let okLists = 0, firstError = null, sitemapRead = false;
  const tryList = async (name, fn) => {
    if (signal?.aborted) { firstError = firstError || 'aborted'; return 'aborted'; }
    requests++;
    try { const r = await fn(); okLists++; return r; }
    catch (e) { const c = codeOf(e); firstError = firstError || c; partial.push(name); return isBad(c) ? c : null; }
  };

  const list = await tryList('nowShowing', () => source.fetchListing(signal));
  if (typeof list === 'string') return fail(list);
  if (list) for (const f of list.films) touch(f.slug, 'nowShowing', { ...f, titleFrom: 'page' });
  if (typeof source.fetchComingSoon === 'function') {
    const cs = await tryList('comingSoon', () => source.fetchComingSoon(signal));
    if (typeof cs === 'string') return fail(cs);
    if (cs) for (const a of cs.films) {
      const { title, label, kind } = splitLabel(a.title);
      touch(a.slug, 'comingSoon', { title, titleRaw: a.title, label, kind, titleFrom: 'anchor' });
    }
  }
  if (typeof source.fetchSitemap === 'function') {
    const sm = await tryList('sitemap', () => source.fetchSitemap(signal));
    if (typeof sm === 'string') return fail(sm);
    if (sm) {
      sitemapRead = true;
      for (const slug of sm.slugs) {
        const g = splitLabel(titleFromSlug(slug));
        touch(slug, 'sitemap', { title: g.title, titleRaw: titleFromSlug(slug), label: g.label, kind: g.kind, titleFrom: 'slug' });
      }
    }
  }
  if (!okLists) return fail(firstError || 'network');

  // Which pages to read: title candidates, watchlist first, then unseen, then watched; skip those read since the last rebuild.
  const rebuilt = lastSydneyHour(nowMs, REBUILD_HOUR);
  const today = sydneyParts(nowMs).date;
  const soonEnough = Date.parse(today + 'T00:00:00Z') + 3 * DAY;
  const byKey = new Map(summaries.map(s => [s.key, s]));
  const asListing = r => {
    const o = cache?.version === CACHE_VERSION ? cache.films?.[r.slug] : null;
    return { ...(o || {}), ...r, directors: r.directors || o?.directors, runtimeMin: r.runtimeMin ?? o?.runtimeMin, kind: r.kind === 'event' || o?.kind === 'event' ? 'event' : 'film' };
  };
  const rows = [...roster.values()].map(asListing);
  const rank = keys => Math.min(...keys.map(k => { const u = byKey.get(k)?.user; return u?.watchlist ? 0 : u?.watched ? 2 : 1; }));
  const wanted = matchToLibrary(rows, summaries, { directorsOf })
    .filter(m => m.candidates.length)
    .map(m => ({ slug: m.listing.slug, rank: rank(m.candidates) }))
    .sort((a, b) => a.rank - b.rank)
    .map(w => w.slug)
    .filter(slug => {
      if (force) return true;
      const o = cache?.version === CACHE_VERSION ? cache.films?.[slug] : null;
      if (!o?.readAt) return true;
      const sessionless = !(o.sessions || []).length;
      const startsSoon = o.firstDate && Date.parse(o.firstDate + 'T00:00:00Z') <= soonEnough;
      if (sessionless && !startsSoon) return nowMs - o.readAt >= NO_SESSIONS_REREAD_MS; // only its first date can change
      return o.readAt < rebuilt;
    });

  const results = {};
  let error = null, stopped = false;
  for (const slug of wanted.slice(0, maxFilms)) {
    if (signal?.aborted) { error = 'aborted'; stopped = true; break; }
    requests++;
    try {
      results[slug] = await source.fetchFilm(`/movie/${slug}/`, signal);
    } catch (e) {
      error = codeOf(e);
      if (isBad(error)) { stopped = true; break; }
    }
  }
  const incomplete = stopped || wanted.length > maxFilms;
  const merged = mergeCache(cache, [...roster.values()], results, nowMs, { sitemapRead, incomplete, fellBack });
  return { cache: merged, error, fetched: Object.keys(results).length, skipped: false, requests, partial };
}

// ---- refresh from Dendy's own data ----

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** A roster entry (or cached film) as a listing for matchToLibrary. */
const asRosterListing = f => ({ title: f.title, titleRaw: f.titleRaw, variants: f.variants, slug: f.slug, kind: f.kind, runtimeMin: f.runtimeMin, directors: f.directors, firstDate: f.firstDate });

/**
 * Primary refresh. Steps: both film lists; screen and badge names (kept 7 days); today's whole-cinema day (films in neither list);
 * match the roster to the library on name + director surname + runtime (the lists carry both, so no film pages are read);
 * then sessions for the matched films plus every film showing now or starting within 7 days, in batches under Dendy's 300-session limit.
 * @returns {Promise<{ok:true, result:object}|{ok:false, fallbackable:boolean, requests:number, result:object}>}
 *   fallbackable: Dendy answered but not in the usual shape ('changed' | 'http'); blocked, aborted and network errors are not (leave it alone).
 */
async function refreshFromGraphql({ source, cache, summaries, nowMs, signal, force, directorsOf }) {
  let requests = 0;
  const partial = [];
  const old = cache && cache.version === CACHE_VERSION ? cache : null;
  const fail = (code, requestsMade = requests) => ({
    ok: false, fallbackable: code === 'changed' || code === 'http', requests: requestsMade,
    result: { cache: mergeCache(cache, null, {}, nowMs), error: code, fetched: 0, skipped: false, requests: requestsMade, partial },
  });
  if (signal?.aborted) return fail('aborted');
  const today = sydneyParts(nowMs).date;

  // 1. The two film lists.
  let listed;
  try { const r = await source.fetchRoster(signal); requests += r.requests ?? 2; listed = r.films; }
  catch (e) { requests += 1; return fail(codeOf(e)); }
  const roster = new Map(listed.map(f => [f.dendyId, f]));

  // 2. Screen and badge names, kept for a week. A failure here only loses the names.
  let config = old?.config && nowMs - ms(old.config.fetchedAt) < CONFIG_MAX_AGE_MS && !force ? old.config : null;
  if (!config && typeof source.fetchConfig === 'function') {
    requests++;
    try { config = { ...(await source.fetchConfig(signal)), fetchedAt: nowMs }; }
    catch (e) { const c = codeOf(e); if (isBad(c)) return fail(c); partial.push('config'); config = old?.config || null; }
  }

  // 3. Today's whole day: catches films in neither list.
  const versions = force ? {} : old?.resultVersions || {};
  const newVersions = {};
  let dayIds = new Set();
  if (typeof source.fetchDay === 'function') {
    requests++;
    const dayKey = 'day:' + today;
    try {
      const day = await source.fetchDay({ date: today, resultVersion: versions[dayKey], config, signal });
      if (day.resultVersion) newVersions[dayKey] = day.resultVersion;
      if (day.unchanged) {
        // Nothing new today: films found by this check earlier stay.
        for (const f of Object.values(old?.films || {})) if (f.fromDay === today && f.dendyId && !roster.has(f.dendyId)) { roster.set(f.dendyId, { ...f }); dayIds.add(f.dendyId); }
      } else {
        for (const [id, m] of Object.entries(day.movies)) {
          dayIds.add(id);
          if (!roster.has(id)) { const { sessions, ...film } = m; roster.set(id, { ...film, lists: ['day'], fromDay: today }); }
        }
      }
    } catch (e) { const c = codeOf(e); if (isBad(c)) return fail(c); partial.push('day'); }
  }

  // 4. Match the roster to the library.
  const entries = [...roster.values()];
  const matches = matchToLibrary(entries.map(asRosterListing), summaries, { directorsOf, todayYear: Number(today.slice(0, 4)) });
  const matched = new Set();
  matches.forEach((m, i) => { if (m.filmKey) matched.add(entries[i].dendyId); });

  // 5. Sessions for the films that matter: matched, showing now, found on today's day, or starting within a week.
  const near = addDays(today, NEAR_DAYS);
  const wanted = entries.filter(f => {
    if (f.showingCount === 0 && !dayIds.has(f.dendyId)) return false; // nothing booked yet: only its first date is known
    return matched.has(f.dendyId) || f.lists?.includes('now-playing') || dayIds.has(f.dendyId) || (f.firstDate && f.firstDate <= near);
  });
  let sessions = { movies: {}, fetched: [], unchanged: [], versions: {}, cut: [], requests: 0 };
  if (wanted.length) {
    try { sessions = await source.fetchSessions(wanted.map(f => ({ id: f.dendyId, showingCount: f.showingCount ?? undefined })), { versions, config, signal }); }
    catch (e) { return fail(codeOf(e), requests + 1); }
    requests += sessions.requests;
  }
  const merged = mergeGraphqlCache(cache, entries, sessions, nowMs, { config, versions: { ...newVersions, ...sessions.versions }, incomplete: false });
  return { ok: true, result: { cache: merged, error: null, fetched: sessions.fetched.length, skipped: false, requests, partial } };
}

/**
 * One refresh. Primary: Dendy's own schedule data (source needs fetchRoster, fetchSessions; fetchConfig and fetchDay are used when present).
 * When that fails in an unexpected way ('changed' | 'http') and the source can read the plain pages, those are used instead and the
 * result names 'graphql' in `partial`. A source without fetchRoster goes straight to the plain pages.
 * Never throws: on failure the old cache is kept and `error` says why ('blocked' | 'http' | 'changed' | 'aborted' | 'network').
 * @returns {Promise<{cache:object, error:string|null, fetched:number, skipped:boolean, requests:number, partial:string[]}>}
 *   fetched: films whose sessions were read (pages path: film pages read); requests: every request made.
 *   maxFilms only limits the pages path.
 */
const CINEMA_WHY = { blocked: 'Dendy turned the request away', http: "Dendy's site didn't answer properly", changed: "Dendy's schedule looked different from usual, so it may need updating", network: "Dendy's site couldn't be reached" };
/** Never throws: reports what went wrong (the internal catches only keep a code, so this is where the problem log hears about it). */
export async function refreshCinema(opts = {}) {
  const r = await refreshCinemaRead(opts);
  const problems = opts.problems;
  if (problems && !r.skipped) {
    if (r.error && r.error !== 'aborted') problems.report({ area: 'Dendy Newtown', message: `Matinee couldn't read what's on at Dendy Newtown: ${CINEMA_WHY[r.error] || 'something went wrong'}.`, error: { code: r.error, message: `refreshCinema error code ${r.error}` }, level: 'error' });
    else if (!r.error && (r.partial || []).some(x => x !== 'graphql')) problems.report({ area: 'Dendy Newtown', message: `Part of Dendy Newtown's listings could not be read (${r.partial.filter(x => x !== 'graphql').join(', ')}). The rest loaded.`, level: 'warning' });
  }
  return r;
}

async function refreshCinemaRead(opts = {}) {
  const { source, cache = null, nowMs = Date.now(), force = false } = opts;
  const args = { ...opts, nowMs, cache, force, summaries: opts.summaries || [] };
  if (!force && !needsRefresh(cache, nowMs)) return { cache, error: null, fetched: 0, skipped: true, requests: 0, partial: [] };
  if (typeof source?.fetchRoster !== 'function') return refreshFromPages(args);
  const g = await refreshFromGraphql(args);
  if (g.ok || !g.fallbackable || typeof source.fetchListing !== 'function') return g.result;
  const r = await refreshFromPages({ ...args, fellBack: true });
  return { ...r, requests: r.requests + g.requests, partial: ['graphql', ...r.partial] };
}
