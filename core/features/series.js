// Progress through a film series. TMDB's collection first (complete, release dates, posters), else Wikidata's "part of the series".
// Members are cached for 30 days; your status is merged in fresh.
import { NO_PROBLEMS, filmLabel } from '../problems.js';
import { seriesMembers } from './wikidata-graph.js';
import { fetchTmdbCollection, seriesName } from './tmdb-collection.js';
import { isEdition } from './series-rules.js';
import { DAY, libraryMatcher, userStatus, addPosters, letterboxdUrl } from './shared.js';

const MAX_AGE = 30 * DAY;
const UNSEEN_POSTERS = 12;

// Release order: Wikidata's series ordinals are patchy (Mad Max 1979 had none, so it sorted after Fury Road). Unreleased films last.
const order = (a, b) => (a.year == null) - (b.year == null) || (a.year ?? 0) - (b.year ?? 0)
  || (a.ordinal ?? 1e9) - (b.ordinal ?? 1e9) || String(a.title).localeCompare(String(b.title));

/** The series from TMDB's collection, or null (no key, no collection, or TMDB didn't answer: then Wikidata is used). */
async function fromTmdb({ store, http, summaries, key, signal, problems = NO_PROBLEMS }) {
  const tk = String(store.library?.settings?.keys?.tmdb || '').trim();
  const t = store.films?.[key]?.src?.tmdb;
  if (!tk || !(t?.collectionId || t?.collection)) return null;
  const cacheName = `seriesT:${t.collectionId || seriesName(t.collection).toLowerCase()}`;
  let raw = store.cached(cacheName, MAX_AGE);
  if (!raw) {
    try { raw = await fetchTmdbCollection({ http, key: tk, id: t.collectionId ?? null, name: t.collection, signal }); } catch (e) {
      if (e?.code === 'aborted') throw e;
      problems.report({ area: 'TMDB', film: filmLabel(store.films?.[key]), message: "Couldn't load this series from TMDB, so Wikidata was used instead.", error: e, level: 'warning' });
      return null;
    }
    if (!raw || !raw.films.length) return null; // not remembered: a miss here may be a name search that a later re-read fixes
    raw = store.setCached(cacheName, raw);
  }
  const byTmdb = new Map();
  for (const [k, f] of Object.entries(store.films || {})) if (f.ids?.tmdb != null) byTmdb.set(String(f.ids.tmdb), k);
  const lib = libraryMatcher(store);
  const posterOf = new Map((summaries || []).map(s => [s.key, s.poster]));
  const films = raw.films.map(f => {
    const k = byTmdb.get(String(f.tmdbId)) || lib.find({ id: '', title: f.title, year: f.year });
    return {
      id: `tmdb:${f.tmdbId}`, title: f.title, year: f.year, ordinal: null, key: k || null, ...userStatus(store, k),
      poster: (k && posterOf.get(k)) || f.poster || null,
      url: k ? null : letterboxdUrl({ tmdbId: f.tmdbId, title: f.title, year: f.year }),
    };
  });
  return { id: `tmdb:${raw.tmdbId}`, name: raw.name || 'Series', films, seen: films.filter(f => f.watched).length, total: films.length };
}

/**
 * @returns {Promise<{ id: string, name: string, films: object[], seen: number, total: number } | null>} null when the film isn't part of a known series
 */
export async function series({ store, http, summaries, key, signal, problems = NO_PROBLEMS }) {
  const fromT = await fromTmdb({ store, http, summaries, key, signal, problems });
  if (fromT) return fromT;
  const collectionId = store.films?.[key]?.src?.wikidata?.collectionId;
  if (!collectionId) return null;
  const qid = collectionId.replace(/^wd:/, '');

  const cacheName = `series2:${qid}`;
  let raw = store.cached(cacheName, MAX_AGE);
  if (!raw) {
    const found = (await seriesMembers(http, [qid], { signal, problems })).get(qid);
    // "Not a series" is remembered too, so opening the film again doesn't ask Wikidata again.
    if (!found || !found.films.length) { store.setCached(cacheName, { name: null, films: [] }); return null; }
    const lib = libraryMatcher(store);
    const films = found.films.filter(f => f.kind !== 'short' || lib.find(f)).map(f => ({ ...f, poster: null }));
    await addPosters(http, films.filter(f => !lib.find(f)).sort(order), { limit: UNSEEN_POSTERS, signal, problems });
    raw = store.setCached(cacheName, { name: found.name, films });
  }

  if (!raw.films.length) return null;
  const lib = libraryMatcher(store);
  const posterOf = new Map((summaries || []).map(s => [s.key, s.poster]));
  const used = new Set();
  const films = raw.films.map(f => {
    const k = lib.find(f);
    if (k) used.add(k);
    return {
      id: f.id, title: f.title, year: f.year, ordinal: f.ordinal ?? null, key: k || null, ...userStatus(store, k),
      poster: k ? posterOf.get(k) || f.poster || null : f.poster || null,
      url: k ? null : letterboxdUrl({ title: f.title, year: f.year }),
    };
  });
  // Library films tagged with this series that Wikidata doesn't list as members.
  for (const [k, film] of Object.entries(store.films)) {
    if (used.has(k) || film.src?.wikidata?.collectionId !== collectionId || isEdition(film.title)) continue;
    films.push({ id: film.ids?.wikidata ? `wd:${film.ids.wikidata}` : `lib:${k}`, title: film.title, year: film.year ?? null, ordinal: null, key: k, ...userStatus(store, k), poster: posterOf.get(k) || null });
  }
  films.sort(order);
  const name = raw.name || String(store.films[key].src?.wikidata?.collection || '').replace(/\s+collection$/i, '') || 'Series';
  return { id: collectionId, name, films, seen: films.filter(f => f.watched).length, total: films.length };
}
