// Pure helpers for keeping the shared library list up to date without reloading all of it.
// No DOM, no Preact: unit-tested in test/unit/library-patch.test.js.

/** Largest number of films asked for in one getSummaries call. */
export const PATCH_CHUNK = 50;

/** True when a 'library' event payload carries a list of changed film keys (otherwise anything may have changed). */
export const isKeyed = payload => !!payload && Array.isArray(payload.keys);

/** Should something showing film `key` refresh for this event? Keyless events always do. */
export const touchesKey = (payload, key) => !isKeyed(payload) || payload.keys.includes(key);

/**
 * What the library list should do about a 'library' event: 'full' (reload everything) or 'patch' (fetch just those films).
 * Keyless events and ones arriving when the last full reload is `fullEvery` ms old or more go 'full'.
 */
export function libraryAction(payload, { now, lastFull, fullEvery }) {
  if (!isKeyed(payload)) return 'full';
  return now - lastFull >= fullEvery ? 'full' : 'patch';
}

/** Split a list into runs of at most `size`. */
export function chunk(list, size = PATCH_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Put updated summaries into a films array: each one replaces the film with the same key (position kept);
 * ones not there yet go on the end. Films that were not updated keep the very same object, so memoised rows stay put.
 * Returns the original array when nothing changed.
 */
export function patchFilms(films, updates) {
  if (!updates || !updates.length) return films;
  const at = new Map(films.map((f, i) => [f.key, i]));
  const next = films.slice();
  for (const u of updates) {
    if (!u || u.key == null) continue;
    if (at.has(u.key)) next[at.get(u.key)] = u; else { at.set(u.key, next.length); next.push(u); }
  }
  return next;
}
