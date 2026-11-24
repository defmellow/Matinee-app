// Discover: films you haven't logged by the people you rate highly, plus the missing entries of series you've started.
// Key-less: Wikidata (who made what), IMDb's ratings file, Wikipedia posters. Pure of Electron.
import { NO_PROBLEMS } from '../problems.js';
import { tasteProfile } from '../analysis/taste.js';
import { eligible as released } from '../analysis/eligible.js';
import { personFilms, seriesMembers, filmBasics, CREW_ROLES } from './wikidata-graph.js';
import { libraryMatcher, linksFor, imdbRatings, addPosters, confidence } from './shared.js';

export const MAX_PEOPLE = 6;
export const MAX_SERIES = 25;
export const SECTION_SIZE = 12;
const POSTER_LIMIT = 40;
// DECISION: how much each role counts when choosing the people you love (directors first).
const ROLE_WEIGHT = { director: 1, writer: 0.5, cinematography: 0.5, composer: 0.5 };
const VERB = { director: 'Directed by', writer: 'Written by', cinematography: 'Shot by', composer: 'Scored by' };
// DECISION: each extra loved person on a film adds this much to its rank (IMDb-style 0–10 points).
const LOVED_BONUS = 1.5;

const isRated = s => s?.user && s.user.rating != null && s.user.rating !== '' && s.user.watched !== false;
const stars = ratings => (ratings.reduce((a, b) => a + Number(b), 0) / ratings.length / 2).toFixed(1);

