// A person's films. Sources in order: TMDB's API (when a key is set: fast, with posters), the Wikidata filmography (no key), and last their
// Letterboxd person page (director / writer / actor). Whichever answers first wins; Letterboxd is only read when both others failed.
//   getPersonFilms({ id, name }) in core/api.js is a thin call into createPersonFilms().get().
// Letterboxd person pages are read the way lbpage reads film pages: a plain browser-style request first, then the page window
// (which can show the user a "verify you're human" check). One page at a time at the top lane (the user opened this person), at most 8 pages per role,
// and the answer is kept for 7 days in cache.json. Library status (watched, watchlist ...) is merged in fresh on every call.
//
// UNVERIFIED on a real person page: no person page has been saved in this project. The grid parser accepts both markups seen on Letterboxd
// (the newer "griditem" LazyPoster with data-item-slug / data-item-name / data-item-link, and the older poster-container with
// data-film-slug / data-film-name / data-target-link), and is tested on synthetic fixtures only.
import { NO_PROBLEMS } from '../problems.js';
import { decodeEntities } from '../parse/critics.js';
import { normTitle } from '../model.js';
import { DAY, letterboxdUrl } from './shared.js';
import { fetchTmdbPerson, DEPARTMENT } from './tmdb-person.js';

export const MAX_PAGES = 8;            // pages followed per role
export const CACHE_DAYS = 7;
const FAIL_MEMORY_MS = 30 * 60 * 1000; // after a failure, don't ask again for this long
const ROLE_ORDER = ['director', 'writer', 'actor'];
const ROLE_NAME = { director: 'director', writer: 'writer', actor: 'cast' }; // Letterboxd URL kind -> role name used in Matinee

// ---------- parsing ----------

const posterUrl = p => (typeof p === 'string' ? p : p && typeof p.url === 'string' ? p.url : null) || null;

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return m ? decodeEntities(m[1]).trim() : null;
};
const filmSlugOf = link => /\/film\/([^/?#"]+)/.exec(String(link || ''))?.[1]?.toLowerCase() || null;

/** "The Substance (2024)" -> { title: 'The Substance', year: 2024 } */
function splitTitleYear(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = /^(.*?)\s*\((\d{4})\)$/.exec(t);
  return m && m[1] ? { title: m[1], year: Number(m[2]) } : { title: t, year: null };
}

/**
 * The films grid of a Letterboxd person page.
 * @returns {{ isPage: boolean, name: string|null, films: {title:string,year:number|null,slug:string}[], next: string|null }}
 *   isPage: looks like a Letterboxd page (not a check page); next: path of the next page of films, or null.
 */
export function parsePersonPage(html) {
  const text = typeof html === 'string' ? html : '';
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] || '').replace(/\s+/g, ' ').trim();
  const isPage = /letterboxd/i.test(title) && !/^(just a moment|attention required|access denied)/i.test(title);
  const films = [], seen = new Set();
  for (const m of text.matchAll(/<(?:div|li|a)\b[^>]*>/gi)) {
    const tag = m[0];
    const slug = (attr(tag, 'data-item-slug') || attr(tag, 'data-film-slug') || filmSlugOf(attr(tag, 'data-item-link')) || filmSlugOf(attr(tag, 'data-target-link')) || '').toLowerCase();
    if (!slug || seen.has(slug) || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue;
    if (!/data-(?:item|film|target)-/.test(tag)) continue;
    const raw = attr(tag, 'data-item-name') || attr(tag, 'data-film-name') || attr(tag, 'data-item-full-display-name') || '';
    const split = splitTitleYear(raw);
    const year = Number(attr(tag, 'data-film-release-year') || attr(tag, 'data-item-year')) || split.year;
    seen.add(slug);
    films.push({ title: split.title || slug.replace(/-/g, ' '), year: year || null, slug });
  }
  const name = decodeEntities(
    /<h1[^>]*class="[^"]*\btitle-1\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1]
    || /<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i.exec(text)?.[1]
    || title.replace(/\s*[•|·-]\s*Letterboxd.*$/i, ''),
  ).replace(/<[^>]*>/g, '').replace(/\s*[•|·]\s*Letterboxd.*$/i, '').replace(/\s+/g, ' ').trim() || null;
  const nextTag = /<a\b[^>]*class="[^"]*\bnext\b[^"]*"[^>]*>/i.exec(text)?.[0];
  const href = nextTag ? attr(nextTag, 'href') : null;
  const next = href && /^\/[a-z]+\/[a-z0-9-]+\/page\/\d+\/?$/i.test(href) ? href : null;
  return { isPage, name, films, next };
}

