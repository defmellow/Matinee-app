// Import a Letterboxd data-export ZIP into the store.
//
// The export is the source of truth for everything it contains, so importing again replaces what an earlier import
// put in: watched / rating / like / watchlist flags, export diary entries, Letterboxd tags and export lists.
// Anything the member made inside Matinee (personal tags, notes, saved views) is left alone, and entries that came
// from the RSS feed survive unless the export now contains the same viewing.
import { parseExportZip, entryCodeFromViewingId, viewingIdFromEntryCode } from '../parse/export.js';
import { lidFromUri, filmKey, titleYearKey } from '../model.js';
import { resolveFilm, userFilm } from '../library.js';
import { syncFlagsFromEntries } from '../sources/rss.js';

/** Film rows carry a film short link (boxd.it/<code>), or in older exports a letterboxd.com/film/<slug>/ link. */
function refOf(uri) {
  const lid = lidFromUri(uri);
  if (lid) return { lid };
  const m = /letterboxd\.com\/(?:[^/]+\/)?film\/([^/?#]+)/.exec(uri || '');
  return m ? { slug: m[1] } : {};
}

/** Forget what the last import put in, ready to be rebuilt. Returns the Letterboxd tags it removed (name → createdAt). */
function clearImported(store) {
  const lib = store.library;
  const lbTags = new Map(Object.entries(lib.tags).filter(([, t]) => t?.source === 'letterboxd').map(([n, t]) => [n, t.createdAt]));
  for (const n of lbTags.keys()) delete lib.tags[n];
  for (const u of Object.values(lib.films)) {
    u.watched = false; u.rating = null; u.liked = false; u.watchlist = false;
    delete u.watchlistAddedAt;
    if (u.tags) u.tags = u.tags.filter(t => !lbTags.has(t) || (u.mine || []).includes(t)); // their own tags on a film stay, whatever their name
  }
  for (const e of Object.values(lib.entries)) if (e.source === 'export') delete lib.entries[e.id];
  for (const l of Object.values(lib.lists)) if (l.source === 'export') delete lib.lists[l.id];
  return lbTags;
}

/**
 * @param {object} store  from createStore()
 * @param {Uint8Array|Buffer} bytes  the export ZIP
 * @param {{ now?: Date|number|string }} [opts]
 * @returns {{ films, watched, rated, liked, watchlist, entries, reviews, lists, newFilmKeys }}
 */
export function importExport(store, bytes, { now } = {}) {
  const data = parseExportZip(bytes);            // throws the friendly "isn't a Letterboxd export" error before anything changes
  const at = new Date(now ?? Date.now()).toISOString();
  const lib = store.library;
  const before = new Set(Object.values(store.films));
  const lbTags = clearImported(store);

  // Films are tracked as objects until the end: resolving a later row can upgrade a film's key (slug:/ty: → lid:).
  const touched = new Set();
  const sets = { watched: new Set(), rated: new Set(), liked: new Set(), watchlist: new Set() };
  const film = (row, { entryLink = false } = {}) => {
    const f = resolveFilm(store, { ...(entryLink ? {} : refOf(row.uri)), title: row.name, year: row.year });
    touched.add(f);
    return f;
  };
  const rows = (list, fn) => { for (const r of list) if (r.name) { const f = film(r); fn(f, userFilm(store, f.key), r); } };

  // 1. Rows that carry a film link.
  rows(data.watched, (f, u) => { u.watched = true; sets.watched.add(f); });
  rows(data.ratings, (f, u, r) => { u.watched = true; sets.watched.add(f); if (r.rating) { u.rating = r.rating; sets.rated.add(f); } });
  rows(data.watchlist, (f, u, r) => { u.watchlist = true; u.watchlistAddedAt = r.date; sets.watchlist.add(f); });
  rows(data.likes, (f, u) => { u.liked = true; sets.liked.add(f); });
  const lists = data.lists.map(l => ({ ...l, films: l.films.map(r => film(r)) }));

  // 2. Diary and reviews carry entry links, so their films are matched by title and year.
  const entries = [];     // { film, entry }
  const tagged = [];      // { film, tags }
  const diaryUris = new Set(data.diary.map(d => d.uri));
  const when = r => r.watchedDate || r.date;
  const reviewByUri = new Map(data.reviews.map(r => [r.uri, r]));
  // Fallback join for reviews whose link isn't any diary row's: same film and watched date.
  const looseReviews = new Map();
  for (const r of data.reviews) if (!diaryUris.has(r.uri)) looseReviews.set(`${titleYearKey(r.name, r.year)}|${when(r)}`, r);
  const used = new Set();
  const codeOf = (uri, i) => lidFromUri(uri) || `row${i}`;

  const addEntry = (row, rev, i, kind) => {
    const f = film(row, { entryLink: true });     // an entry link says nothing about the film
    const tags = [...new Set([...row.tags, ...(rev?.tags || [])])];
    const text = rev?.review || (kind === 'review' ? row.review : '') || null;
    entries.push({
      film: f,
      entry: {
        id: `e:${codeOf(row.uri, `${kind}${i}`)}`, key: null, date: when(row), loggedAt: row.date, rating: row.rating ?? rev?.rating ?? null,
        liked: false,                              // the export doesn't say which viewings were liked
        rewatch: row.rewatch || !!rev?.rewatch, tags, review: text, spoiler: false, source: 'export', viewingId: viewingIdFromEntryCode(lidFromUri(row.uri)),
      },
    });
    tagged.push({ film: f, tags });
  };

  data.diary.forEach((d, i) => {
    if (!d.name) return;
    const rev = reviewByUri.get(d.uri) || looseReviews.get(`${titleYearKey(d.name, d.year)}|${when(d)}`);
    if (rev) used.add(rev);
    addEntry(d, rev, i, 'diary');
  });
  data.reviews.forEach((r, i) => { if (r.name && !used.has(r) && !diaryUris.has(r.uri)) addEntry(r, null, i, 'review'); });

  // 3. Settle keys, then write everything that refers to them.
  const keyOf = f => (store.films[f.key] ? f.key : filmKey(f));
  const entryKeys = new Set();
  for (const { film: f, entry } of entries) {
    entry.key = keyOf(f);
    lib.entries[entry.id] = entry;
    entryKeys.add(`${entry.key}|${entry.date}`);
    const u = userFilm(store, entry.key);
    u.watched = true; sets.watched.add(f);
  }
  for (const { film: f, tags } of tagged) {
    const u = userFilm(store, keyOf(f));
    for (const t of tags) {
      if (!u.tags.includes(t)) u.tags.push(t);
      lib.tags[t] = lib.tags[t] || { source: 'letterboxd', createdAt: lbTags.get(t) || at };
    }
  }
  // Tags the user added by hand survive the rebuild; if the import didn't bring the name back, it belongs to the user alone.
  for (const u of Object.values(lib.films)) for (const t of u.mine || []) if (!lib.tags[t]) lib.tags[t] = { createdAt: lbTags.get(t) || at };
  for (const l of lists) {
    const id = `l:${l.slug}`;
    lib.lists[id] = { id, name: l.name, description: l.description, url: l.url || null, films: [...new Set(l.films.map(keyOf))], source: 'export' };
  }

  // 4. RSS entries stay unless the export now holds the same viewing.
  const keep = [];
  for (const e of Object.values(lib.entries)) {
    if (e.source !== 'rss') continue;
    const viewing = Number(String(e.id).slice(2));
    if (lib.entries[`e:${entryCodeFromViewingId(viewing)}`]?.source === 'export' || entryKeys.has(`${e.key}|${e.date}`)) delete lib.entries[e.id];
    else keep.push(e.key);
  }
  syncFlagsFromEntries(store, keep);

  // 5. Profile.
  const p = data.profile;
  if (p) {
    const favourites = p.favourites.map(refOf).map(r => r.lid && store.films[`lid:${r.lid}`]).filter(Boolean).map(f => f.key);
    lib.user = { ...lib.user, username: p.username, name: p.givenName || p.username, joined: p.joined, bio: p.bio, location: p.location, favourites };
  }

  lib.sync = lib.sync || {};
  lib.sync.lastImport = at;
  store.touch('library');
  store.touch('films');

  const count = set => new Set([...set].map(keyOf)).size;
  return {
    films: count(touched),
    watched: count(sets.watched),
    rated: count(sets.rated),
    liked: count(sets.liked),
    watchlist: count(sets.watchlist),
    entries: entries.length,
    reviews: entries.filter(e => e.entry.review).length,
    lists: lists.length,
    newFilmKeys: [...new Set([...touched].filter(f => !before.has(f)).map(keyOf))],
  };
}
