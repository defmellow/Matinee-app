// The library filter / sort engine. Pure functions over library summaries (see the shape in the brief).
import { autoTagIds, canonicalCountry, foldSearch } from './tags.js';
import { yourTake } from './scores.js';

/**
 * Query object (every field optional; missing means "no filter"):
 *   text            words to find in title, original title, directors, cast, collection (all words must match)
 *   status          'all' | 'watched' | 'watchlist' | 'listed' (on any of your lists) | 'liked' | 'unrated' (watched, no rating) | 'rewatched'
 *   ratingMin/Max   your rating on the 1–10 half-star scale
 *   scoreMin/Max    Matinee score (0–100)
 *   yearMin/Max, runtimeMin/Max (minutes; films with no runtime never pass a runtime filter)
 *   genres, countries, languages   a film passes when it has ANY of them      // DECISION: any-of (not all-of)
 *   tags            personal tags, ALL must match
 *   autoTags        automatic tag ids, ALL must match
 *   people          person ids or exact names, a film passes when it has ANY of them (directors or cast)
 *   directors       director names (or part of a name), a film passes when ANY term matches   // added for `dir:` searches
 *   sort            'recent'|'title'|'year'|'rating'|'score'|'letterboxd'|'runtime'|'popularity'|'yourTake'|'watchlist'
 *   dir             'asc' | 'desc' (each sort has a natural default)
 */

const has = v => v != null && v !== '';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const arr = v => (Array.isArray(v) ? v.filter(has) : []);
const rating = s => (isNum(s?.user?.rating) ? s.user.rating : null);

// ---------- text search ----------

const hayCache = new WeakMap();
/** Folded searchable fields of a summary (cached per object). */
function haystack(s) {
  let h = hayCache.get(s);
  if (h) return h;
  const title = foldSearch(s.title), original = foldSearch(s.originalTitle);
  h = {
    title, original,
    fields: [title, original, ...(s.directors || []).map(p => foldSearch(p?.name)), ...(s.cast || []).map(p => foldSearch(p?.name)), foldSearch(s.collection)].filter(Boolean),
    directors: (s.directors || []).map(p => foldSearch(p?.name)).filter(Boolean),
  };
  hayCache.set(s, h);
  return h;
}

const wordsOf = text => foldSearch(text).split(' ').filter(Boolean);

// ---------- filtering ----------

function buildFilters(q) {
  const f = [];
  const add = fn => f.push(fn);

  switch (q.status) {
    case 'watched': add(s => !!s.user?.watched); break;
    case 'watchlist': add(s => !!s.user?.watchlist); break;
    case 'unwatched': add(s => !s.user?.watched); break;
    case 'listed': add(s => !!s.user?.listed); break;
    case 'liked': add(s => !!s.user?.liked); break;
    case 'unrated': add(s => !!s.user?.watched && rating(s) == null); break;
    case 'rewatched': add(s => (s.timesWatched || 0) >= 2); break;
    default: break; // 'all' or unset
  }

  const range = (get, min, max) => {
    // a bound that is not a number (a mistyped year) is ignored rather than emptying the list
    const bound = v => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);
    const lo = bound(min), hi = bound(max);
    if (lo == null && hi == null) return;
    add(s => {
      const v = get(s);
      return isNum(v) && (lo == null || v >= lo) && (hi == null || v <= hi);
    });
  };
  range(rating, q.ratingMin, q.ratingMax);
  range(s => s.score, q.scoreMin, q.scoreMax);
  range(s => s.year, q.yearMin, q.yearMax);
  range(s => (isNum(s.runtime) && s.runtime > 0 ? s.runtime : null), q.runtimeMin, q.runtimeMax);

  const anyOf = (list, get, norm) => {
    const wanted = new Set(list.map(norm).filter(Boolean));
    if (wanted.size) add(s => (get(s) || []).some(v => wanted.has(norm(v))));
  };
  anyOf(arr(q.genres), s => s.genres, foldSearch);
  anyOf(arr(q.countries), s => s.countries, c => canonicalCountry(c)?.id);
  anyOf(arr(q.languages), s => s.languages, foldSearch);

  const tags = arr(q.tags).map(foldSearch).filter(Boolean);
  if (tags.length) add(s => { const mine = new Set((s.user?.tags || []).map(foldSearch)); return tags.every(t => mine.has(t)); });

  const autos = arr(q.autoTags);
  if (autos.length) add(s => { const mine = new Set(Array.isArray(s.autoTags) ? s.autoTags : autoTagIds(s)); return autos.every(t => mine.has(t)); });

  const people = arr(q.people).map(String);
  if (people.length) {
    const ids = new Set(people), names = new Set(people.map(foldSearch));
    add(s => [...(s.directors || []), ...(s.cast || [])].some(p => p && ((has(p.id) && ids.has(String(p.id))) || names.has(foldSearch(p.name)))));
  }

  const dirTerms = arr(q.directors).map(wordsOf).filter(w => w.length);
  if (dirTerms.length) add(s => { const names = haystack(s).directors; return dirTerms.some(words => names.some(n => words.every(w => n.includes(w)))); });

  const words = wordsOf(q.text);
  if (words.length) add(s => { const fields = haystack(s).fields; return words.every(w => fields.some(x => x.includes(w))); });

  return f;
}

