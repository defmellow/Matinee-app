// Pure helpers for the Wikidata provider: SPARQL builders, response readers and the entity → film-fields mapping.
// No network here. Wikidata data is CC0.

export const FILM_TYPES = ['Q11424', 'Q202866', 'Q24862', 'Q506240', 'Q93204', 'Q226730', 'Q1257444', 'Q20667187'];

/** Television types we accept as "films" (series, miniseries, special, anime series, docuseries, web series). Subclasses are learned at run time. */
export const TV_TYPES = ['Q5398426', 'Q1259759', 'Q1261214', 'Q63952888', 'Q15416', 'Q526877'];
const ANIMATED_TYPES = ['Q202866', 'Q1107'], DOCUMENTARY_TYPES = ['Q93204'];

const Q_USD = 'Q4917', Q_MINUTE = 'Q7727', Q_HOUR = 'Q25235', Q_SECOND = 'Q11574';

// ---------- claim readers ----------

const live = claims => (claims || []).filter(c => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
const val = c => c.mainsnak.datavalue?.value;

export const claimsOf = (entity, prop) => live(entity?.claims?.[prop]);
export const itemIds = (entity, prop) => claimsOf(entity, prop).map(val).map(v => v?.id).filter(Boolean);
export const stringValue = (entity, prop) => {
  const cs = claimsOf(entity, prop);
  const pref = cs.find(c => c.rank === 'preferred') || cs[0];
  const v = pref && val(pref);
  return typeof v === 'string' && v ? v : null;
};

/** '+1984-05-19T00:00:00Z' with precision → { year, date: 'YYYY-MM-DD' | null }. */
export function parseTime(v) {
  const m = /^([+-])(\d{4,})-(\d\d)-(\d\d)T/.exec(v?.time || '');
  if (!m || m[1] === '-') return null;
  const year = Number(m[2]);
  const day = (v.precision ?? 0) >= 11 && m[3] !== '00' && m[4] !== '00';
  return { year, date: day ? `${m[2].padStart(4, '0')}-${m[3]}-${m[4]}` : null };
}

const qualTime = (claim, prop) => {
  const q = claim.qualifiers?.[prop]?.[0];
  return q?.snaktype === 'value' ? parseTime(q.datavalue.value) : null;
};

/** All publication dates (P577) as { year, date }. */
export const publicationDates = entity => claimsOf(entity, 'P577').map(c => parseTime(val(c))).filter(Boolean);
const startDates = entity => claimsOf(entity, 'P580').map(c => parseTime(val(c))).filter(Boolean);

export function isFilm(entity, types = FILM_TYPES) {
  const has = types instanceof Set ? id => types.has(id) : id => types.includes(id);
  return itemIds(entity, 'P31').some(has);
}

const TV_SET = new Set(TV_TYPES);
/** A television item (and not also a film type): judged by the year of its first release. */
export const isTvTypes = (typeIds, tv = TV_SET) => {
  const list = [...typeIds];
  return list.some(t => tv.has(t)) && !list.some(t => FILM_TYPES.includes(t));
};

/** A candidate matches when it is a film or TV item (any of `types`) released within a year of the one we expect. */
export function verifyCandidate(entity, year, types = FILM_TYPES, tv = TV_SET) {
  if (!entity || !isFilm(entity, types)) return false;
  if (!year) return true;
  if (isTvTypes(itemIds(entity, 'P31'), tv)) {
    const years = [...publicationDates(entity), ...startDates(entity)].map(d => d.year);
    return years.length > 0 && Math.abs(Math.min(...years) - year) <= 1;
  }
  return publicationDates(entity).some(d => Math.abs(d.year - year) <= 1);
}

// ---------- text tidy-ups ----------

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function tidyGenre(label) {
  const s = String(label || '').trim();
  if (!s) return null;
  if (/^lgbt/i.test(s)) return 'LGBTQ+';
  const t = s.replace(/\s+(film|movie)s?$/i, '').trim();
  return t ? cap(t) : null;
}

// ---------- genres ----------

export const CANONICAL_GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History',
  'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction', 'Thriller', 'War', 'Western'];