// ---------- who is this person, and where do their Letterboxd pages live ----------

/** Slug of a Letterboxd person page: "lb:sean-baker", "letterboxd:director/sean-baker" or a full URL. */
export function explicitSlug(id) {
  const m = /^(?:lb|letterboxd):(?:(director|actor|writer)\/)?([a-z0-9][a-z0-9-]*)$/i.exec(String(id || '').trim())
    || /letterboxd\.com\/(director|actor|writer)\/([a-z0-9][a-z0-9-]*)/i.exec(String(id || ''));
  if (!m) return null;
  return m[1] ? { role: m[1].toLowerCase(), slug: m[2].toLowerCase() } : { role: null, slug: m[2].toLowerCase() };
}

/**
 * Letterboxd person pages we know for a name, from the people the film pages listed (film.src.lbpage.people.<role>[].slug).
 * @returns {{ role: 'director'|'writer'|'actor', slug: string }[]} one slug per role (the most common), director first
 */
export function slugsFor(store, keyOf, wantKey) {
  const tally = { director: new Map(), writer: new Map(), actor: new Map() };
  for (const f of Object.values(store.films || {})) {
    const p = f.src?.lbpage?.people;
    if (!p) continue;
    for (const [list, role] of [[p.director, 'director'], [p.writer, 'writer'], [p.cast, 'actor']]) {
      for (const x of list || []) if (x?.slug && keyOf(x.name) === wantKey) tally[role].set(x.slug, (tally[role].get(x.slug) || 0) + 1);
    }
  }
  const out = [];
  for (const role of ROLE_ORDER) {
    const best = [...tally[role]].sort((a, b) => b[1] - a[1])[0];
    if (best) out.push({ role, slug: best[0] });
  }
  return out;
}

/** Which kind of Letterboxd page a bare slug belongs to, from the film pages' people lists (director, else writer, else actor; director if unknown). */
function roleOfSlug(store, slug) {
  const found = new Set();
  for (const f of Object.values(store.films || {})) {
    const p = f.src?.lbpage?.people;
    if (!p) continue;
    for (const [list, role] of [[p.director, 'director'], [p.writer, 'writer'], [p.cast, 'actor']]) if ((list || []).some(x => x?.slug === slug)) found.add(role);
  }
  return ROLE_ORDER.find(r => found.has(r)) || 'director';
}

/** A name for a Letterboxd slug, from the film pages' people lists (or null). */
function nameForSlug(store, slug) {
  for (const f of Object.values(store.films || {})) {
    const p = f.src?.lbpage?.people;
    for (const list of p ? [p.director, p.writer, p.cast] : []) for (const x of list || []) if (x?.slug === slug && x.name) return x.name;
  }
  return null;
}

// ---------- reading the pages ----------

const tmdbFailure = e => {
  if (e?.status === 401) return 'TMDB no longer accepts your key. Check it in Settings.';
  if (e?.code === 'not-found' || e?.status === 404) return "TMDB doesn't list this person.";
  if (e?.code === 'host-paused' || e?.status === 429) return 'TMDB has asked Matinee to slow down. Try again in a little while.';
  return "Matinee couldn't reach TMDB.";
};

