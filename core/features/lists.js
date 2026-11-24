// Letterboxd lists you follow, and your own lists you can export for Letterboxd's list importer.
//  - parseListInput: a boxd.it link or a letterboxd.com list address (any page, /detail/ or trailing text) -> what to read.
//  - readList: every page of a list (plain request first, then the page window), telling "not there", "private" and "couldn't read" apart.
//  - followList / refreshList / refreshDueLists / linkList / unlinkList / unfollowList: store changes. Nothing is ever deleted on its own:
//    a list that disappears keeps its last copy and says so; films that leave a list stay in the library; every failure goes to problems.
//  - listCsv: the CSV Letterboxd's "Import" on a list's edit page reads.
// All network goes through the injected http (same shape as core/net.js), so it is testable offline.
import { NO_PROBLEMS } from '../problems.js';
import { parseListPage } from '../parse/list-page.js';
import { resolveFilm, userFilm } from '../library.js';

export const MAX_PAGES = 50;
export const STALE_MS = 24 * 60 * 60 * 1000;
export const HISTORY_MAX = 20;
export const MISS_LIMIT = 2;

const coded = (message, code) => Object.assign(new Error(message), { code });
const iso = now => new Date(now ?? Date.now()).toISOString();

// ---------- addresses ----------

/**
 * @returns {null | { kind: 'short', id: string, url: string } | { kind: 'list', user: string, slug: string, url: string }}
 */
export function parseListInput(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'boxd.it') {
    const m = /^\/([A-Za-z0-9]+)\/?$/.exec(u.pathname);
    return m ? { kind: 'short', id: m[1], url: `https://boxd.it/${m[1]}` } : null;
  }
  if (host === 'letterboxd.com') {
    const m = /^\/([^/]+)\/list\/([^/]+)(?:\/.*)?$/.exec(u.pathname);
    return m ? { kind: 'list', user: m[1], slug: m[2], url: `https://letterboxd.com/${m[1]}/list/${m[2]}/` } : null;
  }
  return null;
}

/** The canonical list address in any address Letterboxd sent us back to, or null when it isn't a list. */
const canonicalOf = url => { const p = parseListInput(url); return p && p.kind === 'list' ? p.url : null; };
const pageUrl = (base, n) => (n > 1 ? `${base}page/${n}/` : base);

// ---------- reading ----------

/** One address: plain request first, then the page window if Letterboxd asks for a check. Never decides what a failure means. */
async function fetchOne(http, url, signal) {
  const judge = (res, viaWindow) => {
    const finalUrl = res.url || url;
    if (res.status === 404) return { kind: 'notfound' };
    if (res.status >= 200 && res.status < 300) {
      const p = parseListPage(res.text, { url: finalUrl });
      if (p.ok) return { kind: 'ok', page: p, finalUrl };
      if (p.private) return { kind: 'private' };
      if (p.notFound) return { kind: 'notfound' };
      return viaWindow ? { kind: 'unreadable', reason: p.challenge ? 'Letterboxd asked for a check that was not completed.' : "The page didn't look like a list." } : { kind: 'retry' };
    }
    if (res.status === 429) return { kind: 'unreadable', reason: 'Letterboxd asked Matinee to slow down.' };
    return viaWindow ? { kind: 'unreadable', reason: `Letterboxd answered ${res.status}.` } : { kind: 'retry' };
  };
  if (typeof http.browserText === 'function') {
    try {
      const r = judge(await http.browserText(url, { signal }), false);
      if (r.kind !== 'retry') return r;
    } catch (e) {
      if (e?.code === 'aborted') throw e;
      if (e?.status === 429) return { kind: 'unreadable', reason: 'Letterboxd asked Matinee to slow down.' };
      // anything else: the page window below is the fallback
    }
  }
  try {
    const r = judge(await http.page(url, { signal }), true);
    return r.kind === 'retry' ? { kind: 'unreadable', reason: "The page didn't look like a list." } : r;
  } catch (e) {
    if (e?.code === 'aborted') throw e;
    return { kind: 'unreadable', reason: e?.message || 'The page could not be read.' };
  }
}

/** Follow a boxd.it link to the list address it points at. */
export async function resolveShort(http, shortUrl, { signal } = {}) {
  let res;
  try { res = typeof http.browserText === 'function' ? await http.browserText(shortUrl, { signal }) : await http.page(shortUrl, { signal }); }
  catch (e) { if (e?.code === 'aborted') throw e; return { kind: 'unreadable', reason: e?.message || 'The link could not be opened.' }; }
  if (res.status === 404) return { kind: 'notfound' };
  const url = canonicalOf(res.url);
  if (url) return { kind: 'ok', url };
  return res.status >= 200 && res.status < 300 ? { kind: 'notalist' } : { kind: 'unreadable', reason: `Letterboxd answered ${res.status}.` };
}

