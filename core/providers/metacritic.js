// Metacritic provider (no key). Reads the Metascore (from the page's ld+json) and the user score (from the page
// markup). The page id (e.g. "movie/paris-texas") normally comes from Wikidata; when it is missing we try the slugs
// Metacritic usually uses and only accept a page whose year and title match the film.
import { HttpError } from '../net.js';
import { normTitle } from '../model.js';
import { isNonFilmPage, parseMetacritic } from '../parse/critics.js';

const BASE = 'https://www.metacritic.com/';
const NAME = 'Metacritic';
const BLOCKS_IN_A_ROW = 3;
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

/** "Paris, Texas" → "paris-texas" (lowercase, accents and apostrophes dropped, anything else non-alphanumeric → "-"). */
export const mcSlug = title => String(title || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’`]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** The ids to try, in order, for a film with no known id. */
export function mcGuesses(film) {
  const base = mcSlug(film.title);
  if (!base || !film.year) return [];
  return [`movie/${base}`, `movie/${base}-${film.year}`];
}

const cleanId = id => String(id || '').trim().replace(/^\/+|\/+$/g, '');

/** A page is the right film when its year is within a year of ours and its title reads the same. */
export function matchesFilm(film, parsed) {
  if (!parsed || parsed.year == null || !film.year) return false;
  return Math.abs(parsed.year - film.year) <= 1 && normTitle(parsed.title) === normTitle(film.title);
}

/** What goes into src.metacritic: only the scores the page really had. null when it had none. */
export function toData(parsed) {
  if (!parsed) return null;
  const mc = {};
  for (const k of ['critics', 'criticsCount', 'users', 'usersCount']) if (parsed[k] != null) mc[k] = parsed[k];
  return mc.critics != null || mc.users != null ? { ratings: { metacritic: mc } } : null;
}

const REDIRECTS = [301, 302, 307, 308];
const pathOf = u => { try { return cleanId(new URL(u).pathname); } catch { return ''; } };
// Metacritic answers a request that looks like a script's fetch (accept */*, sec-fetch-mode cors) to a moved page with a bare
// "301" JSON error and NO Location header, which is why moved films failed with "HTTP 301". A page navigation gets a proper
// redirect, so ask like one. (Chromium may ignore sec-fetch-mode; the year-suffixed fallback below covers that.)
const NAV = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'upgrade-insecure-requests': '1' };

/**
 * GET a Metacritic page, following redirects on the same host (at most 2 hops) even when the fetcher hands the redirect back as a
 * status. Metacritic now moves "movie/alien" to "movie/alien-1979". When a redirect has no Location (see NAV) and `fallback` is
 * given, that URL is tried once. Returns { res, url } (url = where it landed), or null when the redirect could not be followed
 * (no Location and no fallback, another host, too many hops): the caller treats that as a miss, not a failure.
 */
export async function getFollowing(http, url, signal, fallback) {
  const get = u => http.text(u, { browser: true, signal, headers: NAV });
  let res = await get(url);
  let at = res.url || url;
  for (let hop = 0; hop < 2 && REDIRECTS.includes(res.status); hop++) {
    const loc = res.headers?.get?.('location');
    let next;
    try { next = loc ? new URL(loc, url).href : (hop === 0 ? fallback : null); } catch { return null; }
    if (!next || new URL(next).host !== new URL(url).host) return null;
    res = await get(next);
    at = res.url || next;
  }
  return REDIRECTS.includes(res.status) ? null : { res, url: at };
}

/** The year Metacritic puts on the end of a slug ("movie/alien-1979" → 1979), or null. */
export const slugYear = id => { const m = /-((?:18|19|20)\d\d)$/.exec(String(id || '')); return m ? Number(m[1]) : null; };

/** A page we were redirected to is the same film when its year is within a year of ours. */
export const yearFits = (film, year) => year != null && !!film.year && Math.abs(year - film.year) <= 1;

/** One page request, sorted into: ok (parsed), missing (404, or a redirect to some other film), blocked (403/429), unreadable. */
async function getPage(http, id, signal, film) {
  const url = `${BASE}${id}/`;
  let got;
  const year = film?.year, withYear = year && !slugYear(id) ? `${BASE}${id}-${year}/` : undefined;
  try { got = await getFollowing(http, url, signal, withYear); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status };
    throw e;
  }
  if (!got) return { kind: 'missing' };
  const { res } = got;
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 403 || res.status === 429) return { kind: 'blocked', status: res.status };
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
  const parsed = parseMetacritic(res.text);
  // A loaded page about something else (a TV series) is a miss, not a failure; only unreadable pages are failures.
  if (!parsed) return isNonFilmPage(res.text) ? { kind: 'missing' } : { kind: 'unreadable' };
  const landed = pathOf(got.url);
  const moved = landed !== id;
  if (moved) {
    // Moved to a year-suffixed slug: accept only when it is the same film (year within one), else it is some other film.
    if (!/^movie\/[^/]+$/.test(landed)) return { kind: 'missing' };
    if (!yearFits(film || {}, parsed.year) && !yearFits(film || {}, slugYear(landed))) return { kind: 'missing' };
  } else if (film?.year && parsed.year != null && !yearFits(film, parsed.year) && !yearFits(film, slugYear(id))) {
    // (A year-suffixed slug that fits is trusted over the page's own year, which can be a re-release: solaris-1972 shows 1976.)
    // A known id that loads straight away but is another film's page (Solaris 1972 → the 2002 "movie/solaris"): try the year-suffixed
    // slug once. If that fits it replaces the id (the caller stores page.id); if not, this is a miss and nothing is stored.
    if (slugYear(id)) return { kind: 'missing' };
    return getPage(http, `${id}-${film.year}`, signal, film);
  }
  return { kind: 'ok', parsed, id: moved ? landed : id };
}

/** Find a film's page: its known id, or the first guess that checks out. */
async function lookup(film, ctx) {
  // A stored id (often from Wikidata) can be out of date: when its page is gone, fall back to the guesses
  // (The Moon 2023: Wikidata's movie/the-moon-2023 is a 404, the real page is movie/the-moon).
  const known = cleanId(film.ids?.metacritic);
  if (known) {
    const page = await getPage(ctx.http, known, ctx.signal, film);
    if (page.kind !== 'missing') return page;
  }
  for (const guess of mcGuesses(film)) {
    if (guess === known) continue;
    const page = await getPage(ctx.http, guess, ctx.signal, film);
    if (page.kind === 'blocked' || page.kind === 'unreadable') return page;
    if (page.kind === 'ok' && matchesFilm(film, page.parsed)) return page;
  }
  return { kind: 'missing' };
}

export default {
  id: 'metacritic',
  label: NAME,
  gives: ['Metascore', 'user score'],
  needsKey: false,
  refreshDays: 14,
  retryMissDays: 30,
  // Not out yet: neither counted nor pending; re-evaluated each run, so it enters on 1 January.
  needsIds: ['metacritic'],
  requires: film => !(film.year && film.year > new Date().getFullYear()),

  async enrich(films, ctx) {
    const thisYear = new Date().getFullYear();
    let finished = 0, streak = 0;
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      // Not out yet (requires() normally filters these): record nothing, so it is looked at again later.
      if (film.year && film.year > thisYear) { ctx.progress(++finished, films.length); continue; }
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      let page;
      try { page = await lookup(film, ctx); }
      catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      if (page.kind === 'blocked' || page.kind === 'unreadable') {
        const why = page.kind === 'blocked'
          ? new Error(`${NAME} turned the request away (HTTP ${page.status}).`)
          : new Error(`${NAME} sent back a page that could not be read.`);
        ctx.fail(film, why);
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log(page.kind === 'blocked'
            ? `${NAME} keeps turning requests away (HTTP ${page.status}), so we have stopped asking for now. The rest will be checked next time you refresh.`
            : `${NAME} sent back pages we could not read ${BLOCKS_IN_A_ROW} times in a row, so we have stopped asking for now. The rest will be checked next time you refresh.`);
          return;
        }
      } else {
        streak = 0;
        if (page.kind === 'ok') {
          // Record the id when we had to guess it, even if the page has no scores yet.
          // A known id that moved (e.g. to a year-suffixed slug) is replaced, so later reads go straight to the right page.
          if (film.ids?.metacritic && film.ids.metacritic !== page.id) film.ids.metacritic = page.id;
          const ids = cleanId(film.ids?.metacritic) === page.id ? undefined : { metacritic: page.id }; // a guessed or corrected id is kept
          const data = toData(page.parsed);
          // A released film whose page loads but shows no scores at all may mean the site changed its pages (counted by the trouble notice).
          if (!data && film.year && film.year <= thisYear - 1) ctx.done(film, null, ids, { hollow: 'no scores on the page' });
          else ctx.done(film, data, ids);
        } else ctx.done(film, null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
