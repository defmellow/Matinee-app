// Letterboxd RSS: the member's latest ~50 diary entries and reviews. Plain HTTP, never challenged by Cloudflare,
// so it's the cheap way to catch up between full exports.
import { parseRss, urls } from '../parse/letterboxd.js';
import { entryCodeFromViewingId } from '../parse/export.js';
import { addIds } from '../model.js';
import { resolveFilm, userFilm } from '../library.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const two = n => String(n).padStart(2, '0');

/** viewing id → 'YYYY-MM-DD' the entry was logged (the feed's pubDate, as written: "Fri, 9 Oct 2026 23:42:24 +1300"). */
function loggedDates(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const id = /letterboxd-(?:watch|review)-(\d+)/.exec(m[1]);
    const d = /<pubDate>\s*\w+,\s*(\d{1,2})\s+(\w{3})\w*\s+(\d{4})/.exec(m[1]);
    if (id && d && MONTHS[d[2].toLowerCase()]) out.set(Number(id[1]), `${d[3]}-${two(MONTHS[d[2].toLowerCase()])}-${two(d[1])}`);
  }
  return out;
}

/** Newest entry first; on the same day an export entry outranks an RSS one (the export is the source of truth). */
const newestFirst = (a, b) => String(b.date).localeCompare(String(a.date)) || (a.source === 'rss') - (b.source === 'rss');

/**
 * Bring a film's own flags in line with its entries: any film with a diary entry is watched, and when the newest
 * entry came from RSS (so it's newer than anything in the export) its rating and like replace the older ones.
 * An entry with no rating never clears the film's rating.
 */
export function syncFlagsFromEntries(store, keys) {
  const want = new Set(keys);
  const byKey = new Map();
  for (const e of Object.values(store.library.entries)) if (want.has(e.key)) (byKey.get(e.key) || byKey.set(e.key, []).get(e.key)).push(e);
  for (const [key, list] of byKey) {
    const u = userFilm(store, key);
    u.watched = true;
    const latest = list.sort(newestFirst)[0];
    if (latest.source !== 'rss') continue;
    if (latest.rating != null) u.rating = latest.rating;
    u.liked = !!latest.liked;
  }
}

function problem(message, code, extra) { return Object.assign(new Error(message), { code }, extra); }

/**
 * Pull the member's public feed and merge it in.
 * Entries get id 'v:<viewingId>'. A viewing already imported from the export (id 'e:<code>') is recognised exactly —
 * the export's short code is base-62 of viewingId × 10 + 1 — and skipped; export data always wins.
 * @returns {Promise<{ added: number, updated: number }>}
 */
export async function refreshFromRss(store, http, username, { now } = {}) {
  const user = String(username || '').trim().replace(/^@/, '');
  if (!user) throw problem('Enter your Letterboxd username first.', 'no-username');
  const res = await http.text(urls.rss(encodeURIComponent(user)));
  if (res.status === 404) throw problem(`There's no Letterboxd member called “${user}”.`, 'no-user');
  if (res.status < 200 || res.status >= 300) throw problem("Letterboxd didn't answer properly. Try again in a minute.", 'http', { status: res.status });
  const xml = res.text || '';
  if (!/<rss[\s>]/.test(xml) || !/<channel>/.test(xml)) throw problem("Letterboxd sent something we couldn't read. Try again in a minute.", 'bad-feed');

  const lib = store.library;
  const logged = loggedDates(xml);
  // Oldest first, so a film's newest entry is applied last.
  const items = parseRss(xml).filter(i => i.slug)
    .sort((a, b) => String(a.date || logged.get(a.viewingId)).localeCompare(String(b.date || logged.get(b.viewingId))) || a.viewingId - b.viewingId);

  let added = 0, updated = 0;
  const touched = new Set();
  for (const item of items) {
    const film = resolveFilm(store, { slug: item.slug, title: item.title, year: item.year });
    const prev = film.src.rss || {};
    film.src.rss = { ...prev, poster: prev.poster || (item.poster ? { url: item.poster } : null) };
    addIds(film, { tmdb: item.tmdbId, letterboxd: item.slug });

    const date = item.date || logged.get(item.viewingId);
    if (!date) continue;
    const id = `v:${item.viewingId}`;
    // DECISION: a viewing that came from the export is never changed by RSS (a rating or review edited since the export
    // shows up on the next export). Only RSS's own entries are updated.
    if (lib.entries[`e:${entryCodeFromViewingId(item.viewingId)}`]) continue;
    const fields = { key: film.key, date, rating: item.rating, liked: item.liked, rewatch: item.rewatch, review: item.review, spoiler: item.spoiler };
    const have = lib.entries[id];
    if (!have) {
      lib.entries[id] = { id, ...fields, loggedAt: logged.get(item.viewingId) || date, tags: [], source: 'rss' };
      added++;
    } else if (Object.entries(fields).some(([k, v]) => have[k] !== v)) {
      Object.assign(have, fields);
      updated++;
    }
    touched.add(film.key);
  }
  syncFlagsFromEntries(store, touched);

  lib.sync = lib.sync || {};
  lib.sync.lastRefresh = new Date(now ?? Date.now()).toISOString();
  store.touch('library');
  store.touch('films');
  return { added, updated };
}
