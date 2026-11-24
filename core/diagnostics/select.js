// Which films the Test fetch uses: a fixed mix from their own library, topped up from the anchor films when the library is small.
import { compose, normTitle } from '../model.js';

/** The same anchor films scripts/sample-fetch.mjs uses (title, year). */
export const ANCHORS = [
  ['Paris, Texas', 1984], ['Spirited Away', 2001], ['My Neighbor Totoro', 1988], ['Lost in Translation', 2003],
  ['Eternal Sunshine of the Spotless Mind', 2004], ['Moonlight', 2016], ['Portrait of a Lady on Fire', 2019],
  ['Blade Runner', 1982], ['Mad Max: Fury Road', 2015], ['The Grand Budapest Hotel', 2014],
];

const byKeyOrder = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** `n` items spread evenly through a list (stable, no randomness). */
export function spread(list, n) {
  if (n <= 0 || !list.length) return [];
  if (list.length <= n) return [...list];
  return Array.from({ length: n }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / n)]);
}

const isTv = f => compose(f).kind === 'tv' || f.src?.wikidata?.kind === 'tv';
const votesOf = f => Number(f.src?.imdb?.ratings?.imdb?.votes ?? f.src?.imdb?.ratings?.votes ?? f.src?.imdb?.votes);

/**
 * @param {{ films: object, library?: { films?: object } }} store  read only
 * @param {{ count?: number, now?: number }} o
 * @returns {Array<{ film: object, role: 'watched'|'watchlist'|'obscure'|'recent'|'anchor' }>} the real records (clone before use)
 */
export function pickFilms(store, { count = 24, now = Date.now() } = {}) {
  const user = store.library?.films || {};
  const all = Object.values(store.films || {}).filter(f => f && f.title && !isTv(f)).sort(byKeyOrder);
  const used = new Set();
  const out = [];
  const take = (film, role) => { if (film && !used.has(film.key) && out.length < count) { used.add(film.key); out.push({ film, role }); } };

  // One very recent or upcoming film: the soonest one not out yet, else the latest released.
  const dated = all.map(f => ({ f, d: Date.parse(compose(f).released || '') || (f.year ? Date.UTC(f.year, 6, 1) : NaN) })).filter(x => Number.isFinite(x.d));
  const upcoming = dated.filter(x => x.d > now).sort((a, b) => a.d - b.d)[0];
  const recent = upcoming || [...dated].sort((a, b) => b.d - a.d)[0];
  if (recent && count >= 4) take(recent.f, 'recent');
  // One obscure film: the fewest IMDb votes among films that have a count.
  const voted = all.filter(f => Number.isFinite(votesOf(f)) && votesOf(f) > 0 && !used.has(f.key)).sort((a, b) => votesOf(a) - votesOf(b));
  if (voted.length && count >= 4) take(voted[0], 'obscure');

  const slots = count - out.length;
  const watchlistN = Math.min(Math.round(slots * 0.4), slots);
  const watchlist = all.filter(f => user[f.key]?.watchlist && !user[f.key]?.watched && !used.has(f.key));
  const watched = all.filter(f => user[f.key]?.watched && !used.has(f.key)).sort((a, b) => (a.year || 0) - (b.year || 0) || byKeyOrder(a, b));
  for (const f of spread(watchlist, watchlistN)) take(f, 'watchlist');
  for (const f of spread(watched.filter(f => !used.has(f.key)), count - out.length)) take(f, 'watched');
  for (const f of spread(watchlist.filter(f => !used.has(f.key)), count - out.length)) take(f, 'watchlist');

  // Small library: top up from the anchors that are in it, then with bare records (title and year only; the providers do the rest).
  if (out.length < count) {
    const titles = new Map(all.map(f => [normTitle(f.title) + '|' + f.year, f]));
    for (const [title, year] of ANCHORS) {
      if (out.length >= count) break;
      const have = titles.get(normTitle(title) + '|' + year);
      if (have) take(have, 'anchor');
      else out.push({ film: { key: 'anchor:' + normTitle(title).replace(/ /g, '-') + '-' + year, title, year, ids: {}, src: {}, checked: {}, missed: {} }, role: 'anchor' });
    }
  }
  return out;
}

/** A copy of a stored film that looks never fetched, so every source runs. Nothing in the original changes. */
export function freshClone(film, { freshIds = false } = {}) {
  const c = structuredClone(film);
  c.src = c.src?.rss ? { rss: c.src.rss } : {};
  c.checked = {}; c.missed = {}; c.failed = {};
  if (freshIds) { c.ids = {}; if (c.lid) c.slug = null; }
  return c;
}
