// Wikidata "graph" look-ups for Discover, filmographies and series: who made which films, which films belong
// to a series. Query service only (the action APIs get throttled from shared IPs). Every query is a POST,
// batched (at most BATCH items) and grouped to one row per film so the answers stay small.
import { NO_PROBLEMS } from '../problems.js';
import { genuineSeries } from './series-rules.js';
import {
  FILM_TYPES, TV_TYPES, sparqlFilmSubclasses, readTypeClasses,
} from '../parse/wikidata.js';

export const BATCH = 25;
const SPARQL = 'https://query.wikidata.org/sparql?format=json';
const ROLE_PROPS = { director: 'P57', writer: 'P58', cinematography: 'P344', composer: 'P86', cast: 'P161' };
export const CREW_ROLES = ['director', 'writer', 'cinematography', 'composer'];
// What counts as a series: film series and media franchises (not lists such as "100 greatest films", which also use P179).
const SERIES_TYPES = ['Q24856', 'Q196600'];
const SHORT_TYPES = new Set(['Q24862']);

const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const isQid = q => /^Q\d+$/.test(q);
const values = qids => qids.map(q => `wd:${q}`).join(' ');
const bindings = json => json?.results?.bindings || [];
const v = (b, k) => (b[k] ? b[k].value : null);
const qidOf = uri => (/Q\d+$/.exec(uri || '') || [])[0] || null;
const yearOf = d => { const m = /^(\d{4})-/.exec(d || ''); return m ? Number(m[1]) : null; };
const dayOf = d => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(d || ''); return m ? m[1] : null; };
const list = s => (s ? String(s).split('|').filter(Boolean) : []);

function sparql(http, query, signal) {
  return http.json(SPARQL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }).toString(),
  });
}

// ---------- which types count as film / TV ----------

const accepted = new Set([...FILM_TYPES, ...TV_TYPES]);
const tvTypes = new Set(TV_TYPES);
// Episodes, seasons and the like are never films, even though they descend from "television programme".
const NOT_A_FILM_ROOTS = ['Q1983062', 'Q21191270', 'Q3464665', 'Q24634210']; // episode, TV series episode, TV season, podcast episode
const rejected = new Set(NOT_A_FILM_ROOTS);

const sparqlEpisodeSubclasses = qids => `SELECT DISTINCT ?t WHERE { VALUES ?t { ${values(qids)} } VALUES ?root { ${values(NOT_A_FILM_ROOTS)} } ?t wdt:P279* ?root . }`;
const episodeTypes = json => new Set(bindings(json).map(b => qidOf(v(b, 't'))).filter(Boolean));

/** Learn which unknown type items are subclasses of film or TV types (e.g. "science fiction film"). One cheap query. */
async function learnTypes(http, typeIds, signal, problems = NO_PROBLEMS) {
  const unknown = [...typeIds].filter(t => !accepted.has(t) && !rejected.has(t));
  for (const group of chunks(unknown, 50)) {
    try {
      const r = readTypeClasses(await sparql(http, sparqlFilmSubclasses(group), signal));
      const ok = group.filter(t => r.accepted.has(t));
      for (const t of group) if (!r.accepted.has(t)) rejected.add(t);
      const episodes = ok.length ? episodeTypes(await sparql(http, sparqlEpisodeSubclasses(ok), signal)) : new Set();
      for (const t of ok) (episodes.has(t) ? rejected : accepted).add(t);
      for (const t of r.tv) if (!episodes.has(t)) tvTypes.add(t);
    } catch (e) {
      if (e?.code === 'aborted') throw e;
      problems.report({ area: 'Wikidata', message: "Couldn't check some film types on Wikidata, so a few titles may be missing from this list.", error: e, level: 'warning' }); // they stay unknown: this run treats them as "not a film"
    }
  }
}

/** → 'film' | 'tv' | 'short' | null (not a film or TV item). */
function kindOf(types) {
  const ok = types.filter(t => accepted.has(t));
  if (!ok.length) return null;
  if (ok.some(t => SHORT_TYPES.has(t)) && !ok.some(t => t === 'Q11424')) return 'short';
  if (ok.every(t => tvTypes.has(t))) return 'tv';
  return 'film';
}