/**
 * Every page of a list.
 * @returns {Promise<{ status: 'ok'|'notfound'|'private'|'unreadable', reason?: string, pages: number, complete: boolean,
 *   finalUrl: string, name: string, owner: string, ownerName: string, description: string, items: object[] }>}
 *   complete is false when the page cap stopped the read; a later page that fails makes the whole read 'unreadable'.
 */
export async function readList(http, url, { signal, maxPages = MAX_PAGES } = {}) {
  const out = { status: 'ok', pages: 0, complete: true, finalUrl: url, name: '', owner: '', ownerName: '', description: '', items: [] };
  let base = url;
  for (let n = 1; n <= maxPages; n++) {
    const r = await fetchOne(http, pageUrl(base, n), signal);
    if (r.kind !== 'ok') return { ...out, status: r.kind === 'notalist' ? 'unreadable' : r.kind, reason: r.reason, items: n > 1 ? out.items : [], complete: false };
    out.pages++;
    const p = r.page;
    if (n === 1) {
      const canon = canonicalOf(r.finalUrl);
      if (!canon) return { ...out, status: 'unreadable', reason: "That address isn't a list.", complete: false };
      base = out.finalUrl = canon;
      out.name = p.name; out.owner = p.owner; out.ownerName = p.ownerName; out.description = p.description;
    }
    out.items.push(...p.items);
    if (!p.hasNext || !p.items.length) return out;
    if (n === maxPages) out.complete = false;
  }
  return out;
}

// ---------- changes ----------

/** { added, removed } between two ordered key lists. Order changes alone are not changes. */
export function diffKeys(before, after) {
  const was = new Set(before), is = new Set(after);
  return { added: after.filter(k => !was.has(k)), removed: before.filter(k => !is.has(k)) };
}

const keepHistory = h => h.slice(-HISTORY_MAX);

/** Put a good read into a list (and its films into the library, as films nobody has watched or listed yet). Returns { added, removed }. */
function apply(store, list, read, now) {
  const keys = [], notes = {};
  for (const item of read.items) {
    const film = resolveFilm(store, { slug: item.slug, title: item.title, year: item.year });
    userFilm(store, film.key); // makes it a library film; watched / watchlist stay as they were
    if (keys.includes(film.key)) continue;
    keys.push(film.key);
    if (item.note) notes[film.key] = item.note;
  }
  const first = list.fetchedAt == null && !(list.films || []).length;
  const old = list.films || [];
  let next = keys;
  // A read stopped by the page cap only ever adds: what is past the cap is unknown, not gone.
  if (!read.complete) next = [...keys, ...old.filter(k => !keys.includes(k))];
  const d = first ? { added: [], removed: [] } : diffKeys(old, next);
  const recovered = !first && list.status && list.status !== 'ok';
  if (d.added.length || d.removed.length || recovered) {
    list.history = keepHistory([...(list.history || []), { at: iso(now), added: d.added, removed: d.removed, ...(recovered ? { back: true } : {}) }]);
  }
  list.films = next;
  list.notes = notes;
  if (read.name) list.name = read.name;
  if (read.owner) list.owner = read.owner;
  list.ownerName = read.ownerName || list.ownerName || '';
  list.description = read.description || '';
  list.url = read.finalUrl || list.url;
  list.fetchedAt = list.checkedAt = iso(now);
  list.status = 'ok'; list.missCount = 0; list.pages = read.pages; list.truncated = !read.complete || undefined;
  delete list.reason;
  store.touch('library'); store.touch('films');
  return d;
}

const idFor = p => `lb:${p.user}:${p.slug}`;
const findByUrl = (store, ...urls) => Object.values(store.library.lists).find(l => l.source === 'letterboxd' && urls.some(u => u && (l.url === u || l.shortUrl === u))) || null;
const label = l => `The list "${l.name}"${l.owner ? ` by ${l.owner}` : ''}`;

const READ_FAIL = {
  notfound: "Letterboxd couldn't find that list. Check the link, and that the list is public.",
  private: 'That list is private, so Matinee can only read it if you make it public on Letterboxd.',
};
const failMessage = r => READ_FAIL[r.status] || `Matinee couldn't read that list. ${r.reason || ''}`.trim();

