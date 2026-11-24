// On-demand fetching: films on screen, hovered or opened are fetched ahead of the background crawl (core fetchNow).
// Reads the film key from each card's link (#/film/<key>), so it needs nothing from the card component itself.
import { useEffect, useState } from 'preact/hooks';
import { call, on } from '../api.js';

const MAX_KEYS = 24, SETTLE_MS = 400, HOVER_MS = 300;
const CARD = 'a.film-card, a.tn-card';
let lastSent = ''; // survives re-renders: the library reloads about once a second during a crawl, which must not re-ask

// ---- "is the app fetching?" for the thin load bar ----
// A tiny module-level counter: beginFetch()/endFetch() pair up, useFetching() reports whether any is open.
let fetching = 0;
const watchers = new Set();
const notify = () => watchers.forEach(f => f(fetching > 0));
export function beginFetch() { fetching++; notify(); }
export function endFetch() { fetching = Math.max(0, fetching - 1); notify(); }
export function useFetching() {
  const [on_, set] = useState(fetching > 0);
  useEffect(() => { watchers.add(set); set(fetching > 0); return () => watchers.delete(set); }, []);
  return on_;
}

// fetchNow answers at once ({ queued }) and the work carries on in the core (there is no "finished" signal), so "in flight"
// means: films were queued and have not all come back yet. Each keyed library update ticks its films off. It ends when
// every queued film has come back, or after a quiet spell with no updates (films with nothing new never report), or after
// 30 s at the latest. The quiet spell is long enough to ride out films waiting behind other work.
const IDLE_MS = 10000, CAP_MS = 30000;
let open = false, idleTimer = 0, capTimer = 0, listening = false;
const waiting = new Set(); // keys queued and not yet reported back
function closeFetch() {
  if (!open) return;
  open = false; waiting.clear(); clearTimeout(idleTimer); clearTimeout(capTimer);
  endFetch();
}
function touchFetch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeFetch, IDLE_MS);
}
function openFetch(keys) {
  if (!listening) {
    listening = true;
    on('library', p => {
      if (!open) return;
      if (p && Array.isArray(p.keys)) { p.keys.forEach(k => waiting.delete(k)); if (!waiting.size) { closeFetch(); return; } }
      touchFetch();
    });
  }
  keys.forEach(k => waiting.add(k));
  if (!open) { open = true; beginFetch(); capTimer = setTimeout(closeFetch, CAP_MS); }
  touchFetch();
}
const ask = (keys, tier, slot) => {
  call('fetchNow', { keys, tier, slot }).then(res => { if (res && res.queued > 0) openFetch(keys); }).catch(() => {}); // recorded by api.call; the film page shows its own source status
};

export const keyOf = el => {
  const m = /^#\/film\/(.+)$/.exec(el.getAttribute('href') || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

/**
 * Attach to a container of poster cards. Once scrolling settles, the cards on screen (up to 24) replace the previous
 * set; resting the pointer on a card fetches that film. `deps` should change when the cards in the container change.
 */
export function useFetchNow(ref, deps) {
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set();
    let settle = null, hover = null;
    const flush = () => {
      const keys = [...root.querySelectorAll(CARD)].filter(el => visible.has(el)).map(keyOf).filter(Boolean).slice(0, MAX_KEYS);
      const id = keys.join('|');
      if (!keys.length || id === lastSent) return;
      lastSent = id;
      ask(keys, 'quick', 'visible');
    };
    const io = new IntersectionObserver(entries => {
      for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
      clearTimeout(settle); settle = setTimeout(flush, SETTLE_MS);
    });
    root.querySelectorAll(CARD).forEach(el => io.observe(el));
    const over = e => {
      const card = e.target.closest && e.target.closest(CARD);
      if (!card || card === hover?.card) return;
      clearTimeout(hover?.timer);
      const key = keyOf(card);
      hover = key ? { card, timer: setTimeout(() => ask([key], 'quick', 'hover'), HOVER_MS) } : null;
    };
    const out = e => {
      if (!hover || (e.relatedTarget && hover.card.contains(e.relatedTarget))) return;
      clearTimeout(hover.timer); hover = null;
    };
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    return () => { io.disconnect(); clearTimeout(settle); clearTimeout(hover?.timer); root.removeEventListener('mouseover', over); root.removeEventListener('mouseout', out); };
  }, deps);
}

