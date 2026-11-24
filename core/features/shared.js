// Small helpers shared by Discover, filmographies and series: matching Wikidata items to the library,
// IMDb ratings for a handful of ids, Wikipedia posters, and link building.
import { NO_PROBLEMS, filmLabel } from '../problems.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { readRatings, RATINGS_URL } from '../providers/imdb.js';
import { posterFrom, titleForUrl } from '../providers/wikipedia.js';

export const DAY = 864e5;

export const normTitle = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9À-￿]+/g, ' ').trim();

/** Find library films by Wikidata id, else by normalised title + year (±1: Wikidata dates are often a festival premiere). */
export function libraryMatcher(store) {
  const byQid = new Map();
  const byTitle = new Map();
  for (const [key, film] of Object.entries(store.films || {})) {
    const qid = film.ids?.wikidata;
    if (qid) byQid.set(qid, key);
    for (const t of new Set([film.title, film.originalTitle, film.src?.wikidata?.title].filter(Boolean))) {
      const n = normTitle(t);
      if (!n) continue;
      if (!byTitle.has(n)) byTitle.set(n, []);
      byTitle.get(n).push({ key, year: film.year });
    }
  }
  return {
    /** @param {{ id: string, title: string, year: number|null }} item */
    find(item) {
      const qid = String(item.id || '').replace(/^wd:/, '');
      if (byQid.has(qid)) return byQid.get(qid);
      const hits = byTitle.get(normTitle(item.title));
      if (!hits) return null;
      const hit = hits.find(h => h.year != null && item.year != null && Math.abs(h.year - item.year) <= 1);
      return hit ? hit.key : null;
    },
  };
}

/**
 * THE link for a film that isn't in the library ("outside film"), used by every screen that shows one (person pages, series).
 * Best first: its Letterboxd page (slug), Letterboxd's TMDB or IMDb redirect, else a Letterboxd search for title + year.
 * Outside films everywhere share one shape: { key: null, title, year, poster, url } (UI: OutsideFilmCard in ui/components/film.jsx).
 */
export function letterboxdUrl({ slug = null, tmdbId = null, imdb = null, title = '', year = null } = {}) {
  if (slug) return `https://letterboxd.com/film/${slug}/`;
  if (tmdbId != null) return `https://letterboxd.com/tmdb/${tmdbId}/`;
  if (imdb) return `https://letterboxd.com/imdb/${imdb}/`;
  return `https://letterboxd.com/search/${encodeURIComponent(`${title}${year ? ' ' + year : ''}`.trim())}/`;
}

/** { watched, rating } of a library film (rating on the 1–10 half-star scale). */
export function userStatus(store, key) {
  const u = key ? store.library?.films?.[key] : null;
  return { watched: !!u?.watched, rating: u?.rating ?? null };
}

export function linksFor(item) {
  return {
    letterboxd: item.imdb ? `https://letterboxd.com/imdb/${item.imdb}/` : null,
    imdb: item.imdb ? `https://www.imdb.com/title/${item.imdb}/` : null,
    wikipedia: item.enwiki ? `https://en.wikipedia.org/wiki/${titleForUrl(item.enwiki)}` : null,
  };
}

/** One streamed pass over IMDb's ratings file for these ids → Map(tt → { value, votes }). Failure → empty map. */
export async function imdbRatings(http, ids, { signal, problems = NO_PROBLEMS } = {}) {
  const wanted = new Set([...ids].filter(Boolean));
  if (!wanted.size) return new Map();
  try {
    const res = await http.response(RATINGS_URL, { signal });
    if (!res.ok || !res.body) {
      problems.report({ area: 'IMDb', message: "IMDb's ratings file wasn't available, so some films show no IMDb score here.", error: { status: res.status, message: 'ratings file request failed' }, level: 'warning' });
      return new Map();
    }
    const unzipped = /\bgzip\b/i.test(res.headers.get('content-encoding') || '');
    let found;
    await pipeline(
      Readable.fromWeb(res.body),
      ...(unzipped ? [] : [createGunzip()]),
      async function* (source) {
        const decoder = new TextDecoder();
        for await (const chunk of source) yield decoder.decode(chunk, { stream: true });
      },
      async source => { found = await readRatings(source, wanted); },
      { signal },
    );
    return found || new Map();
  } catch (e) {
    if (e?.code === 'aborted' || e?.name === 'AbortError' || e?.code === 'ABORT_ERR') throw Object.assign(new Error('Stopped.'), { code: 'aborted' });
    problems.report({ area: 'IMDb', message: "Couldn't read IMDb's ratings file, so some films show no IMDb score here.", error: e, level: 'warning' });
    return new Map();
  }
}

/** Wikipedia poster for an article title, or null (no article, no portrait image, or any failure). */
export async function wikipediaPoster(http, enwiki, { signal, problems = NO_PROBLEMS, film = '' } = {}) {
  if (!enwiki) return null;
  try {
    const summary = await http.json(`https://en.wikipedia.org/api/rest_v1/page/summary/${titleForUrl(enwiki)}`, { signal, retry429: false });
    const p = posterFrom(summary);
    return p ? { url: p.url, thumb: p.thumb } : null;
  } catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status !== 404) problems.report({ area: 'Wikipedia', film, message: "Couldn't get a poster from Wikipedia.", error: e, level: 'warning' }); // 404 = no such article: normal
    return null;
  }
}

/** Fetch posters for items that have an article title, at most `limit` requests, two at a time. Mutates `poster` on each item. */
export async function addPosters(http, items, { limit = 40, signal, onStep, problems = NO_PROBLEMS } = {}) {
  const todo = items.filter(i => i.enwiki && !i.poster).slice(0, limit);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const item = todo[next++];
      item.poster = await wikipediaPoster(http, item.enwiki, { signal, problems, film: filmLabel(item) });
      onStep?.();
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Bayesian-style confidence: pulls ratings with few votes towards 6.5. Unrated → 6.0. */
export function confidence(imdb, prior = 6.5, weight = 2500) {
  if (!imdb) return 6.0;
  return (imdb.value * imdb.votes + prior * weight) / (imdb.votes + weight);
}