/** Work out the canonical address (resolving a short link) and read it. Throws a plain-English error when it can't. */
async function openList(http, input, signal) {
  const p = parseListInput(input);
  if (!p) throw coded("That doesn't look like a Letterboxd list link. Paste a link like boxd.it/abc12 or letterboxd.com/name/list/list-name/.", 'bad-link');
  let url = p.url, shortUrl = null;
  if (p.kind === 'short') {
    shortUrl = p.url;
    const r = await resolveShort(http, p.url, { signal });
    if (r.kind === 'notalist') throw coded("That link doesn't go to a list.", 'bad-link');
    if (r.kind !== 'ok') throw coded(failMessage(r), r.kind);
    url = r.url;
  }
  const read = await readList(http, url, { signal });
  if (read.status !== 'ok') throw coded(failMessage(read), read.status);
  return { read, url: read.finalUrl, shortUrl };
}

const userOf = url => { const p = parseListInput(url); return p && p.kind === 'list' ? p : null; };

/** Follow a Letterboxd list by link. Returns the list (existing one when already followed). */
export async function followList({ store, http, signal, now }, input) {
  const p = parseListInput(input);
  const known = p && findByUrl(store, p.url);
  if (known) return { id: known.id, existing: true };
  const { read, url, shortUrl } = await openList(http, input, signal);
  const dup = findByUrl(store, url, shortUrl);
  if (dup) return { id: dup.id, existing: true };
  const u = userOf(url);
  const list = { id: idFor(u), source: 'letterboxd', follow: true, url, shortUrl, name: read.name || u.slug, owner: read.owner || u.user, ownerName: '', description: '',
    films: [], notes: {}, fetchedAt: null, checkedAt: null, status: 'ok', missCount: 0, history: [], created: iso(now) };
  apply(store, list, read, now);
  store.library.lists[list.id] = list;
  store.touch('library');
  return { id: list.id, existing: false, count: list.films.length };
}

/** Read a followed list again. Never throws for a list problem: the list records it and it goes to `problems`. */
export async function refreshList({ store, http, signal, now, problems = NO_PROBLEMS }, id) {
  const list = store.library.lists[id];
  if (!list || list.source !== 'letterboxd') return { status: 'skipped' };
  let read = await readList(http, list.url, { signal });
  if (read.status === 'notfound' && list.shortUrl) {
    // A renamed list: the short link still finds it.
    const r = await resolveShort(http, list.shortUrl, { signal });
    if (r.kind === 'ok') read = await readList(http, r.url, { signal });
  }
  if (read.status === 'ok') {
    const d = apply(store, list, read, now);
    if (!read.complete) problems.report({ area: 'Lists', message: `${label(list)} is longer than Matinee reads (${MAX_PAGES} pages). It added what it found and removed nothing.`, level: 'warning' });
    return { status: 'ok', added: d.added.length, removed: d.removed.length };
  }
  list.checkedAt = iso(now);
  const was = list.status;
  if (read.status === 'notfound') {
    list.missCount = (list.missCount || 0) + 1;
    if (list.missCount >= MISS_LIMIT) {
      list.status = 'gone';
      if (was !== 'gone') problems.report({ area: 'Lists', message: `${label(list)} is no longer on Letterboxd. Matinee is showing the last copy it saw.`, level: 'error' });
    } else {
      problems.report({ area: 'Lists', message: `Letterboxd couldn't find ${label(list).replace(/^The/, 'the')}. Matinee will check again.`, level: 'warning' });
    }
  } else if (read.status === 'private') {
    list.status = 'private';
    if (was !== 'private') problems.report({ area: 'Lists', message: `${label(list)} is private now, so Matinee can't update it. Showing the last copy.`, level: 'error' });
  } else {
    list.status = 'unreadable'; list.reason = read.reason;
    problems.report({ area: 'Lists', message: `Matinee couldn't read ${label(list).replace(/^The/, 'the')}. ${read.reason || ''} Showing the last copy.`.replace(/\s+/g, ' '), level: 'error' });
  }
  store.touch('library');
  return { status: list.status };
}