const GENRE_RULES = [
  ['Action', /action|martial arts|superhero/], ['Adventure', /adventure/], ['Animation', /animat|anime/], ['Comedy', /comedy/],
  ['Crime', /crime|gangster|heist|noir/], ['Documentary', /documentary/], ['Drama', /drama/], ['Family', /family|children/],
  ['Fantasy', /fantasy/], ['History', /histor|biograph|period/], ['Horror', /horror/], ['Music', /music/],
  ['Mystery', /mystery|detective|whodunit/], ['Romance', /romance|romantic/], ['Science Fiction', /science fiction|sci-fi/],
  ['Thriller', /thriller|suspense/], ['War', /(^|\s)war(\s|$)/], ['Western', /western/],
];
const NOT_A_STYLE = /^(independent|flashback)$|^(film )?based on\b/i;

/**
 * Wikidata genre labels → Letterboxd's genres plus the finer labels, which become tags ("styles").
 * "Comedy drama" → genres Comedy + Drama, style "Comedy drama"; "Drama" → genre only.
 */
export function canonicalGenres(labels) {
  const found = new Set(), styles = [];
  for (const raw of labels || []) {
    let l = String(raw || '').trim();
    if (!l) continue;
    if (/^road$/i.test(l)) l = 'Road movie';
    const low = l.toLowerCase();
    const exact = CANONICAL_GENRES.find(g => g.toLowerCase() === low);
    if (exact) { found.add(exact); continue; }
    for (const [g, re] of GENRE_RULES) if (re.test(low)) found.add(g);
    if (!NOT_A_STYLE.test(l) && !styles.includes(l)) styles.push(l);
  }
  return { genres: CANONICAL_GENRES.filter(g => found.has(g)), styles };
}

// ---------- titles ----------

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'vs']);

/** Wikipedia style: small words lowercase except at the start or after a colon. */
export function wikipediaCase(title) {
  let start = true;
  return String(title).split(' ').map(w => {
    const out = !start && SMALL_WORDS.has(w.toLowerCase().replace(/\.$/, '')) ? w.toLowerCase() : w;
    start = /:$/.test(w);
    return out;
  }).join(' ');
}

const COUNTRIES = {
  'united states of america': 'USA', 'united states': 'USA', 'united kingdom': 'UK',
  "people's republic of china": 'China', 'republic of ireland': 'Ireland', 'kingdom of the netherlands': 'Netherlands',
  'russian federation': 'Russia', 'czech republic': 'Czechia', "republic of china": 'Taiwan',
};
export const tidyCountry = label => {
  const s = String(label || '').trim();
  return s ? COUNTRIES[s.toLowerCase()] || s : null;
};

// ---------- SPARQL ----------

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]+/g, ' ');

/** Films keyed by TMDB id (P4947) and/or Letterboxd slug (P6127). */
export function sparqlByIds({ tmdb = [], letterboxd = [] }) {
  const blocks = [];
  if (tmdb.length) blocks.push(`{ VALUES ?t { ${tmdb.map(v => `"${esc(v)}"`).join(' ')} } ?item wdt:P4947 ?t . }`);
  if (letterboxd.length) blocks.push(`{ VALUES ?l { ${letterboxd.map(v => `"${esc(v)}"`).join(' ')} } ?item wdt:P6127 ?l . }`);
  return `SELECT ?item ?t ?l WHERE { ${blocks.join(' UNION ')} }`;
}

/** Exact English label + publication year ±1, batched by index. items: [{ title, year }] */
export function sparqlByLabel(items) {
  const blocks = items.map((it, i) => {
    const yr = it.year ? ` FILTER(YEAR(?d) >= ${it.year - 1} && YEAR(?d) <= ${it.year + 1})` : '';
    return `{ ?film rdfs:label "${esc(it.title)}"@en . ?film wdt:P577 ?d .${yr} BIND("${i}" AS ?k) }`;
  });
  // The label union must run first and the type join after it: left to itself the query service starts from every film
  // and times out (504 after ~60 s); with the join order fixed it answers in a few seconds. Keep this order.
  return `SELECT ?film ?k ?d ?sl WHERE { hint:Query hint:optimizer "None" . ${blocks.join(' UNION ')} ?film wdt:P31 ?type . VALUES ?type { ${FILM_TYPES.map(q => `wd:${q}`).join(' ')} } ?film wikibase:sitelinks ?sl . }`;
}

