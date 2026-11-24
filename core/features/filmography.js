// A person's complete filmography with what you've seen. The network part (their films, ratings, posters) is cached for
// 30 days; your watched/rating status is merged in fresh on every call so it never goes stale.
import { NO_PROBLEMS } from '../problems.js';
import { personFilms } from './wikidata-graph.js';
import { DAY, libraryMatcher, userStatus, linksFor, imdbRatings, addPosters } from './shared.js';

const MAX_AGE = 30 * DAY;
const UNSEEN_POSTERS = 20;
const ALL_ROLES = ['director', 'writer', 'cinematography', 'composer', 'cast'];

/** This person's entry (name, QID) and the library films they appear in, from the summaries. */
function findPerson(summaries, personId) {
  let name = null, qid = null;
  const inLibrary = new Map(); // film key → { summary, roles }
  for (const s of summaries || []) {
    for (const [role, list] of Object.entries(s.people || {})) {
      for (const p of list || []) {
        if (p?.id !== personId) continue;
        name = name || p.name;
        if (!qid && /^wd:Q\d+$/.test(p.sourceId || '')) qid = p.sourceId.slice(3);
        const e = inLibrary.get(s.key) || { summary: s, roles: [] };
        if (!e.roles.includes(role)) e.roles.push(role);
        inLibrary.set(s.key, e);
      }
    }
  }
  return { name, qid, inLibrary };
}

const byYear = (a, b) => (a.year ?? 1e9) - (b.year ?? 1e9) || String(a.title).localeCompare(String(b.title));

/**
 * @returns {Promise<{ person: { id, name, qid }, films: object[], seen: number, total: number, partial?: boolean }>}
 */
export async function filmography({ store, http, summaries, personId, signal, problems = NO_PROBLEMS }) {
  const { name, qid, inLibrary } = findPerson(summaries, personId);
  if (!name) throw Object.assign(new Error("That person isn't in your library any more."), { code: 'not-found' });
  const person = { id: personId, name, qid: qid ? `wd:${qid}` : null };

  const libraryRow = ({ summary: s, roles }) => ({
    id: s.ids?.wikidata ? `wd:${s.ids.wikidata}` : `lib:${s.key}`, title: s.title, year: s.year ?? null, roles, key: s.key,
    ...userStatus(store, s.key), poster: s.poster || null, imdb: s.ratings?.imdb || null, ratings: s.ratings || null,
    links: linksFor({ imdb: s.ids?.imdb, enwiki: s.ids?.enwiki }),
  });
  const finish = films => {
    films.sort(byYear);
    return { films, seen: films.filter(f => f.watched).length, total: films.length };
  };

  if (!qid) {
    return { person, ...finish([...inLibrary.values()].map(libraryRow)), partial: true };
  }

  const cacheName = `filmography:${qid}`;
  let raw = store.cached(cacheName, MAX_AGE);
  if (!raw) {
    const result = await personFilms(http, [qid], { signal, roles: ALL_ROLES, problems });
    const lib = libraryMatcher(store);
    // Shorts are left out unless you've logged one.
    const films = (result.get(qid) || []).filter(f => f.kind !== 'short' || lib.find(f)).map(f => ({ ...f, imdbId: f.imdb, imdb: null, poster: null }));
    const ratings = await imdbRatings(http, films.map(f => f.imdbId), { signal, problems });
    for (const f of films) { const r = ratings.get(f.imdbId); f.imdb = r ? { value: r.value, votes: r.votes } : null; }
    const unseen = films.filter(f => !lib.find(f)).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    await addPosters(http, unseen, { limit: UNSEEN_POSTERS, signal, problems });
    raw = store.setCached(cacheName, { films });
  }

  const lib = libraryMatcher(store);
  const used = new Set();
  // Two Wikidata items can match one library film (a remake with the same name): the exact id match wins, the other is dropped.
  const matched = raw.films.map(f => ({ f, key: lib.find(f) }));
  for (const m of matched) if (m.key && store.films[m.key]?.ids?.wikidata === m.f.id.slice(3)) used.add(m.key);
  const taken = new Set();
  const rows = matched.filter(m => {
    if (!m.key) return true;
    const exact = store.films[m.key]?.ids?.wikidata === m.f.id.slice(3);
    if (taken.has(m.key) || (!exact && used.has(m.key))) return false;
    taken.add(m.key);
    return true;
  }).map(({ f, key }) => {
    const entry = key ? inLibrary.get(key) : null;
    if (key) used.add(key);
    const row = {
      id: f.id, title: f.title, year: f.year, roles: f.roles, key: key || null, ...userStatus(store, key),
      poster: key ? (entry?.summary.poster || store.films[key]?.src?.wikipedia?.poster || f.poster || null) : f.poster || null,
      imdb: f.imdb, links: linksFor({ imdb: f.imdbId, enwiki: f.enwiki }),
      // Library films carry every score we hold; others only have IMDb (no Letterboxd/RT without a fetch).
      ratings: entry?.summary.ratings || null,
    };
    if (entry) row.roles = [...new Set([...f.roles, ...entry.roles])];
    return row;
  });
  // Films in your library with this person that Wikidata doesn't credit them on.
  for (const [key, e] of inLibrary) if (!used.has(key)) rows.push(libraryRow(e));
  return { person, ...finish(rows) };
}
