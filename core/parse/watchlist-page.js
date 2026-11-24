// A member's public Letterboxd watchlist page (/<user>/watchlist/by/added/), newest added first.
// The page is a poster grid, so this wraps the shared grid parser and adds the "is this really the watchlist" check.
import { parsePosterGrid, isChallenge } from './letterboxd.js';

/**
 * @param {string} html
 * @returns {{ ok: boolean, challenge?: boolean, items: { slug: string, title: string, year: number|null, filmId: number|null }[], hasNext: boolean }}
 *   ok is false for a check page or anything that isn't a poster grid; items are in page order (newest added first).
 */
export function parseWatchlistPage(html) {
  const text = String(html || '');
  if (isChallenge(text) || /<title[^>]*>\s*(?:Attention Required|Access denied)/i.test(text)) return { ok: false, challenge: true, items: [], hasNext: false };
  const grid = parsePosterGrid(text);
  const items = grid.items.filter(i => i.slug).map(i => ({ slug: i.slug, title: i.title, year: i.year ?? null, filmId: i.lbId ?? null }));
  // An empty watchlist still has the grid markup; a page without it (an error page, a changed layout) is not trusted.
  const ok = items.length > 0 || /class="[^"]*\bposter-list\b|data-num-entries/.test(text);
  return { ok, items, hasNext: ok && grid.hasNext };
}