const qidOf = uri => (/Q\d+$/.exec(uri || '') || [])[0] || null;
const bindings = json => json?.results?.bindings || [];

/** → { tmdb: Map(id → qid), letterboxd: Map(slug → qid) } */
export function readIdMatches(json) {
  const tmdb = new Map(), letterboxd = new Map();
  for (const b of bindings(json)) {
    const q = qidOf(b.item?.value);
    if (!q) continue;
    if (b.t && !tmdb.has(b.t.value)) tmdb.set(b.t.value, q);
    if (b.l && !letterboxd.has(b.l.value)) letterboxd.set(b.l.value, q);
  }
  return { tmdb, letterboxd };
}

/** → Map(index → qid). Exact year beats a near one; then the item with more sitelinks wins. */
export function readLabelMatches(json, items) {
  const best = new Map();
  for (const b of bindings(json)) {
    const i = Number(b.k?.value), q = qidOf(b.film?.value);
    if (!q || !items[i]) continue;
    const y = Number(/^[+-]?(\d{4})/.exec(b.d?.value || '')?.[1]);
    const rank = [items[i].year && y === items[i].year ? 1 : 0, Number(b.sl?.value) || 0];
    const cur = best.get(i);
    if (!cur || rank[0] > cur.rank[0] || (rank[0] === cur.rank[0] && rank[1] > cur.rank[1])) best.set(i, { q, rank });
  }
  return new Map([...best].map(([i, v]) => [i, v.q]));
}

// ---------- Wikipedia title resolution ----------

export function titleCandidates(title, year) {
  const t = String(title || '').trim();
  if (!t || t.includes('|')) return [];
  const out = [...(year ? [`${t} (${year} film)`] : []), `${t} (film)`, t];
  const up = t[0].toUpperCase() + t.slice(1); // Wikipedia capitalises the first letter of every title
  return up === t ? out : [...new Set(out.map(x => x[0].toUpperCase() + x.slice(1)))];
}

/**
 * Article titles to try for the sitelink query, most specific first. Beyond the plain candidates it tries the ways
 * Wikipedia commonly spells a title differently from Letterboxd: "GoodFellas" → "Goodfellas", "WALL·E" → "WALL-E",
 * "Your Name." → "Your Name", "X: The Movie" → "X", title case, plain dashes; then TV spellings ("Title (TV series)"),
 * and last of all the part before (or after) a colon. Every hit is still checked for type and year.
 */
export function sitelinkTitles(title, year) {
  const t = String(title || '').trim();
  if (!t || t.includes('|')) return [];
  const cap = x => x[0].toUpperCase() + x.slice(1);
  const trimmed = t.replace(/(?<!\.)\.$/, '').trim();
  const noMovie = trimmed.replace(/\s*[:–—-]\s*the movie$/i, '').trim();
  const base = [...new Set([t, trimmed, noMovie].filter(Boolean))];
  const spelt = base.flatMap(v => [v, v.replace(/[·•]/g, '-'), v.replace(/[–—]/g, '-'), v.replace(/\s*&\s*/g, ' and '), cap(v.toLowerCase())]);
  const variants = [...new Set(spelt.flatMap(v => [v, wikipediaCase(v)]).filter(Boolean))];
  const tv = [...new Set([t, noMovie].flatMap(v => [v, wikipediaCase(v)]).filter(Boolean))]
    .flatMap(v => [`${v} (TV series)`, ...(year ? [`${v} (${year} TV series)`] : []), `${v} (miniseries)`].map(cap));
  const colon = noMovie.indexOf(':');
  const parts = colon > 0 ? [noMovie.slice(0, colon).trim(), noMovie.slice(colon + 1).trim()].filter(x => x.length > 1) : [];
  const partTitles = parts.flatMap(p => [p, wikipediaCase(p)]);
  return [...new Set([...variants.flatMap(v => titleCandidates(v, year)), ...tv, ...partTitles.flatMap(v => titleCandidates(v, year))])];
}

