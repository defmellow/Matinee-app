// Shared UI state hooks. The library is fetched once, shared by every screen, and refreshed when the
// core says it changed (throttled so a running import doesn't thrash the UI).
import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { call, on } from './api.js';
import { makeSeq } from './shell.js';
import { libraryAction, patchFilms, PATCH_CHUNK } from './libraryPatch.js';

/** Subscribe to a core event for the lifetime of a component. */
export function useEvent(event, fn) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => on(event, p => ref.current(p)), [event]);
}

// Background refreshes (films filling in while you browse) wait until you stop scrolling, so a 3 MB library
// reload never lands mid-scroll.
let lastScroll = 0;
if (typeof addEventListener === 'function') {
  addEventListener('scroll', () => { lastScroll = Date.now(); }, true);
  addEventListener('wheel', () => { lastScroll = Date.now(); }, { capture: true, passive: true });
}
export function whenIdle(fn, quiet = 400) {
  const wait = lastScroll + quiet - Date.now();
  if (wait > 0) setTimeout(() => whenIdle(fn, quiet), wait + 20); else fn();
}

/**
 * Run an async API call; re-runs when deps change. Returns { data, error, loading, reload }.
 * `refreshOn`: an event name ('library'), or { event, when } where `when(payload)` decides whether this event matters
 * (e.g. { event: 'library', when: p => touchesKey(p, key) } for a page about one film).
 */
export function useCall(method, args = {}, deps = [], { refreshOn = null } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(null); if (!seq.current) seq.current = makeSeq();
  // Only the newest call may land. A background refresh that fails keeps the page that is already showing.
  const start = useCallback(keep => {
    const id = seq.current.next();
    setState(s => ({ ...s, loading: true }));
    call(method, args).then(
      data => { if (seq.current.current(id)) setState({ data, error: null, loading: false }); },
      error => { if (seq.current.current(id)) setState(s => ({ data: keep ? s.data : null, error, loading: false })); });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useCallback(() => start(false), [start]);
  useEffect(() => { start(false); return () => seq.current.cancel(); }, [start]);
  const startRef = useRef(start); startRef.current = start;
  const refresh = useRef(null);
  if (!refresh.current) refresh.current = throttle(() => whenIdle(() => startRef.current(true)), 3000);
  const event = !refreshOn ? '__none__' : typeof refreshOn === 'string' ? refreshOn : refreshOn.event;
  const when = refreshOn && typeof refreshOn === 'object' ? refreshOn.when : null;
  useEvent(event, payload => { if (!when || when(payload)) refresh.current(); });
  return { ...state, reload: run };
}

// ---- core state (job progress, counts, settings) ----
let coreState = null; const coreSubs = new Set();
function setCore(s) { coreState = s; coreSubs.forEach(f => f(s)); }
let coreLoading = null;
// If the very first load fails (the core is still starting) try again a couple of times, then let the app say so.
let coreFails = 0, coreFailed = false; const failSubs = new Set();
function setFailed(v) { if (coreFailed !== v) { coreFailed = v; failSubs.forEach(f => f(v)); } }
export function refreshCore() {
  const p = call('getState')
    .then(s => { coreFails = 0; setFailed(false); setCore(s); })
    .catch(() => { // api.call has already recorded the failure
      if (coreState) return;
      if (++coreFails <= 2) setTimeout(refreshCore, 1200 * coreFails); else setFailed(true);
    })
    .finally(() => { if (coreLoading === p) coreLoading = null; });
  coreLoading = p;
  return p;
}
/** "Try again" after the core could not be reached. */
export function retryCore() { coreFails = 0; setFailed(false); return refreshCore(); }
/** True once the first load has failed for good. */
export function useCoreFailed() {
  const [f, set] = useState(coreFailed);
  useEffect(() => { failSubs.add(set); set(coreFailed); return () => failSubs.delete(set); }, []);
  return f;
}

/** Re-renders only when `pick(coreState)` changes; no event listeners, so it is cheap to use in many places. */
export function useCoreSelect(pick) {
  const [v, set] = useState(() => (coreState ? pick(coreState) : undefined));
  useEffect(() => { const f = st => set(st ? pick(st) : undefined); coreSubs.add(f); f(coreState); return () => coreSubs.delete(f); }, []);
  return v;
}

export function useCore() {
  const [s, set] = useState(coreState);
  useEffect(() => { coreSubs.add(set); if (!coreState && !coreLoading) refreshCore(); return () => coreSubs.delete(set); }, []);
  useEvent('progress', p => { if (coreState) setCore({ ...coreState, job: p.phase === 'done' ? null : p }); if (p.phase === 'done') refreshCore(); });
  useEvent('state', () => refreshCore());
  return s;
}

// ---- library (all film summaries) ----
// Two ways to stay current while films fill in:
//  - a keyless 'library' event (import, edits, reset, end of a run): reload everything (throttled, and not mid-scroll);
//  - a keyed one ({ keys }): fetch just those films' summaries and patch them into `lib.films`.
// Patching leaves the rest of what getLibrary returns (tag and auto-tag counts, facets, views, list counts) as it was.
// That is safe because films filling in only change the film summaries; the counts can be a little behind (a genre or
// auto-tag count off by a few) until the full reload, which keyed events trigger at most every FULL_EVERY ms and the
// end of a run always triggers. User edits (tags, lists, views) are keyless, so they never wait.
const FULL_EVERY = 60000, PATCH_WAIT = 400;
let lib = null; let libPromise = null; const libSubs = new Set();
let epoch = 0;            // bumps when a full reload starts or lands, so a patch fetched across one is not applied
let lastFull = 0;
let pending = new Set(), patchTimer = null, patching = false;

let libError = null; const libErrSubs = new Set();
function setLibError(e) { libError = e; libErrSubs.forEach(f => f(e)); }
/** The error from the last library load, or null. Lets the Library say so (and Debug mode show why) instead of loading forever. */
export function useLibraryError() {
  const [e, set] = useState(libError);
  useEffect(() => { libErrSubs.add(set); set(libError); return () => libErrSubs.delete(set); }, []);
  return e;
}

export function reloadLibrary() {
  epoch++; lastFull = Date.now(); pending = new Set();
  // A failed reload keeps what is showing (api.call has recorded it); the next library event tries again.
  libPromise = call('getLibrary').then(d => { epoch++; lib = d; setLibError(null); libSubs.forEach(f => f(d)); return d; }, e => { setLibError(e); return lib; }).finally(() => { libPromise = null; });
  return libPromise;
}
const throttledReload = throttle(() => whenIdle(reloadLibrary), 4000);

async function patchPending() {
  if (patching) return; patching = true;
  try {
    while (pending.size && lib) {
      if (libPromise) { await libPromise.catch(() => {}); continue; } // a full reload is already bringing everything up to date
      const keys = [...pending].slice(0, PATCH_CHUNK);
      for (const k of keys) pending.delete(k);
      const at = epoch;
      let res;
      try { res = await call('getSummaries', { keys }); } catch { continue; } // recorded by api.call; the next full reload catches these films up
      if (at !== epoch || !lib) { for (const k of keys) pending.add(k); continue; } // a reload landed meanwhile: ask again
      lib = { ...lib, films: patchFilms(lib.films, res.films) };
      libSubs.forEach(f => f(lib));
    }
  } finally { patching = false; }
}
function schedulePatch() {
  if (patchTimer) return;
  patchTimer = setTimeout(() => { patchTimer = null; whenIdle(patchPending); }, PATCH_WAIT);
}

on('library', payload => {
  if (!libSubs.size) { lib = null; return; }
  // 'full' also refreshes the counts, and covers these keys
  if (libraryAction(payload, { now: Date.now(), lastFull, fullEvery: FULL_EVERY }) === 'full') { throttledReload(); return; }
  for (const k of payload.keys) pending.add(k);
  if (pending.size) schedulePatch();
});

export function useLibrary(enabled = true) {
  const [data, set] = useState(lib);
  useEffect(() => {
    if (!enabled) return;
    set(lib); libSubs.add(set); if (!lib && !libPromise) reloadLibrary(); return () => libSubs.delete(set);
  }, [enabled]);
  return data; // null while loading: { films: [summary], tags, autoTags, views, facets }
}

// ---- toasts ----
const toastSubs = new Set();
export function toast(message) { toastSubs.forEach(f => f(message)); }
export function useToasts() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { let t; const f = m => { setMsg(m); clearTimeout(t); t = setTimeout(() => setMsg(null), 3200); }; toastSubs.add(f); return () => toastSubs.delete(f); }, []);
  return msg;
}

