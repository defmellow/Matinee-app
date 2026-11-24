// Dendy Newtown pages -> plain facts. Pure: HTML in, objects out, never throws.
// The site pre-renders schema.org JSON-LD (Movie + ScreeningEvent in an @graph). We keep only titles, dates/times,
// a link back and a short label; no descriptions, images or other copy.

const SITE = 'https://newtown.dendy.com.au';
const LD = /<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;

/** Every JSON-LD node on the page, with @graph flattened. Bad blocks are skipped. */
export function jsonLdNodes(html) {
  const out = [];
  const add = n => {
    if (Array.isArray(n)) return n.forEach(add);
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n['@graph'])) n['@graph'].forEach(add);
    if (n['@type']) out.push(n);
  };
  for (const m of String(html || '').matchAll(LD)) {
    try { add(JSON.parse(m[1])); } catch { /* one bad block must not hide the rest */ }
  }
  return out;
}

const isType = (n, t) => [].concat(n['@type']).includes(t);
const SLUG = /\/movie\/([a-z0-9][a-z0-9-]*)\/?(?:#|$|\?)/i;
/** '/movie/<slug>/' id or url -> slug (null if it is anything else). */
export function slugFromUrl(u) {
  const m = SLUG.exec(String(u || ''));
  return m ? m[1].toLowerCase() : null;
}
export const filmPath = slug => `/movie/${slug}/`;
export const filmUrl = slug => SITE + filmPath(slug);

// ---- titles ----
// Dendy prints edition words after " - " ("Alien - Directors Cut"), in brackets ("The Godfather (4K Re-release)"), or keeps the
// film's other name in brackets ("House (Hausu)"). There is no "Retrospective:" style prefix in the real data.
const EDITION_WORDS = /\b(director'?s?'?s? cut|extended cut|final cut|theatrical cut|uncut|tv miniseries|miniseries|live on stage|restoration|restored|re-?release|remaster(?:ed)?|\d+k\b|\d+(?:st|nd|rd|th) anniversary|anniversary|marathon|encore)\b/i;
const PREFIXES = [[/^\s*exhibition on screen\s*:\s*/i, 'Exhibition on Screen'], [/^\s*nt live\s*:\s*/i, 'NT Live']];
const EVENT_TITLE = /^movie trivia\b|\bconcert\b|\bmarathon\b|\blive on stage\b|^reel rock\b/i;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** '&#39;' / '&amp;' / '&nbsp;' -> text; spaces collapsed, curly apostrophes made straight. */
export function decodeText(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\s\u00a0]+/g, ' ').trim();
}

const fixCut = t => t.replace(/\bdirectors?'?s?'? cut\b/gi, "Director's Cut").replace(/\b(\d+)k\b/gi, '$1K');

/**
 * Title as the site prints it -> { title (clean), label|null (edition text for display), kind, variants }.
 * variants: plain titles worth trying against the library, clean title first ("House (Hausu)" -> House, House Hausu, Hausu).
 */
export function splitLabel(raw) {
  let t = decodeText(raw);
  let label = null;
  let kind = 'film';
  for (const [re, name] of PREFIXES) {
    const m = re.exec(t);
    if (m) { label = name; kind = 'event'; t = t.slice(m[0].length).trim(); break; }
  }
  // Trailing " - <edition words>" (the last dash group only, so "Alien - Directors Cut" keeps "Alien").
  const dash = /\s+[-\u2013\u2014]\s+([^-\u2013\u2014]+)$/.exec(t);
  if (dash && EDITION_WORDS.test(dash[1])) {
    label = label || fixCut(dash[1].trim());
    t = t.slice(0, dash.index).trim();
  }
  // Trailing "(...)": an edition, or the film's other name.
  const alt = [];
  const br = /\s*\(([^()]+)\)\s*$/.exec(t);
  if (br && t.slice(0, br.index).trim()) {
    const inner = br[1].trim();
    if (EDITION_WORDS.test(inner)) label = label || fixCut(inner);
    else alt.push(inner);
    t = t.slice(0, br.index).trim();
  }
  if (EVENT_TITLE.test(t) || /\b(marathon|live on stage)\b/i.test(label || '')) kind = 'event';
  const variants = [t, ...alt.map(a => `${t} ${a}`), ...alt].filter(Boolean);
  return { title: t, label, kind, variants: [...new Set(variants)] };
}

/** A readable title guessed from a slug, for matching only ('alien---directors-cut' -> 'alien - directors cut'). */
export function titleFromSlug(slug) {
  return String(slug || '').split(/-{2,}/).map(p => p.replace(/-/g, ' ').trim()).filter(Boolean).join(' - ');
}