/** MediaWiki query response + the titles we asked for → Map(requested title → qid), skipping missing/disambiguation pages. */
export function readTitleResolution(json, asked) {
  const q = json?.query || {};
  const hop = new Map();
  for (const r of [...(q.normalized || []), ...(q.redirects || [])]) hop.set(r.from, r.to);
  const pages = new Map((q.pages || []).map(p => [p.title, p]));
  const out = new Map();
  for (const t of asked) {
    let cur = t;
    for (let n = 0; n < 4 && hop.has(cur); n++) cur = hop.get(cur);
    const p = pages.get(cur);
    if (!p || p.missing || p.invalid || p.pageprops?.disambiguation !== undefined || !p.pageprops?.wikibase_item) continue;
    out.set(t, { qid: p.pageprops.wikibase_item, title: p.title });
  }
  return out;
}

// ---------- SPARQL: titles via English Wikipedia sitelinks ----------

const litEn = s => `"${esc(s)}"@en`;
const numOf = v => (v == null ? null : Number(v));
const yearOf = d => { const m = /^([+-]?\d{4,})-/.exec(d || ''); return m ? Number(m[1]) : null; };

/** items: [{ titles: [...] }] (most specific title first). One row per (film, article, type, release date). */
export function sparqlBySitelinks(items) {
  const rows = [];
  items.forEach((it, i) => it.titles.forEach(t => rows.push(`("${i}" ${litEn(t)})`)));
  return `SELECT ?k ?name ?item ?type ?d ?sl WHERE { VALUES (?k ?name) { ${rows.join(' ')} } ` +
    '?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?name . ' +
    '?item wdt:P31 ?type . OPTIONAL { ?item wdt:P577|wdt:P580 ?d } OPTIONAL { ?item wikibase:sitelinks ?sl } }';
}

/** → [{ k, name, qid, types:Set, years:[], sl }] merged per (film, article). */
export function readSitelinkRows(json) {
  const by = new Map();
  for (const b of bindings(json)) {
    const qid = qidOf(b.item?.value), k = Number(b.k?.value), name = b.name?.value;
    if (!qid || !Number.isInteger(k) || !name) continue;
    const key = `${k}|${name}`;
    if (!by.has(key)) by.set(key, { k, name, qid, types: new Set(), years: [], sl: 0 });
    const r = by.get(key);
    const t = qidOf(b.type?.value); if (t) r.types.add(t);
    const y = yearOf(b.d?.value); if (y != null && !r.years.includes(y)) r.years.push(y);
    r.sl = Math.max(r.sl, numOf(b.sl?.value) || 0);
  }
  return [...by.values()];
}

// TV items count by the year of their first release; films by any release.
const yearOk = (r, year, tv = TV_SET) => {
  if (!year) return true;
  if (isTvTypes(r.types, tv) && r.years.length) return Math.abs(Math.min(...r.years) - year) <= 1;
  return r.years.some(y => Math.abs(y - year) <= 1);
};

/** Type QIDs we can't judge yet (not known film types, not known non-film types) on rows whose year already fits. */
export function unknownTypes(rows, items, accepted, rejected, tv = TV_SET) {
  const out = new Set();
  for (const r of rows) {
    if (!yearOk(r, items[r.k]?.year, tv)) continue;
    for (const t of r.types) if (!accepted.has(t) && !rejected.has(t)) out.add(t);
  }
  return out;
}

