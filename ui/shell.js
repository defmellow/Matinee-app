// Small pure helpers for the app shell (kept apart from the components so node tests can import them).

/** Latest-call-wins guard: `next()` starts a call, `current(id)` says whether it is still the newest; `cancel()` drops all in flight. */
export function makeSeq() {
  let n = 0;
  return { next: () => ++n, current: id => id === n, cancel: () => { n++; } };
}

/** Theme preference cached for the first paint: only the fixed themes are worth caching (system follows the computer). */
export const THEME_KEY = 'matinee.theme';
export const CACHEABLE = ['light', 'dark', 'neutral', 'neutral-light'];
export function cachedTheme(storage) {
  try { const t = storage && storage.getItem(THEME_KEY); return CACHEABLE.includes(t) ? t : null; } catch { return null; }
}
export function cacheTheme(storage, t) {
  try { if (CACHEABLE.includes(t)) storage.setItem(THEME_KEY, t); else storage.removeItem(THEME_KEY); } catch { /* storage may be blocked */ }
}

/** "Less motion" cached for the first paint, like the theme. */
export const MOTION_KEY = 'matinee.motion';
export function cachedMotion(storage) { try { return storage && storage.getItem(MOTION_KEY) === 'less' ? 'less' : null; } catch { return null; } }
export function cacheMotion(storage, m) { try { if (m === 'less') storage.setItem(MOTION_KEY, 'less'); else storage.removeItem(MOTION_KEY); } catch { /* storage may be blocked */ } }

const TITLES = { tonight: 'Tonight', library: 'Library', feel: 'By feel', discover: 'Discover', upcoming: 'Upcoming', diary: 'Diary', insights: 'Insights', map: 'Map', settings: 'Settings', film: 'Film', person: 'Person', year: 'Year in review', welcome: 'Welcome' };
export function routeTitle(name) { return `${TITLES[name] || 'Library'} - Matinee`; }
