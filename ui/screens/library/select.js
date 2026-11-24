// Library "Select" mode: pure helpers (range picking, summarising a selection, suggestions, toast wording).
import { plural } from '../../format.js';

/** Keys from `anchor` to `key` inclusive, in `order`. Falls back to just [key] when the anchor isn't in the order. */
export function rangeKeys(order, anchor, key) {
  const a = order.indexOf(anchor), b = order.indexOf(key);
  if (b < 0) return [];
  if (a < 0) return [key];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** A new Set with `keys` switched on (on = true) or off. */
export function withKeys(selected, keys, on) {
  const next = new Set(selected);
  for (const k of keys) { if (on) next.add(k); else next.delete(k); }
  return next;
}

/** Keep only selected keys that are still in the library. Returns the same Set when nothing changed. */
export function pruneKeys(selected, byKey) {
  let drop = false;
  for (const k of selected) if (!byKey.has(k)) { drop = true; break; }
  return drop ? new Set([...selected].filter(k => byKey.has(k))) : selected;
}

/** Identifies the query and view mode, so the Library only resets its scroll window when they really change. */
export const querySignature = (q, mode) => JSON.stringify([q, mode]);

/**
 * Summarise a selection. `byKey` is a Map of key → film. Keys no longer in the library are ignored.
 * tagUnion lists the tags on the selected WATCHLIST films (the only ones that can change), most common first.
 */
export function summarise(byKey, selected) {
  let watchlistCount = 0, watchedCount = 0;
  const counts = new Map();
  for (const key of selected) {
    const f = byKey.get(key);
    if (!f) continue;
    if (f.user && f.user.watchlist) {
      watchlistCount++;
      for (const t of f.user.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    } else watchedCount++;
  }
  const tagUnion = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { total: watchlistCount + watchedCount, watchlistCount, watchedCount, tagUnion };
}

/** Existing tag names that match what's being typed (prefix matches first), skipping blanks. */
export function suggestTags(names, input, limit = 8) {
  const q = String(input || '').trim().toLowerCase();
  const all = [...new Set(names)];
  if (!q) return all.slice(0, limit);
  const starts = all.filter(n => n.toLowerCase().startsWith(q));
  const has = all.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...starts, ...has].slice(0, limit);
}

/** The note under the tag actions when the selection includes watched films. null when there's nothing to say. */
export function watchedNote({ total, watchlistCount }) {
  return total > 0 && watchlistCount < total ? `Tags apply to watchlist films only — ${watchlistCount} of ${total} selected.` : null;
}

const skippedText = n => (n ? ` ${plural(n, 'watched film')} ${n === 1 ? 'was' : 'were'} skipped.` : '');

/** Toast after tagFilms. result = { changed, skipped }. */
export function tagToast({ add, remove }, { changed, skipped }) {
  const tag = add || remove;
  const rest = skippedText(skipped);
  if (!changed) return (add ? `Those films already have '${tag}'.` : `None of those films had '${tag}'.`) + rest;
  return (add ? `Tagged ${plural(changed, 'film')} '${tag}'.` : `Removed '${tag}' from ${plural(changed, 'film')}.`) + rest;
}