const DT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
/** The date and time are read from the text as written (the site's own Sydney clock); no time-zone maths. */
function sessionFrom(ev) {
  const m = DT.exec(String(ev.startDate || ''));
  if (!m) return null;
  const url = String(ev.url || ev.offers?.url || '');
  const s = { date: m[1], time: m[2] };
  if (/^https:\/\/newtown\.dendy\.com\.au\//.test(url)) s.bookingUrl = url;
  if (/SoldOut/i.test(String(ev.offers?.availability || ''))) s.soldOut = true;
  return s;
}

const runtimeOf = d => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(String(d || ''));
  const min = m ? (Number(m[1] || 0) * 60 + Number(m[2] || 0)) : 0;
  return min > 0 ? min : null;
};

const sortSessions = list => list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
const dedupe = list => {
  const seen = new Set();
  return list.filter(s => { const k = s.date + s.time + (s.bookingUrl || ''); if (seen.has(k)) return false; seen.add(k); return true; });
};

const names = list => [].concat(list ?? []).map(p => decodeText(typeof p === 'string' ? p : p?.name)).filter(Boolean);
const isoDay = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : null; };

function collect(html) {
  const nodes = jsonLdNodes(html);
  const movies = new Map();
  for (const n of nodes) {
    if (!isType(n, 'Movie')) continue;
    const slug = slugFromUrl(n['@id']) || slugFromUrl(n.sameAs) || slugFromUrl(n.url);
    if (!slug || movies.has(slug) || !n.name) continue;
    const rating = n.contentRating ? String(n.contentRating).trim() : null;
    movies.set(slug, {
      slug, name: String(n.name), runtimeMin: runtimeOf(n.duration), rating, directors: names(n.director),
      firstDate: isoDay(n.dateCreated), // Dendy's first-showing date for this run: NOT the film's year
    });
  }
  const events = new Map();
  for (const n of nodes) {
    if (!isType(n, 'ScreeningEvent')) continue;
    const slug = slugFromUrl(n.workPresented?.['@id']) || slugFromUrl(n.workPresented?.url) || slugFromUrl(String(n.url || '').replace('/checkout/showing/', '/movie/'));
    const s = sessionFrom(n);
    if (!slug || !s) continue;
    if (!events.has(slug)) events.set(slug, []);
    events.get(slug).push(s);
  }
  return { nodes, movies, events };
}

export const CAP_AT = 20; // the plain now-showing page was seen holding exactly 20 sessions (a film page with 20 may be cut too)

function filmFrom(m, sessions) {
  const { title, label, kind, variants } = splitLabel(m.name);
  const dates = [...new Set(sessions.map(s => s.date))];
  return {
    title, titleRaw: decodeText(m.name), slug: m.slug, path: filmPath(m.slug), label, variants,
    kind: m.rating === 'E' ? 'event' : kind, rating: m.rating, runtimeMin: m.runtimeMin, directors: m.directors,
    firstDate: m.firstDate, sessions, dates, maybeCut: sessions.length === CAP_AT,
  };
}

/**
 * Rich form of the list page.
 * @returns {{ films: object[], eventCount: number, capped: boolean, hasTheater: boolean }}
 *   films: { title, titleRaw, slug, path, label, kind, rating, runtimeMin, directors, firstDate, sessions, dates, maybeCut, variants }
 *   capped: true when the page may not list everything (exactly 20 sessions); the caller can fill in with film pages.
 */
export function parseListing(html) {
  try {
    const { nodes, movies, events } = collect(html);
    const films = [];
    for (const m of movies.values()) films.push(filmFrom(m, sortSessions(dedupe(events.get(m.slug) || []))));
    const eventCount = [...events.values()].reduce((n, l) => n + l.length, 0);
    return { films, eventCount, capped: eventCount === CAP_AT, hasTheater: nodes.some(n => isType(n, 'MovieTheater')) };
  } catch {
    return { films: [], eventCount: 0, capped: false, hasTheater: false };
  }
}

/** List page -> films ([] on anything unexpected). */
export const parseNowShowing = html => parseListing(html).films;

/** One film page -> the same shape as a list film (sessions:[{date,time,bookingUrl?,soldOut?}]), or null if no film is found. */
export function parseFilmPage(html) {
  try {
    const { movies, events } = collect(html);
    const first = movies.values().next().value;
    if (!first) return null;
    // On a film page the sessions belong to its own Movie; if the page names no work, take them all.
    const all = [...events.values()].flat();
    return filmFrom(first, sortSessions(dedupe(events.get(first.slug) || (movies.size === 1 ? all : []))));
  } catch {
    return null;
  }
}