// ---------- sorting ----------

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// DECISION: title sort skips a leading English "The/A/An", like Letterboxd (accents are ignored too; "À bout de souffle" is left alone).
const sortTitle = s => foldSearch(String(s.title ?? '').replace(/^\s*(?:the|a|an)\s+(?=\S)/i, ''));

const popularity = s => {
  const v = [s.ratings?.imdb?.votes, s.ratings?.letterboxd?.votes].filter(isNum);
  return v.length ? Math.max(...v) : null;
};

// key(s, q) → number | string | null (null sorts last whatever the direction); dir = natural direction
const SORTS = {
  recent: { dir: 'desc', key: (s, q) => (q.status === 'watchlist' ? (isNum(s.user?.watchlistOrder) ? s.user.watchlistOrder : null) : s.lastWatched || null), flip: q => q.status === 'watchlist' },
  title: { dir: 'asc', key: s => sortTitle(s), str: true },
  year: { dir: 'desc', key: s => (isNum(s.year) ? s.year : null) },
  rating: { dir: 'desc', key: s => rating(s) },
  score: { dir: 'desc', key: s => (isNum(s.score) ? s.score : null) },
  letterboxd: { dir: 'desc', key: s => (isNum(s.ratings?.letterboxd?.value) && s.ratings.letterboxd.value > 0 ? s.ratings.letterboxd.value : null) },
  runtime: { dir: 'desc', key: s => (isNum(s.runtime) && s.runtime > 0 ? s.runtime : null) },
  popularity: { dir: 'desc', key: s => popularity(s) },
  yourTake: { dir: 'desc', key: s => yourTake(rating(s), s.score) },
  watchlist: { dir: 'asc', key: s => (isNum(s.user?.watchlistOrder) ? s.user.watchlistOrder : null) },
};

const missing = v => v == null || (typeof v === 'number' && Number.isNaN(v));

function sortList(list, q) {
  const spec = SORTS[q.sort];
  const text = foldSearch(q.text);

  // No sort chosen: keep the order given, except a text search puts titles that start with it first.
  if (!spec) {
    if (!text) return list;
    const rank = s => {
      const h = haystack(s);
      if (h.title.startsWith(text) || sortTitle(s).startsWith(text) || h.original.startsWith(text)) return 0;
      if (h.title.includes(text) || h.original.includes(text)) return 1;
      return 2;
    };
    return list.map((s, i) => ({ s, i, r: rank(s), t: sortTitle(s) }))
      .sort((a, b) => a.r - b.r || collator.compare(a.t, b.t) || a.i - b.i)
      .map(x => x.s);
  }

  // Natural direction, flipped when the caller asks for the other way. The watchlist's own order runs ascending.
  const natural = spec.flip?.(q) ? 'asc' : spec.dir;
  const dir = q.dir === 'asc' || q.dir === 'desc' ? q.dir : natural;
  const sign = dir === 'asc' ? 1 : -1;
  return list.map((s, i) => ({ s, i, k: spec.key(s, q), t: sortTitle(s) }))
    .sort((a, b) => {
      const ma = missing(a.k), mb = missing(b.k);
      if (ma !== mb) return ma ? 1 : -1;
      if (!ma && a.k !== b.k) {
        const c = spec.str ? collator.compare(a.k, b.k) : a.k < b.k ? -1 : 1;
        if (c) return c * sign;
      }
      return collator.compare(a.t, b.t) || a.i - b.i;
    })
    .map(x => x.s);
}