const plainFailure = e => {
  const status = e?.status;
  if (e?.code === 'host-paused' || status === 429) return 'Letterboxd has asked Matinee to slow down. Try again in a little while.';
  if (status === 403) return 'Letterboxd turned the request away.';
  if (status >= 500) return "Letterboxd isn't working right now.";
  if (e?.code === 'timeout') return 'Letterboxd took too long to answer.';
  if (e?.code === 'changed') return 'Letterboxd’s page looked different from usual, so Matinee could not read it.';
  if (e?.code === 'check') return 'Letterboxd wants you to check you’re human first. Open this person again once you have.';
  return "Matinee couldn't reach Letterboxd.";
};

/** One page: { kind: 'ok', parsed } | { kind: 'missing' } or throws. Plain request first, then the page window. */
async function readPage(http, path, signal) {
  const url = 'https://letterboxd.com' + path;
  const attempt = res => {
    if (res.status === 404 || res.status === 410) return { kind: 'missing' };
    if (res.status >= 200 && res.status < 300 && !res.challenge) {
      const parsed = parsePersonPage(res.text);
      if (parsed.isPage && (parsed.films.length || /class="[^"]*\b(?:poster-list|grid|film-list)\b/.test(res.text || ''))) return { kind: 'ok', parsed };
    }
    return null;
  };
  if (typeof http.browserText === 'function') {
    try { const r = attempt(await http.browserText(url, { signal, priority: 0 })); if (r) return r; }
    catch (e) { if (e?.code === 'aborted' || e?.code === 'host-paused' || e?.status === 429) throw e; /* anything else: the page window below is the fallback; its failure is reported by the caller */ }
  }
  const res = await http.page(url, { signal, priority: 0 });
  const r = attempt(res);
  if (r) return r;
  if (res.challenge || res.status === 403 || /<title[^>]*>\s*(?:just a moment|attention required|access denied)/i.test(String(res.text || ''))) throw Object.assign(new Error('check'), { code: 'check', status: res.status });
  if (res.status >= 200 && res.status < 300) {
    const parsed = parsePersonPage(res.text);
    if (parsed.isPage) return { kind: 'ok', parsed }; // a real page with no films on it
    throw Object.assign(new Error('Letterboxd’s page looked different from usual.'), { code: 'changed' });
  }
  throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
}

/** All pages (up to MAX_PAGES) of one role page. @returns {{ missing: boolean, name: string|null, films: object[], complete: boolean }} */
async function readRole(http, { role, slug }, signal) {
  const films = [], seen = new Set();
  let path = `/${role}/${slug}/`, name = null, pages = 0, complete = true;
  while (path && pages < MAX_PAGES) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { code: 'aborted' });
    const r = await readPage(http, path, signal);
    if (r.kind === 'missing') return { missing: pages === 0, name, films, complete: pages > 0 };
    pages++;
    name = name || r.parsed.name;
    for (const f of r.parsed.films) if (!seen.has(f.slug)) { seen.add(f.slug); films.push(f); }
    path = r.parsed.next;
  }
  if (path) complete = false;
  return { missing: false, name, films, complete };
}

// ---------- the feature ----------

/**
 * @param {object} o
 * @param {object} o.store            real store (reads films, library; caches results)
 * @param {object} o.http             from createHttp
 * @param {() => object[]} o.summaries  library summaries (full)
 * @param {(name: string) => string} o.keyOf  the app's name -> person id ('p:sean-baker')
 * @param {(event: string, payload: object) => void} o.emit
 * @param {() => number} [o.now]
 * @param {Function} [o.filmographyFn]  the Wikidata filmography (injected for tests)
 */
