// Watchlist catch-up so a refresh needs no new export. Letterboxd has no watchlist feed, so:
//  1. the user's activity feed (/ajax/activity-pagination/<user>/, the rows the activity page loads) is read once and its "added X to their
//     watchlist" rows applied, back to the last check (library.sync.watchlistSeenAt);
//  2. if that can't be read, or page 1 doesn't reach back to the last check, the watchlist page /<user>/watchlist/by/added/ (newest first)
//     is read instead: page 1, then the next only while every film so far was new, stopping at the first film already on the watchlist
//     or after MAX_PAGES.
// Pages are read like film pages: a plain request first, then the page window if Letterboxd asks for a check (never defeated here: the
// existing flow shows it to the user's). Fails soft: any problem leaves the library as it was.
// Removals: a film that came onto the watchlist from an activity row remembers that row (watchlistVia / watchlistActivityId / watchlistActivityAt).
// When a later read of the feed reaches back past that time and the row (and any other row for the film) is gone, the user took it off Letterboxd's
// watchlist, so it comes off here too (tags, notes and `mine` stay). More than MAX_REMOVALS in one read is treated as a broken read: none are removed
// and it is reported. Films that came from the export or the watchlist page are never removed automatically (no row to watch for).
import { NO_PROBLEMS } from '../problems.js';
import { parseWatchlistPage } from '../parse/watchlist-page.js';
import { parseActivity } from '../parse/activity-page.js';
import { resolveFilm, userFilm, removeFromWatchlist, isAfter } from '../library.js';
import { normTitle, titleYearKey } from '../model.js';

export const MAX_PAGES = 5;
export const MAX_REMOVALS = 5;
const pageUrl = (user, n) => `https://letterboxd.com/${encodeURIComponent(user)}/watchlist/by/added/${n > 1 ? `page/${n}/` : ''}`;
const activityUrl = user => `https://letterboxd.com/ajax/activity-pagination/${encodeURIComponent(user)}/`;
const day = now => new Date(now ?? Date.now()).toISOString().slice(0, 10);

/** One page: plain request, then the page window when the plain one is turned away or isn't the watchlist. Null when neither works. */
async function readPage(http, url, signal) {
  if (typeof http.browserText === 'function') {
    try {
      const res = await http.browserText(url, { signal });
      if (res.status >= 200 && res.status < 300) { const p = parseWatchlistPage(res.text); if (p.ok) return p; }
      if (res.status === 404 || res.status === 429) return null; // no such page / host paused: don't push on
    } catch (e) {
      if (e?.code === 'aborted' || e?.status === 429) return null;
      // anything else: the page window below is the fallback, and a failure there is reported by the caller
    }
  }
  const res = await http.page(url, { signal });
  if (res.status < 200 || res.status >= 300) return null;
  const p = parseWatchlistPage(res.text);
  return p.ok ? p : null;
}

/** The stored film for this item without creating one (slug, then title + year), or null. */
function findFilm(store, item) {
  const films = Object.values(store.films);
  const bySlug = films.find(f => f.slug === item.slug || f.ids?.letterboxd === item.slug);
  if (bySlug) return bySlug;
  if (!normTitle(item.title)) return null;
  const k = titleYearKey(item.title, item.year);
  return films.find(f => !(f.slug || f.ids?.letterboxd) && titleYearKey(f.title, f.year) === k) || null;
}

/** Apply collected items: new films are added, known ones marked, watched ones skipped.
 *  A film the user took off in Matinee comes back only for an activity row newer than the removal (the watchlist page has no dates, so it never does). */
