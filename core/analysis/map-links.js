// The Map's lines, worked out for the films on show. Shared by the core (the whole library) and the Map screen, which works them out
// again whenever a view (Watched, Watchlist, orphans) hides films: a line to a hidden film would vanish, and a film whose closest
// matches are all hidden would sit with no lines at all (20 Nov: lines only appeared once a film was clicked).

/**
 * @param lists lists[i] = [[j, s], ...] film i's closest films, strongest first (ties: lower index first)
 * @param keep i -> boolean, the films on show (default all)
 * @param o { top: lines per film, floor: a line past a film's first must be at least this alike }
 * @returns [[a, b, s]] with a < b, each pair once
 */
export function topLinks(lists, keep = () => true, { top = 5, floor = 0 } = {}) {
  const seen = new Set(), links = [], n = lists.length;
  for (let i = 0; i < n; i++) {
    if (!keep(i)) continue;
    let r = 0;
    for (const [j, s] of lists[i] || []) {
      if (r >= top) break;
      if (j == null || j === i || !keep(j)) continue;
      if (r++ > 0 && s < floor) continue;
      const a = Math.min(i, j), b = Math.max(i, j), id = a * n + b;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push([a, b, s]);
    }
  }
  return links;
}