/** Re-read every followed list not read in the last 24 hours (or all of them with force). */
export async function refreshDueLists(ctx, { force = false } = {}) {
  const { store, signal, problems = NO_PROBLEMS } = ctx;
  const t = ctx.now ?? Date.now();
  const out = { checked: 0, added: 0, removed: 0 };
  for (const l of Object.values(store.library.lists)) {
    if (signal?.aborted) break;
    if (l.source !== 'letterboxd' || l.follow === false) continue;
    const last = Date.parse(l.checkedAt || l.fetchedAt || '') || 0;
    if (!force && t - last < STALE_MS) continue;
    try {
      const r = await refreshList(ctx, l.id);
      out.checked++; out.added += r.added || 0; out.removed += r.removed || 0;
    } catch (e) {
      if (e?.code === 'aborted') break;
      problems.report({ area: 'Lists', message: `Matinee couldn't check ${label(l).replace(/^The/, 'the')} for changes.`, error: e, level: 'error' });
    }
  }
  return out;
}

/**
 * Turn one of your own lists into a followed Letterboxd list (after you exported it and imported it there). Keeps the id.
 * Films of yours that did not make it onto Letterboxd are recorded in the history, so nothing vanishes quietly.
 */
export async function linkList({ store, http, signal, now }, id, input) {
  const list = store.library.lists[id];
  if (!list) throw coded('That list no longer exists.', 'not-found');
  if (list.source !== 'matinee') throw coded('This list already follows Letterboxd.', 'read-only');
  const p = parseListInput(input);
  const known = p && findByUrl(store, p.url);
  if (known) throw coded(`You already follow that list (“${known.name}”).`, 'already');
  const { read, url, shortUrl } = await openList(http, input, signal);
  const dup = findByUrl(store, url, shortUrl);
  if (dup) throw coded(`You already follow that list (“${dup.name}”).`, 'already');
  const own = list.films || [], keepNotes = list.notes || {};
  const mine = { name: list.name };
  const u = userOf(url);
  Object.assign(list, { source: 'letterboxd', follow: true, url, shortUrl, owner: read.owner || u.user, fetchedAt: null, status: 'ok', missCount: 0, history: [] });
  list.films = []; // so the read is treated as a first read, then compared with what the user exported below
  apply(store, list, read, now);
  const missing = own.filter(k => !list.films.includes(k));
  list.history = [{ at: iso(now), added: [], removed: missing, linked: true }];
  list.name = mine.name; // the name the user gave it stays unless Letterboxd's differs
  if (read.name) list.name = read.name;
  // The user's notes for films that are on the Letterboxd list but came back without one stay.
  for (const [k, v] of Object.entries(keepNotes)) if (list.films.includes(k) && !list.notes[k]) list.notes[k] = v;
  store.touch('library');
  return { id: list.id, count: list.films.length, missing: missing.length };
}

/** Back to an own list: the films, notes and name stay; Matinee stops reading Letterboxd. */
export function unlinkList({ store }, id) {
  const list = store.library.lists[id];
  if (!list || list.source !== 'letterboxd') throw coded('That list does not follow Letterboxd.', 'not-found');
  for (const k of ['follow', 'url', 'shortUrl', 'owner', 'ownerName', 'fetchedAt', 'checkedAt', 'status', 'missCount', 'history', 'pages', 'truncated', 'reason']) delete list[k];
  list.source = 'matinee';
  list.notes = list.notes || {};
  store.touch('library');
  return { id: list.id };
}

/** Stop following: the list goes, its films stay in the library. */
export function unfollowList({ store }, id) {
  const list = store.library.lists[id];
  if (!list || list.source !== 'letterboxd') throw coded('That list does not follow Letterboxd.', 'not-found');
  delete store.library.lists[id];
  store.touch('library');
  return { ok: true };
}

/** Every film key on any list (own, followed or imported). */
export function listedKeys(store) {
  const set = new Set();
  for (const l of Object.values(store.library.lists)) for (const k of l.films || []) set.add(k);
  return set;
}

// ---------- export for Letterboxd ----------

const csvField = v => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_COLUMNS = ['LetterboxdURI', 'tmdbID', 'imdbID', 'Title', 'Year', 'Directors', 'Review'];

/**
 * @param {{ slug?: string|null, tmdb?: string|number|null, imdb?: string|null, title: string, year?: number|null, directors?: string[], note?: string }[]} rows
 * @returns {string} UTF-8 text (no byte-order mark), comma-separated with no spaces after commas, in the order the rows came in
 */
export function listCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.slug ? `https://letterboxd.com/film/${r.slug}/` : '', r.tmdb ?? '', r.imdb ?? '', r.title, r.year ?? '', (r.directors || []).join(', '), r.note || '',
    ].map(csvField).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** "My list: best?" -> "My list best.csv": safe on Windows, never empty. */
export function csvFilename(name) {
  const base = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  return `${base || 'List'}.csv`;
}