function apply(store, fresh, when, out, { activity = false } = {}) {
  for (const item of fresh) {
    const have = findFilm(store, item);
    const film = resolveFilm(store, { slug: item.slug, title: item.title, year: item.year ?? have?.year ?? null });
    const u = userFilm(store, film.key);
    if (u.watched || u.watchlist) continue;
    if (u.watchlistRemovedAt && !(activity && isAfter(item.at, u.watchlistRemovedAt))) continue;
    u.watchlist = true;
    u.watchlistAddedAt = when;
    delete u.watchlistRemovedAt; delete u.watchlistRemovedVia;
    if (activity) { u.watchlistVia = 'activity'; u.watchlistActivityId = item.id || null; u.watchlistActivityAt = item.at || null; }
    else { u.watchlistVia = 'page'; delete u.watchlistActivityId; delete u.watchlistActivityAt; }
    if (have) out.marked++; else out.added++;
  }
  if (out.added || out.marked) { store.touch('library'); store.touch('films'); }
}

/**
 * Films that came from an activity row whose row is gone from a feed that reaches back past it.
 * @returns {{ gone: string[] (library keys), } }
 */
function goneFromFeed(store, p) {
  const oldest = p.oldest ? Date.parse(p.oldest) : NaN;
  const ids = new Set(p.items.map(i => i.id)), slugs = new Set(p.items.map(i => i.slug));
  const gone = [];
  for (const [key, u] of Object.entries(store.library.films)) {
    if (!u.watchlist || u.watched || u.watchlistVia !== 'activity' || !u.watchlistActivityAt) continue;
    const at = Date.parse(u.watchlistActivityAt);
    // Strictly past the row's time: a page that ends in the same second might have cut the row off.
    if (!Number.isFinite(oldest) || !Number.isFinite(at) || !(oldest < at)) continue;
    const film = store.films[key];
    const slug = film && (film.slug || film.ids?.letterboxd);
    if (ids.has(u.watchlistActivityId) || (slug && slugs.has(slug))) {
      // Still there (maybe re-added on Letterboxd): remember the newest row so the next read checks that one.
      const row = p.items.filter(i => i.slug === slug).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      if (row && row.id !== u.watchlistActivityId && isAfter(row.at, u.watchlistActivityAt)) { u.watchlistActivityId = row.id; u.watchlistActivityAt = row.at; store.touch('library'); }
      continue;
    }
    gone.push(key);
  }
  return gone;
}

/** Take films off whose activity row is gone; hold off entirely when it would be a lot. */
function applyRemovals(store, p, { now, problems, log }, out) {
  const gone = goneFromFeed(store, p);
  if (!gone.length) return;
  if (gone.length > MAX_REMOVALS) {
    out.heldOff = gone.length;
    problems.report({ area: 'Watchlist refresh', message: `Matinee held off removing ${gone.length} films from your watchlist because the activity page looked unusual.`, level: 'warning' });
    return;
  }
  for (const key of gone) {
    if (!removeFromWatchlist(store, key, { via: 'activity', now })) continue;
    out.removed = (out.removed || 0) + 1;
    const film = store.films[key];
    if (log) log({ title: film?.title || key, text: 'Taken off your watchlist in Matinee: it is no longer on your Letterboxd activity page.' });
  }
  if (out.removed) { store.touch('library'); store.touch('films'); }
}

/** The activity rows: the data request first (plain), then the activity page in the window (its own script fills the rows). Null if neither gives rows. */
async function readActivity(http, user, signal) {
  if (typeof http.browserText === 'function') {
    try {
      const res = await http.browserText(activityUrl(user), { signal });
      if (res.status >= 200 && res.status < 300) { const p = parseActivity(res.text); if (p.ok) return p; }
      if (res.status === 429) return null;
    } catch (e) { if (e?.code === 'aborted' || e?.status === 429) return null; /* anything else: the page window below is the fallback */ }
  }
  const res = await http.page(`https://letterboxd.com/${encodeURIComponent(user)}/activity/`, { signal, waitFor: '#activity-table-body [data-activity-id]' });
  if (res.status < 200 || res.status >= 300) return null;
  const p = parseActivity(res.text);
  return p.ok ? p : null;
}