/** Persist small view preferences (grid size, last filter) per screen. */
export function usePref(key, initial) {
  const [v, set] = useState(() => { try { const s = localStorage.getItem('pref:' + key); return s ? JSON.parse(s) : initial; } catch { return initial; } });
  const save = useCallback(nv => { set(prev => { const val = typeof nv === 'function' ? nv(prev) : nv; try { localStorage.setItem('pref:' + key, JSON.stringify(val)); } catch { /* ignore */ } return val; }); }, [key]);
  return [v, save];
}

// Remembered for the session: filters, tabs and the like survive going into a film and back.
// Held in memory, mirrored to sessionStorage. `key` must be unique per screen ("feel.filters").
const memory = new Map();
const readSession = key => {
  if (memory.has(key)) return { found: true, value: memory.get(key) };
  try { const s = sessionStorage.getItem('rs:' + key); if (s != null) { const value = JSON.parse(s); memory.set(key, value); return { found: true, value }; } } catch { /* ignore */ }
  return { found: false };
};
/** Like useState, but the value comes back when the screen is opened again. Values must be JSON-safe. */
export function useRestoredState(key, initial) {
  const [v, set] = useState(() => { const r = readSession(key); return r.found ? r.value : (typeof initial === 'function' ? initial() : initial); });
  const save = useCallback(nv => {
    set(prev => {
      const val = typeof nv === 'function' ? nv(prev) : nv;
      memory.set(key, val);
      try { sessionStorage.setItem('rs:' + key, JSON.stringify(val)); } catch { /* ignore */ }
      return val;
    });
  }, [key]);
  return [v, save];
}

export function throttle(fn, ms) {
  let t = null, pending = false;
  return (...a) => {
    if (t) { pending = true; return; }
    fn(...a);
    t = setTimeout(() => { t = null; if (pending) { pending = false; fn(...a); } }, ms);
  };
}
