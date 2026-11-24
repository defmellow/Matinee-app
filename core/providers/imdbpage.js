// IMDb keywords and reviews provider (no key). Reads plot keywords and a few review excerpts from a film's public IMDb
// pages, the way a browser would. Only runs for films whose IMDb id is already known. Polite: one page at a time, paced
// per host (core/net.js), and it stops when IMDb keeps turning requests away.
import { parseImdbKeywords, parseImdbReviews } from '../parse/imdbpage.js';

const NAME = 'IMDb keywords and reviews';
const BLOCKS_IN_A_ROW = 3;
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const CHECK_TITLE = /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i;
const imdbId = film => (/^tt\d+$/.test(String(film.ids?.imdb || '').trim()) ? String(film.ids.imdb).trim() : '');

/** One page: ok (parsed), missing (404), or blocked (403/429/challenge). */
async function getPage(http, url, parse, signal) {
  let res = null;
  // A plain request first (a Test fetch, 29 Oct: 3/3 keyword pages read plain; the window took ~3.5 s each, one at a time). The window is the fallback
  // when the plain page is a check, or has no data block and nothing readable.
  if (typeof http.browserText === 'function') {
    try {
      const r = await http.browserText(url, { signal });
      const t = String(r.text || '');
      if (r.status >= 200 && r.status < 300 && !CHECK_TITLE.test(t) && (t.includes('__NEXT_DATA__') || parse(t).length)) res = r;
      else if (r.status === 404 || r.status === 410) res = r;
    } catch (e) { if (e?.code === 'aborted') throw e; /* use the window */ }
  }
  try { if (!res) res = await http.page(url, { signal, waitFor: '#__NEXT_DATA__', settleMs: 1200 }); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status };
    throw e;
  }
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 403 || res.status === 429 || res.status === 202) return { kind: 'blocked', status: res.status };
  if (res.status < 200 || res.status >= 300) throw new Error(`${NAME}: HTTP ${res.status}`);
  const text = String(res.text || '');
  const items = parse(text);
  // A page with no data block and nothing we could read is not a genuine "no keywords": try again next refresh.
  if (CHECK_TITLE.test(text) || (!items.length && !text.includes('__NEXT_DATA__'))) return { kind: 'blocked', status: res.status, unreadable: true };
  return { kind: 'ok', items };
}

export default {
  id: 'imdbpage',
  label: NAME,
  gives: ['plot keywords', 'audience reviews'],
  needsKey: false,
  requires: film => !!imdbId(film),
  needsIds: ['imdb'],
  refreshDays: 180,
  retryMissDays: 45,

  async enrich(films, ctx) {
    let finished = 0, streak = 0;
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      const id = imdbId(film);
      let kw, rv;
      try {
        // TMDB already gave 10+ keywords: skip the keywords page and keep any stored ones; reviews are still read.
        kw = ctx.keywordsCovered?.(film) ? { kind: 'ok', items: film.src?.imdbpage?.keywords || [] } : await getPage(ctx.http, `https://www.imdb.com/title/${id}/keywords/`, parseImdbKeywords, ctx.signal);
        rv = kw.kind === 'blocked' ? kw : await getPage(ctx.http, `https://www.imdb.com/title/${id}/reviews/`, parseImdbReviews, ctx.signal);
      } catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      const blocked = [kw, rv].find(r => r.kind === 'blocked');
      if (blocked) {
        ctx.fail(film, new Error(blocked.unreadable ? 'IMDb returned a page we could not read.' : `IMDb turned the request away (HTTP ${blocked.status}).`));
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log(`IMDb keeps turning requests away (HTTP ${blocked.status}), so we have stopped asking for keywords and reviews for now. The rest will be checked next time you refresh.`);
          return;
        }
      } else {
        streak = 0;
        const data = { keywords: kw.items || [], reviews: rv.items || [] };
        ctx.done(film, data.keywords.length || data.reviews.length ? data : null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