/** sitemap.xml -> film slugs (from '/movie/<slug>/' <loc> entries), in order, no duplicates. Never throws. */
export function parseSitemap(xml) {
  const out = new Set();
  try {
    for (const m of String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
      const slug = slugFromUrl(decodeText(m[1]));
      if (slug) out.add(slug);
    }
  } catch { /* fail soft */ }
  return [...out];
}

/**
 * /coming-soon/ -> the film links in the page (the site keeps them in a hidden SEO block).
 * @returns {{ films: {slug:string,title:string}[], hasTheater: boolean }}
 */
export function parseComingSoon(html) {
  try {
    const text = String(html || '');
    const films = new Map();
    for (const m of text.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const slug = slugFromUrl(decodeText(m[1]));
      const title = decodeText(m[2].replace(/<[^>]*>/g, ' '));
      if (slug && title && !films.has(slug)) films.set(slug, { slug, title });
    }
    return { films: [...films.values()], hasTheater: jsonLdNodes(text).some(n => isType(n, 'MovieTheater')) };
  } catch {
    return { films: [], hasTheater: false };
  }
}

// ---- GraphQL replies (Dendy's own schedule data) -> plain facts ----
// Every parser takes the parsed JSON body and never throws: it returns { ok:true, ... } or { ok:false, error }.

