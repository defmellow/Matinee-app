// JSON-file storage. Two files: your data (library.json) and film details (films.json).
// Writes are debounced and atomic (write to temp, fsync, rename) and keep one previous copy (.bak), so a crash never corrupts data.
// A file that can't be read for a passing reason (antivirus holding it) stops start-up rather than starting empty.
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA = 2;

/**
 * library.json
 *   user:     { username, name, joined, bio, favourites[] } | null
 *   films:    filmKey -> { watched, rating (1–10 half-stars), liked, watchlist, watchlistAddedAt, tags[], note }
 *   entries:  entryId -> { id, key (filmKey), date 'YYYY-MM-DD', rating, liked, rewatch, review, spoiler, tags[], source: 'export'|'rss' }
 *   lists:    listId -> { id, name, description, films: [filmKey], source }
 *   tags:     tag name -> { createdAt }        (personal tags; auto tags are derived, never stored)
 *   views:    viewId -> { id, name, query }    (saved filters)
 *   sync:     { lastImport, lastRefresh, lastFull, problems[] }
 *   settings: { keys: { tmdb, omdb }, region: 'AU' }
 * films.json
 *   filmKey -> film record (see core/model.js)
 * cache.json
 *   name -> { at: ISO time, value }   (on-demand lookups: filmographies, series, discoveries — safe to delete)
 */
function emptyLibrary() {
  return {
    schema: SCHEMA,
    user: null,
    films: {},
    entries: {},
    lists: {},
    tags: {},
    views: {},
    sync: { lastImport: null, lastRefresh: null, lastFull: null, problems: [] },
    settings: { keys: {}, region: 'AU' },
  };
}

const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE', 'EAGAIN']);
const sleepSync = ms => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// How long a change waits before its file is written: [debounce, maxWait] ms. The library (the user's tags, notes, views) is written almost at once;
// films.json (~17 MB) and cache.json are rewritten as a whole, which holds up the core for ~175 ms each time on a real library, so during a
// fetch they wait longer (21 Nov audit). Everything is still written at job end and on close (flush), and that data can be fetched again.
const EXPIRES = [['personfilms:', 7], ['personphoto:none/', 30], ['filmography:', 30], ['seriesT:', 30], ['series2:', 30]]; // see core/features/person-films.js, filmography.js, series.js
const TIMING = { library: [400, 5000], films: [3000, 20000], cache: [3000, 20000] };