/** The people to look up: id, name, QID, roles you rate them in, how many films you've rated and the average. */
export function lovedPeople(summaries, limit = MAX_PEOPLE) {
  const profile = tasteProfile(summaries);
  const people = new Map();
  for (const s of summaries || []) {
    for (const role of CREW_ROLES) {
      for (const p of s.people?.[role] || []) {
        if (!p?.id) continue;
        let e = people.get(p.id);
        if (!e) { e = { id: p.id, name: p.name, qid: null, roles: new Set(), films: new Map() }; people.set(p.id, e); }
        if (/^wd:Q\d+$/.test(p.sourceId || '')) e.qid = p.sourceId.slice(3);
        const a = profile.features.get(`${role}:${p.id}`);
        if (a && a.count >= 2 && a.affinity > 0) e.roles.add(role);
        if (isRated(s)) e.films.set(s.key, Number(s.user.rating));
      }
    }
  }
  const out = [];
  for (const e of people.values()) {
    if (!e.qid || !e.roles.size || e.films.size < 2) continue;
    const affinity = Math.max(...[...e.roles].map(r => profile.features.get(`${r}:${e.id}`).affinity * ROLE_WEIGHT[r]));
    const ratings = [...e.films.values()];
    out.push({ id: e.id, name: e.name, qid: e.qid, roles: [...e.roles], rated: ratings.length, average: stars(ratings), affinity });
  }
  out.sort((a, b) => b.affinity - a.affinity || b.rated - a.rated || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

/** Series you've started: collection QID → { watched: Set of film keys }. Needs src.wikidata.collectionId on film records. */
function startedSeries(store) {
  const out = new Map();
  for (const [key, film] of Object.entries(store.films || {})) {
    const id = film.src?.wikidata?.collectionId;
    if (!id || !store.library.films[key]?.watched) continue;
    const q = id.replace(/^wd:/, '');
    if (!out.has(q)) out.set(q, new Set());
    out.get(q).add(key);
  }
  return out;
}

const oneItem = f => ({
  id: f.id, title: f.title, year: f.year, kind: f.kind === 'tv' ? 'tv' : 'film', poster: null, imdb: null,
  runtime: f.runtime ?? null, genres: [], directors: [], reasons: [], links: linksFor(f),
  enwiki: f.enwiki, imdbId: f.imdb,
});

/**
 * @param {{ store, http, summaries: object[], signal?: AbortSignal, progress?: (done: number, total: number) => void, now?: Date }} ctx
 * @returns {Promise<{ updatedAt: string, sections: { id: string, title: string, subtitle: string, items: object[] }[] }>}
 */
export async function discover({ store, http, summaries, signal, problems = NO_PROBLEMS, progress = () => {}, now = new Date() }) {
  const lib = libraryMatcher(store);
  let done = 0, total = 5;
  const step = () => progress(Math.min(++done, total), total);
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { code: 'aborted' }); };
  progress(0, total);

  // Same rules as Tonight: released, at least 45 minutes. TV is kept here (marked kind 'tv') and left out when the list is served.
  const eligible = f => f.year && f.kind !== 'short' && released(f, { today: now, includeTV: true, includeShorts: f.kind === 'tv' }) && !lib.find(f);

  // ---- people ----
  const people = lovedPeople(summaries);
  const films = people.length ? await personFilms(http, people.map(p => p.qid), { signal, problems }) : new Map();
  step(); check();

  const byId = new Map();                 // film id → shared item
  const lovedBy = new Map();              // film id → Set of person qid
  const sections = [];
  for (const p of people) {
    const mine = [];
    for (const f of films.get(p.qid) || []) {
      const loved = f.roles.filter(r => p.roles.includes(r));
      if (!loved.length || !eligible(f)) continue;
      let item = byId.get(f.id);
      if (!item) { item = oneItem(f); byId.set(f.id, item); lovedBy.set(f.id, new Set()); }
      lovedBy.get(f.id).add(p.qid);
      if (loved.includes('director')) item.byLovedDirector = true;
      item.reasons.push(`${VERB[loved.includes('director') ? 'director' : loved[0]]} ${p.name}, whose films you rate ${p.average}★`);
      mine.push(item);
    }
    sections.push({
      kind: 'person', id: `person:${p.qid}`, title: `More from ${p.name}`,
      subtitle: `You've rated ${p.rated} of their films, ${p.average}★ on average`, items: mine,
    });
  }

  // ---- series ----
  const started = startedSeries(store);
  const seriesItems = [];
  if (started.size) {
    const pick = [...started].sort((a, b) => b[1].size - a[1].size).slice(0, MAX_SERIES).map(([q]) => q);
    const members = await seriesMembers(http, pick, { signal, problems });
    const seen = new Set();
    for (const q of pick) {
      const s = members.get(q);
      if (!s || !s.name) continue;
      const watchedKeys = started.get(q);
      const ordered = [...s.films].sort((a, b) => (a.ordinal ?? 1e9) - (b.ordinal ?? 1e9) || (a.year ?? 1e9) - (b.year ?? 1e9));
      let lastSeen = -1;
      ordered.forEach((f, i) => { const k = lib.find(f); if (k && watchedKeys.has(k)) lastSeen = i; });
      if (lastSeen < 0) continue; // only series where a watched film is one of the real entries
      // Only released films count as entries of the series: TV spin-offs and shorts never move the "seen x of y" figures or become "next".
      const entries = ordered.filter(f => f.kind === 'film' && released(f, { today: now, includeTV: true }));
      const size = entries.length;
      const seenCount = entries.filter(f => { const k = lib.find(f); return k && watchedKeys.has(k); }).length;
      const nextIdx = ordered.findIndex((f, i) => i > lastSeen && f.kind !== 'tv' && eligible(f));
      ordered.forEach((f, i) => {
        if (!eligible(f) || seen.has(f.id)) return;
        seen.add(f.id);
        let item = byId.get(f.id);
        if (!item) { item = oneItem(f); byId.set(f.id, item); lovedBy.set(f.id, new Set()); }
        item.reasons.unshift(i === nextIdx ? `Next in the ${s.name} series` : `Part of the ${s.name} series (you've seen ${seenCount} of ${size})`);
        item.seriesName = s.name;
        seriesItems.push(item);
      });
    }
  }
  if (seriesItems.length || started.size) {
    sections.push({ kind: 'series', id: 'series', title: 'Finish the series', subtitle: 'Films from series you have started', items: seriesItems });
  }
  step(); check();

  // ---- ratings, ranking ----
  const all = [...byId.values()];
  const ratings = await imdbRatings(http, all.map(i => i.imdbId), { signal, problems });
  for (const i of all) { const r = ratings.get(i.imdbId); i.imdb = r ? { value: r.value, votes: r.votes } : null; }
  step(); check();

  const rank = i => confidence(i.imdb) + LOVED_BONUS * (Math.max(1, lovedBy.get(i.id)?.size || 0) - 1);
  // A weak suggestion makes the whole page feel unreliable: films they directed need IMDb 6.0+ (or no rating yet),
  // films they only wrote, shot or scored need 6.5+.
  const goodEnough = i => (i.imdb ? i.imdb.value >= (i.byLovedDirector ? 6.0 : 6.5) : !!i.byLovedDirector);
  const ranked = [];
  for (const sec of sections) {
    const seen = new Set();
    sec.items = sec.items.filter(i => (sec.kind === 'series' || goodEnough(i)) && !seen.has(i.id) && seen.add(i.id));
    sec.items.sort((a, b) => rank(b) - rank(a) || String(a.title).localeCompare(String(b.title)));
    sec.items = sec.items.slice(0, SECTION_SIZE);
    ranked.push(...sec.items);
  }

  // ---- posters for what we show (best first, capped) ----
  const shown = [...new Map(ranked.map(i => [i.id, i])).values()].sort((a, b) => rank(b) - rank(a));
  try { // directors and genres for what we show; a failure just leaves them blank
    const basics = await filmBasics(http, shown.map(i => i.id), { signal, problems });
    for (const i of shown) { const b = basics.get(i.id.slice(3)); if (b) { i.directors = b.directors.slice(0, 3); i.genres = b.genres.slice(0, 4); i.runtime = i.runtime ?? b.runtime; } }
  } catch (e) { if (e?.code === 'aborted') throw e; problems.report({ area: 'Discover', message: "Couldn't read directors and genres for the suggestions; they show without them.", error: e, level: 'warning' }); }
  step(); check();
  total += Math.min(POSTER_LIMIT, shown.filter(i => i.enwiki).length);
  await addPosters(http, shown, { limit: POSTER_LIMIT, signal, onStep: step, problems });

  const kept = sections.filter(s => s.items.length).map(s => ({
    id: s.id, title: s.title, subtitle: s.subtitle,
    items: s.items.map(({ enwiki, imdbId, seriesName, byLovedDirector, ...item }) => ({ ...item, reasons: [...new Set(item.reasons)].slice(0, 3) })),
  }));
  progress(total, total);
  return { updatedAt: now.toISOString(), sections: kept };
}