/** Most specific verified article per film → Map(index → { qid, title }). items: [{ titles, year }] */
export function pickSitelinkMatches(rows, items, accepted, tv = TV_SET) {
  const out = new Map();
  items.forEach((it, i) => {
    for (const title of it.titles) {
      const hits = rows.filter(r => r.k === i && r.name === title && yearOk(r, it.year, tv) && [...r.types].some(t => accepted.has(t)));
      if (hits.length) {
        hits.sort((a, b) => b.sl - a.sl);
        out.set(i, { qid: hits[0].qid, title });
        return;
      }
    }
  });
  return out;
}

/** Which of these type items are (sub)classes of film or of a TV type? One cheap query per unknown batch. */
export function sparqlFilmSubclasses(qids) {
  const roots = ['Q11424', ...TV_TYPES].map(q => `wd:${q}`).join(' ');
  return `SELECT DISTINCT ?t ?root WHERE { VALUES ?t { ${qids.map(q => `wd:${q}`).join(' ')} } VALUES ?root { ${roots} } ?t wdt:P279* ?root . }`;
}
/** → { accepted: Set of type QIDs that are film or TV classes, tv: the ones that are TV only }. A row without ?root counts as film. */
export function readTypeClasses(json) {
  const roots = new Map();
  for (const b of bindings(json)) {
    const t = qidOf(b.t?.value);
    if (!t) continue;
    if (!roots.has(t)) roots.set(t, new Set());
    roots.get(t).add(qidOf(b.root?.value) || 'Q11424');
  }
  const accepted = new Set(roots.keys());
  const tv = new Set([...roots].filter(([, r]) => ![...r].some(x => !TV_SET.has(x))).map(([t]) => t));
  return { accepted, tv };
}

// ---------- SPARQL: details for a batch of items ----------

const SIMPLE_PROPS = ['P31', 'P57', 'P58', 'P344', 'P86', 'P1040', 'P162', 'P136', 'P495', 'P364', 'P272', 'P144', 'P921', 'P840', 'P179',
  'P345', 'P4947', 'P6127', 'P1258', 'P1712', 'P1476'];
const EN = 'FILTER(LANG(?%) = "en")';
const enLabel = (item, label) => `OPTIONAL { ?${item} rdfs:label ?${label} . ${EN.replace('%', label)} }`;

/** One row per (film, property value). ?kind is the property id; see readDetails for what the other columns mean.
 *  "P144/P31" rows say what kind of work a source is (its P31 type in ?v); the source work itself comes back in ?role. */
export function sparqlDetails(qids) {
  return `SELECT ?item ?kind ?st ?v ?vl ?ord ?role ?rl ?t ?prec ?a ?u WHERE { VALUES ?item { ${qids.map(q => `wd:${q}`).join(' ')} } {
    VALUES ?pp { ${SIMPLE_PROPS.map(p => `wdt:${p}`).join(' ')} } ?item ?pp ?v . BIND(STRAFTER(STR(?pp), "/direct/") AS ?kind) ${enLabel('v', 'vl')}
  } UNION {
    VALUES (?kind ?ap ?aps) { ("P161" p:P161 ps:P161) ("P166" p:P166 ps:P166) ("P1411" p:P1411 ps:P1411) }
    ?item ?ap ?st . ?st ?aps ?v ; wikibase:rank ?rk . FILTER(?rk != wikibase:DeprecatedRank) ${enLabel('v', 'vl')}
    OPTIONAL { ?st pq:P1545 ?ord } OPTIONAL { ?st pq:P585 ?t }
    OPTIONAL { ?st pq:P453 ?role . ${enLabel('role', 'rl')} }
  } UNION {
    VALUES (?kind ?qp ?qv) { ("P2047" p:P2047 psv:P2047) ("P2130" p:P2130 psv:P2130) ("P2142" p:P2142 psv:P2142) }
    ?item ?qp ?st . ?st ?qv ?vn . ?vn wikibase:quantityAmount ?a ; wikibase:quantityUnit ?u .
  } UNION {
    VALUES (?kind ?tp ?tps) { ("P577" p:P577 psv:P577) ("P580" p:P580 psv:P580) }
    ?item ?tp ?st . ?st ?tps ?vn . ?vn wikibase:timeValue ?t ; wikibase:timePrecision ?prec .
  } UNION {
    ?item wdt:P144 ?role . ?role wdt:P31 ?v . BIND("P144/P31" AS ?kind) ${enLabel('v', 'vl')}
  } UNION {
    BIND("meta" AS ?kind) ${enLabel('item', 'vl')}
    OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?v }
  } }`;
}