/**
 * Filter and sort library summaries. Does not change its input.
 * @param {object[]} summaries
 * @param {object} [q] query (see top of file)
 * @returns {object[]}
 */
export function applyQuery(summaries, q = {}) {
  const query = q || {};
  const filters = buildFilters(query);
  const list = (Array.isArray(summaries) ? summaries : []).filter(s => s && filters.every(fn => fn(s)));
  return sortList(list, query);
}

// ---------- facets ----------

/** Count films per name. `keyOf` merges spellings (the first spelling seen is the one shown). */
const countBy = (items, getNames, keyOf = n => n) => {
  const map = new Map();
  for (const item of items) {
    const seen = new Set();
    for (const name of getNames(item) || []) {
      const key = has(name) ? keyOf(name) : null;
      if (!has(key) || seen.has(key)) continue;
      seen.add(key);
      const e = map.get(key) || { name, count: 0 };
      e.count++;
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
};

/**
 * Filter options with counts, over whatever summaries you pass (pass the filtered list for live counts).
 * decades are oldest first and carry yearMin/yearMax; people are directors (top 50).
 */
export function facets(summaries) {
  const list = (Array.isArray(summaries) ? summaries : []).filter(Boolean);

  const decades = new Map();
  for (const s of list) {
    if (!isNum(s.year)) continue;
    const d = Math.floor(s.year / 10) * 10;
    decades.set(d, (decades.get(d) || 0) + 1);
  }

  const people = new Map();
  for (const s of list) {
    const seen = new Set();
    for (const p of s.directors || []) {
      const k = has(p?.id) ? `id:${p.id}` : has(p?.name) ? `name:${foldSearch(p.name)}` : null;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const e = people.get(k) || { name: p.name, id: p.id ?? null, count: 0 };
      e.count++;
      people.set(k, e);
    }
  }

  return {
    genres: countBy(list, s => s.genres, foldSearch),
    countries: countBy(list, s => s.countries, c => canonicalCountry(c)?.id),
    languages: countBy(list, s => s.languages, foldSearch),
    decades: [...decades].sort((a, b) => a[0] - b[0]).map(([d, count]) => ({ name: `${d}s`, count, yearMin: d, yearMax: d + 9 })),
    tags: countBy(list, s => s.user?.tags, foldSearch),
    people: [...people.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))).slice(0, 50),
  };
}

// ---------- search-box operators ----------

const NUM = '\\d+(?:\\.\\d+)?';