// ---------- shared query pieces ----------

const FILM_COLUMNS = `(SAMPLE(?title) AS ?t) (MIN(?d) AS ?date) (SAMPLE(?imdb) AS ?im) (SAMPLE(?wiki) AS ?w) (SAMPLE(?rt) AS ?run)
    (GROUP_CONCAT(DISTINCT STRAFTER(STR(?type), "/entity/"); separator="|") AS ?types)`;
const FILM_PATTERN = `?film wdt:P31 ?type .
    OPTIONAL { ?film rdfs:label ?title . FILTER(LANG(?title) = "en") }
    OPTIONAL { ?film wdt:P577|wdt:P580 ?d }
    OPTIONAL { ?film wdt:P345 ?imdb }
    OPTIONAL { ?film wdt:P2047 ?rt }
    OPTIONAL { ?article schema:about ?film ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wiki }`;

function readFilm(b) {
  const types = list(v(b, 'types'));
  const imdb = v(b, 'im');
  const run = Number(v(b, 'run'));
  return {
    qid: qidOf(v(b, 'film')), types,
    title: v(b, 'title') ?? v(b, 't'),
    year: yearOf(v(b, 'date')),
    released: dayOf(v(b, 'date')),
    imdb: /^tt\d+$/.test(imdb || '') ? imdb : null,
    enwiki: v(b, 'w'),
    runtime: Number.isFinite(run) && run > 0 && run < 1000 ? Math.round(run) : null,
  };
}

function finish(f, kind) {
  return { id: `wd:${f.qid}`, title: f.title, year: f.year, released: f.released, kind, imdb: f.imdb, enwiki: f.enwiki, runtime: f.runtime };
}

// ---------- queries ----------

/**
 * Films and TV items each person worked on.
 * @param {object} http  core/net.js http
 * @param {string[]} qids  person QIDs ('Q…' or 'wd:Q…')
 * @param {{ signal?: AbortSignal, roles?: string[] }} [opts]  roles default to the four crew roles; add 'cast' for actors
 * @returns {Promise<Map<string, { id, title, year, kind, imdb, enwiki, runtime, roles: string[] }[]>>} person QID → films (kind 'film' | 'tv' | 'short')
 */
export async function personFilms(http, qids, { signal, problems = NO_PROBLEMS, roles = CREW_ROLES } = {}) {
  const people = [...new Set((qids || []).map(q => String(q).replace(/^wd:/, '')).filter(isQid))];
  const use = roles.filter(r => ROLE_PROPS[r]);
  const out = new Map(people.map(q => [q, []]));
  const allTypes = new Set();
  const rows = [];
  for (const group of chunks(people, BATCH)) {
    const query = `SELECT ?person ?film ${FILM_COLUMNS} (GROUP_CONCAT(DISTINCT ?role; separator="|") AS ?roles) WHERE {
    VALUES ?person { ${values(group)} }
    VALUES (?prop ?role) { ${use.map(r => `(wdt:${ROLE_PROPS[r]} "${r}")`).join(' ')} }
    ?film ?prop ?person .
    ${FILM_PATTERN}
  } GROUP BY ?person ?film`;
    for (const b of bindings(await sparql(http, query, signal))) {
      const person = qidOf(v(b, 'person')), f = readFilm(b);
      if (!person || !f.qid) continue;
      f.types.forEach(t => allTypes.add(t));
      rows.push({ person, f, roles: list(v(b, 'roles')) });
    }
  }
  await learnTypes(http, allTypes, signal, problems);
  for (const { person, f, roles: r } of rows) {
    const kind = kindOf(f.types);
    if (!kind || !f.title || /^Q\d+$/.test(f.title)) continue;
    if (!out.has(person)) out.set(person, []);
    out.get(person).push({ ...finish(f, kind), roles: r });
  }
  return out;
}

/**
 * Members of series (Wikidata "part of the series", P179), with the series ordinal when recorded.
 * @returns {Promise<Map<string, { id, name, films: { id, title, year, kind, imdb, enwiki, runtime, ordinal: number|null }[] }>>} series QID → series
 */
