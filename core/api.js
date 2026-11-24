// The core's public surface. The UI calls these methods (via Electron IPC or the dev server) and listens to events:
//   'progress' { phase, label, done, total } — a background job is running ({ phase: 'done' } when it ends)
//   'library'  { keys? } — data changed. With `keys`, only those films' stored data changed (fetch them with getSummaries);
//                without, anything may have changed (reload the lot)
//   'state'    — settings/user/job state changed
//   'cinema'   { ok, error, fetched } — a Dendy Newtown read finished (see getCinema)
//   'testFetchStep' { phase, provider?, film?, state, atMs } — progress of Settings → Test fetch
//   'personFilms' { id, name, status: 'ok'|'failed' } — a person's films finished loading (call getPersonFilms again)
import { createHash } from 'node:crypto';
import { createStore } from './store.js';
import { createFeelMemoFile } from './feel-memo-file.js';
import { createProblems, filmLabel } from './problems.js';
import nodePath from 'node:path';
import { createHttp } from './net.js';
import { compose, posterCandidates, scoreAndFeelSources } from './model.js';
import { userFilm, entriesFor, removeFromWatchlist, restoreToWatchlist, resetWatchlistTracking, reimportReminder, REIMPORT_SNOOZE_DAYS } from './library.js';
import { enrich, hasPendingWork, wantsFor, coveredBy, createTrouble } from './enrich.js';
import { createFetchLog, siteForHost } from './fetchlog.js';
import { createStorageMeter, clearCache } from './diagnostics/storage.js';
import { createRateTracker, computeProgress } from './progress.js';
import { allProviders, providerById } from './providers/all.js';
import { importExport } from './import/export.js';
import { refreshFromRss } from './sources/rss.js';
import { refreshWatchlist } from './sources/watchlist.js';
import { matineeScore, yourTake, hotTakes } from './analysis/scores.js';
import { autoTags, tagIndex } from './analysis/tags.js';
import { insights } from './analysis/stats.js';
import { moreInsights, feelTaste, yearFeel } from './analysis/insights-more.js';
import { facets } from './analysis/query.js';
import { buildIndex, related } from './analysis/similarity.js';
import { tasteProfile, rankTonight } from './analysis/taste.js';
import { eligible } from './analysis/eligible.js';
import { upcoming } from './features/upcoming.js';
import { libraryMatcher } from './features/shared.js';
import { localDay } from './util/localday.js';
import { createPersonFilms } from './features/person-films.js';
import { shareEntries, SHARE_FILENAME, SHARE_LOG_FILES } from './share.js';
import { makeBackup, parseBackup, restoreBackup } from './backup.js';
import { zipChunks } from './zip.js';
import { followList, refreshList, refreshDueLists, linkList, unlinkList, unfollowList, listedKeys, listCsv, csvFilename } from './features/lists.js';
import fs from 'node:fs';
import path from 'node:path';

const HOUR = 36e5;

const OFFLINE = "Matinee can't reach the internet right now. Check your connection and try again.";
const GENERIC = 'Something went wrong. Try again in a moment.';
/** The sentence a person may see for an error. Core errors are already written for people; system and programming errors are not. */
function plainMessage(e) {
  const msg = e && typeof e.message === 'string' ? e.message : '';
  const code = e && e.code;
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK|CONNECTION|TIMED_OUT|PROXY|TUNNEL|ADDRESS)/.test(msg) || msg === 'fetch failed') return OFFLINE;
  if (typeof code === 'string' && /^(E[A-Z0-9]+|ERR_[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(code)) {
    if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_.*)$/.test(code)) return OFFLINE;
    if (code === 'ENOSPC') return 'Your disk is full, so Matinee could not save. Free up some space and try again.';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return "Matinee couldn't save to its data folder. Check that another program isn't using it.";
    return GENERIC;
  }
  if (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError || e instanceof ReferenceError) return GENERIC;
  if (!msg || msg.length > 300 || /\n\s+at /.test(msg)) return GENERIC;
  return msg;
}
const badRequest = (message = 'That request is not valid.') => Object.assign(new Error(message), { code: 'bad-request' });
const MAX_NOTE = 10000, MAX_TAG = 60, MAX_NAME = 120, MAX_INPUT_BYTES = 100e6;
const THEMES = new Set(['system', 'light', 'dark', 'neutral', 'neutral-light']);
const FRIEND_CODE = '123'; // the only friend code: turns Dendy Newtown on
// Kept by Start over (Settings → Your data): how Matinee looks and is set up, never the user's films.
const KEPT_ON_RESET = ['theme', 'motion', 'feelColours', 'region', 'regionChosen', 'friendCode', 'dendy', 'keys', 'keyStatus'];

// People come from different sources ('wd:Q…' from Wikidata, 'tmdb:…' from TMDB). One name-based key per person
// keeps them the same person across films, whichever source filled each film in.
const personKeys = new Map(); // names repeat across films; the same name always gives the same key
const personKey = name => {
  const hit = personKeys.get(name);
  if (hit !== undefined) return hit;
  if (personKeys.size > 50000) personKeys.clear();
  const k = personKeyOf(name);
  personKeys.set(name, k);
  return k;
};
const personKeyOf = name => 'p:' + String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, '-').replace(/^-|-$/g, '');
function normalisePeople(people) {
  const out = {};
  for (const [role, list] of Object.entries(people || {})) out[role] = (list || []).map(p => ({ ...p, id: personKey(p.name), sourceId: p.id || null }));
  return out;
}

