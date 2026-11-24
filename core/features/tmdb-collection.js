// A film series from TMDB's collections (fast, complete, with posters and release dates):
//   fetchTmdbCollection({ http, key, id, name, signal }) -> { tmdbId, name, films: [{ tmdbId, title, year, date, poster }] } | null
// With no id (films read before the id was stored), the collection is found by searching its exact name.
// Built from TMDB's documented shapes; the network path is fixture-tested only (no TMDB key in the cloud).
import { authFor } from '../providers/tmdb.js';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Strip TMDB's " Collection" suffix: "Mad Max Collection" → "Mad Max". */
export const seriesName = name => String(name || '').replace(/\s+collection$/i, '').trim();

/** TMDB's /collection/{id} body → our shape, oldest first; unreleased films (no date) go last. */
export function mapCollection(body) {
  if (!body || !Array.isArray(body.parts)) return null;
  const films = body.parts.filter(p => p && p.id != null && p.title).map(p => ({
    tmdbId: p.id, title: p.title,
    date: p.release_date || null,
    year: /^\d{4}/.test(p.release_date || '') ? Number(p.release_date.slice(0, 4)) : null,
    poster: p.poster_path ? IMG + p.poster_path : null,
  }));
  films.sort((a, b) => (a.date == null) - (b.date == null) || String(a.date).localeCompare(String(b.date)) || a.title.localeCompare(b.title));
  return { tmdbId: body.id, name: seriesName(body.name), films };
}

export async function fetchTmdbCollection({ http, key, id = null, name = null, signal } = {}) {
  const auth = authFor(key);
  const get = (path, params = {}) => http.json(`${BASE}${path}?${new URLSearchParams({ ...auth.params, language: 'en-US', ...params })}`, { headers: auth.headers, signal, priority: 0 });
  let cid = id;
  if (cid == null) {
    if (!name) return null;
    const hits = (await get('/search/collection', { query: name }))?.results || [];
    const exact = hits.find(h => norm(h.name) === norm(name)); // a near-miss is more likely another series
    if (!exact) return null;
    cid = exact.id;
  }
  return mapCollection(await get(`/collection/${encodeURIComponent(cid)}`));
}
