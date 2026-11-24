// Tiny hash router: #/library, #/film/<key>, #/person/<id>, #/diary, #/map, #/tonight, #/insights, #/settings, #/welcome
import { useEffect, useState } from 'preact/hooks';

/** decodeURIComponent that never throws: a bad %-escape keeps the raw text. */
export function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

export function parse(hash = location.hash) {
  const [pathPart, qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const [name = 'library', ...rest] = pathPart.split('/');
  return { name: name || 'library', param: rest.map(safeDecode).join('/') || null, qs };
}

/** '?role=cast' or 'role=cast' -> { role: 'cast' } */
export const queryOf = qs => Object.fromEntries(new URLSearchParams(qs || ''));

export function useRoute() {
  const [route, set] = useState(parse());
  useEffect(() => {
    const f = () => set(parse());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return route;
}

/** Whether the browser-style history can step back or forward (Chromium's Navigation API; both true where it's missing). */
export function useHistoryState() {
  const read = () => { const n = window.navigation; return n && typeof n.canGoBack === 'boolean' ? { back: n.canGoBack, forward: n.canGoForward } : { back: true, forward: true }; };
  const [st, set] = useState(read);
  useEffect(() => {
    const f = () => set(read());
    const n = window.navigation;
    if (n && n.addEventListener) n.addEventListener('currententrychange', f);
    addEventListener('hashchange', f);
    return () => { if (n && n.removeEventListener) n.removeEventListener('currententrychange', f); removeEventListener('hashchange', f); };
  }, []);
  return st;
}
export function forward() { fresh = false; history.forward(); }

/** go('film', key) or go('library') */
export function go(name, param, query) {
  markFresh();
  location.hash = href(name, param, query);
}
export function back() { if (history.length > 1) { fresh = false; history.back(); } else go('library'); }
/** href('person', id, { role: 'director' }) -> '#/person/<id>?role=director' (empty values are left out). */
export const href = (name, param, query) => {
  const qs = new URLSearchParams(Object.entries(query || {}).filter(([, v]) => v != null && v !== '')).toString();
  return '#/' + name + (param != null ? '/' + encodeURIComponent(param) : '') + (qs ? '?' + qs : '');
};

// ---- scroll restore ----
// The screens scroll inside <main>. We remember each route's scroll position; going Back (or Forward) puts it back,
// while a fresh click on a link (sidebar, film card...) starts at the top.
const positions = new Map(); // route key -> scrollTop
const routeKey = (hash = location.hash) => hash.replace(/^#\/?/, '') || 'library';
let fresh = true; // true unless the last move was Back/Forward

/** Mark the next route change as a fresh visit (links do this automatically; go() too). */
export function markFresh() { fresh = true; }

/** Wire up scroll memory for the scrolling element. Call once; returns a cleanup function. */
export function installScrollRestore(el) {
  let current = routeKey();
  let stop = null;
  const cancel = () => { if (stop) { stop(); stop = null; } };
  const onScroll = () => { positions.set(current, el.scrollTop); };
  const onClick = e => { const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (a) fresh = true; };
  // The page may still be filling in (library loading, results arriving): keep nudging until it is tall enough.
  const restore = target => {
    cancel();
    let raf = 0; const t0 = Date.now();
    const user = () => cancel();
    let lastH = -1, since = Date.now();
    const tick = () => {
      if (el.scrollHeight !== lastH) { lastH = el.scrollHeight; since = Date.now(); }
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
      // done once we're there and the page has stopped growing (results often arrive after the first paint)
      if ((Math.abs(el.scrollTop - target) <= 1 && Date.now() - since > 800) || Date.now() - t0 > 3000) { cancel(); return; }
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener('wheel', user, { passive: true }); el.addEventListener('touchstart', user, { passive: true }); el.addEventListener('keydown', user);
    stop = () => { cancelAnimationFrame(raf); el.removeEventListener('wheel', user); el.removeEventListener('touchstart', user); el.removeEventListener('keydown', user); };
    raf = requestAnimationFrame(tick);
  };
  const onHash = () => {
    const key = routeKey();
    if (key === current) return;
    const target = fresh ? 0 : positions.get(key) || 0;
    if (fresh) positions.delete(key);
    fresh = false; // the next change is Back/Forward unless a link click says otherwise
    current = key;
    cancel();
    // wait for the new screen to render, then place it
    requestAnimationFrame(() => { if (target > 0) restore(target); else el.scrollTop = 0; });
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onClick, true);
  addEventListener('hashchange', onHash);
  return () => { cancel(); el.removeEventListener('scroll', onScroll); document.removeEventListener('click', onClick, true); removeEventListener('hashchange', onHash); };
}