export async function seriesMembers(http, qids, { signal, problems = NO_PROBLEMS } = {}) {
  const ids = [...new Set((qids || []).map(q => String(q).replace(/^wd:/, '')).filter(isQid))];
  const out = new Map();
  const allTypes = new Set();
  const rows = [];
  for (const group of chunks(ids, BATCH)) {
    const query = `SELECT ?series ?film (SAMPLE(?sl) AS ?sname) (MIN(?o) AS ?ord) (COUNT(DISTINCT ?lnk) AS ?links) ${FILM_COLUMNS} WHERE {
    VALUES ?series { ${values(group)} }
    ?series wdt:P31/wdt:P279* ?stype . VALUES ?stype { ${SERIES_TYPES.map(q => `wd:${q}`).join(' ')} }
    ?film p:P179 ?st . ?st ps:P179 ?series .
    OPTIONAL { ?st pq:P1545 ?o }
    OPTIONAL { ?film wdt:P155|wdt:P156 ?lnk . ?lnk wdt:P179 ?series }
    OPTIONAL { ?series rdfs:label ?sl . FILTER(LANG(?sl) = "en") }
    ${FILM_PATTERN}
  } GROUP BY ?series ?film`;
    for (const b of bindings(await sparql(http, query, signal))) {
      const series = qidOf(v(b, 'series')), f = readFilm(b);
      if (!series || !f.qid) continue;
      f.types.forEach(t => allTypes.add(t));
      const ord = Number.parseFloat(v(b, 'ord'));
      const links = v(b, 'links');
      rows.push({ series, name: v(b, 'sname'), f, ordinal: Number.isFinite(ord) ? ord : null, linked: links == null ? null : Number(links) > 0 });
    }
  }
  await learnTypes(http, allTypes, signal, problems);
  for (const { series, name, f, ordinal, linked } of rows) {
    const kind = kindOf(f.types);
    if (!kind || !f.title) continue;
    if (!out.has(series)) out.set(series, { id: `wd:${series}`, name: name || null, films: [] });
    const s = out.get(series);
    if (!s.name && name) s.name = name;
    s.films.push({ ...finish(f, kind), ordinal, linked });
  }
  // Only genuine series: no studio or best-of lists, no re-release duplicates, at least two real entries.
  for (const [id, s] of [...out]) {
    const g = genuineSeries(s);
    if (g) out.set(id, g); else out.delete(id);
  }
  return out;
}

/**
 * Basics for films by QID: title, year, IMDb id, article title, type, directors and genres.
 * @returns {Promise<Map<string, { id, title, year, kind, imdb, enwiki, runtime, directors: string[], genres: string[] }>>}
 */
export async function filmBasics(http, qids, { signal, problems = NO_PROBLEMS } = {}) {
  const ids = [...new Set((qids || []).map(q => String(q).replace(/^wd:/, '')).filter(isQid))];
  const out = new Map();
  const rows = [];
  const allTypes = new Set();
  for (const group of chunks(ids, BATCH)) {
    const query = `SELECT ?film ${FILM_COLUMNS}
    (GROUP_CONCAT(DISTINCT ?dn; separator="|") AS ?dirs) (GROUP_CONCAT(DISTINCT ?gn; separator="|") AS ?genres) WHERE {
    VALUES ?film { ${values(group)} }
    ${FILM_PATTERN}
    OPTIONAL { ?film wdt:P57 ?dir . ?dir rdfs:label ?dn . FILTER(LANG(?dn) = "en") }
    OPTIONAL { ?film wdt:P136 ?g . ?g rdfs:label ?gn . FILTER(LANG(?gn) = "en") }
  } GROUP BY ?film`;
    for (const b of bindings(await sparql(http, query, signal))) {
      const f = readFilm(b);
      if (!f.qid) continue;
      f.types.forEach(t => allTypes.add(t));
      rows.push({ f, directors: list(v(b, 'dirs')), genres: list(v(b, 'genres')) });
    }
  }
  await learnTypes(http, allTypes, signal, problems);
  for (const { f, directors, genres } of rows) {
    const kind = kindOf(f.types);
    if (!kind || !f.title) continue;
    out.set(f.qid, { ...finish(f, kind), directors, genres });
  }
  return out;
}