export function createCore({ dataDir, logsDir = null, appDir = null, fetch = globalThis.fetch, browserFetch = null, browserUserAgent, render = null, onEvent = () => {}, clock = {}, providers = null, cookieProbe = null }) {
  const store = createStore(dataDir);
  const http = createHttp({ fetch, browserFetch, ...(browserUserAgent ? { browserUserAgent } : {}), render });
  const fetchLog = createFetchLog({ onChange: info => onEvent('fetchlog', info) }); // what is being fetched, for the Details dropdown
  const discoverLog = createFetchLog({ max: 100, onChange: info => onEvent('discoverlog', info) }); // the same, for Discover
  // Trouble notices (a source keeps failing, a site asked us to slow down) and the pasteable fetch log.
  // Every error in the app goes here (core, Electron and UI): logs/problems.log + the list in Settings → Debug. Never pops up on its own.
  const problems = createProblems({ dir: logsDir || nodePath.join(dataDir, 'logs'), now: () => nowMs(), onNew: e => onEvent('problem', e), onChange: () => { const c = problems.counts(); onEvent('problems', { unseen: problems.unseen(), total: c.error + c.warning, ...c }); } }); // the whole count, so a Clear empties every badge
  // Trouble notices go into the problem log: a pause or a human check is the site (warning), anything else means a source isn't working (error).
  const trouble = createTrouble({ now: () => nowMs(), emit: (e, p) => { if (e === 'trouble' && p) problems.report({ area: p.site || 'Fetching', message: p.message, level: /slow down|human/i.test(p.message || '') ? 'warning' : 'error' }); onEvent(e, p); }, onChange: () => emit('state'), hostStatus: typeof http.hostStatus === 'function' ? () => http.hostStatus() : null });
  // A failed save is reported (once per kind of file within an hour, repeats counted); the store retries it on its own. Problems found while loading wait in store.notes.
  const SAVE_AREA = { library: 'your library', films: 'film details', cache: 'saved lookups' };
  store.onError = (e, which) => problems.report({ area: 'Saving', message: `Matinee couldn't save ${SAVE_AREA[which] || 'your data'} just now and will try again shortly.`, error: e, level: 'error' });
  for (const n of store.notes || []) problems.report({ area: 'Saving', ...n });
  // Dendy Newtown is behind a friend code since onboarding (23 Nov). An install that already had a library before then keeps it on;
  // a new one starts with it off until the code is typed.
  if (store.library.settings.dendy === undefined) {
    const had = Object.keys(store.library.films || {}).length > 0 || Object.keys(store.films || {}).length > 0;
    store.library.settings.dendy = had;
    if (had) store.touch('library');
  }
  const dendyOn = () => store.library.settings.dendy === true;
  if (typeof http.observe === 'function') http.observe(n => trouble.observe(n));
  const rates = createRateTracker({ now: () => nowMs() }); // finished films per source, for the time-left estimate (follows the injected clock)
  let version = 0;
  let job = null;          // { kind, controller, progress }
  let closed = false; // close() was called: nothing may start again
  let rerunEnrichment = false; // a key was added while a run was going: start a fresh run once it stops
  let discoverJob = null;  // promise while Discover is being worked out
  const cache = new Map(); // name -> { version, value }
  const filmCache = new Map(); // film key -> { s: full summary, wire: slim copy sent to the UI }; survives version bumps unless named
  let statsCache = null;   // diary stats per film; only diary/import edits change them, and those emit keyless
  let testRun = null;      // { controller, step, resume } while Settings → Test fetch runs; it holds back the background crawl
  let lastTest = null;     // { report, text, startedAt }: the latest test report, in memory only
  let cinemaJob = null;    // promise while Dendy Newtown is being read
  let cinemaCtl = null;

  // Several sources run at once, so their progress is combined into one figure for the UI.
  let parts = new Map(); // provider id -> { label, done, total }
  const emit = (event, payload) => {
    if (event === 'library' && job) job.touched = true;
    if (event === 'film') {
      // Per-source outcomes for a film page: only that film's summary is rebuilt. No version bump, so the library-wide caches
      // (facets, similarity, feel index) are not thrown away for every source that lands; the data itself arrives with 'library'.
      const keys = payload && Array.isArray(payload.keys) ? payload.keys : null;
      if (keys) for (const k of keys) filmCache.delete(k); else filmCache.clear();
    } else if (event === 'library') {
      version++;
      // Only films named in the event need their summary rebuilt; a keyless event (import, edits, reset) drops them all.
      const keys = payload && Array.isArray(payload.keys) ? payload.keys : null;
      if (keys) for (const k of keys) filmCache.delete(k); else { filmCache.clear(); statsCache = null; }
    }
    if (event === 'progress' && payload && payload.phase === 'provider') {
      const total = payload.total || 0;
      parts.set(payload.provider, { label: payload.label, done: Math.min(payload.done || 0, total), total });
      const all = [...parts.values()];
      const active = all.filter(p => p.done < p.total);
      payload = {
        phase: 'provider',
        label: active.length > 1 ? 'Fetching ratings, posters and details' : (active[0] || all[all.length - 1]).label,
        done: all.reduce((a, p) => a + p.done, 0), total: all.reduce((a, p) => a + p.total, 0),
        sources: Object.fromEntries([...parts].map(([id, p]) => [id, { done: p.done, total: p.total }])),
      };
    }
    if (event === 'progress' && payload && payload.phase === 'done') parts = new Map();
    if (event === 'progress' && job) job.progress = payload;
    onEvent(event, payload);
    // The UI reads the time-left text from getState, which it only re-reads on a 'state' event. While a job runs, nudge it every few seconds
    // so the estimate appears and keeps up (before this it stayed at its first value, "working it out").
    if (event === 'progress' && job && payload && payload.phase === 'provider' && nowMs() - lastStateTick >= STATE_TICK_MS) { lastStateTick = nowMs(); onEvent('state'); }
  };
  const STATE_TICK_MS = 5000;
  let lastStateTick = -Infinity;
  // Enrichment says "library changed" every few films; each one drops the summary caches and makes the UI reload.
  // From a long run we pass on at most one a second (the last one always goes out). Edits the user makes by hand are never delayed.
  const LIBRARY_GAP = 1000;
  const nowMs = clock.now || Date.now, later = clock.setTimeout || setTimeout, cancel = clock.clearTimeout || clearTimeout;
  let lastLibrary = -Infinity, libraryTimer = null;
  let pendingKeys = new Set(), pendingAll = false; // keys seen while waiting; a keyless request makes the whole batch keyless
  const sendLibrary = () => {
    const payload = pendingAll ? undefined : { keys: [...pendingKeys] };
    pendingKeys = new Set(); pendingAll = false;
    emit('library', payload);
  };
  const emitLibraryBatched = payload => {
    if (payload && Array.isArray(payload.keys)) for (const k of payload.keys) pendingKeys.add(k); else pendingAll = true;
    const wait = lastLibrary + LIBRARY_GAP - nowMs();
    if (wait > 0) { if (!libraryTimer) libraryTimer = later(() => { libraryTimer = null; emitLibraryBatched({ keys: [] }); }, wait); return; }
    if (libraryTimer) { cancel(libraryTimer); libraryTimer = null; }
    lastLibrary = nowMs();
    sendLibrary();
  };
  const emitFromEnrich = (event, payload) => (event === 'library' ? emitLibraryBatched(payload) : emit(event, payload));
  const facetsHeld = new WeakMap(); // feel index -> getFeelFacets answer
  const cached = (name, fn) => {
    const c = cache.get(name);
    if (c && c.version === version) return c.value;
    const value = fn();
    cache.set(name, { version, value });
    return value;
  };

  const THIN_WATCHLIST = 30; // fewer unwatched watchlist films than this: Tonight also draws on your lists unless the user says otherwise

  // ---------- summaries: one compact object per film, everything the lists need ----------
    function entryStats() {
    if (statsCache) return statsCache;
    return (statsCache = (() => {
      const m = new Map();
      for (const e of Object.values(store.library.entries)) {
        const s = m.get(e.key) || { times: 0, last: null, first: null, rewatched: false, reviewed: false };
        s.times++; if (e.rewatch) s.rewatched = true; if (e.review) s.reviewed = true;
        if (!s.last || e.date > s.last) s.last = e.date;
        if (!s.first || e.date < s.first) s.first = e.date;
        m.set(e.key, s);
      }
      return m;
    })());
  }

  const readOnly = l => Object.assign(new Error(l.source === 'letterboxd' ? 'This list follows Letterboxd. Edit it there; changes show up here when Matinee refreshes.' : 'Imported lists are read-only. Make a copy to change it.'), { code: 'read-only' });
  // An imported list that is also followed is shown once (the followed one): same address.
  const visibleLists = () => {
    const all = Object.values(store.library.lists);
    const followed = new Set(all.filter(l => l.source === 'letterboxd').flatMap(l => [l.url, l.shortUrl]).filter(Boolean));
    return all.filter(l => !(l.source === 'export' && l.url && followed.has(l.url)));
  };
  const nameKeys = keys => (keys || []).map(k => { const s = store.films[k]; return s ? { key: k, title: s.title, year: s.year } : null; }).filter(Boolean);
  // Films on any list (own, followed or imported): the "On my lists" filter and Tonight's list pool. Rebuilt with every library change.
  const listed = () => cached('listed', () => listedKeys(store));

  function summarize(film, stats = entryStats()) {
    const u = store.library.films[film.key] || { watched: false, rating: null, liked: false, watchlist: false, tags: [] };
    const c = compose(film, { posterPick: u.posterPick || null }); // a poster the user chose for this film wins everywhere
    c.people = normalisePeople(c.people);
    const es = stats.get(film.key);
    const { score, parts } = matineeScore(c.ratings);
    const s = {
      key: c.key, slug: c.slug, title: c.title, originalTitle: c.originalTitle, year: c.year,
      poster: c.poster, runtime: c.runtime, genres: c.genres, countries: c.countries, languages: c.languages,
      directors: c.people.director, cast: c.people.cast.slice(0, 8), people: c.people,
      keywords: c.keywords, subjects: c.subjects, awards: c.awards, collection: c.collection, basedOn: c.basedOn,
      ratings: c.ratings, score, scoreParts: parts, ids: c.ids, released: c.released, ausRelease: c.ausRelease, regionRelease: c.regionRelease, kind: c.kind,
      user: { watched: !!u.watched, rating: u.rating ?? null, liked: !!u.liked, watchlist: !!u.watchlist, watchlistOrder: u.watchlistOrder ?? null, watchlistAddedAt: u.watchlistAddedAt || null, watchlistRemovedAt: u.watchlistRemovedAt || null, watchlistRemovedVia: u.watchlistRemovedVia || null, tags: u.tags || [], note: u.note || '', listed: listed().has(film.key) },
      timesWatched: es ? es.times : (u.watched ? 1 : 0), lastWatched: es ? es.last : null, firstWatched: es ? es.first : null,
      rewatched: es ? es.rewatched : false, reviewed: es ? es.reviewed : false,
      enriched: Object.keys(film.src || {}).length > 0,
    };
    s.yourTake = s.user.rating != null && score != null ? yourTake(s.user.rating, score) : null;
    s.autoTags = autoTags(s).map(t => t.id);
    return s;
  }

  // What the UI gets for the library list: the full summary minus things only the film page reads (it asks getFilm, which
  // has them all): whole cast/crew lists, score breakdown, awards, ids, keywords, subjects. People are cut to what search and
  // the list rows read (id + name); the poster to the one URL the poster tile shows.
  const idName = p => ({ id: p.id, name: p.name });
  function slim(s) {
    const { people, scoreParts, awards, ids, keywords, subjects, ...rest } = s; // eslint-disable-line no-unused-vars
    return { ...rest, directors: (s.directors || []).map(idName), cast: s.cast.map(idName), poster: s.poster ? { thumb: s.poster.thumb || s.poster.url || null } : s.poster };
  }
  // One summary per film, rebuilt only when that film is named in a 'library' event (or on a keyless event).
  const entryOf = (film, stats) => {
    let e = filmCache.get(film.key);
    if (!e) { const full = summarize(film, stats); e = { s: full, wire: slim(full) }; filmCache.set(film.key, e); }
    return e;
  };
  const summaries = () => cached('summaries', () => {
    const stats = entryStats();
    const lib = store.library.films;
    return Object.values(store.films).filter(f => lib[f.key] || stats.has(f.key)).map(f => entryOf(f, stats).s);
  });
  const wireSummaries = () => cached('wire', () => summaries().map(s => filmCache.get(s.key).wire));
  const wireByKey = () => cached('wireByKey', () => new Map(wireSummaries().map(w => [w.key, w])));
  const byKey = () => cached('byKey', () => new Map(summaries().map(s => [s.key, s])));
  // Feel engine: built once per library version from every film we hold text and tags for.
  const feelMemo = new Map();
  const mapHeld = new Map(); // lens (and 'features') -> { fp, value }: the last Map layouts and the fingerprint of the data they came from
  /** The films the feel engine reads, and a stamp that changes whenever their fetched data does. Cheap: no text work. */
  const feelInputs = () => {
    const bk = byKey();
    const films = Object.values(store.films).filter(f => bk.has(f.key));
    return { films, stamp: films.map(f => `${f.key}|${f.title}|${f.year}|${Object.values(f.checked || {}).join(',')}`).join('\n') };
  };
  // The per-film feel work is kept on disk (core/feel-memo-file.js) so the first build after a restart takes about a second, not ten.
  const memoFile = createFeelMemoFile({ dir: dataDir, report: e => problems.report(e) });
  let memoLoad = null, memoTimer = null, feelWarm = null;
  const loadFeelMemo = () => memoLoad || (memoLoad = (async () => {
    const [saved, { adoptMemo }] = await Promise.all([memoFile.load(), import('./analysis/feel/index.js')]);
    if (saved && !feelMemo.size) for (const [k, v] of saved) feelMemo.set(k, v);
    adoptMemo(feelMemo); // the loaded work was made with the built-in lexicon and classifier
  })());
  // Saving is v8.serialize of the whole memo (tens of MB, over 100 ms that the core can do nothing else), so it is done at most
  // once every 30 s, whatever changes meanwhile go in the same save, and whatever is still unsaved is written by close().
  const MEMO_SAVE_MS = 30_000;
  const saveFeelMemo = () => {
    feelMemo.dirty = false;
    // save() reports its own failures; a save that didn't land leaves the work unsaved, so close() tries again
    memoFile.save(feelMemo).then(ok => { if (!ok) feelMemo.dirty = true; }, error => { feelMemo.dirty = true; problems.report({ area: 'Feel', level: 'warning', message: "Couldn't save the feel work for next time.", error }); });
  };
  const saveFeelMemoSoon = () => {
    if (memoTimer || closed) return;
    memoTimer = setTimeout(() => { memoTimer = null; if (!closed) saveFeelMemo(); }, MEMO_SAVE_MS);
    if (memoTimer.unref) memoTimer.unref();
  };
  // What the index was built from. Each film's input is gathered again only when something it is made of changed (its title,
  // year, a source's checked time, or a source's data object), and a re-gathered input whose hash is unchanged is replaced by
  // the old one. So a score read, a quiet re-read that found the same text, or an edit to the user's tags gives the same inputs, and
  // the held index is handed back as it is instead of being rebuilt for every film.
  const feelFilms = new Map(); // film key -> { input, stamp, refs }
  let feelHeld = null;         // { inputs, index }: the last index and the inputs it was built from, in order
  let feelRun = Promise.resolve(); // builds run one after another: they share the memo
  const sameRefs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const refreshFeel = async ({ buildFeelIndexAsync, inputSig }, gatherFeelInput) => {
    const bk = byKey();
    const films = Object.values(store.films).filter(f => bk.has(f.key));
    const inputs = new Array(films.length);
    let same = !!feelHeld && feelHeld.inputs.length === films.length;
    const seen = new Set();
    let gathered = 0;
    for (let i = 0; i < films.length; i++) {
      const f = films[i];
      const stamp = `${f.title}|${f.year}|${Object.values(f.checked || {}).join(',')}`;
      const refs = [f, f.src, ...Object.values(f.src || {})];
      let e = feelFilms.get(f.key);
      if (!e || e.stamp !== stamp || !sameRefs(e.refs, refs)) {
        const input = gatherFeelInput(compose(f), f);
        if (!e || inputSig(input) !== inputSig(e.input)) e = { input }; // new film, or what is known about it changed
        e.stamp = stamp; e.refs = refs;
        feelFilms.set(f.key, e);
        // after a launch every film is gathered and hashed (about 60 ms in all): let other calls in now and then
        if (++gathered % 50 === 0) await new Promise(resolve => setImmediate(resolve));
      }
      seen.add(f.key);
      inputs[i] = e.input;
      if (same && feelHeld.inputs[i] !== e.input) same = false;
    }
    for (const k of [...feelFilms.keys()]) if (!seen.has(k)) feelFilms.delete(k);
    if (same) return feelHeld.index;
    // In slices (feel/index.js buildFeelIndexAsync): the first build after an update reads every film from scratch, about
    // seven seconds of work, and the core keeps answering other calls in between.
    const index = await buildFeelIndexAsync(inputs, { memo: feelMemo });
    feelHeld = { inputs, index };
    if (feelMemo.dirty) saveFeelMemoSoon();
    return index;
  };
  const feelIndex = async () => {
    const [mod, { gatherFeelInput }] = await Promise.all([import('./analysis/feel/index.js'), import('./analysis/feel/gather.js'), loadFeelMemo()]);
    // Rebuilt only when a film's feel input changed (see refreshFeel); callers in the same library version share one build.
    for (let round = 0; ; round++) {
      const at = version;
      const index = await cached('feelIndex', () => {
        const run = feelRun.then(() => refreshFeel(mod, gatherFeelInput));
        // The next build waits for this one whether or not it worked; its failure reaches every caller through `run`.
        feelRun = run.catch(() => {});
        // A failed build is not kept for the rest of this version: the next call tries again.
        run.catch(() => { const c = cache.get('feelIndex'); if (c && c.value === run) cache.delete('feelIndex'); });
        return run;
      });
      // Film data moved on while it was built (a source landed): catch up, so what callers work out from it next (the fit model,
      // the graph) is not cached against the newer data. A few rounds at most, so a busy fetch never keeps a caller waiting.
      if (version === at || round >= 2) return index;
    }
  };
  // Shortly after launch the index is built once in the background (in slices), so the first film page or By feel search after
  // an update does not wait for it. Nothing else waits on this; if it fails, it is reported and the next call tries again.
  const FEEL_WARM_MS = 4000;
  feelWarm = setTimeout(() => {
    feelWarm = null;
    if (closed || !Object.keys(store.films).length) return;
    feelIndex().catch(error => problems.report({ area: 'Feel', level: 'warning', message: "Matinee couldn't work out how your films feel yet. It tries again when you open a film.", error }));
  }, FEEL_WARM_MS);
  if (feelWarm.unref) feelWarm.unref();
  // ---------- the Map ----------
  // Each layout is saved with a fingerprint of the film data it came from. Bump the "map vN" when feel-engine or layout code changes.
  const mapCtx = lens => {
    const shown = summaries().filter(s => s.user.watched || s.user.watchlist);
    const keys = shown.map(s => s.key).sort(), watched = new Set(shown.filter(s => s.user.watched).map(s => s.key));
    const stamp = `${keys.join('|')}\n${[...watched].sort().join('|')}\n${feelInputs().stamp}`;
    const fpOf = what => createHash('sha1').update(`map v13 ${what}\n${stamp}`).digest('hex');
    return { lens, keys, watched, layoutFp: fpOf(lens), featureFp: fpOf('features') };
  };
  const mapSaved = (heldKey, cacheName) => [mapHeld.get(heldKey), store.cache[cacheName]?.value].filter(x => x && x.value); // newest first
  const mapFresh = (heldKey, cacheName, fp) => mapSaved(heldKey, cacheName).find(x => x.fp === fp)?.value || null;
  const sameFilms = (layout, keys) => { const have = new Set(layout.nodes.map(p => p.key)); return have.size === keys.length && keys.every(k => have.has(k)); };
  const breathe = () => new Promise(r => setImmediate(r));
  /** Work out what is missing (layout and/or features), save it and hold it. Yields now and then so a click is never stuck behind it. */
  const computeMap = async (ctx, { layout = null, features = null }) => {
    const { lens, keys, watched = new Set() } = ctx;
    const [{ lensEmphasis, feelMap, featureTable, alignTo }, { similar, profileOf }] = await Promise.all([import('./analysis/feel-map.js'), import('./analysis/feel/index.js')]);
    const fi = await feelIndex();
    const descriptorsOf = key => { const p = profileOf(fi, key); return p ? (p.descriptors || []) : []; };
    if (!layout) {
      const among = new Set(keys), emphasis = lensEmphasis(lens), neighbours = new Map();
      let n = 0;
      for (const k of keys) {
        neighbours.set(k, similar(fi, k, { limit: 15, among, ...(emphasis ? { emphasis } : {}) }).map(r => ({ key: r.key, score: r.score })));
        if (++n % 40 === 0) await breathe();
      }
      // Each film's closest among watched films and among watchlist films too: the Watched and Watchlist views draw their lines
      // from these (most of a film's 15 closest can sit in the other half: on a real library, 4 in 5 films are on the watchlist).
      const halves = [watched, new Set(keys.filter(k => !watched.has(k)))], extra = new Map();
      for (const k of keys) {
        const own = neighbours.get(k) || [];
        const short = halves.filter(half => own.filter(r => half.has(r.key)).length < 5); // only where its own 15 hold fewer than 5 lines' worth
        if (!short.length) continue;
        extra.set(k, short.flatMap(half => similar(fi, k, { limit: 8, among: half, ...(emphasis ? { emphasis } : {}) })).map(r => ({ key: r.key, score: r.score })));
        if (++n % 20 === 0) await breathe();
      }
      await breathe();
      layout = feelMap({ keys, neighbours, extra, descriptorsOf });
      const previous = mapSaved(lens, 'map:layout:' + lens)[0]?.value;
      if (previous) layout = alignTo(layout, previous); // the new picture sits where the old one did
      store.setCached('map:layout:' + lens, { fp: ctx.layoutFp, value: layout });
    }
    if (!features) { features = featureTable(keys, descriptorsOf); store.setCached('map:features', { fp: ctx.featureFp, value: features }); }
    mapHeld.set(lens, { fp: ctx.layoutFp, value: layout });
    mapHeld.set('features', { fp: ctx.featureFp, value: features });
    return { layout, features };
  };
  // One background recompute per lens. A request made while it runs only matters if the film data differs from what it started with.
  // While background fetches keep landing, film data changes every few seconds; a lens is redone at most once per MAP_COOLDOWN
  // (the saved picture is nearly the same meanwhile), so the Map never keeps the core busy.
  const MAP_COOLDOWN = 10 * 60 * 1000;
  const mapRunning = new Map(); // lens -> { fp, next }
  const mapLastRun = new Map(); // lens -> when its last background recompute started
  const refreshMap = ctx => {
    if (closed) return;
    const running = mapRunning.get(ctx.lens);
    if (running) { if (running.fp !== ctx.layoutFp) running.next = ctx; return; }
    const run = { fp: ctx.layoutFp, next: null };
    mapRunning.set(ctx.lens, run);
    const wait = Math.max(0, (mapLastRun.get(ctx.lens) ?? -Infinity) + MAP_COOLDOWN - nowMs());
    const t = setTimeout(async () => {
      mapLastRun.set(ctx.lens, nowMs());
      try {
        if (closed) return;
        await computeMap(ctx, { features: mapFresh('features', 'map:features', ctx.featureFp) });
        if (!closed) emit('map', { lens: ctx.lens });
      } catch (error) {
        problems.report({ area: 'Map', message: "Couldn't update the map with the latest film data. It keeps showing the last layout.", error, level: 'error' });
      } finally {
        mapRunning.delete(ctx.lens);
        if (run.next && !closed) refreshMap(run.next);
      }
    }, wait);
    if (t.unref) t.unref();
  };
  // After the Map is answered from saved data, get the feel engine ready so the first click does not wait for it.
  let warmTimer = null;
  const warmFeel = () => {
    if (warmTimer || closed) return;
    warmTimer = setTimeout(() => {
      warmTimer = null;
      if (!closed) feelIndex().catch(error => problems.report({ area: 'Feel', message: "Couldn't get the feel engine ready ahead of time.", error, level: 'warning' }));
    }, 0);
    if (warmTimer.unref) warmTimer.unref();
  };

  const scopeKeys = scope => scope === 'all' ? null : new Set(summaries().filter(s => scope === 'watched' ? s.user.watched : s.user.watchlist).map(s => s.key));
  const withFilms = list => list.map(r => ({ ...r, film: byKey().get(r.key) })).filter(r => r.film);

  const index = () => cached('index', () => buildIndex(summaries()));

  // ---------- background jobs ----------
  function startJob(kind, fn) {
    if (job) return { started: false, running: job.kind };
    if (testRun) return { started: false, running: 'test' }; // Test fetch has the network to itself
    stopQuiet(); pendingQuiet = null; // a new visible job takes over from any quiet pass
    const controller = new AbortController();
    job = { kind, controller, progress: { phase: kind, label: 'Starting…', done: 0, total: 1 } }; // total 1, not 0: a 0 of 0 bar reads as finished until the first real step
    emit('state');
    (async () => {
      try { await fn(controller.signal); }
      catch (e) {
        if (e.code !== 'aborted') {
          store.library.sync.problems = [{ step: kind, message: plainMessage(e) }];
          problems.report({ area: kind === 'import' ? 'Import' : 'Refresh', message: kind === 'import' ? "Matinee couldn't finish filling in the imported films." : "Matinee couldn't finish refreshing your library.", error: e, level: 'error' });
        }
      } finally {
        // A run that recorded nothing and found no problems has nothing new to show: skip the keyless 'library' event,
        // which would make every open window reload the whole library.
        const changed = job.touched || pendingAll || pendingKeys.size > 0 || !!libraryTimer || (store.library.sync.problems || []).length > 0;
        job = null;
        try { store.flush(); } catch (e) { /* store.onError has reported it */ store.library.sync.problems = [{ step: 'save', message: "Matinee couldn't save just now and will try again shortly." }]; }
        emit('progress', { phase: 'done', label: 'Up to date' });
        if (libraryTimer) { cancel(libraryTimer); libraryTimer = null; }
        pendingKeys = new Set(); pendingAll = false;
        lastLibrary = nowMs();
        if (changed) emit('library');
        emit('state');
        if (rerunEnrichment) { rerunEnrichment = false; startJob('refresh', sig => runEnrichment(sig)); }
        else if (pendingQuiet) { const q = pendingQuiet; pendingQuiet = null; stopQuiet(); const c = quietCtl = new AbortController(); q(c.signal).catch(e => { if (e?.code !== 'aborted') problems.report({ area: 'Refresh', message: 'The quiet re-check of older films stopped early.', error: e, level: 'error' }); }).finally(() => { if (quietCtl === c) quietCtl = null; try { store.flush(); } catch { /* store.onError has reported it; the store retries */ } }); }
      }
    })();
    return { started: true };
  }

  // ---------- on-demand fetching: films the user can see, hovers over or opens jump the queue ----------
  // These runs sit outside the single job slot and use the same http (its per-host limiters stay the only throttle).
  // `inflight` is shared with the background crawl so neither fetches what the other is already fetching.
  const inflight = new Map();
  const QUICK_PROVIDERS = new Set(['boxd', 'wikidata', 'wikipedia', 'lbpage']);
  const FETCH_CAP = 24, FETCH_COOLDOWN = 10 * 60 * 1000;
  const LANES = { open: 0, opened: 0, hover: 1, hovered: 1, visible: 2 }; // request priority per slot (lower = sooner)
  const fetchSlots = new Map();   // slot -> { controller, keys, fresh, tier }
  const attempted = new Map();    // 'tier|key' -> time; stops failing films being retried on every scroll
  const fetchProblems = [];       // kept apart from sync.problems, which the background run assigns wholesale

  function stopFilmRuns() { for (const c of [...filmAborts]) c.abort(); filmAborts.clear(); }
  function stopFetchNow(slot) {
    for (const [name, s] of fetchSlots) if (!slot || slot === name) {
      s.controller.abort(); fetchSlots.delete(name);
      // Forget the attempt now, not when the aborted run winds down: a replacement request for an overlapping set
      // (a small scroll) is built straight away and would otherwise drop the films the old run never reached.
      for (const k of s.fresh) attempted.delete(s.tier + '|' + k);
    }
  }

  // ---------- API keys: what we know about each one (never the key itself) ----------
  const provs = () => providers || allProviders();
  const provById = id => provs().find(p => p.id === id) || null;
  const setKeyStatus = (id, patch) => {
    const s = store.library.settings;
    s.keyStatus = s.keyStatus || {};
    s.keyStatus[id] = { ...(s.keyStatus[id] || {}), ...patch };
    store.touch('library');
  };
  const REJECTED = /stopped working|didn't accept|did not accept|HTTP 401|key stopped/i;
  /** After a run: a rejected key, a rate limit or failed lookups show on the key's row; a clean run clears them. */
  function noteKeyOutcome(problems, said) {
    const keys = store.library.settings.keys || {};
    for (const p of provs()) {
      if (!p.needsKey || !keys[p.id]) continue;
      const mine = problems.filter(x => x.provider === p.id);
      if (mine.some(x => REJECTED.test(x.message || ''))) {
        setKeyStatus(p.id, { state: 'rejected', lastError: `${p.label} key rejected. Check it, or paste a new one.` });
      } else if (mine.some(x => /429|rate limit|too many/i.test(x.message || '')) || /limit/i.test(said.get(p.id) || '')) {
        setKeyStatus(p.id, { lastError: `${p.label} has hit its limit for now. Matinee will pick up where it left off later.` });
      } else if (mine.length) {
        setKeyStatus(p.id, { lastError: `${mine.length} ${mine.length === 1 ? 'lookup' : 'lookups'} didn't go through. They will be tried again next time.` });
      } else {
        const st = store.library.settings.keyStatus?.[p.id];
        if (st && (st.lastError || st.state === 'rejected')) setKeyStatus(p.id, { lastError: null, state: 'ok' });
      }
    }
  }
  const keyView = (p, lib) => {
    if (!p.needsKey) return null;
    const key = (lib.settings.keys || {})[p.id];
    if (!key) return null;
    const st = (lib.settings.keyStatus || {})[p.id] || {};
    return { hint: '••••' + String(key).slice(-4), state: st.state || 'untested', testedAt: st.testedAt || null, message: st.message || null, lastError: st.lastError || null };
  };

  let pendingQuiet = null; // the quiet re-read pass a finished job left to run
  let quietCtl = null;
  const stopQuiet = () => { if (quietCtl) { quietCtl.abort(); quietCtl = null; } };
  async function runEnrichment(signal, { full = false, only = null, ignoreBackoff = false } = {}) {
    const said = new Map(); // provider id -> last log line, so a daily limit can be shown on its row
    const emitTracked = (event, payload) => { if (event === 'log' && payload && payload.provider) said.set(payload.provider, payload.message); emitFromEnrich(event, payload); };
    const res = await enrich({ store, providers: provs(), http, emit: emitTracked, signal, full, only, log: fetchLog, inflight, deferQuiet: true, trouble, ignoreBackoff, problemLog: problems, onFilm: (f, id) => rates.note(id) });
    pendingQuiet = res.runQuiet || null; // run once the visible job has ended: the quiet re-read pass shows no progress
    store.library.sync.problems = res.problems.slice(0, 50);
    noteKeyOutcome(res.problems, said);
    if (full) store.library.sync.lastFull = new Date().toISOString();
    store.touch('library');
  }

  function fetchNow({ keys = [], tier = 'quick', slot = null } = {}) {
    if (testRun) return { queued: 0 };
    const full = tier === 'full';
    slot = slot || (full ? 'open' : 'visible');
    const lane = LANES[slot] ?? (full ? 0 : 2);
    const opened = lane === 0; // a film the user has opened ignores failure backoff
    const now = nowMs();
    const valid = [...new Set(Array.isArray(keys) ? keys : [keys])].filter(k => typeof k === 'string' && store.films[k]);
    // Films with no Letterboxd score yet go first (it leads everywhere), then the rest in the order given.
    const lacksLb = k => !(compose(store.films[k]).ratings?.letterboxd?.value > 0);
    const wanted = [...valid.filter(lacksLb), ...valid.filter(k => !lacksLb(k))].slice(0, FETCH_CAP);
    const running = fetchSlots.get(slot);
    if (running && running.keys.join('|') === wanted.join('|')) return { queued: 0 }; // same films, already on it
    stopFetchNow(slot); // the new request replaces the old one for this slot
    const fresh = wanted.filter(k => {
      const a = Math.max(attempted.get('full|' + k) || -Infinity, full ? -Infinity : attempted.get('quick|' + k) || -Infinity);
      return now - a > FETCH_COOLDOWN;
    });
    if (!fresh.length) return { queued: 0 };
    const list = (providers || allProviders()).filter(p => !p.bulk && (full || QUICK_PROVIDERS.has(p.id))); // bulk downloads (IMDb's file) never run for one film
    const controller = new AbortController();
    const entry = { controller, keys: wanted, fresh, tier };
    fetchSlots.set(slot, entry);
    for (const k of fresh) attempted.set(tier + '|' + k, now);
    // Progress and log lines belong to the background run's display, so they are not forwarded.
    const quietEmit = (event, payload) => { if (event === 'library') emitLibraryBatched(payload); };
    // Every film is queued at once (one run each, started in on-screen order) so the network queue can put a more urgent lane ahead.
    // Films the user is looking at (opened or hovered) also report what each source said, live, for the film page.
    const watching = lane <= 1, announce = lane === 0; // hovered films are recorded; only an opened film's page needs live events
    if (watching) for (const k of fresh) startFetchRecord(k);
    const one = k => enrich({ store, providers: list, http, emit: quietEmit, signal: controller.signal, only: [k], keepOrder: true, inflight, lane, ignoreBackoff: opened, trouble, problemLog: problems, onFilm: film => emitLibraryBatched({ keys: [film.key] }), onOutcome: (film, p, o) => { if (watching) noteOutcome(film, p, o, announce); } });
    const run = async only => {
      const results = await Promise.all(only.map(one));
      return { problems: results.flatMap(r => r.problems), skipped: results.flatMap(r => r.skipped) };
    };
    (async () => {
      try {
        let res = await run(fresh);
        fetchProblems.push(...res.problems);
        // Films another run had in flight were left to it. Wait for that run: if it finishes them, good; if it was aborted
        // (the user scrolled on) they are still unfetched, so take them here. Gives up after a minute.
        const stillWanted = k => store.films[k] && list.some(p => !(p.enabled && !p.enabled(store.library.settings || {})) && wantsFor(p, store.films[k], { now: nowMs(), full, ignoreBackoff: opened, lane }));
        let left = [...new Set(res.skipped.map(sk => sk.slice(sk.indexOf('|') + 1)))];
        for (let i = 0; i < 120 && left.length && !controller.signal.aborted; i++) {
          if (!left.some(k => list.some(p => inflight.has(p.id + '|' + k)))) break;
          await new Promise(r => later(r, 500));
        }
        left = left.filter(k => !controller.signal.aborted && stillWanted(k) && !list.some(p => inflight.has(p.id + '|' + k)));
        if (left.length) { res = await run(left); fetchProblems.push(...res.problems); }
        fetchProblems.splice(0, Math.max(0, fetchProblems.length - 20));
      } catch (e) {
        if (e.code !== 'aborted') { fetchProblems.push({ message: e.message }); problems.report({ area: 'Fetching', message: 'Fetching details for the films on screen stopped early.', error: e, level: 'error' }); }
      } finally {
        if (controller.signal.aborted) for (const k of fresh) attempted.delete(tier + '|' + k);
        if (fetchSlots.get(slot) === entry) fetchSlots.delete(slot);
      }
    })();
    return { queued: fresh.length };
  }

  // ---------- what each source said about a film (the film page's "failed N sources" pill) ----------
  // Kept in memory only (the last run per film). After a restart the page rebuilds the failed ones from film.failed (see fetchStatus).
  const lastFetch = new Map(); // film key -> { at, outcomes: Map(provider id -> { provider, label, status, reason, at }) }
  const filmRuns = new Map();  // film key -> promise of the run in progress
  const filmAborts = new Set();
  function startFetchRecord(key) { const rec = { at: new Date(nowMs()).toISOString(), outcomes: new Map() }; lastFetch.set(key, rec); return rec; }
  /** One source finished (or could not) with one film: remember it and tell the page straight away. */
  function noteOutcome(film, p, o, announce = true) {
    const rec = lastFetch.get(film.key) || startFetchRecord(film.key);
    rec.outcomes.set(p.id, { provider: p.id, label: p.label, status: o.status, reason: o.reason || '', at: o.at || new Date(nowMs()).toISOString() });
    if (lastFetch.size > 400) lastFetch.delete(lastFetch.keys().next().value); // bounded
    if (announce) emit('film', { key: film.key, keys: [film.key], provider: p.id, status: o.status, reason: o.reason || '' });
  }
  /** What we can say about a source for a film that it has not reported on in this run (or since the app opened). */
  function inferOutcome(p, film) {
    const settings = store.library.settings || {};
    const base = { provider: p.id, label: p.label };
    if (p.enabled && !p.enabled(settings)) return { ...base, status: 'skipped', reason: p.needsKey ? 'needs a key' : 'turned off', at: null };
    if (p.bulk) return { ...base, status: film.checked?.[p.id] ? 'ok' : 'skipped', reason: film.checked?.[p.id] ? 'up to date' : 'read for the whole library at once', at: film.checked?.[p.id] || null };
    const f = film.failed?.[p.id];
    if (f) return { ...base, status: 'failed', reason: `didn't work last time, will try again later`, at: f.at };
    if (p.requires && !p.requires(film) && !film.checked?.[p.id]) return { ...base, status: 'skipped', reason: 'nothing to look up yet', at: null };
    if (film.missed?.[p.id]) { const hollow = !!film.missNote?.[p.id]; return { ...base, status: 'miss', reason: hollow ? 'page there, no scores' : `${p.label} has nothing on this film`, ...(hollow ? { hollow: true } : {}), at: film.checked?.[p.id] || null }; }
    if (film.checked?.[p.id]) return { ...base, status: 'ok', reason: 'up to date', at: film.checked[p.id] };
    const covered = coveredBy(p, film, { lane: 2 });
    if (covered) return { ...base, status: 'deferred', reason: `${covered}; read later in the background`, at: null };
    return { ...base, status: 'deferred', reason: 'not read yet', at: null };
  }
  /**
   * { at, failed, deferred, outcomes: [{ provider, label, status: 'ok'|'miss'|'failed'|'deferred'|'skipped', reason, at }] } for one film,
   * one entry per source, in provider order.
   */
  function fetchStatus(film) {
    const rec = lastFetch.get(film.key);
    const outcomes = provs().map(p => (rec && rec.outcomes.get(p.id)) || inferOutcome(p, film));
    return { at: rec ? rec.at : null, failed: outcomes.filter(o => o.status === 'failed').length, deferred: outcomes.filter(o => o.status === 'deferred').length, outcomes };
  }

  /**
   * Read the sources for ONE film at the top lane, ignoring failure backoff, and report what each said (events 'film' as they land).
   * ids = null: every enabled source that is missing, missed, failed or due (fresh ones are reported 'ok', "up to date");
   * ids = [...]: only those sources, read whatever their freshness (a retry).
   */
  async function fetchFilm(key, ids = null) {
    const film = store.films[key];
    if (!film) throw Object.assign(new Error('That film is no longer in your library.'), { code: 'not-found' });
    const running = filmRuns.get(key);
    if (running) { if (!ids) return running; await running.catch(() => {}); /* that run's own failure is reported where it happened; this call starts its own */ }
    const wanted = ids ? new Set(ids) : null;
    const list = provs().filter(p => !p.bulk && (!wanted || wanted.has(p.id)));
    if (wanted && !list.length) throw badRequest('Matinee has no source by that name.');
    const controller = new AbortController();
    filmAborts.add(controller);
    if (!ids || !lastFetch.has(key)) startFetchRecord(key);
    const quietEmit = (event, payload) => { if (event === 'library') emitLibraryBatched(payload); };
    const run = (async () => {
      try {
        await enrich({ store, providers: list, http, emit: quietEmit, signal: controller.signal, only: [key], keepOrder: true, inflight, lane: 0, ignoreBackoff: true,
          full: !ids, force: ids ? true : null, trouble, problemLog: problems, onFilm: f => emitLibraryBatched({ keys: [f.key] }), onOutcome: (f, p, o) => noteOutcome(f, p, o, true) });
      } catch (e) { if (e.code !== 'aborted') throw e; }
      finally { filmAborts.delete(controller); }
      const st = { key, ...fetchStatus(film) };
      emit('film', { key, keys: [key], done: true, failed: st.failed, deferred: st.deferred });
      return st;
    })().finally(() => { if (filmRuns.get(key) === run) filmRuns.delete(key); });
    filmRuns.set(key, run);
    return run;
  }

  async function runRefresh(signal, { full = false, ignoreBackoff = false } = {}) {
    // Started and finished marks: a run cut short (the app closed mid-fetch) is picked up at the next launch (autoRefresh).
    store.library.sync = store.library.sync || {};
    store.library.sync.refreshStarted = new Date().toISOString();
    store.touch('library');
    const user = store.library.user && store.library.user.username;
    if (user) {
      emit('progress', { phase: 'rss', label: 'Checking Letterboxd for new diary entries and watchlist films', done: 0, total: 1 });
      try { const r = await refreshFromRss(store, http, user); if (r.added || r.updated) emit('library'); }
      catch (e) { if (e.code === 'no-user') throw e; problems.report({ area: 'Diary refresh', message: "Matinee couldn't check Letterboxd for new diary entries. It carried on with the rest.", error: e, level: 'error' }); }
      // New watchlist films (reads the user's activity feed, else the user's public watchlist page; fails soft, never stops the refresh)
      try { const w = await refreshWatchlist(store, http, user, { signal, problems, log: e => fetchLog.add({ site: 'Letterboxd', provider: 'watchlist', kind: 'ok', ...e }) }); if (w.added || w.marked || w.removed) emit('library'); } catch (e) { if (e?.code !== 'aborted') problems.report({ area: 'Watchlist refresh', message: "Matinee couldn't check Letterboxd for new watchlist films. It carried on with the rest.", error: e, level: 'error' }); }
    }
    // Followed Letterboxd lists, when they have not been read in the last day. Fails soft per list (each problem is reported).
    try { const l = await refreshDueLists({ store, http, signal, now: nowMs(), problems }); if (l.checked) emit('library'); } catch (e) { if (e?.code !== 'aborted') problems.report({ area: 'Lists', message: "Matinee couldn't check your followed lists. It carried on with the rest.", error: e, level: 'error' }); }
    await runEnrichment(signal, { full, ignoreBackoff });
    store.library.sync = store.library.sync || {};
    store.library.sync.lastRefresh = new Date().toISOString(); // also when there is no username or the RSS step failed, so autoRefresh doesn't restart at every launch
    if (!(signal && signal.aborted)) store.library.sync.refreshDone = store.library.sync.lastRefresh;
    store.touch('library');
  }

  // Tags that came from Letterboxd are read-only here; only the ones made in Matinee (on watchlist films) can be renamed or deleted.
  const isLetterboxdTag = name => { const t = store.library.tags[name]; return !!t && !!t.source && t.source !== 'matinee'; };
  // A tag the user adds by hand stays on that film even if its name matches a Letterboxd tag, so a re-import never wipes it (`u.mine`).
  const noteMine = (u, before) => {
    const mine = new Set((u.mine || []).filter(t => (u.tags || []).includes(t)));
    for (const t of u.tags || []) if (!before.includes(t) && isLetterboxdTag(t)) mine.add(t);
    if (mine.size) u.mine = [...mine]; else delete u.mine;
  };
  const readOnlyTag = () => Object.assign(new Error('That tag comes from Letterboxd, so it can only be changed there.'), { code: 'read-only' });

  // ---------- Dendy Newtown (cinema listings): read at most once a Sydney day, lane 4, never part of the job slot ----------
  const CINEMA_FAIL_DAYS = 3;
  const cinemaCache = () => store.cached('cinema', Infinity) || null;
  const cinemaHealth = () => store.cached('cinemaHealth', Infinity) || { failedDays: [] };
  async function cinemaRead({ force = false } = {}) {
    // Without the friend code Dendy is never read: not an error, the feature is simply off.
    if (!dendyOn()) return { ok: false, error: 'off', fetched: 0, requests: 0, partial: [], skipped: true };
    if (cinemaJob) return cinemaJob;
    const run = (async () => {
      const [{ refreshCinema, sydneyParts }, { createDendySource }] = await Promise.all([import('./features/cinema.js'), import('./sources/dendy.js')]);
      const before = cinemaCache();
      cinemaCtl = new AbortController();
      let r;
      try {
        r = await refreshCinema({ source: createDendySource({ http, priority: 4 }), problems, cache: before, summaries: summaries(), nowMs: nowMs(), signal: cinemaCtl.signal, force });
      } catch (e) {
        if (e?.code !== 'aborted') problems.report({ area: 'Dendy Newtown', message: "Matinee couldn't read what's on at Dendy Newtown.", error: e, level: 'error' });
        r = { cache: null, error: e?.code === 'aborted' ? 'aborted' : 'network', fetched: 0, skipped: false, requests: 0, partial: [] };
      }
      if (r.skipped) return { ok: true, error: null, fetched: 0, requests: 0, partial: [], skipped: true };
      // Failures are saved too: the cache's own triedAt makes the next read wait three hours.
      if (r.cache) store.setCached('cinema', r.cache);
      // A day counts as failed when the lists could not be read at all (the stored read time did not move). After three such days
      // (not necessarily in a row on the calendar: days the user had the app closed are not counted) the user gets a plain notice.
      const worked = !!r.cache && r.cache.fetchedAt !== (before ? before.fetchedAt : null);
      if (r.error !== 'aborted') {
        if (worked) { store.setCached('cinemaHealth', { failedDays: [] }); trouble.resolve('cinema:dendy'); }
        else {
          const today = sydneyParts(nowMs()).date, h = cinemaHealth();
          const days = h.failedDays.includes(today) ? h.failedDays : [...h.failedDays, today].slice(-10);
          store.setCached('cinemaHealth', { failedDays: days });
          if (days.length >= CINEMA_FAIL_DAYS) trouble.raise('cinema:dendy', 'Dendy Newtown', "What's on at Dendy Newtown hasn't loaded for a few days. Matinee keeps trying quietly. Turn on Debug mode in Settings → Debug for a log you can copy.");
        }
      }
      const out = { ok: !r.error, error: r.error || null, fetched: r.fetched, requests: r.requests, partial: r.partial || [] };
      if (r.error !== 'aborted') emit('cinema', { ok: out.ok, error: out.error, fetched: out.fetched });
      return out;
    })().catch(e => { problems.report({ area: 'Dendy Newtown', message: "Matinee couldn't read what's on at Dendy Newtown.", error: e, level: 'error' }); return { ok: false, error: 'network', fetched: 0, requests: 0, partial: [] }; }).finally(() => { cinemaJob = null; cinemaCtl = null; });
    return (cinemaJob = run);
  }

  // ---------- Settings → Test fetch ----------
  /** The problem log and app log files, by name. A file that isn't there is normal and skipped; one that can't be read is reported. */
  function readLogFiles() {
    const dirs = [logsDir || nodePath.join(dataDir, 'logs'), nodePath.dirname(dataDir)];
    const out = {};
    for (const name of SHARE_LOG_FILES) {
      for (const dir of dirs) {
        try { out[name] = fs.readFileSync(nodePath.join(dir, name), 'utf8'); break; }
        catch (e) { if (e?.code !== 'ENOENT') problems.report({ area: 'Share data', message: `Matinee couldn't read ${name} for the share file.`, error: e, level: 'warning' }); }
      }
    }
    return out;
  }
  /** Asks a source whether a key works; a key it refused, or a source that could not be reached, goes to the problem log. */
  async function checkKey(p, key) {
    const v = await p.validateKey(key, http);
    if (!v.ok) {
      const unreachable = /reach|problem answering/i.test(v.message || '');
      problems.report({ area: p.label, message: unreachable ? `Matinee couldn't test the ${p.label} key: ${v.message}` : `${p.label} did not accept the key: ${v.message}`, level: unreachable ? 'warning' : 'error' });
    }
    return v;
  }
  async function runTestFetchNow({ count = 24 } = {}) {
    if (testRun) throw badRequest('A test fetch is already running.');
    const n = Math.max(1, Math.min(Math.floor(Number(count)) || 24, 40));
    const { runTestFetch, formatReport } = await import('./diagnostics/index.js');
    if (testRun) throw badRequest('A test fetch is already running.');
    const controller = new AbortController();
    // The background crawl, the quiet pass and on-screen fetching all pause so the test has the network to itself (they share the same pacing).
    testRun = { controller, step: null, resume: !!job || !!quietCtl || rerunEnrichment };
    if (job) job.controller.abort();
    stopQuiet(); pendingQuiet = null; stopFetchNow();
    emit('state');
    try {
      const report = await runTestFetch({
        store, providers: provs(), http, settings: store.library.settings, count: n, signal: controller.signal, now: nowMs,
        cookieProbe, hasWindow: !!render, problems,
        onStep: step => { if (testRun) testRun.step = step; emit('testFetchStep', step); },
      });
      const text = formatReport(report);
      lastTest = { report, text, startedAt: report.startedAt };
      return { report, text };
    } finally {
      const resume = testRun.resume;
      testRun = null;
      emit('state');
      // An import during the test (rerunEnrichment) also gets its refresh now. Nothing starts on a closed core.
      if (!closed && (resume || rerunEnrichment)) {
        if (startJob('refresh', sig => runRefresh(sig)).started === false) rerunEnrichment = true; // the stopped run is still winding down: it restarts when it ends
        else rerunEnrichment = false;
      }
    }
  }

  // ---------- poster choice ----------
  function posterOptions(key) {
    const film = store.films[key];
    if (!film) throw Object.assign(new Error('That film is no longer in your library.'), { code: 'not-found' });
    const cands = posterCandidates(film);
    const pick = store.library.films[key]?.posterPick || null;
    return {
      chosen: pick && cands.some(c => c.source === pick) ? pick : null,
      auto: cands[0] ? cands[0].source : null,
      options: cands.map(c => ({ source: c.source, label: c.label, url: c.poster.url, thumb: c.poster.thumb || c.poster.url })),
    };
  }

  const people = createPersonFilms({ store, http, problems, summaries: () => summaries(), keyOf: personKey, emit: (e, p) => emit(e, p), now: nowMs });

  const storageMeter = createStorageMeter({ dataDir, appDir, problems });

  // ---------- methods ----------
  const methods = {
    /** Disk space Matinee uses: { total, parts: [{ id, label, bytes }] } in bytes (cached for a minute). */
    getStorage() { return storageMeter(); },
    /** Empty the saved lookups and the image cache (re-fetchable only; never films or library). Returns { freed, storage }. */
    async clearCache() {
      const r = await clearCache({ dataDir, problems, clearLookups() { for (const k of Object.keys(store.cache)) delete store.cache[k]; store.touch('cache'); } });
      return { ...r, storage: await storageMeter({ fresh: true }) };
    },
    /** Recent fetch activity, oldest first: [{ n, t, site, provider, title, kind, text }]. `since` = last entry number already seen. */
    getFetchLog({ since = 0 } = {}) { return { entries: fetchLog.list({ since }), last: fetchLog.last, text: trouble.text() }; },
    // ---------- problems (every error in the app; Settings → Debug, and everywhere in Debug mode) ----------
    /** { list: newest first [{ id, at, area, message, detail, film, level, count, isNew }], unseen, text (pasteable), folder } */
    getProblems() { return { list: problems.list(), unseen: problems.unseen(), counts: problems.counts(), text: problems.text(), folder: logsDir || nodePath.join(dataDir, 'logs') }; },
    markProblemsSeen() { problems.markSeen(); return { ok: true }; },
    clearProblems() { problems.clear(); return { ok: true }; },
    /** From the UI or Electron: { area, message, detail?, film?, level? }. detail = technical text (error message, stack line). */
    reportProblem({ area, message, detail = '', film = '', level = 'error' } = {}) {
      problems.report({ area: String(area || 'Matinee'), message: String(message || 'Something went wrong.'), error: detail ? { message: String(detail) } : null, film: String(film || ''), level: level === 'warning' ? 'warning' : 'error' });
      return { ok: true };
    },
    getDiscoverLog({ since = 0 } = {}) { return { entries: discoverLog.list({ since }), last: discoverLog.last }; },
    getState() {
      const lib = store.library;
      const uf = Object.values(lib.films);
      const { enriched, filled } = cached('filled', () => {
        const filled = {}; let enriched = 0;
        for (const f of Object.values(store.films)) {
          let any = false;
          for (const [id, v] of Object.entries(f.src || {})) { any = true; if (v) filled[id] = (filled[id] || 0) + 1; }
          if (any) enriched++;
        }
        return { enriched, filled };
      });
      return {
        ready: Object.keys(store.films).length > 0,
        user: lib.user,
        counts: {
          films: summaries().length, watched: uf.filter(f => f.watched).length, watchlist: uf.filter(f => f.watchlist).length,
          entries: Object.keys(lib.entries).length, reviews: Object.values(lib.entries).filter(e => e.review).length,
          enriched,
        },
        job: job ? job.progress : null,
        testFetch: { running: !!testRun, step: testRun ? testRun.step : null }, // Settings → Test fetch
        trouble: trouble.list(), // [{ key, site, message, since }]: plain-language notices, empty when all is well
        problems: { unseen: problems.unseen(), total: problems.list().length, ...problems.counts() }, // the error log (Settings → Debug)
        progress: computeProgress({ store, providers: provs(), tracker: rates, running: !!job, now: nowMs(), hostStatus: typeof http.hostStatus === 'function' ? http.hostStatus() : [] }),
        sync: lib.sync,
        settings: { region: lib.settings.region || 'AU', regionChosen: !!lib.settings.regionChosen, dendy: lib.settings.dendy === true, friendCode: lib.settings.friendCode || '', theme: lib.settings.theme || 'system', motion: lib.settings.motion === 'less' ? 'less' : 'system', feelColours: lib.settings.feelColours !== 'off', debug: !!lib.settings.debug, reimportReminder: reimportReminder(lib, nowMs()), keys: Object.fromEntries(Object.entries(lib.settings.keys || {}).map(([k, v]) => [k, v ? '••••' + String(v).slice(-4) : ''])) },
        providers: provs().map(p => ({ id: p.id, label: p.label, gives: p.gives || [], adds: p.adds || null, key: keyView(p, lib), needsKey: !!p.needsKey, hasKey: !!(lib.settings.keys || {})[p.id], keyHelp: p.keyHelp || null, attribution: p.attribution || null, filled: filled[p.id] || 0 })),
      };
    },

    async importExport({ bytes, base64 }) {
      if (!bytes && typeof base64 === 'string' && base64.length > MAX_INPUT_BYTES * 1.4) throw badRequest("That file doesn't look like a Letterboxd export.");
      const buf = bytes || Buffer.from(typeof base64 === 'string' ? base64 : '', 'base64');
      if (buf.length > MAX_INPUT_BYTES) throw badRequest("That file doesn't look like a Letterboxd export.");
      let summary;
      try { summary = importExport(store, buf, { now: nowMs() }); resetWatchlistTracking(store); delete store.library.settings.reimportReminder?.snoozeUntil; }
      catch (e) { if (e?.code !== 'bad-request') problems.report({ area: 'Import', message: "Matinee couldn't read that Letterboxd export.", error: e, level: 'error' }); throw e; }
      try { store.flush(); } catch { /* store.onError has reported it; the store retries */ }
      emit('library'); emit('state');
      // If a run is already going, the new films are picked up when it ends.
      if (startJob('import', signal => runRefresh(signal)).started === false) rerunEnrichment = true;
      return summary;
    },

    // DECISION: a refresh the user asks for ignores failure backoff (the automatic ones respect it).
    refresh({ full = false } = {}) { return startJob('refresh', signal => runRefresh(signal, { full, ignoreBackoff: true })); },
    /** Called when the app opens: quietly refresh if it's been a while. */
    autoRefresh() {
      // Dendy Newtown's listings ride along: refreshCinema limits itself (first look of a Sydney day, then about every 4 hours), lane 4, and nothing here waits for it.
      if (!testRun && dendyOn() && Object.keys(store.films).length) cinemaRead().catch(() => { /* cinemaRead reports its own failure and never rejects; nothing more to say here */ });
      const last = Date.parse(store.library.sync.lastRefresh || 0);
      const lastFull = Date.parse(store.library.sync.lastFull || 0);
      if (!Object.keys(store.films).length) return { started: false };
      // Opening the app fetches whatever is missing on the user's computer (new sources, newly added films), at most hourly;
      // otherwise a quiet top-up every six hours.
      const pending = hasPendingWork({ store, providers: allProviders() });
      // A run that never finished (the app was closed while it fetched) carries on straight away. Checking Letterboxd at the start of
      // a run already stamps lastRefresh, so without this a reopen within the hour left the rest unfetched until a manual Refresh.
      const sync = store.library.sync || {};
      const cutShort = pending && !!sync.refreshStarted && !(Date.parse(sync.refreshDone || 0) >= Date.parse(sync.refreshStarted));
      if (!cutShort && Date.now() - last < (pending ? 1 : 6) * HOUR) return { started: false };
      return startJob('refresh', signal => runRefresh(signal, { full: Date.now() - lastFull > 7 * 24 * HOUR }));
    },
    cancel() { rerunEnrichment = false; stopQuiet(); if (job) job.controller.abort(); stopFetchNow(); stopFilmRuns(); return { ok: true }; },
    /** Stop a Test fetch that is running (its report so far is dropped). */
    cancelTestFetch() { if (testRun) testRun.controller.abort(); return { ok: true }; },
    /** Fetch these films now, ahead of the background crawl. tier 'quick' = posters, ids, Letterboxd scores; 'full' = every source. */
    fetchNow(args) { return fetchNow(args || {}); },
    /**
     * Opening a film: read every enabled source that is missing, failed or due for this one film, at the top lane, ignoring failure backoff.
     * Args { key }. Resolves when the sources are done with { key, at, failed, deferred, outcomes: [{ provider, label, status, reason, at }] }.
     * Events while it runs: 'film' { key, keys: [key], provider, status, reason } per source, then 'film' { key, keys, done: true, failed, deferred }.
     */
    fetchFilmAll({ key } = {}) { return fetchFilm(typeof key === 'string' ? key : ''); },
    /** Retry just these sources for a film whatever their freshness. Args { key, providerIds: [id] }. Same result and events as fetchFilmAll. */
    retryFilmSources({ key, providerIds } = {}) {
      const ids = (Array.isArray(providerIds) ? providerIds : []).filter(id => typeof id === 'string');
      if (!ids.length) throw badRequest('Pick at least one source to try again.');
      return fetchFilm(typeof key === 'string' ? key : '', ids);
    },
    /** What each source said about this film last time ({ key, at, failed, deferred, outcomes }), without fetching anything. */
    getFetchStatus({ key } = {}) {
      const film = store.films[key];
      if (!film) throw Object.assign(new Error('That film is no longer in your library.'), { code: 'not-found' });
      return { key, ...fetchStatus(film) };
    },

    /**
     * Everything known about how one film was filled in, for the film page's Debug panel. Read-only, nothing is fetched.
     * @returns {{ key, title, year, ids, fieldSources, providers: [{ id, label, status, reason, checked, missed, failed, missNote, reread, hasData, fields }], problems: object[] }}
     */
    getFilmDebug({ key } = {}) {
      const film = store.films[key];
      if (!film) throw Object.assign(new Error('That film is no longer in your library.'), { code: 'not-found' });
      const outcomes = new Map(fetchStatus(film).outcomes.map(o => [o.provider, o]));
      const label = filmLabel(film);
      return {
        key, title: film.title, year: film.year ?? null, ids: { ...film.ids },
        watchlist: (u => ({ on: !!u.watchlist, via: u.watchlistVia || null, addedAt: u.watchlistAddedAt || null, activityId: u.watchlistActivityId || null, activityAt: u.watchlistActivityAt || null, removedAt: u.watchlistRemovedAt || null, removedVia: u.watchlistRemovedVia || null }))(store.library.films[key] || {}),
        fieldSources: { ...compose(film).sources, ...scoreAndFeelSources(film) },
        providers: provs().map(p => {
          const o = outcomes.get(p.id) || {};
          return {
            id: p.id, label: p.label, status: o.status || null, reason: o.reason || '',
            checked: film.checked?.[p.id] || null, missed: film.missed?.[p.id] || null, failed: film.failed?.[p.id] || null,
            missNote: film.missNote?.[p.id] || null, reread: film.reread?.[p.id] || null,
            hasData: !!film.src?.[p.id], fields: Object.keys(film.src?.[p.id] || {}),
          };
        }),
        problems: label ? problems.list().filter(e => e.film === label) : [],
      };
    },

    getLibrary() {
      const all = summaries();
      return {
        films: wireSummaries(),
        tags: (() => {
          const counts = cached('tagCounts', () => { const m = new Map(); for (const s of all) for (const t of new Set(s.user.tags)) m.set(t, (m.get(t) || 0) + 1); return m; });
          return Object.entries(store.library.tags).map(([name, t]) => ({ name, source: t.source || 'matinee', count: counts.get(name) || 0 })).sort((a, b) => b.count - a.count);
        })(),
        autoTags: cached('tagIndex', () => tagIndex(all)),
        facets: cached('facets', () => facets(all)),
        views: Object.values(store.library.views),
        lists: visibleLists().map(l => ({ id: l.id, name: l.name, count: l.films.length, source: l.source || 'matinee' })),
      };
    },

    /** The library-list summaries for just these films: { films: [summary] } (same objects getLibrary returns). */
    getSummaries({ keys = [] } = {}) {
      const w = wireByKey();
      return { films: (Array.isArray(keys) ? keys : [keys]).map(k => w.get(k)).filter(Boolean) };
    },

    getFilm({ key }) {
      const film = store.films[key];
      if (!film) throw Object.assign(new Error('That film is no longer in your library.'), { code: 'not-found' });
      const c = compose(film, { posterPick: store.library.films[key]?.posterPick || null });
      c.people = normalisePeople(c.people);
      const s = entryOf(film, entryStats()).s; // rebuilt when this film was named in a 'film' or 'library' event
      const wb = wireByKey();
      const rel = related(index(), key, { k: 12 }).map(r => ({ ...r, film: wb.get(r.key) })).filter(r => r.film);
      return {
        ...s, ...c, user: s.user, score: s.score, scoreParts: s.scoreParts,
        autoTags: autoTags(s),
        entries: entriesFor(store, key),
        related: rel,
        lists: visibleLists().filter(l => l.films.includes(key)).map(l => ({ id: l.id, name: l.name, source: l.source || 'matinee' })),
        links: {
          letterboxd: c.slug ? `https://letterboxd.com/film/${c.slug}/` : film.lid ? `https://boxd.it/${film.lid}` : null,
          imdb: c.ids.imdb ? `https://www.imdb.com/title/${c.ids.imdb}/` : null,
          tmdb: c.ids.tmdb ? `https://www.themoviedb.org/movie/${c.ids.tmdb}` : null,
          wikipedia: c.ids.enwiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(c.ids.enwiki.replace(/ /g, '_'))}` : null,
          rt: c.ids.rt ? `https://www.rottentomatoes.com/${c.ids.rt}` : null,
          metacritic: c.ids.metacritic ? `https://www.metacritic.com/${c.ids.metacritic}/` : null,
        },
        checked: film.checked,
        fetchStatus: fetchStatus(film),
      };
    },

    /**
     * A person and their films in the library. Resolves by id (a Matinee 'p:…' id, a source id such as 'wd:Q…', or a Letterboxd 'lb:slug'),
     * then by name. Never 'not found' once a name is known: a person with no films in the library comes back with an empty list.
     */
    getPerson({ id, name } = {}) {
      const who = people.resolve({ id, name });
      if (!who.name) throw Object.assign(new Error('Nobody by that name in your library.'), { code: 'not-found' });
      const films = who.library.map(e => ({ film: e.summary, roles: e.roles }));
      const rated = films.filter(f => f.film.user.rating != null);
      return {
        id: who.pid || id || null, name: who.name,
        films: films.sort((a, b) => (a.film.year || 0) - (b.film.year || 0)),
        stats: { inLibrary: films.length, watched: films.filter(f => f.film.user.watched).length, watchlist: films.filter(f => f.film.user.watchlist).length, averageRating: rated.length ? rated.reduce((a, f) => a + f.film.user.rating, 0) / rated.length / 2 : null },
      };
    },

    /**
     * All of a person's films, from their Letterboxd person page (director / writer / actor), else Wikidata. Args { id, name } (either).
     * Returns at once: { id, name, status: 'ok'|'none'|'failed'|'loading', reason?, source: 'letterboxd'|'wikidata'|null, fetchedAt, roles: ['director'|'writer'|'cast'],
     *   films: [{ title, year|null, url, slug|null, key|null (library key), poster|null, role, roles?, watched, watchlist, liked, rating|null }] }.
     * 'loading' lists the person's library films meanwhile and fires event 'personFilms' { id, name, status } when done: call again then.
     */
    getPersonFilms(args) { return people.get(args || {}); },
    /** Portraits for people a film's own credits have none for. Args { people: [{ id, name }] } (at most 12). -> { [id or name]: TMDB image path | null } */
    async getPeoplePhotos({ people: list = [] } = {}) {
      const out = {};
      await Promise.all((Array.isArray(list) ? list : []).slice(0, 12).map(async p => {
        const k = String(p?.id || p?.name || '');
        if (k) out[k] = await people.photo({ id: p?.id, name: p?.name });
      }));
      return out;
    },

    // ---------- Dendy Newtown ----------
    /** What is on at Dendy Newtown matched to the library (buildCinemaView), or null if it has never been read. */
    async getCinema() {
      if (!dendyOn()) return null;
      const cache = cinemaCache();
      if (!cache || !cache.fetchedAt) return null;
      const { buildCinemaView, listingsFromCache } = await import('./features/cinema.js');
      return buildCinemaView({ listings: listingsFromCache(cache), summaries: summaries(), nowMs: nowMs(), fetchedAt: cache.fetchedAt });
    },
    /** Read Dendy Newtown now (without `force` only if due: once a Sydney day). -> { ok, error, fetched, requests, partial } and event 'cinema'. */
    refreshCinema({ force = false } = {}) { return cinemaRead({ force: !!force }); },

    // ---------- Settings → Test fetch ----------
    /** Fetch a few films with every source into copies (the library is never changed). -> { report, text }. Events 'testFetchStep'. */
    runTestFetch(args) { return runTestFetchNow(args || {}); },
    /** The latest test report ({ text, startedAt }), kept in memory only; null before the first. */
    getLastTestReport() { return lastTest ? { text: lastTest.text, startedAt: lastTest.startedAt } : null; },

    // ---------- Settings -> Share data ----------
    /** Writes matinee-share.zip into `dir` (the data folder if `dir` can't be used). No keys or secrets go in. -> { path, films, bytes } */
    async exportShare({ dir, appVersion = null } = {}) {
      const { profileOf, describe } = await import('./analysis/feel/index.js');
      const fi = await feelIndex();
      const feelOf = key => { const profile = profileOf(fi, key); return profile ? { profile, summary: describe(profile) } : null; };
      problems.flush(); // so problems.json on disk is current
      const input = { library: store.library, films: store.films, feelOf, fetchLog: trouble.text(), lastTest, appVersion, now: new Date(nowMs()), logs: readLogFiles() };
      const entries = shareEntries(input);
      let target = path.join(typeof dir === 'string' && dir ? dir : dataDir, SHARE_FILENAME);
      let fd;
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); fd = fs.openSync(target + '.tmp', 'w'); }
      catch (e) {
        problems.report({ area: 'Share data', message: "Matinee couldn't save the share file in that folder, so it used its own data folder instead.", error: e, level: 'warning' });
        target = path.join(dataDir, SHARE_FILENAME); fd = fs.openSync(target + '.tmp', 'w');
      }
      let bytes = 0;
      try { for await (const piece of zipChunks(entries, { now: input.now })) bytes += fs.writeSync(fd, piece); }
      catch (e) { problems.report({ area: 'Share data', message: "Matinee couldn't finish writing the share file.", error: e, level: 'error' }); throw e; }
      finally { fs.closeSync(fd); }
      fs.renameSync(target + '.tmp', target);
      return { path: target, films: Object.keys(store.films).length, bytes };
    },

    // ---------- poster choice ----------
    /** { chosen: sourceId|null, auto: sourceId|null, options: [{ source, label, url, thumb }] } for a film. */
    getPosterOptions({ key } = {}) { return posterOptions(key); },
    /** Choose a poster source for a film in the library (source null = back to automatic). Returns the new options and fires 'library' { keys }. */
    setPoster({ key, source = null } = {}) {
      if (typeof key !== 'string' || !store.films[key] || !(store.library.films[key] || entryStats().has(key))) throw badRequest("Matinee couldn't find that film in your library.");
      if (source != null && (typeof source !== 'string' || !posterOptions(key).options.some(o => o.source === source))) throw badRequest("That source doesn't have a poster for this film.");
      const u = userFilm(store, key);
      if (source) u.posterPick = source; else delete u.posterPick;
      store.touch('library'); emit('library', { keys: [key] });
      return posterOptions(key);
    },

    getDiary() {
      const bk = wireByKey(); // the slim rows the library list uses: the diary shows title, year and poster only
      const entries = Object.values(store.library.entries).map(e => ({ ...e, film: bk.get(e.key) || null })).filter(e => e.film).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { entries };
    },

    getInsights() {
      return cached('insights:' + localDay(), () => {
        const input = { summaries: summaries(), entries: Object.values(store.library.entries), today: localDay() };
        const base = insights(input);
        return { ...base, ...moreInsights({ ...input, perMonth: base.filmsPerMonthAvg }), hotTakes: hotTakes(summaries(), { n: 8 }) };
      });
    },
    /** What the films the user watches and rates highest feel like (Insights → Taste, Watchlist). Waits for the feel index, so it is its own call. */
    async getFeelTaste() {
      const fi = await feelIndex();
      const { profileOf } = await import('./analysis/feel/index.js');
      return cached('feelTaste', () => feelTaste({ summaries: summaries(), profileOf: key => profileOf(fi, key) }));
    },

    /**
     * The Map: every film (watched and watchlist together) as a dot placed so films that feel alike sit close. One layout; the screen filters.
     * Speed: a saved layout is shown at once even when film data has changed since (`stale: true`), and a fresh one is worked out in the
     * background, lined up with the old one so the map does not flip, then announced with a 'map' event { lens }.
     */
    async getMap({ lens = 'feel' } = {}) {
      const { LENSES } = await import('./analysis/feel-map.js');
      if (!Object.hasOwn(LENSES, lens)) throw badRequest("That way of arranging the map isn't available.");
      const ctx = mapCtx(lens);
      const L = 'map:layout:' + lens;
      let layout = mapFresh(lens, L, ctx.layoutFp), features = mapFresh('features', 'map:features', ctx.featureFp);
      if (layout && features) { mapHeld.set(lens, { fp: ctx.layoutFp, value: layout }); mapHeld.set('features', { fp: ctx.featureFp, value: features }); warmFeel(); return { lens, ...layout, ...features }; }
      const oldLayout = layout || mapSaved(lens, L).map(x => x.value).find(v => sameFilms(v, ctx.keys));
      const oldFeatures = features || mapSaved('features', 'map:features')[0]?.value;
      if (oldLayout && oldFeatures) { refreshMap(ctx); warmFeel(); return { lens, ...oldLayout, ...oldFeatures, stale: true }; }
      ({ layout, features } = await computeMap(ctx, { layout, features }));
      return { lens, ...layout, ...features };
    },

    async getFeel({ key }) {
      const { profileOf, describe } = await import('./analysis/feel/index.js');
      const profile = profileOf(await feelIndex(), key);
      return profile ? { profile, summary: describe(profile) } : null;
    },
    async getFeelSimilar({ key, emphasis, limit = 12, scope = 'all' }) {
      const { similar } = await import('./analysis/feel/index.js');
      return withFilms(similar(await feelIndex(), key, { emphasis, limit, among: scopeKeys(scope) }));
    },
    async shiftFeel({ key, axis, dir = 1, limit = 12, scope = 'all' }) {
      const { shift } = await import('./analysis/feel/index.js');
      const fi = await feelIndex();
      if (!(fi.axes || []).some(x => x.id === axis)) throw badRequest("That change isn't available.");
      return withFilms(shift(fi, key, { axis, dir: dir < 0 ? -1 : 1 }, { limit, among: scopeKeys(scope) }));
    },
    async searchFeel({ descriptors = [], themes = [], avoid = [], text = '', limit = 30, scope = 'all' } = {}) {
      const { queryFeel, profileOf } = await import('./analysis/feel/index.js');
      const list = x => (Array.isArray(x) ? x : []);
      const fi = await feelIndex();
      // `rough` marks a film Matinee has little to go on for (certainty.js), so its place in the results is a rough guess.
      return withFilms(queryFeel(fi, { descriptors: list(descriptors), themes: list(themes), avoid: list(avoid), text: typeof text === 'string' ? text : '' }, { limit, among: scopeKeys(scope), all: true }))
        .map(r => (profileOf(fi, r.key)?.certainty?.level === 'low' ? { ...r, rough: true } : r));
    },
    /**
     * A short feel line for many films at once (Library cards and rows): { [key]: { headline, words } }, words = up to three
     * feelings (no themes) in the film page's order. Films with nothing written yet are left out. Worked out once per data version.
     */
    async getFeelBriefs({ keys = null } = {}) {
      const { profileOf, describe } = await import('./analysis/feel/index.js');
      const fi = await feelIndex();
      const all = cached('feelBriefs', () => {
        const m = {};
        for (const r of fi.recs) {
          const p = profileOf(fi, r.key);
          if (!p) continue;
          const sum = describe(p);
          const words = (sum.chips || []).filter(c => c.facet !== 'theme').slice(0, 3).map(c => c.label);
          if (words.length || sum.headline) m[r.key] = { headline: sum.headline || '', words };
        }
        return m;
      });
      if (!Array.isArray(keys)) return all;
      const out = {};
      for (const k of keys) if (all[k]) out[k] = all[k];
      return out;
    },
    /** The feelings and themes a typed phrase names, e.g. "quietly sad" -> [{ id: 'melancholic', kind: 'descriptors' }, …]. */
    async feelWordsIn({ text = '' } = {}) {
      const { textIds } = await import('./analysis/feel/query.js');
      return textIds(await feelIndex(), typeof text === 'string' ? text.slice(0, 200) : '');
    },
    /** Every feeling, theme and place with how many films carry it. `keys`: count only these films (the ones in view). */
    async getFeelFacets({ keys = null } = {}) {
      const { facets: feelFacets, AXES } = await import('./analysis/feel/index.js');
      const fi = await feelIndex();
      const among = Array.isArray(keys) ? keys.filter(k => typeof k === 'string') : null;
      const axes = AXES.map(a => ({ id: a.id, low: a.low, high: a.high }));
      if (among) return { ...feelFacets(fi, among), axes }; // counted for the films in view: changes with every view, not kept
      // The whole library: worked out once per feel index (~610 KB, 75-100 ms on a real library), not on every call.
      if (!facetsHeld.has(fi)) facetsHeld.set(fi, { ...feelFacets(fi), axes });
      return facetsHeld.get(fi);
    },
    /** Just the "Like this one, but…" axes (the film page needs only these, not every feeling's count). */
    async getFeelAxes() {
      const { AXES } = await import('./analysis/feel/index.js');
      return AXES.map(a => ({ id: a.id, low: a.low, high: a.high }));
    },

    /** Fit for unwatched films: crowd verdict + how each feels next to films the user rated. Returns { ranked: [key], byKey }. Without `keys`: the top `limit` (20) of the pool. */
    async getFit({ keys = null, limit = 20 } = {}) {
      const { buildFit } = await import('./analysis/fit.js');
      const fi = await feelIndex();
      const all = summaries();
      const pool = all.filter(s => !s.user.watched && eligible(s)).map(s => s.key);
      const model = cached('fit', () => buildFit({ summaries: all, feel: fi, today: new Date(), pool }));
      // Without keys: the best few of the pool, not a row for every film.
      const want = Array.isArray(keys) ? keys.filter(k => byKey().has(k)) : model.rank(pool).slice(0, Math.max(0, Math.min(Number(limit) || 20, 100)));
      const byK = {};
      for (const k of want) byK[k] = model.fit(k);
      return { ranked: model.rank(want), byKey: byK };
    },

    /** Tonight v2: three role picks + "more like these". `nudge` swaps one pick ({role,key,kind}). See docs/DESIGN-discovery.md. */
    async getPicks({ dials = {}, exclude = [], seed = 0, nudge = null, avoid = [], choose = null } = {}) {
      const [{ buildPicks, nudgePick, choosePick }, { buildFit }] = await Promise.all([import('./analysis/picks.js'), import('./analysis/fit.js')]);
      const fi = await feelIndex();
      const all = summaries();
      const pool = all.filter(s => !s.user.watched && eligible(s)).map(s => s.key);
      const fitModel = cached('fit', () => buildFit({ summaries: all, feel: fi, today: new Date(), pool }));
      // "Include my lists": on by default when the watchlist alone is thin (fewer than 30 unwatched films); their own choice wins.
      const wl = all.filter(s => s.user.watchlist && !s.user.watched).length;
      const extra = all.filter(s => s.user.listed && !s.user.watchlist && !s.user.watched).length;
      const includeLists = dials.includeLists == null ? wl < THIN_WATCHLIST : !!dials.includeLists;
      const listsPool = { extra, on: includeLists && extra > 0, chosen: dials.includeLists != null };
      const o = { summaries: all, fitModel, feel: fi, today: new Date(), dials: { ...dials, includeLists }, exclude, seed, avoid };
      // Pick cards read title, year, poster, runtime, genres, ratings and the score breakdown; the rest of the summary stays home.
      const lean = p => (p && p.film ? { ...p, film: { ...slim(p.film), scoreParts: p.film.scoreParts } } : p);
      if (choose) { const r = choosePick(o, choose); return r.pick ? { ...r, pick: lean(r.pick) } : r; }
      if (nudge) { const r = nudgePick(o, nudge); return r.pick ? { ...r, pick: lean(r.pick) } : r; }
      const r = buildPicks(o);
      return { ...r, listsPool, picks: r.picks.map(lean), more: r.more.map(lean) };
    },

    /** Films opening in cinemas in the user's country in the next six months (Letterboxd film pages for Australia, else TMDB). */
    getUpcoming() {
      const region = String(store.library.settings.region || 'AU').toUpperCase();
      return { ...upcoming({ summaries: summaries(), today: localDay(), region }), region, hasTmdb: !!(store.library.settings.keys || {}).tmdb };
    },

    getTonight({ maxMinutes = null, mood = null, shuffleSeed = 0, pool = 'watchlist' } = {}) {
      const all = summaries();
      const profile = cached('taste', () => tasteProfile(all));
      const candidates = all.filter(s => pool === 'all' ? !s.user.watched : s.user.watchlist);
      const picks = rankTonight(profile, index(), candidates, { maxMinutes, mood, shuffleSeed, limit: 24 }).map(p => ({ ...p, film: wireByKey().get(p.key) }));
      const moods = {};
      for (const s of candidates) for (const g of s.genres) moods[g] = (moods[g] || 0) + 1;
      return { picks, moods: Object.entries(moods).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })), poolSize: candidates.length };
    },

    // ---------- wave 3: modules load on demand (see docs/briefs/wave3-contracts.md) ----------
    async getYear({ year } = {}) {
      const { yearInReview } = await import('./analysis/year.js');
      const entries = Object.values(store.library.entries);
      const latest = entries.reduce((m, e) => Math.max(m, Number(String(e.date).slice(0, 4)) || 0), 0);
      return yearInReview({ summaries: summaries(), entries, year: Number(year) || latest || new Date().getFullYear() });
    },
    /** What a diary year felt like (Year in review → Taste). Waits for the feel index, so it is its own call. */
    async getYearFeel({ year } = {}) {
      const fi = await feelIndex();
      const { profileOf } = await import('./analysis/feel/index.js');
      const entries = Object.values(store.library.entries);
      const latest = entries.reduce((m, e) => Math.max(m, Number(String(e.date).slice(0, 4)) || 0), 0);
      const y = Number(year) || latest || new Date().getFullYear();
      return cached('yearFeel:' + y, () => yearFeel({ summaries: summaries(), entries, year: y, profileOf: key => profileOf(fi, key) }));
    },
    async getCalibration() {
      const { calibration } = await import('./analysis/calibration.js');
      return cached('calibration', () => calibration(summaries()));
    },
    async getDiscover({ refresh = false, includeTV = false } = {}) {
      const { discover } = await import('./features/discover.js');
      // Suggestions are checked against the library every time they are served: films the user has logged or listed since drop out,
      // and TV entries of a series only show when the user has TV switched on.
      const serve = value => {
        const lib = libraryMatcher(store);
        return { ...value, sections: (value.sections || []).map(sec => ({
          ...sec,
          items: (sec.items || []).filter(i => !lib.find(i) && !(sec.id === 'series' && i.kind === 'tv' && !includeTV)),
        })).filter(sec => sec.items.length) };
      };
      const fresh = !refresh && store.cached('discover', 3 * 24 * HOUR);
      if (fresh) return serve(fresh);
      if (!discoverJob) {
        const controller = new AbortController();
        const say = (kind, text) => discoverLog.add({ site: 'Discover', kind, text });
        const stop = http.observe ? http.observe(n => discoverLog.add({ site: siteForHost(n.host), kind: n.kind, text: n.text })) : null;
        say('fetch', 'looking for films by the people you rate highly');
        discoverJob = discover({ store, http, problems, summaries: summaries(), signal: controller.signal, progress: (d, t) => { if (d > 0) say('ok', `finished part ${d} of ${t}`); emit('progress', { phase: 'discover', label: 'Finding films for you', done: d, total: t }); } })
          .then(v => { store.setCached('discover', v); store.flush(); say('ok', 'suggestions are ready'); emit('discover', { ok: true }); })
          .catch(e => { if (e?.code !== 'aborted') problems.report({ area: 'Discover', message: "Matinee couldn't finish finding films for you. It will try again next time.", error: e, level: 'error' }); say('error', "couldn't finish, will try again next time"); emit('discover', { ok: false, message: plainMessage(e) }); })
          .finally(() => { if (stop) stop(); discoverJob = null; emit('progress', { phase: 'done', label: 'Up to date' }); }); // closes the 'Finding films for you' job so the app-wide bar and pill clear
      }
      return store.cache.discover ? { ...serve(store.cache.discover.value), refreshing: true } : { status: 'loading' };
    },
    async getFilmography({ id }) {
      const { filmography } = await import('./features/filmography.js');
      return filmography({ store, http, problems, summaries: summaries(), personId: id }).catch(e => { problems.report({ area: 'Person page', message: "Matinee couldn't load that person's films.", error: e, level: 'error' }); throw e; });
    },
    async getSeries({ key }) {
      const { series } = await import('./features/series.js');
      return series({ store, http, problems, summaries: summaries(), key }).catch(e => { problems.report({ area: 'Series', message: "Matinee couldn't load the other films in this series.", error: e, level: 'error', film: filmLabel(store.films[key]) }); throw e; });
    },

    // ---------- your edits ----------
    /** Tags and notes are the one thing Matinee lets you add to a film, and only on your watchlist (Letterboxd has no way to). */
    setUserFilm({ key, tags, note }) {
      if (typeof key !== 'string' || !store.films[key]) throw badRequest("Matinee couldn't find that film.");
      if (tags != null && !Array.isArray(tags)) throw badRequest("Those tags weren't valid.");
      if (note != null && typeof note !== 'string') throw badRequest("That note wasn't valid.");
      const u = userFilm(store, key);
      if (!u.watchlist) throw Object.assign(new Error('Tags and notes can only be added to films on your watchlist. Everything else comes from Letterboxd.'), { code: 'read-only' });
      const before = [...(u.tags || [])];
      if (tags) { u.tags = [...new Set(tags.filter(t => typeof t === 'string').map(t => t.trim().slice(0, MAX_TAG)).filter(Boolean))]; for (const t of u.tags) if (!store.library.tags[t]) store.library.tags[t] = { createdAt: new Date().toISOString() }; noteMine(u, before); }
      if (note != null) u.note = note.slice(0, MAX_NOTE);
      store.touch('library'); emit('library');
      return u;
    },
    /**
     * Take a film off the watchlist in Matinee only (Letterboxd isn't touched). Tags, notes and `mine` stay with the film.
     * A later import or activity read puts it back only for a Letterboxd addition newer than this removal (an import re-adds what the export says).
     */
    removeFromWatchlist({ key }) {
      if (typeof key !== 'string' || !store.films[key]) throw badRequest("Matinee couldn't find that film.");
      if (!removeFromWatchlist(store, key, { via: 'manual', now: nowMs() })) throw badRequest("That film isn't on your watchlist.");
      fetchLog.add({ site: 'Letterboxd', provider: 'watchlist', title: store.films[key].title, kind: 'ok', text: 'Taken off your watchlist in Matinee by you.' });
      emit('library', { keys: [key] });
      return { ok: true };
    },
    /** Undo removeFromWatchlist. */
    restoreToWatchlist({ key }) {
      if (typeof key !== 'string' || !store.films[key]) throw badRequest("Matinee couldn't find that film.");
      if (!restoreToWatchlist(store, key)) throw badRequest("That film wasn't taken off your watchlist.");
      emit('library', { keys: [key] });
      return { ok: true };
    },
    /** The monthly re-import reminder: { snooze: true } = hide for 3 months; { off: true|false } = never show / show again. */
    setReimportReminder({ snooze, off } = {}) {
      const s = store.library.settings;
      const r = s.reimportReminder || (s.reimportReminder = {});
      if (off != null) { if (off) r.off = true; else delete r.off; }
      if (snooze) r.snoozeUntil = new Date(nowMs() + REIMPORT_SNOOZE_DAYS * HOUR * 24).toISOString();
      if (off === false) delete r.snoozeUntil;
      store.touch('library'); emit('state');
      return reimportReminder(store.library, nowMs());
    },
    /** Add and/or remove tags on several watchlist films at once. Films that aren't on the watchlist are skipped (and counted). */
    tagFilms({ keys = [], add = [], remove = [] }) {
      const clean = a => [...new Set((a || []).map(t => String(t).trim()).filter(Boolean))];
      const addT = clean(add), rmT = clean(remove);
      let changed = 0, skipped = 0;
      for (const key of keys) {
        const u = store.library.films[key];
        if (!u || !u.watchlist) { skipped++; continue; }
        const next = [...new Set([...(u.tags || []).filter(t => !rmT.includes(t)), ...addT])];
        if (next.length !== (u.tags || []).length || next.some((t, i) => t !== (u.tags || [])[i])) { const before = [...(u.tags || [])]; u.tags = next; noteMine(u, before); changed++; }
      }
      for (const t of addT) if (!store.library.tags[t]) store.library.tags[t] = { createdAt: new Date().toISOString() };
      if (changed) { store.touch('library'); emit('library'); }
      return { changed, skipped };
    },
    renameTag({ from, to }) {
      to = String(to || '').trim().slice(0, MAX_TAG); if (!to || !store.library.tags[from]) return { ok: false };
      if (isLetterboxdTag(from)) throw readOnlyTag();
      if (to === from) return { ok: true };
      if (isLetterboxdTag(to)) throw readOnlyTag();
      // Renaming onto a tag that already exists merges the two; the existing tag keeps its details.
      if (!store.library.tags[to]) store.library.tags[to] = store.library.tags[from];
      delete store.library.tags[from];
      for (const u of Object.values(store.library.films)) if (u.tags) u.tags = [...new Set(u.tags.map(t => (t === from ? to : t)))];
      store.touch('library'); emit('library'); return { ok: true };
    },
    deleteTag({ name }) {
      if (isLetterboxdTag(name)) throw readOnlyTag();
      delete store.library.tags[name];
      for (const u of Object.values(store.library.films)) if (u.tags) u.tags = u.tags.filter(t => t !== name);
      store.touch('library'); emit('library'); return { ok: true };
    },
    saveView({ id, name, query }) {
      if (!query || typeof query !== 'object' || Array.isArray(query)) throw badRequest("That view couldn't be saved.");
      if (id != null && (typeof id !== 'string' || !/^[\w-]{1,40}$/.test(id))) throw badRequest("That view couldn't be saved.");
      id = id || 'v' + Date.now().toString(36);
      store.library.views[id] = { id, name: String(name || 'Saved view').slice(0, MAX_NAME), query };
      store.touch('library'); emit('library'); return store.library.views[id];
    },
    deleteView({ id }) { delete store.library.views[id]; store.touch('library'); emit('library'); return { ok: true }; },

    // ---------- lists: followed from Letterboxd (source 'letterboxd'), imported from the export (source 'export', read-only) and your own (source 'matinee') ----------
    /** All lists: own first, then followed, then imported. covers = up to 4 posters for a tile. Followed lists carry owner and status. */
    getLists() {
      const lists = visibleLists();
      const covers = l => l.films.map(k => byKey().get(k)).filter(f => f && f.poster).slice(0, 4).map(f => f.poster);
      const rank = l => (l.source === 'matinee' ? 0 : l.source === 'letterboxd' ? 1 : 2);
      return lists
        .map(l => ({ id: l.id, name: l.name, description: l.description || '', source: l.source || 'matinee', count: l.films.length, covers: covers(l), created: l.created || null,
          owner: l.owner || '', status: l.source === 'letterboxd' ? l.status || 'ok' : 'ok', fetchedAt: l.fetchedAt || null }))
        .sort((a, b) => rank(a) - rank(b) || (b.created || '').localeCompare(a.created || '') || a.name.localeCompare(b.name));
    },
    /** One list with its films in list order (summaries; films that aren't resolved yet come back as `outside` cards). */
    getList({ id }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      const src = l.source || 'matinee';
      return {
        id: l.id, name: l.name, description: l.description || '', source: src, editable: src === 'matinee',
        owner: l.owner || '', url: src === 'letterboxd' ? l.url || null : (l.url || null), status: src === 'letterboxd' ? l.status || 'ok' : 'ok',
        fetchedAt: l.fetchedAt || null, lastSeen: l.fetchedAt || null, notes: l.notes || {}, truncated: !!l.truncated,
        history: (l.history || []).slice(-20).reverse().map(h => ({ at: h.at, back: !!h.back, linked: !!h.linked, added: nameKeys(h.added), removed: nameKeys(h.removed) })),
        debug: { url: l.url || null, shortUrl: l.shortUrl || null, fetchedAt: l.fetchedAt || null, checkedAt: l.checkedAt || null, pagesRead: l.pages ?? null, status: l.status || null, missCount: l.missCount ?? null, reason: l.reason || null },
        films: l.films.map(k => byKey().get(k)).filter(Boolean),
      };
    },
    /** Create or update one of your own lists. Other lists can't be changed (use copyList). films = ordered film keys. */
    saveList({ id, name, description, films }) {
      let l = id ? store.library.lists[id] : null;
      if (l && l.source !== 'matinee') throw readOnly(l);
      if (!l) {
        l = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: 'New list', description: '', films: [], notes: {}, source: 'matinee', created: new Date().toISOString() };
        store.library.lists[l.id] = l;
      }
      if (name != null) l.name = String(name).trim() || 'Untitled list';
      if (description != null) l.description = String(description).trim();
      if (films) { l.films = [...new Set(films.filter(k => store.films[k]))]; for (const k of l.films) userFilm(store, k); }
      store.touch('library'); emit('library');
      return { id: l.id, name: l.name, count: l.films.length };
    },
    deleteList({ id }) {
      const l = store.library.lists[id];
      if (!l) return { ok: false };
      if (l.source === 'letterboxd') throw Object.assign(new Error('This list follows Letterboxd. Use Unfollow to stop following it.'), { code: 'read-only' });
      if (l.source !== 'matinee') throw Object.assign(new Error('Imported lists come back with your next import. Make a copy to keep your own version.'), { code: 'read-only' });
      delete store.library.lists[id]; store.touch('library'); emit('library'); return { ok: true };
    },
    /** Make an editable copy of any list. */
    copyList({ id }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      const made = methods.saveList({ name: `${l.name} (copy)`, description: l.description, films: l.films });
      const c = store.library.lists[made.id];
      if (l.notes) c.notes = { ...l.notes };
      return made;
    },
    /** Add (on: true) or remove (on: false) one film in one of your own lists. Adding goes to the end. */
    setInList({ id, key, on }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      if (l.source !== 'matinee') throw readOnly(l);
      if (on && store.films[key] && !l.films.includes(key)) { l.films.push(key); userFilm(store, key); }
      if (!on) { l.films = l.films.filter(k => k !== key); if (l.notes) delete l.notes[key]; }
      store.touch('library'); emit('library');
      return { ok: true, count: l.films.length };
    },

    /** Add several films to one of your own lists at once (kept in order, duplicates ignored). */
    addToList({ id, keys = [] }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      if (l.source !== 'matinee') throw readOnly(l);
      const before = l.films.length;
      for (const k of keys) if (store.films[k] && !l.films.includes(k)) { l.films.push(k); userFilm(store, k); }
      if (l.films.length !== before) { store.touch('library'); emit('library'); }
      return { added: l.films.length - before, count: l.films.length };
    },
    /** A note on one film in one of your own lists (it becomes the Review column when you export). Empty text clears it. */
    setListNote({ id, key, text }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      if (l.source !== 'matinee') throw readOnly(l);
      if (!l.films.includes(key)) throw Object.assign(new Error('That film is not on this list.'), { code: 'not-found' });
      l.notes = l.notes || {};
      const t = String(text ?? '').trim().slice(0, 2000);
      if (t) l.notes[key] = t; else delete l.notes[key];
      store.touch('library'); emit('library');
      return { ok: true };
    },
    /** The CSV Letterboxd's list importer reads, for any list: { filename, csv, count }. */
    exportList({ id }) {
      const l = store.library.lists[id];
      if (!l) throw Object.assign(new Error('That list no longer exists.'), { code: 'not-found' });
      const rows = l.films.map(k => byKey().get(k)).filter(Boolean).map(f => ({
        slug: f.slug || null, tmdb: f.ids?.tmdb ?? null, imdb: f.ids?.imdb ?? null, title: f.title, year: f.year,
        directors: (f.directors || []).map(d => d.name), note: (l.notes || {})[f.key] || '',
      }));
      return { filename: csvFilename(l.name), csv: listCsv(rows), count: rows.length };
    },
    /** Follow a Letterboxd list from a boxd.it or letterboxd.com link. Throws a plain-English error when it can't be read. */
    async followList({ url }) {
      const r = await followList({ store, http, now: nowMs() }, url);
      emit('library'); // the new films are library films now; the film cards ask for their details as they show
      return r;
    },
    /** Read one followed list again now. */
    async refreshList({ id }) {
      const r = await refreshList({ store, http, now: nowMs(), problems }, id);
      emit('library');
      return r;
    },
    async refreshLists() { const r = await refreshDueLists({ store, http, now: nowMs(), problems }, { force: true }); emit('library'); return r; },
    /** After exporting and importing on Letterboxd: paste the new list's link and Matinee follows it from then on (same list, same id). */
    async linkList({ id, url }) {
      const r = await linkList({ store, http, now: nowMs() }, id, url);
      emit('library');
      return r;
    },
    /** Keep a followed list as your own: its films and notes stay, Matinee stops reading Letterboxd. */
    unlinkList({ id }) { const r = unlinkList({ store }, id); emit('library'); return r; },
    /** Stop following a Letterboxd list. Its films stay in your library. */
    unfollowList({ id }) { const r = unfollowList({ store }, id); emit('library'); return r; },

    // ---------- settings ----------
    async testKey({ provider, key }) {
      const p = provById(provider);
      if (!p || !p.validateKey) return { ok: false, message: 'Unknown source.' };
      return checkKey(p, String(key || '').trim());
    },
    /** Test the key already saved for a source (the "Test again" button). Starts a run if it had been rejected and now works. */
    async retestKey({ provider }) {
      const p = provById(provider);
      const key = (store.library.settings.keys || {})[provider];
      if (!p || !p.validateKey || !key) return { ok: false, message: 'There is no key saved for that source.' };
      const v = await checkKey(p, key);
      const wasRejected = store.library.settings.keyStatus?.[provider]?.state === 'rejected';
      setKeyStatus(provider, v.ok ? { state: 'ok', testedAt: new Date().toISOString(), message: v.message, lastError: null } : { state: /reach|problem answering/i.test(v.message) ? 'unreachable' : 'rejected', testedAt: new Date().toISOString(), message: v.message });
      emit('state');
      if (v.ok && wasRejected) { for (const f of Object.values(store.films)) { if (f.checked) delete f.checked[provider]; if (f.missed) delete f.missed[provider]; if (f.failed) delete f.failed[provider]; } startJob('refresh', signal => runEnrichment(signal)); }
      return v;
    },
    async setSettings({ keys, region, regionFromSystem = false, theme, username, debug, motion, feelColours, friendCode }) {
      // Friend code (onboarding "Enter friend code", Settings → Letterboxd): the right one turns Dendy Newtown on; a wrong one changes nothing.
      if (friendCode != null) {
        const code = String(friendCode).trim();
        const st = store.library.settings;
        if (!code) {
          delete st.friendCode; st.dendy = false;
          cinemaCtl?.abort(); trouble.resolve('cinema:dendy');
          store.touch('library'); emit('state'); emit('cinema', { ok: true, error: null, fetched: 0 });
          return { ok: true, dendy: false };
        }
        if (code !== FRIEND_CODE) return { ok: false, message: 'Invalid code! :c' };
        const was = st.dendy === true;
        st.friendCode = code; st.dendy = true;
        store.touch('library'); emit('state');
        if (!was && Object.keys(store.films).length) cinemaRead().catch(() => { /* cinemaRead reports its own failure and never rejects */ });
        return { ok: true, dendy: true };
      }
      // feel colours (Settings → Appearance): on unless switched off, so only 'off' is stored
      if (feelColours != null) { if (feelColours) delete store.library.settings.feelColours; else store.library.settings.feelColours = 'off'; store.touch('library'); emit('state'); }
      if (motion != null) { if (motion !== 'less' && motion !== 'system') throw badRequest("That motion setting isn't available."); if (motion === 'less') store.library.settings.motion = 'less'; else delete store.library.settings.motion; store.touch('library'); emit('state'); }
      if (debug != null) { store.library.settings.debug = !!debug; store.touch('library'); emit('state'); }
      if (region != null && region !== '' && !(typeof region === 'string' && /^[A-Za-z]{2}$/.test(region))) throw badRequest("That region isn't valid.");
      if (theme != null && theme !== '' && !THEMES.has(theme)) throw badRequest("That theme isn't available.");
      if (keys != null && (typeof keys !== 'object' || Array.isArray(keys))) throw badRequest("Those keys weren't valid.");
      const s = store.library.settings;
      if (keys) {
        for (const [id, key] of Object.entries(keys)) {
          const k = String(key || '').trim();
          if (!k) { delete s.keys[id]; if (s.keyStatus) delete s.keyStatus[id]; continue; }
          const p = provById(id);
          if (!p) continue; // not a source Matinee knows
          let v = { ok: true, message: 'Saved.' };
          if (p && p.validateKey) { v = await checkKey(p, k); if (!v.ok) return v; }
          s.keys[id] = k;
          setKeyStatus(id, { state: 'ok', testedAt: new Date().toISOString(), message: v.message, lastError: null });
          // A new key means films can be filled in from this source now.
          for (const f of Object.values(store.films)) { if (f.checked) delete f.checked[id]; if (f.missed) delete f.missed[id]; if (f.failed) delete f.failed[id]; }
        }
      }
      let regionChanged = false;
      if (region && !(regionFromSystem && s.regionChosen)) {
        const r = region.toUpperCase();
        regionChanged = r !== (s.region || 'AU');
        s.region = r;
        if (!regionFromSystem) s.regionChosen = true;
        // Release dates and age ratings are read for the country: TMDB reads each film again (nothing is blanked meanwhile).
        if (regionChanged) for (const f of Object.values(store.films)) if (f.checked) delete f.checked.tmdb;
      }
      if (theme) s.theme = theme;
      if (username != null) store.library.user = { ...(store.library.user || {}), username: String(username).trim().replace(/^@/, '').slice(0, 60) };
      store.touch('library'); store.touch('films'); emit('state');
      if (keys || (regionChanged && (s.keys || {}).tmdb && Object.keys(store.films).length)) {
        // Films are queued for the new key (or country) straight away; if a run is already going, a fresh one follows it.
        if (startJob('refresh', signal => runEnrichment(signal)).started === false) rerunEnrichment = true;
      }
      return { ok: true, message: keys && Object.values(keys).some(k => String(k || '').trim()) ? 'Working. Matinee is filling in films now.' : 'Saved.' };
    },
    exportBackup() {
      try { store.flush(); } catch { /* store.onError has reported it; the backup is built from memory, so it is still complete */ }
      // API keys stay out of the file (makeBackup): it's meant to be kept and may be shared.
      return { filename: `matinee-backup-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(makeBackup(store), null, 1) };
    },
    /** Restore a backup made by exportBackup (onboarding: "Import data from Matinee on another device"). Args { json }. */
    importBackup({ json } = {}) {
      if (typeof json === 'string' && json.length > MAX_INPUT_BYTES) throw badRequest("That file isn't a Matinee backup.");
      const parsed = parseBackup(json); // throws the friendly message before anything changes
      let summary;
      try {
        rerunEnrichment = false; stopQuiet(); if (job) job.controller.abort(); stopFetchNow(); stopFilmRuns();
        summary = restoreBackup(store, parsed);
      } catch (e) { problems.report({ area: 'Backup', message: "Matinee couldn't restore that backup.", error: e, level: 'error' }); throw badRequest("Matinee couldn't restore that backup. Your Letterboxd export will work instead."); }
      try { store.flush(); } catch { /* store.onError has reported it; the store retries */ }
      emit('library'); emit('state');
      if (startJob('import', signal => runRefresh(signal)).started === false) rerunEnrichment = true;
      return summary;
    },
    // Start over: everything goes except how Matinee looks and is set up (look, country, username, friend code, keys), so there is nothing to ask again.
    resetAll() {
      rerunEnrichment = false; stopQuiet(); if (job) job.controller.abort(); stopFetchNow(); stopFilmRuns(); people.stop();
      const s = store.library.settings || {};
      const kept = {};
      for (const k of KEPT_ON_RESET) if (s[k] !== undefined) kept[k] = JSON.parse(JSON.stringify(s[k]));
      const username = store.library.user && store.library.user.username;
      store.reset();
      Object.assign(store.library.settings, kept);
      if (!store.library.settings.keys) store.library.settings.keys = {};
      if (username) store.library.user = { username };
      store.touch('library');
      try { store.flush(); } catch { /* store.onError has reported it; the store retries */ }
      emit('library'); emit('state'); return { ok: true };
    },
  };

  return {
    store,
    async call(method, args = {}) {
      const fn = Object.hasOwn(methods, method) ? methods[method] : null;
      if (!fn) throw Object.assign(new Error(`Unknown method ${method}`), { code: 'unknown-method' });
      return fn(args || {});
    },
    methods: Object.keys(methods),
    close() { closed = true; clearTimeout(memoTimer); memoTimer = null; clearTimeout(feelWarm); rerunEnrichment = false; stopQuiet(); if (job) job.controller.abort(); stopFetchNow(); stopFilmRuns(); if (testRun) testRun.controller.abort(); if (cinemaCtl) cinemaCtl.abort(); people.stop(); if (feelMemo.dirty) { feelMemo.dirty = false; memoFile.saveSync(feelMemo); } problems.flush(); try { store.flush(); } catch (e) { problems.report({ area: 'Saving', message: "Matinee couldn't save your data while closing.", error: e }); problems.flush(); } },
  };
}