/** '>=8', '>8', '<=8', '<8', '8', '8+', '7-9' → { min?, max? } (> and < step to the next whole number: >7.5 is 8+). null when not a number test. */
function parseNumeric(v) {
  let m;
  if ((m = new RegExp(`^(>=|<=|>|<|=)?\\s*(${NUM})$`).exec(v))) {
    const n = Number(m[2]);
    switch (m[1]) {
      case '>=': return { min: n };
      case '>': return { min: Math.floor(n) + 1 };
      case '<=': return { max: n };
      case '<': return { max: Math.ceil(n) - 1 };
      default: return { min: n, max: n };
    }
  }
  if ((m = new RegExp(`^(${NUM})\\+$`).exec(v))) return { min: Number(m[1]) };
  if ((m = new RegExp(`^(${NUM})-(${NUM})$`).exec(v))) {
    const a = Number(m[1]), b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

/** '★4+', '★★★½', '★3.5' → rating on the 1–10 scale. '+' means "this or better". */
function parseStars(v) {
  let m, n;
  if ((m = /^(★+)(½)?(\+)?$/.exec(v))) n = m[1].length + (m[2] ? 0.5 : 0);
  else if ((m = /^★(\d(?:\.5|\.0)?)(\+)?$/.exec(v))) n = Number(m[1]);
  else return null;
  if (!(n >= 0.5 && n <= 5) || (n * 2) % 1 !== 0) return null;
  return m[m.length - 1] === '+' ? { min: n * 2 } : { min: n * 2, max: n * 2 };
}

const OPERATORS = {
  dir: 'directors', director: 'directors', directed: 'directors',
  year: 'year', rated: 'rated', rating: 'rated', score: 'score', runtime: 'runtime',
  genre: 'genres', tag: 'tags', country: 'countries', language: 'languages', lang: 'languages',
  is: 'status',
};
const STATUSES = new Set(['watched', 'watchlist', 'listed', 'unwatched', 'liked', 'unrated', 'rewatched']);

function applyRange(out, minKey, maxKey, r, { lo = -Infinity, hi = Infinity } = {}) {
  if (!r || (r.min != null && (r.min < lo || r.min > hi)) || (r.max != null && (r.max < lo || r.max > hi))) return false;
  if (r.min != null) out[minKey] = r.min;
  if (r.max != null) out[maxKey] = r.max;
  return true;
}

/**
 * Pull search-box operators out of typed text. Returns { text, ...query fields }, ready to merge into a query.
 *   dir:wenders  dir:"wim wenders"      year:1984  year:1980-1989  year:1980s  year:>=1990
 *   rated:>=8 (1–10)  rated:7-9  ★4+  ★★★½      score:>=80
 *   genre:drama  tag:comfort  country:japan  language:korean  runtime:<100  runtime:>=150  is:watchlist
 * Anything not recognised (unknown operator, bad value) stays in `text`. Repeated list operators accumulate.
 */
export function parseQueryText(str) {
  const out = {};
  const words = [];
  const push = (key, value) => { (out[key] ||= []).push(value); };
  const tokens = String(str ?? '').match(/[^\s"]*"[^"]*(?:"|$)|\S+/g) || [];

  for (const raw of tokens) {
    const unquoted = raw.replace(/"/g, '');
    if (!unquoted) continue;
    const m = /^([A-Za-z]+):(.+)$/s.exec(raw);
    let ok = false;

    if (m && OPERATORS[m[1].toLowerCase()]) {
      const op = OPERATORS[m[1].toLowerCase()];
      const value = m[2].replace(/^"|"$/g, '').trim();
      if (value) {
        switch (op) {
          case 'directors': case 'genres': case 'tags': case 'countries': case 'languages':
            push(op, value); ok = true; break;
          case 'year': {
            const decade = /^(\d{4})s$/.exec(value);
            ok = decade ? applyRange(out, 'yearMin', 'yearMax', { min: +decade[1], max: +decade[1] + 9 })
              : applyRange(out, 'yearMin', 'yearMax', parseNumeric(value), { lo: 1800, hi: 2999 });
            break;
          }
          case 'rated':
            ok = applyRange(out, 'ratingMin', 'ratingMax', value.startsWith('★') ? parseStars(value) : parseNumeric(value), { lo: 1, hi: 10 });
            break;
          case 'score': ok = applyRange(out, 'scoreMin', 'scoreMax', parseNumeric(value), { lo: 0, hi: 100 }); break;
          case 'runtime': ok = applyRange(out, 'runtimeMin', 'runtimeMax', parseNumeric(value)); break;
          case 'status': if (STATUSES.has(value.toLowerCase())) { out.status = value.toLowerCase(); ok = true; } break;
          default: break;
        }
      }
    } else if (raw.startsWith('★')) {
      ok = applyRange(out, 'ratingMin', 'ratingMax', parseStars(raw), { lo: 1, hi: 10 });
    }

    if (!ok) words.push(unquoted);
  }
  return { text: words.join(' '), ...out };
}