export function createStore(dir, { debounce, maxWait, retryDelays = [50, 150, 400], rearmDelays = [2000, 5000, 15000] } = {}) {
  const timing = which => [debounce ?? TIMING[which][0], maxWait ?? TIMING[which][1]]; // a caller's (test's) own values apply to every file
  fs.mkdirSync(dir, { recursive: true });
  // Problems found while loading (before the app's problem log exists): api.js drains these into it. After that, `store.onError` is called.
  const notes = [];
  const files = { library: path.join(dir, 'library.json'), films: path.join(dir, 'films.json'), cache: path.join(dir, 'cache.json') };

  /** Run an fs call, retrying briefly when Windows says the file is busy; throws the last error. */
  const withRetry = fn => {
    for (let i = 0; ; i++) {
      try { return fn(); } catch (e) {
        if (!TRANSIENT.has(e.code) || i >= retryDelays.length) throw e;
        sleepSync(retryDelays[i]);
      }
    }
  };
  // Parsed JSON, or undefined when the file is missing; throws SyntaxError-like { corrupt: true } for empty or broken content.
  const parseFile = f => {
    let text;
    try { text = withRetry(() => fs.readFileSync(f, 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
    if (!text.trim()) throw Object.assign(new Error('empty file'), { corrupt: true });
    try { return JSON.parse(text); } catch (e) { throw Object.assign(e, { corrupt: true }); }
  };
  // Move a damaged file aside (one copy per size, so repeated launches don't pile up), keeping its bytes for rescue.
  const setAside = f => {
    try {
      const size = fs.statSync(f).size;
      const base = path.basename(f) + '.corrupt-';
      const have = fs.readdirSync(path.dirname(f)).some(n => n.startsWith(base) && fs.statSync(path.join(path.dirname(f), n)).size === size);
      if (have) fs.unlinkSync(f); else fs.renameSync(f, f + '.corrupt-' + Date.now());
    } catch (e) { notes.push({ message: "Matinee couldn't move a damaged data file aside.", error: e, level: 'warning' }); }
  };
  const read = (f, fallback) => {
    try {
      const v = parseFile(f);
      return v === undefined ? fallback : v;
    } catch (e) {
      if (!e.corrupt) throw e; // a read that failed for another reason must not look like an empty library
      setAside(f);
      const name = path.basename(f);
      try { const v = parseFile(f + '.bak'); if (v !== undefined) { notes.push({ message: `${name} was damaged, so Matinee went back to its last good copy. Anything from the last few minutes may be missing.`, error: e, level: 'error' }); return v; } } catch (e2) { if (!e2.corrupt) throw e2; }
      notes.push({ message: `${name} was damaged and there was no good copy, so it starts empty. The damaged file was kept next to it.`, error: e, level: 'error' });
      return fallback;
    }
  };
  let library = read(files.library, null);
  // pre-release data: start clean rather than migrate, but keep the old file; films.json and cache.json load on their own
  if (library && library.schema !== SCHEMA) {
    try { fs.copyFileSync(files.library, `${files.library}.schema-${library.schema}.bak`); } catch (e) { notes.push({ message: "Matinee couldn't keep a copy of your old library file before starting fresh.", error: e, level: 'warning' }); }
    library = null;
  }
  library = Object.assign(emptyLibrary(), library || {});
  const films = read(files.films, {});
  const cache = read(files.cache, {});
  // Lookups made per person or per series pile up for good (every person page and hover card adds some) and are only ever read while
  // fresh, so on load the ones well past their use are dropped. [name prefix, days a reader still accepts it]; dropped at twice that.
  for (const [k, v] of Object.entries(cache)) {
    const rule = EXPIRES.find(([prefix]) => k.startsWith(prefix));
    const at = v && Date.parse(v.at);
    if (rule && at && Date.now() - at > 2 * rule[1] * 86400000) delete cache[k];
  }
  const timers = {};
  const dirty = new Set();
  const firstDirty = {}; // which -> time it first became dirty, so a busy crawl still gets written
  const failures = {};   // which -> consecutive failed writes
  const noBak = new Set(); // after reset() the old copy is dropped rather than kept

  function writeNow(which) {
    const data = which === 'library' ? library : which === 'films' ? films : cache;
    const f = files[which];
    const tmp = f + '.tmp';
    try {
      const json = JSON.stringify(data);
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      try {
        if (noBak.has(which)) fs.unlinkSync(f + '.bak'); else fs.copyFileSync(f, f + '.bak');
      } catch { /* no earlier copy to keep on the first save: expected */ }
      withRetry(() => fs.renameSync(tmp, f));
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* the half-written file is already gone: expected */ }
      throw e;
    }
    noBak.delete(which);
    dirty.delete(which); delete firstDirty[which]; failures[which] = 0;
  }

  function arm(which, delay) {
    clearTimeout(timers[which]);
    timers[which] = setTimeout(() => {
      try { writeNow(which); }
      catch (e) {
        store.lastError = e; store.onError?.(e, which);
        const n = failures[which] = (failures[which] || 0) + 1;
        arm(which, rearmDelays[Math.min(n - 1, rearmDelays.length - 1)]); // stays dirty, tries again later
      }
    }, delay);
  }

  const store = {
    dir,
    notes,
    /** Set by the app: (error, 'library'|'films'|'cache') when a save fails. The save is retried on its own. */
    onError: null,
    library,
    films,
    cache,
    lastError: null,
    /** Cached value if younger than maxAgeMs, else undefined. */
    cached(name, maxAgeMs) {
      const c = cache[name];
      return c && Date.now() - Date.parse(c.at) < maxAgeMs ? c.value : undefined;
    },
    setCached(name, value) { cache[name] = { at: new Date().toISOString(), value }; this.touch('cache'); return value; },
    touch(which) {
      const now = Date.now();
      if (!dirty.has(which)) firstDirty[which] = now;
      dirty.add(which);
      if (failures[which] && timers[which]) return; // a failing write is already waiting to be retried
      const [wait, most] = timing(which);
      arm(which, Math.max(0, Math.min(wait, most - (now - firstDirty[which]))));
    },
    /** Write every unsaved file now. Tries all of them, then throws the first error. */
    flush() {
      let first = null;
      for (const w of [...dirty]) {
        clearTimeout(timers[w]);
        try { writeNow(w); } catch (e) {
          store.lastError = e; store.onError?.(e, w); first = first || e;
          failures[w] = (failures[w] || 0) + 1;
          arm(w, rearmDelays[Math.min(failures[w] - 1, rearmDelays.length - 1)]);
        }
      }
      if (first) throw first;
    },
    reset() {
      for (const k of Object.keys(library)) delete library[k];
      Object.assign(library, emptyLibrary());
      for (const k of Object.keys(films)) delete films[k];
      for (const k of Object.keys(cache)) delete cache[k];
      for (const w of ['library', 'films', 'cache']) noBak.add(w);
      this.touch('library'); this.touch('films'); this.touch('cache');
    },
  };
  return store;
}