export function createPersonFilms({ store, http, summaries, keyOf, emit = () => {}, now = Date.now, filmographyFn = null, problems = NO_PROBLEMS }) {
  const jobs = new Map();   // jobKey -> promise
  let ctl = new AbortController(); // stop() cancels every read in progress
  const failures = new Map(); // jobKey -> { at, reason }
  const photoJobs = new Map(); // 'photo:<person>' -> promise of a portrait lookup in progress

  /** Who is being asked about: { id, name, pid (the id used in summaries), qid, slugs, library: [{ summary, roles }] } */
  function resolve({ id, name }) {
    const all = summaries();
    const asked = explicitSlug(id);
    // The screen passes its route parameter as both id and name, so a "name" that is really an id ('p:sean-baker', 'wd:Q5') is not a name.
    const idLike = v => /^(?:p|wd|tmdb|lb|letterboxd):/i.test(v) || /^https?:\/\//i.test(v);
    let pname = typeof name === 'string' && name.trim() && !idLike(name.trim()) ? name.trim() : null;
    if (!pname && typeof id === 'string' && id.trim() && !idLike(id.trim())) pname = id.trim(); // a plain name used as the id
    if (!pname && asked) pname = nameForSlug(store, asked.slug);
    let pid = null, qid = null, photo = null, tmdbId = /^tmdb:\d+$/.test(String(id || '')) ? Number(String(id).slice(5)) : null;
    const library = new Map();
    const want = pname ? keyOf(pname) : null;
    const hit = p => (id && (p.id === id || p.sourceId === id)) || (want && p.id === want);
    for (const s of all) {
      for (const [role, list] of Object.entries(s.people || {})) {
        for (const p of list || []) {
          if (!hit(p)) continue;
          pid = pid || p.id; pname = pname || p.name; photo = photo || p.photo || null;
          if (!qid && /^wd:Q\d+$/.test(p.sourceId || '')) qid = p.sourceId.slice(3);
          if (!tmdbId && /^tmdb:\d+$/.test(p.sourceId || '')) tmdbId = Number(p.sourceId.slice(5));
          const e = library.get(s.key) || { summary: s, roles: [] };
          const r = role === 'cast' && p.role ? `cast:${p.role}` : role;
          if (!e.roles.includes(r)) e.roles.push(r);
          library.set(s.key, e);
        }
      }
    }
    if (!pid && pname) pid = keyOf(pname);
    const slugs = asked ? [{ role: asked.role || roleOfSlug(store, asked.slug), slug: asked.slug }] : pid ? slugsFor(store, keyOf, pid) : [];
    // Roles they were opened from (library roles first), as TMDB departments to prefer when searching by name
    const kinds = [...new Set([...library.values()].flatMap(e => e.roles.map(r => r.split(':')[0])))];
    const departments = ['director', 'writer', 'cast', 'cinematography', 'composer', 'editor', 'producer'].filter(k => kinds.includes(k)).map(k => DEPARTMENT[k]);
    return { id: id || pid, name: pname, pid, qid, tmdbId, photo, departments, slugs, library: [...library.values()] };
  }

  const cacheName = s => `personfilms:${s.role}/${s.slug}`;
  const cachedRole = s => store.cached(cacheName(s), CACHE_DAYS * DAY);
  const atOf = s => store.cache?.[cacheName(s)]?.at || null;

  // Library lookup: Letterboxd slug first, then title + year.
  function libraryIndex() {
    const bySlug = new Map(), byTy = new Map(), byTitle = new Map(), byTmdb = new Map();
    for (const s of summaries()) {
      if (s.slug) bySlug.set(s.slug, s);
      const tid = store.films?.[s.key]?.ids?.tmdb ?? s.ids?.tmdb;
      if (tid != null) byTmdb.set(String(tid), s);
      const t = normTitle(s.title), ot = normTitle(s.originalTitle);
      for (const n of new Set([t, ot].filter(Boolean))) {
        byTy.set(`${n}|${s.year || ''}`, s);
        byTitle.set(n, byTitle.has(n) ? null : s); // null = ambiguous
      }
    }
    return f => (f.tmdbId != null && byTmdb.get(String(f.tmdbId))) || bySlug.get(f.slug) || byTy.get(`${normTitle(f.title)}|${f.year || ''}`) || (!f.year ? byTitle.get(normTitle(f.title)) : null) || null;
  }

  function row(f, role, find) {
    const s = find(f);
    const u = s ? store.library.films?.[s.key] : null;
    const slug = f.slug || s?.slug || null;
    return {
      title: f.title || s?.title, year: f.year ?? s?.year ?? null,
      url: letterboxdUrl({ slug, tmdbId: f.tmdbId, title: f.title || s?.title, year: f.year ?? s?.year }),
      slug, key: s ? s.key : null, poster: posterUrl(s?.poster) || posterUrl(f.poster), role,
      watched: !!u?.watched, watchlist: !!u?.watchlist, liked: !!u?.liked, rating: u?.rating ?? null,
    };
  }

  const libraryRows = who => {
    const find = libraryIndex();
    return who.library.map(e => ({ ...row({ title: e.summary.title, year: e.summary.year, slug: e.summary.slug, poster: e.summary.poster }, e.roles[0].split(':')[0], find), key: e.summary.key, roles: e.roles }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  };

  function fromLetterboxd(who) {
    const find = libraryIndex(), byslug = new Map();
    const roles = [];
    let fetchedAt = null;
    for (const s of who.slugs) {
      const c = cachedRole(s);
      if (!c) continue;
      roles.push(ROLE_NAME[s.role]);
      const at = atOf(s); if (at && (!fetchedAt || at < fetchedAt)) fetchedAt = at;
      for (const f of c.films) {
        const have = byslug.get(f.slug);
        if (have) { if (!have.roles.includes(ROLE_NAME[s.role])) have.roles.push(ROLE_NAME[s.role]); continue; }
        byslug.set(f.slug, { ...row(f, ROLE_NAME[s.role], find), roles: [ROLE_NAME[s.role]] });
      }
    }
    return { roles, fetchedAt, films: [...byslug.values()] };
  }

  async function wikidataRows(who) {
    const fn = filmographyFn || (await import('./filmography.js')).filmography;
    const r = await fn({ store, http, summaries: summaries(), personId: who.pid, signal: ctl.signal });
    const find = libraryIndex();
    return {
      roles: [...new Set(r.films.flatMap(f => f.roles || []).map(x => String(x).split(':')[0]))],
      films: r.films.map(f => {
        const base = row({ title: f.title, year: f.year, slug: f.key ? store.films[f.key]?.slug || null : null, poster: f.poster }, (f.roles || [])[0] || 'cast', find);
        return { ...base, key: f.key || base.key, roles: f.roles || [], watched: f.watched ?? base.watched, watchlist: f.watchlist ?? base.watchlist };
      }),
    };
  }

  // TMDB: one cache entry per person (7 days). Films collapse to one row with all their roles.
  const tmdbKey = () => String(store.library?.settings?.keys?.tmdb || '').trim();
  const tmdbName = who => `personfilms:tmdb/${who.pid || who.tmdbId || who.qid}`;
  const cachedTmdb = who => (who.pid || who.tmdbId || who.qid) ? store.cached(tmdbName(who), CACHE_DAYS * DAY) : null;
  function fromTmdb(who) {
    const find = libraryIndex(), c = cachedTmdb(who);
    const films = c.films.map(f => {
      const base = row({ title: f.title, year: f.year, tmdbId: f.tmdbId, poster: f.poster }, f.roles[0].split(':')[0], find);
      return { ...base, roles: f.roles };
    });
    return { roles: [...new Set(c.films.flatMap(f => f.roles.map(r => r.split(':')[0])))], films, mainRole: c.knownFor || null, photo: c.photo || null, fetchedAt: store.cache?.[tmdbName(who)]?.at || null };
  }
  async function runTmdb(who) {
    const r = await fetchTmdbPerson({ http, key: tmdbKey(), tmdbId: who.tmdbId, name: who.name, departments: who.departments, signal: ctl.signal });
    store.setCached(tmdbName(who), { films: r.films, tmdbId: r.tmdbId, knownFor: r.knownFor || null, photo: r.photo || null });
  }

  const result = (who, over) => ({ id: who.id, name: who.name, status: 'none', source: null, fetchedAt: null, roles: [], mainRole: null, photo: who.photo || null, films: [], ...over });
  const jobKeyOf = who => (who.slugs.length ? who.slugs.map(cacheName).join('+') : `wd:${who.qid || who.pid}`);
  const failedRecently = key => { const f = failures.get(key); return f && now() - f.at < FAIL_MEMORY_MS ? f : null; };

  async function run(who, key) {
    let reason = null;
    // A later source answering is a success, but TMDB is not asked again for a while if it failed
    const ok = () => { if (reason) failures.set(key, { at: now(), reason, real: true }); else failures.delete(key); return 'ok'; };
    // 1. TMDB (needs the user's key)
    if (tmdbKey()) {
      try { await runTmdb(who); return ok(); }
      catch (e) {
        if (e?.code === 'aborted') return 'aborted';
        reason = tmdbFailure(e);
        problems.report({ area: 'TMDB', film: who.name, message: `Couldn't load ${who.name}'s films from TMDB: ${reason}`, error: e, level: 'warning' });
      }
    }
    // 2. Wikidata (no key; its own cache of 30 days keeps later calls cheap)
    if (who.qid) {
      try { const w = await wikidataRows(who); if (w.films.length) return ok(); }
      catch (e) {
        if (e?.code === 'aborted') return 'aborted';
        problems.report({ area: 'Wikidata', film: who.name, message: `Couldn't load ${who.name}'s films from Wikidata.`, error: e, level: 'warning' });
      }
    }
    // 3. Letterboxd pages, last
    if (who.slugs.length) {
      try {
        for (const s of who.slugs) {
          if (cachedRole(s)) continue;
          const r = await readRole(http, s, ctl.signal);
          if (r.missing) store.setCached(cacheName(s), { films: [], complete: true, missing: true });
          else store.setCached(cacheName(s), { films: r.films, complete: r.complete, name: r.name });
        }
        return ok();
      } catch (e) {
        if (e?.code === 'aborted') return 'aborted';
        reason = plainFailure(e);
        problems.report({ area: 'Letterboxd', film: who.name, message: `Couldn't load ${who.name}'s films from Letterboxd: ${reason}`, error: e, level: 'warning' });
      }
    }
    failures.set(key, { at: now(), reason: reason || 'Matinee could not find a full list for this person yet.', real: !!reason });
    return 'failed';
  }

  /** The best answer already held for a person (TMDB, then Wikidata, then Letterboxd), or null. */
  async function heldAnswer(who) {
    if (cachedTmdb(who)) { const t = fromTmdb(who); return result(who, { status: t.films.length ? 'ok' : 'none', source: 'tmdb', fetchedAt: t.fetchedAt, roles: t.roles, mainRole: t.mainRole, photo: t.photo || who.photo, films: t.films }); }
    if (who.qid && store.cached(`filmography:${who.qid}`, 30 * DAY)) {
      try {
        const w = await wikidataRows(who);
        if (w.films.length) return result(who, { status: 'ok', source: 'wikidata', fetchedAt: store.cache?.[`filmography:${who.qid}`]?.at || null, roles: w.roles, films: w.films });
      } catch { /* only a held (cached) answer was wanted; a real read failure is reported by run() */ }
    }
    if (who.slugs.length > 0 && who.slugs.every(cachedRole)) {
      const lb = fromLetterboxd(who);
      return result(who, { status: lb.films.length ? 'ok' : 'none', source: 'letterboxd', fetchedAt: lb.fetchedAt, roles: lb.roles, films: lb.films });
    }
    return null;
  }

  return {
    resolve,
    /** The shape described for getPersonFilms in core/api.js. Never throws for a known name; start-up of the read is in the background. */
    async get({ id, name } = {}) {
      const who = resolve({ id, name });
      if (!who.name) throw Object.assign(new Error('Nobody by that name is known to Matinee.'), { code: 'not-found' });
      const key = jobKeyOf(who);
      // TMDB's answer is shown at once when held. Without a TMDB key, whatever else is held (Wikidata, then Letterboxd) is shown at once.
      let held = await heldAnswer(who);
      // A TMDB answer saved before we kept the main role: read it again once, so the page can open on the right role.
      if (held?.source === 'tmdb' && cachedTmdb(who)?.knownFor === undefined && tmdbKey() && !jobs.has(key) && !failedRecently(key)) {
        try { if (await run(who, key) === 'ok') held = (await heldAnswer(who)) || held; } catch (e) { problems.report({ area: 'TMDB', film: who.name, message: `Couldn't refresh ${who.name}'s films. The earlier list is still shown.`, error: e, level: 'warning' }); }
      }
      if (held && (held.source === 'tmdb' || !tmdbKey())) return held;
      const mine = libraryRows(who);
      if (jobs.has(key)) return result(who, { status: 'loading', films: mine, roles: [...new Set(mine.flatMap(f => f.roles.map(r => r.split(':')[0])))] });
      const fail = failedRecently(key);
      if (fail || (!tmdbKey() && !who.slugs.length && !who.qid)) {
        if (held) return { ...held, ...(fail?.real ? { reason: fail.reason } : {}) };
        return result(who, { status: 'failed', reason: fail ? fail.reason : 'Matinee has no other films for this person yet.', films: mine });
      }
      const job = run(who, key).then(out => { jobs.delete(key); emit('personFilms', { id: who.id, name: who.name, status: out === 'ok' ? 'ok' : 'failed' }); return out; }, e => { jobs.delete(key); problems.report({ area: 'Person page', film: who.name, message: `Matinee couldn't load ${who.name}'s films.`, error: e, level: 'error' }); });
      jobs.set(key, job);
      return result(who, { status: 'loading', films: mine });
    },
    /**
     * A person's portrait (TMDB image path) or null, for a film whose own credits carry none: a film TMDB does not list (a series,
     * a short) takes its people from Letterboxd, which has no portraits, so the cast card showed initials for people whose person
     * page shows a face. Answers from what is held (another library film, or this person's saved TMDB answer); otherwise ONE TMDB
     * lookup by name, the same one the person page makes, and never the slower sources. Without the user's TMDB key: null.
     */
    async photo({ id, name } = {}) {
      let who;
      try { who = resolve({ id, name }); } catch { return null; } // nobody by that name: nothing to show, the card keeps the initials
      if (!who.name) return null;
      if (who.photo) return who.photo;
      const held = cachedTmdb(who);
      if (held) return held.photo || null;
      const key = `photo:${who.pid || who.name}`;
      if (!tmdbKey() || failedRecently(key) || store.cached(`personphoto:none/${who.pid}`, 30 * DAY)) return null;
      if (!photoJobs.has(key)) {
        photoJobs.set(key, runTmdb(who).then(() => cachedTmdb(who)?.photo || null, e => {
          if (e?.code === 'aborted') return null;
          failures.set(key, { at: now(), reason: tmdbFailure(e) });
          // TMDB not knowing someone is expected (a private person in a documentary), so it is remembered for a month, not reported.
          if (e?.code === 'not-found') store.setCached(`personphoto:none/${who.pid}`, true);
          else problems.report({ area: 'TMDB', film: who.name, message: `Couldn't look up ${who.name}'s photo on TMDB.`, error: e, level: 'warning' });
          return null;
        }).finally(() => photoJobs.delete(key)));
      }
      return photoJobs.get(key);
    },
    /** Cancel every read in progress (the app is closing or the library was reset). */
    stop() { ctl.abort(); ctl = new AbortController(); },
    /** For tests: wait for a read that get() started. */
    async idle() { await Promise.all([...jobs.values()]); },
  };
}
