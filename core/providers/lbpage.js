// Letterboxd film-page provider (no key). Reads a film's public Letterboxd page and keeps what the crowd says about it:
// the average rating and count, theme and mini-theme keywords, genres, the tagline and a few popular review excerpts.
// Only runs for films with a known Letterboxd slug. Pages are paced by core/net.js (one at a time, a few seconds apart).
// Each page is first read with a plain browser-style request (fast). If Letterboxd answers with a check, a 403 or
// something that isn't a film page, we never push on (a 429 is different: it just stops the pass, see below): for the rest of that run pages are opened in the page window
// (http.page), which shows the user the check to complete. A plain request is not tried again after that.
import { HttpError } from '../net.js';
import { defaultWants, lastLook } from '../enrich.js';
import { parseLetterboxdFilm } from '../parse/lbpage.js';

const NAME = 'Letterboxd film page';
const BLOCKS_IN_A_ROW = 3;
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const slugOf = film => String(film.slug || film.ids?.letterboxd || '').trim().replace(/^\/+|\/+$/g, '');
const isChallenge = text => /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i.test(String(text || ''));

/** What gets stored: the parsed object without empty fields. null when the page had nothing useful. */
export function toData(parsed) {
  if (!parsed) return null;
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  // Letterboxd's own average (0–5) and rating count feed the Matinee score and the film page via compose().
  if (out.average != null) out.ratings = { letterboxd: { value: out.average, votes: out.ratingCount ?? null } };
  return Object.keys(out).length ? out : null;
}

const classify = res => {
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 429) return { kind: 'blocked', status: 429, rateLimited: true }; // the network layer pauses the host; never switch route
  if (res.status === 403 || isChallenge(res.text)) return { kind: 'blocked', status: res.status };
  return null;
};

/** Plain request. Returns a result, or null when we should switch to the window (challenge, 403/429, not a film page). */
async function getPlain(http, url, signal) {
  let res;
  try { res = await http.browserText(url, { signal }); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 429) return { kind: 'blocked', status: 429, rateLimited: true, code: e.code };
    if (e?.status === 403) return null;
    throw e;
  }
  const c = classify(res);
  if (c?.kind === 'missing' || c?.rateLimited) return c;
  if (c) return null;
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
  const parsed = parseLetterboxdFilm(res.text);
  return parsed ? { kind: 'ok', parsed } : null;
}

async function getWindow(http, url, slug, signal) {
  let res;
  try { res = await http.page(url, { signal, waitFor: '.js-review-body' }); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status, rateLimited: e.status === 429, code: e.code };
    throw e;
  }
  const c = classify(res);
  if (c) return c;
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
  const parsed = parseLetterboxdFilm(res.text);
  if (!parsed) throw new Error(`${NAME}: the page for ${slug} did not look like a film page.`);
  return { kind: 'ok', parsed };
}

/** `state.useWindow` lives for one run: once set, plain requests are not tried again. */
async function getPage(http, slug, signal, state, log) {
  const url = `https://letterboxd.com/film/${encodeURIComponent(slug)}/`;
  // A quiet refresh never opens the page window: if the plain request doesn't get a page, stop and try another day.
  if (state.silent) {
    const r = typeof http.browserText === 'function' ? await getPlain(http, url, signal) : null;
    return r || { kind: 'blocked', status: 0 };
  }
  if (!state.useWindow && typeof http.browserText === 'function') {
    const r = await getPlain(http, url, signal);
    if (r) return r;
    state.useWindow = true;
    log('Letterboxd wants a closer look, so film pages are now opened in a page window for the rest of this refresh.');
  }
  return getWindow(http, url, slug, signal);
}

export default {
  id: 'lbpage',
  label: NAME,
  gives: ['crowd themes', 'popular reviews'],
  needsKey: false,
  requires: film => !!slugOf(film),
  startsAfter: 'boxd', // only needs the Letterboxd slug, so it can start as soon as boxd has run (see enrich.js)
  refreshDays: 120,
  since: '2026-10-28', // re-run once now that poster, synopsis, facts, names and ids are stored too (earlier: Australian dates, then average and count)
  retryMissDays: 45,

  // Also look again (at most weekly) at recent films with no Australian date yet: cinema dates appear as a release nears.
  wants(film, opts = {}) {
    if (defaultWants(this, film, opts)) return true;
    // Stored by an older version that didn't keep the poster, summary or ids: look once more (at most every 3 days), whatever the dates say.
    const stored = film.src?.lbpage;
    if (stored && Object.keys(stored).length && !film.missed?.lbpage && !stored.poster && !stored.synopsis && !stored.ids && !stored.ausRelease && this.requires(film) && (opts.now ?? Date.now()) - lastLook(film, 'lbpage') > 3 * 864e5) return true;
    const checked = film.checked?.lbpage;
    if (!checked || film.src?.lbpage?.ausRelease || film.missed?.lbpage || !this.requires(film)) return false;
    const now = opts.now ?? Date.now();
    return Number(film.year) >= new Date(now).getUTCFullYear() - 1 && now - lastLook(film, 'lbpage') > 7 * 864e5;
  },

  async enrich(films, ctx) {
    let finished = 0, streak = 0;
    const state = { useWindow: false, silent: !!ctx.silent };
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      let r;
      try { r = await getPage(ctx.http, slugOf(film), ctx.signal, state, ctx.log); }
      catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      if (r.kind === 'blocked') {
        // status and code ride along so a paused site (host-paused / 429) is told apart from a real refusal
        ctx.fail(film, Object.assign(new Error(`${NAME} turned the request away (HTTP ${r.status}).`), { ...(r.status ? { status: r.status } : {}), ...(r.code ? { code: r.code } : {}) }));
        if (ctx.silent || r.rateLimited) return; // quietly leave the rest for another day (a 429 means the host is paused: stop, don't push on)
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log('Letterboxd keeps turning page requests away, so we have stopped reading film pages for now. The rest will be checked next time you refresh.');
          return;
        }
      } else {
        streak = 0;
        ctx.done(film, r.kind === 'ok' ? toData(r.parsed) : null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