const SYDNEY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** An instant (ms or ISO string with offset/Z) -> { date:'YYYY-MM-DD', time:'HH:MM' } on the Sydney clock, daylight saving included. null if not a date. */
export function toSydney(when) {
  const t = typeof when === 'number' ? when : Date.parse(when);
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(SYDNEY.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** "Almost sold out" is shown when this many seats or fewer are left (and at least one is). */
export const ALMOST_SOLD_OUT_SEATS = 10;
// Badges that are not worth showing: price tags, seating style and the cinema's own test entries.
const DROP_BADGE = /^\$\s*\d+(?:\.\d+)?\s*ticket$|^reserved seating$|^z*test$/i;

/** Where to book a session (only ever opened in the user's browser, never fetched). */
export const bookingUrl = (slug, id) => `${SITE}/checkout/showing/${slug}/${id}/`;

const failure = error => ({ ok: false, error });
/** The shared reply check: error bodies, `errors` arrays and missing data are all failures. */
function replyProblem(json, key) {
  if (!json || typeof json !== 'object') return 'Dendy sent something unreadable.';
  if (Array.isArray(json.errors) && json.errors.length) return String(json.errors[0]?.message || 'Dendy reported an error.');
  if (json.error) return String(json.error?.message || json.error || 'Dendy reported an error.');
  const body = json.data?.[key];
  if (!body || typeof body !== 'object') return 'Dendy\'s reply looked different from usual.';
  return null;
}

const splitDirectors = s => String(s || '').split(/\s*(?:,|;|&|\band\b)\s*/i).map(decodeText).filter(Boolean);
const posInt = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : null);

/** One GraphQL movie row (roster row, or the `movie` inside a session) -> a film in the same shape as the page parsers' films. null without id and slug. */
export function filmFromMovie(m, { inList } = {}) {
  const id = m?.id != null ? String(m.id) : null;
  const slug = m?.urlSlug ? String(m.urlSlug).toLowerCase() : null;
  if (!id || !slug || !m.name) return null;
  const { title, label, kind, variants } = splitLabel(m.name);
  const rating = m.rating ? String(m.rating).trim() : null;
  return {
    dendyId: id, slug, path: filmPath(slug), title, titleRaw: decodeText(m.name), label, variants,
    kind: rating === 'E' || kind === 'event' || m.isMarathon === true ? 'event' : 'film', rating,
    runtimeMin: posInt(m.duration), directors: splitDirectors(m.directedBy), firstDate: isoDay(m.dateOfFirstShowing),
    releaseDate: isoDay(m.releaseDate), status: m.showingStatus ? String(m.showingStatus) : null,
    showingCount: Number.isFinite(+m.showingCount) ? +m.showingCount : null, ...(inList ? { inList } : {}),
  };
}

/**
 * `movies(...)` reply -> the films on one list.
 * @returns {{ok:true, count:number, resultVersion:string|null, films:object[]}|{ok:false, error:string}}
 */
export function parseRoster(json, { list } = {}) {
  try {
    const bad = replyProblem(json, 'movies');
    if (bad) return failure(bad);
    const body = json.data.movies;
    if (!Array.isArray(body.data)) return failure('Dendy\'s film list looked different from usual.');
    const films = body.data.map(m => filmFromMovie(m, { inList: list })).filter(Boolean);
    return { ok: true, count: films.length, resultVersion: body.resultVersion != null ? String(body.resultVersion) : null, films };
  } catch {
    return failure('Dendy\'s film list could not be read.');
  }
}

/**
 * Screen and badge names from the trimmed config reply.
 * @returns {{ok:true, version:string|null, screens:Object<string,string>, badges:Object<string,string>}|{ok:false, error:string}}
 */
export function parseConfig(json) {
  try {
    if (!json || typeof json !== 'object') return failure('Dendy sent something unreadable.');
    if (Array.isArray(json.errors) && json.errors.length) return failure(String(json.errors[0]?.message || 'Dendy reported an error.'));
    if (json.error) return failure(String(json.error?.message || 'Dendy reported an error.'));
    const c = json.data?.addOrUpdateClientConfig?.clientConfig;
    if (!c || typeof c !== 'object') return failure('Dendy\'s settings looked different from usual.');
    const screens = {}, badges = {};
    for (const s of c.screens || []) if (s?.id != null && s.name) screens[String(s.id)] = decodeText(s.name);
    for (const b of c.showingBadges || []) if (b?.id != null && b.displayName) badges[String(b.id)] = decodeText(b.displayName);
    return { ok: true, version: c.version != null ? String(c.version) : null, screens, badges };
  } catch {
    return failure('Dendy\'s settings could not be read.');
  }
}

/** One session row -> { id, date, time, endTime, start, end, bookingUrl, screen?, format?, labels, seatsLeft, soldOut?, almostSoldOut?, preview? } or null if it should not be shown. */
function sessionFromRow(r, movie, { screens = {}, badges = {} }) {
  if (!r || !r.published || r.private || r.past) return null;
  const startMs = Date.parse(r.time);
  const local = toSydney(startMs);
  if (!local || r.id == null) return null;
  const id = String(r.id);
  const s = { id, date: local.date, time: local.time, start: new Date(startMs).toISOString() };
  const dur = movie?.runtimeMin;
  if (dur) { const endMs = startMs + dur * 60000; s.end = new Date(endMs).toISOString(); s.endTime = toSydney(endMs).time; }
  s.bookingUrl = bookingUrl(movie.slug, id);
  const screen = screens[String(r.screenId)];
  if (screen) s.screen = screen;
  const labels = [...new Set((r.showingBadgeIds || []).map(b => badges[String(b)]).filter(n => n && !DROP_BADGE.test(n)))];
  s.labels = labels;
  if (labels.length) s.format = labels.join(' · ');
  if (Number.isFinite(+r.seatsRemaining)) {
    s.seatsLeft = +r.seatsRemaining;
    if (s.seatsLeft <= 0) s.soldOut = true; // never seen live: inferred, check on a busy day
    else if (s.seatsLeft <= ALMOST_SOLD_OUT_SEATS) s.almostSoldOut = true;
  }
  if (r.isPreview) s.preview = true;
  return s;
}

/**
 * `showingsForDate(...)` reply -> sessions grouped by film.
 * @param {object} json
 * @param {{screens?:Object<string,string>, badges?:Object<string,string>}} [names] from parseConfig; unknown ids show nothing
 * @returns {{ok:true, unchanged:true, resultVersion:string}
 *   |{ok:true, unchanged:false, resultVersion:string|null, count:number, truncated:boolean, movies:Object<string,object>}
 *   |{ok:false, error:string}}
 *   movies: by film id, the film (see filmFromMovie) plus `sessions` (start order). truncated: the reply hit Dendy's 300-session
 *   limit, so later sessions are missing and the caller should ask for fewer films at a time.
 */
export function parseShowings(json, names = {}) {
  names = names || {};
  try {
    const bad = replyProblem(json, 'showingsForDate');
    if (bad) return failure(bad);
    const body = json.data.showingsForDate;
    const version = body.resultVersion != null ? String(body.resultVersion) : null;
    if (body.data == null) return version ? { ok: true, unchanged: true, resultVersion: version } : failure('Dendy\'s sessions looked different from usual.');
    if (!Array.isArray(body.data)) return failure('Dendy\'s sessions looked different from usual.');
    const movies = {};
    for (const r of body.data) {
      const film = filmFromMovie(r?.movie);
      if (!film) continue;
      const m = movies[film.dendyId] || (movies[film.dendyId] = { ...film, sessions: [] });
      const s = sessionFromRow(r, m, names);
      if (s) m.sessions.push(s);
    }
    for (const m of Object.values(movies)) m.sessions.sort((a, b) => a.start.localeCompare(b.start));
    const count = Number.isFinite(+body.count) ? +body.count : body.data.length;
    return { ok: true, unchanged: false, resultVersion: version, count, truncated: Math.max(count, body.data.length) >= SESSION_LIMIT, movies };
  } catch {
    return failure('Dendy\'s sessions could not be read.');
  }
}

/** Dendy returns at most this many sessions in one reply (earliest first). */
export const SESSION_LIMIT = 300;