const wrap = (value, qualifiers) => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } }, ...(qualifiers ? { qualifiers } : {}) });
const qual = value => [{ snaktype: 'value', datavalue: { value } }];
const asTime = (t, precision) => ({ time: /^[+-]/.test(t) ? t : `+${t}`, precision });

/**
 * SPARQL details response → { entities: Map(qid → entity-shaped object, or null if nothing was found), labels: Map(qid → English label|null) }.
 * The entities look like wbgetentities ones (claims, labels, sitelinks), so mapEntity and verifyCandidate work on both.
 */
export function readDetails(json, asked) {
  const entities = new Map(asked.map(q => [q, { id: q, claims: {}, labels: {}, sitelinks: {} }]));
  const labels = new Map();
  const seen = new Set();
  const note = (uri, lit) => { const q = qidOf(uri); if (q && (lit?.value || !labels.has(q))) labels.set(q, lit?.value || labels.get(q) || null); };
  for (const b of bindings(json)) {
    const qid = qidOf(b.item?.value), e = entities.get(qid), kind = b.kind?.value;
    if (!e || !kind) continue;
    const st = b.st?.value;
    if (st) { if (seen.has(st)) continue; seen.add(st); }
    const add = (prop, claim) => (e.claims[prop] ||= []).push(claim);
    const v = b.v;
    if (kind === 'meta') {
      if (b.vl?.value) e.labels.en = { value: b.vl.value };
      if (v?.value) e.sitelinks.enwiki = { title: v.value };
    } else if (kind === 'P577' || kind === 'P580') {
      if (b.t?.value) add(kind, wrap(asTime(b.t.value, numOf(b.prec?.value))));
    } else if (kind === 'P2047' || kind === 'P2130' || kind === 'P2142') {
      if (b.a?.value) add(kind, wrap({ amount: b.a.value, unit: b.u?.value }));
    } else if (!v) {
      continue;
    } else if (kind === 'P1476') {
      add(kind, wrap({ text: v.value, language: v['xml:lang'] }));
    } else if (v.type === 'uri') {
      const id = qidOf(v.value);
      if (!id) continue;
      note(v.value, b.vl);
      const q = {};
      if (b.ord?.value) q.P1545 = qual(b.ord.value);
      if (b.role?.value && qidOf(b.role.value)) { q.P453 = qual({ id: qidOf(b.role.value) }); if (kind !== 'P144/P31') note(b.role.value, b.rl); }
      if (b.t?.value) q.P585 = qual(asTime(b.t.value, 11));
      add(kind, wrap({ id }, Object.keys(q).length ? q : undefined));
    } else {
      add(kind, wrap(v.value));
    }
  }
  // items the query never described (deleted, merged) come back empty
  for (const [q, e] of [...entities]) if (!Object.keys(e.claims).length && !e.labels.en) entities.set(q, null);
  return { entities, labels };
}

// ---------- entity → fields ----------

/** QIDs of items whose English labels are needed to describe this entity. */
export function referencedIds(entity) {
  const ids = new Set();
  const take = (prop, max = Infinity) => itemIds(entity, prop).slice(0, max).forEach(i => ids.add(i));
  for (const p of ['P57', 'P58', 'P344', 'P86', 'P1040', 'P136', 'P495', 'P364', 'P272', 'P166', 'P1411', 'P144', 'P921', 'P840', 'P179']) take(p);
  take('P162', 40); take('P161', 60);
  for (const c of claimsOf(entity, 'P161')) for (const q of c.qualifiers?.P453 || []) if (q.datavalue?.value?.id) ids.add(q.datavalue.value.id);
  return ids;
}

