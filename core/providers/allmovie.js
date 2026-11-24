// AllMovie provider (no key). Finds the film by title and year, then reads its Moods / Themes / Flags / Tone descriptors
// from the public page, the way a browser would. Polite: paced per host (core/net.js), stops when blocked repeatedly.
import { normTitle } from '../model.js';
import { parseAllMovie, parseAllMovieSearch } from '../parse/allmovie.js';

const NAME = 'AllMovie';
const BASE = 'https://www.allmovie.com';
const BLOCKS_IN_A_ROW = 3;
const CHECK_TITLE = /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i;
// Film pages carry the descriptor groups; the search page is server-rendered, so a short settle is enough.
const FILM_WAIT = { waitFor: '.charactList', settleMs: 1200 };
const SEARCH_WAIT = { settleMs: 600 };
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

/** A plain browser-style request first (about 2.5 s, many at once); the page window only when that gave nothing readable. (A Test fetch, 29 Oct: plain worked 3/3.) */
async function plainFirst(http, url, signal, ok) {
  if (typeof http.browserText !== 'function') return null;
  try {
    const res = await http.browserText(url, { signal });
    if (res.status >= 200 && res.status < 300 && ok(String(res.text || ''))) return res;
  } catch (e) { if (e?.code === 'aborted') throw e; /* anything else: use the window */ }
  return null;
}
const looksLikeResults = t => !CHECK_TITLE.test(t) && /class="results\b|<title[^>]*>[^<]*AllMovie/i.test(t);
const looksLikeFilm = t => !CHECK_TITLE.test(t) && /charactList/.test(t);

/** @returns {{kind:'ok'|'missing'|'blocked', text?:string, status?:number}} */
async function get(http, url, signal, wait, search = false) {
  let res = await plainFirst(http, url, signal, search ? looksLikeResults : looksLikeFilm);
  try { if (!res) res = await http.page(url, { signal, ...wait }); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status };
    throw e;
  }
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 403 || res.status === 429 || res.status === 202) return { kind: 'blocked', status: res.status };
  if (res.status < 200 || res.status >= 300) throw new Error(`${NAME}: HTTP ${res.status}`);
  const text = String(res.text || '');
  if (CHECK_TITLE.test(text) || (search && !/class="results\b|<title[^>]*>[^<]*AllMovie/i.test(text))) return { kind: 'blocked', status: res.status, unreadable: true };
  return { kind: 'ok', text };
}

export function pickResult(results, film) {
  const want = normTitle(film.title);
  const hits = results.filter(r => normTitle(r.title) === want && r.year && Math.abs(r.year - film.year) <= 1);
  // Prefer the exact year over a neighbouring one
  return hits.find(r => r.year === film.year) || hits[0] || null;
}

export default {
  id: 'allmovie',
  independent: true, // matches by title and year only, so it can start before the id stage finishes
  label: NAME,
  gives: ['moods', 'themes', 'tone', 'flags'],
  needsKey: false,
  requires: film => !!(film.title && film.year),
  refreshDays: 365,
  retryMissDays: 60,

  async enrich(films, ctx) {
    let finished = 0, streak = 0;
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      let search, page = null, hit = null;
      try {
        search = await get(ctx.http, `${BASE}/search/movies/${encodeURIComponent(film.title)}`, ctx.signal, SEARCH_WAIT, true);
        if (search.kind === 'ok') {
          hit = pickResult(parseAllMovieSearch(search.text), film);
          if (hit) page = await get(ctx.http, `${BASE}/movie/${hit.slug}`, ctx.signal, FILM_WAIT);
        }
      } catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      const blocked = [search, page].find(r => r?.kind === 'blocked');
      if (blocked) {
        ctx.fail(film, new Error(blocked.unreadable ? `${NAME} returned a page we could not read.` : `${NAME} turned the request away (HTTP ${blocked.status}).`));
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log(`AllMovie keeps turning requests away (HTTP ${blocked.status}), so we have stopped asking for moods and themes for now. The rest will be checked next time you refresh.`);
          return;
        }
      } else {
        streak = 0;
        const parsed = page?.kind === 'ok' ? parseAllMovie(page.text) : null;
        if (parsed) ctx.done(film, { id: hit.id, ...parsed }, { allmovie: hit.id });
        else ctx.done(film, null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