/** Watchlist additions from the activity feed. `reached`: page 1 goes back to the last check, so nothing in between was missed. */
async function fromActivity(store, http, user, { signal, now, problems, log }, out) {
  const p = await readActivity(http, user, signal);
  if (!p) return null;
  out.pages++;
  const seen = store.library.sync?.watchlistSeenAt || null;
  // A row on or after the last check is (re)applied: applying twice changes nothing.
  apply(store, p.items.filter(i => !seen || !i.at || i.at >= seen), day(now), out, { activity: true });
  try { applyRemovals(store, p, { now, problems, log }, out); }
  catch (e) { problems.report({ area: 'Watchlist refresh', message: "Matinee couldn't check which films you've taken off your watchlist on Letterboxd. Your watchlist is unchanged.", error: e, level: 'error' }); }
  // First time there is no check to reach back to: the export is the base, so page 1 is enough.
  return { newest: p.newest, reached: !seen || (!!p.oldest && p.oldest < seen) };
}

/**
 * @returns {Promise<{ added: number, marked: number, removed?: number, heldOff?: number, pages: number, via?: string, error?: string }>}
 *   added = films new to the library, marked = films already known that are now on the watchlist, removed = films taken off because
 *   their activity row is gone, heldOff = how many would have been removed but looked like a glitch.
 */
export async function refreshWatchlist(store, http, username, { signal, now, problems = NO_PROBLEMS, log = null } = {}) {
  let out = { added: 0, marked: 0, pages: 0 };
  const user = String(username || '').trim().replace(/^@/, '');
  if (!user) return out;
  let act = null, threw = false;
  try { act = await fromActivity(store, http, user, { signal, now, problems, log }, out); }
  catch (e) {
    if (e?.code === 'aborted') return out;
    threw = true;
    problems.report({ area: 'Watchlist refresh', message: "Matinee couldn't read your Letterboxd activity feed, so it checked your watchlist page instead.", error: e, level: 'warning' });
  }
  if (act) out.via = 'activity';
  else if (!threw && !signal?.aborted) problems.report({ area: 'Watchlist refresh', message: "Letterboxd wouldn't show your activity page, so Matinee couldn't check for films you've taken off your watchlist. It looked at your watchlist page instead.", level: 'warning' });
  if (!act || !act.reached) out = await fromWatchlistPage(store, http, user, { signal, now }, out);
  if (out.error) problems.report({ area: 'Watchlist refresh', message: `Matinee couldn't check your Letterboxd watchlist: ${out.error}`, level: 'error' });
  // The check only moves forward once everything up to it was read.
  if (act?.newest && !out.error) {
    const sync = store.library.sync || (store.library.sync = {});
    if (!sync.watchlistSeenAt || act.newest > sync.watchlistSeenAt) { sync.watchlistSeenAt = act.newest; store.touch('library'); }
  }
  return out;
}

async function fromWatchlistPage(store, http, user, { signal, now }, out) {
  const fresh = []; // collected first, applied only if every request worked
  try {
    for (let n = 1; n <= MAX_PAGES; n++) {
      if (signal?.aborted) return out;
      const p = await readPage(http, pageUrl(user, n), signal);
      if (!p) return { ...out, error: 'Letterboxd would not show the watchlist.' };
      out.pages++;
      let allNew = p.items.length > 0, stop = false;
      for (const item of p.items) {
        const have = findFilm(store, item);
        const u = have && store.library.films[have.key];
        if (u?.watchlist) { stop = true; allNew = false; break; }
        if (u?.watched || u?.watchlistRemovedAt) { allNew = false; continue; } // watched films are never touched; ones the user removed here stay removed (the page has no dates)
        fresh.push(item);
      }
      if (stop || !allNew || !p.hasNext) break;
    }
  } catch (e) {
    if (e?.code === 'aborted') return out;
    return { ...out, error: e?.message || 'The watchlist could not be read.' };
  }
  apply(store, fresh, day(now), out);
  out.via = out.via ? 'activity+watchlist' : 'watchlist';
  return out;
}