function quantity(entity, prop, pick) {
  const out = [];
  for (const c of claimsOf(entity, prop)) {
    const v = val(c);
    const amount = Number(v?.amount);
    if (Number.isFinite(amount) && amount > 0) out.push({ amount, unit: qidOf(v.unit) });
  }
  return pick(out);
}
const money = list => {
  const usd = list.filter(x => x.unit === Q_USD);
  // No USD claim: a missing figure is better than another currency shown as dollars.
  return usd.length ? Math.max(...usd.map(x => x.amount)) : null;
};
const runtimeMinutes = list => {
  const x = list[0];
  if (!x) return null;
  const m = x.unit === Q_HOUR ? x.amount * 60 : x.unit === Q_SECOND ? x.amount / 60 : x.amount;
  return m >= 1 && m < 2000 ? Math.round(m) : null;
};

// "Part of" also points at studio catalogues and best-of lists ("Walt Disney Animation Studios feature film",
// "BBC's 100 Greatest Films of the 21st Century"). Those are not series you can finish.
const CATALOGUE_NAME = /\b(list of|greatest|best (of|films?|movies?)|top \d+|\d+ (best|greatest)|studios?|feature films?|filmography|canon|classics|collections?|films? of|catalogue|catalog)\b/i;
export const isCatalogueName = name => CATALOGUE_NAME.test(String(name || ''));

const words = s => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(the|and|part|film|films|series|trilogy|franchise|saga|movie)$/.test(w)));

/** The series a film belongs to: skips catalogues and lists, prefers the one that shares a word with the film's title. */
export function pickCollection(ids, label, title) {
  const real = ids.filter(id => !isCatalogueName(label(id)));
  const mine = words(title);
  return real.find(id => [...words(label(id))].some(w => mine.has(w))) || real[0] || null;
}

// What a source work is, from the English labels of its types. Closed set; first match wins.
const SOURCE_KINDS = [
  ['comic', /\b(comics?|manga|graphic novels?|webcomics?|manhwa)\b/],
  ['play', /\bplays?\b/],
  ['novel', /\bnovels?\b|\bnovellas?\b/],
  ['short story', /\bshort stor(y|ies)\b/],
  ['book', /\bbooks?\b/],
];
export function sourceKind(typeLabels) {
  const text = (typeLabels || []).join(' ; ').toLowerCase();
  return SOURCE_KINDS.find(([, re]) => re.test(text))?.[0] || null;
}

/**
 * @param {object} entity  wbgetentities entity (claims, sitelinks, labels)
 * @param {(qid) => string|null} label  English label lookup; null → value is dropped
 * @param {Set<string>} [tv]  type QIDs that mean television (data.kind = 'tv')
 * @returns {{ data: object, ids: object }}
 */
export function mapEntity(entity, label, tv = TV_SET) {
  const names = (prop, tidy = x => x, max = Infinity) => {
    const out = [];
    for (const id of itemIds(entity, prop)) {
      const n = tidy(label(id));
      if (n && !out.includes(n)) out.push(n);
      if (out.length >= max) break;
    }
    return out;
  };
  const people = (prop, max) => {
    const out = [];
    for (const id of itemIds(entity, prop)) {
      const name = label(id);
      if (name && !out.some(p => p.id === `wd:${id}`)) out.push({ name, id: `wd:${id}` });
      if (out.length >= max) break;
    }
    return out;
  };

  // DECISION: the kind of each source work rides along in its name ("Dune (novel)") so no new stored field is needed.
  const typeLabels = new Map();
  for (const c of claimsOf(entity, 'P144/P31')) {
    const w = c.qualifiers?.P453?.[0]?.datavalue?.value?.id, t = val(c)?.id, n = t && label(t);
    if (w && n) typeLabels.set(w, [...(typeLabels.get(w) || []), n]);
  }
  const basedOnNames = () => {
    const out = [];
    for (const id of itemIds(entity, 'P144')) {
      const n = label(id);
      const kind = sourceKind(typeLabels.get(id));
      const full = n && kind && !n.toLowerCase().includes(`(${kind})`) ? `${n} (${kind})` : n;
      if (full && !out.includes(full)) out.push(full);
    }
    return out;
  };

  const cast = claimsOf(entity, 'P161').map((c, i) => {
    const id = val(c)?.id, name = id && label(id);
    if (!name) return null;
    const ord = Number(c.qualifiers?.P1545?.[0]?.datavalue?.value);
    const roleId = c.qualifiers?.P453?.[0]?.datavalue?.value?.id;
    const role = roleId && label(roleId);
    return { order: Number.isFinite(ord) ? ord : null, i, p: { name, id: `wd:${id}`, ...(role ? { role } : {}) } };
  }).filter(Boolean);
  if (cast.some(c => c.order != null)) cast.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.i - b.i);
  const seen = new Set();
  const castList = cast.map(c => c.p).filter(p => !seen.has(p.id) && seen.add(p.id)).slice(0, 20);

  const awards = [];
  const addAwards = (prop, won) => {
    for (const c of claimsOf(entity, prop)) {
      const id = val(c)?.id, name = id && label(id);
      if (!name) continue;
      const year = qualTime(c, 'P585')?.year ?? null;
      if (!awards.some(a => a.id === `wd:${id}` && a.year === year && a.won === won)) awards.push({ name, id: `wd:${id}`, won, year });
    }
  };
  addAwards('P166', true);
  addAwards('P1411', false);

  const dates = publicationDates(entity).filter(d => d.date).map(d => d.date).sort();
  if (!dates.length) dates.push(...startDates(entity).filter(d => d.date).map(d => d.date).sort());
  const collectionId = pickCollection(itemIds(entity, 'P179').filter(id => label(id)), label, entity.labels?.en?.value);
  const types = itemIds(entity, 'P31');
  const { genres, styles } = canonicalGenres(names('P136', tidyGenre));
  // The item's type is reliable evidence: an animated film is Animation even when its genres say "Adventure".
  if (types.some(t => ANIMATED_TYPES.includes(t)) && !genres.includes('Animation')) genres.unshift('Animation');
  if (types.some(t => DOCUMENTARY_TYPES.includes(t)) && !genres.includes('Documentary')) genres.unshift('Documentary');
  const orig = claimsOf(entity, 'P1476').map(val).find(v => v?.text);
  const enLabel = entity.labels?.en?.value;
  const peopleOut = {
    director: people('P57'), writer: people('P58'), cinematography: people('P344'),
    composer: people('P86'), editor: people('P1040'), producer: people('P162', 6), cast: castList,
  };
  for (const k of Object.keys(peopleOut)) if (!peopleOut[k].length) delete peopleOut[k];

  const data = {
    title: enLabel || undefined,
    originalTitle: orig && orig.text !== enLabel ? orig.text : undefined,
    runtime: quantity(entity, 'P2047', runtimeMinutes),
    released: dates[0] || null,
    genres,
    keywords: styles,
    kind: isTvTypes(types, tv) ? 'tv' : undefined,
    countries: names('P495', tidyCountry),
    languages: names('P364'),
    studios: names('P272'),
    collection: (collectionId && label(collectionId)) || null,
    collectionId: collectionId ? `wd:${collectionId}` : null,
    basedOn: basedOnNames(),
    subjects: names('P921'),
    locations: names('P840'),
    awards,
    budget: quantity(entity, 'P2130', money),
    boxOffice: quantity(entity, 'P2142', money),
    people: peopleOut,
  };
  for (const k of Object.keys(data)) if (data[k] == null || data[k] === undefined) delete data[k];

  const ids = {
    wikidata: entity.id,
    imdb: stringValue(entity, 'P345'),
    tmdb: stringValue(entity, 'P4947'),
    letterboxd: stringValue(entity, 'P6127'),
    rt: stringValue(entity, 'P1258'),
    metacritic: stringValue(entity, 'P1712'),
    enwiki: entity.sitelinks?.enwiki?.title || null,
  };
  return { data, ids };
}
