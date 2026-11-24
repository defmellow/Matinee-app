// Pure helpers for what is written on the Map: names that never overlap, the "Around here" note, and the feeling search.

/** Rects overlap (touching edges do not count). */
export const overlaps = (a, b, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * Hands out room one rect at a time. `bounds` ({ w, h }) is the canvas: a rect must lie inside it, so nothing is clipped at the edge.
 * `blocked` are rectangles that are taken (the zoom buttons, the back button). `fits` means inside, not blocked and not overlapping
 * anything placed; `place` keeps a rect if it fits (a `must` one is always kept, and blocks later ones).
 */
export function createPlacer(gap = 2, { bounds = null, blocked = [] } = {}) {
  const kept = [];
  const inside = r => !bounds || (r.x >= 0 && r.y >= 0 && r.x + r.w <= bounds.w && r.y + r.h <= bounds.h);
  const clear = r => inside(r) && !blocked.some(b => overlaps(r, b, 0));
  return {
    kept, inside, clear,
    fits: rect => clear(rect) && !kept.some(k => overlaps(rect, k, gap)),
    place(rect, must = false) {
      if (!must && kept.some(k => overlaps(rect, k, gap))) return false;
      kept.push(rect);
      return true;
    },
  };
}

/**
 * Find room for a label of size tw x th next to a dot at (x, y): beside it (the side with more room first), then above and below.
 * Never outside the canvas or under a blocked rectangle. When nothing is clear of other labels and `crowded` is true (mid-flow), a
 * spot that is only inside the canvas and unblocked is taken; otherwise null (drop it).
 */
export function labelSpot(x, y, tw, th, placer, { crowded = false, preferLeft = false } = {}) {
  const right = { x: x + 11, y: y - th / 2, w: tw, h: th }, left = { x: x - 11 - tw, y: y - th / 2, w: tw, h: th };
  const spots = preferLeft ? [left, right] : [right, left];
  spots.push({ x: x - tw / 2, y: y - th - 12, w: tw, h: th }, { x: x - tw / 2, y: y + 12, w: tw, h: th }, { x: x + 11, y: y - th - 10, w: tw, h: th }, { x: x + 11, y: y + 10, w: tw, h: th }, { x: x - 11 - tw, y: y - th - 10, w: tw, h: th }, { x: x - 11 - tw, y: y + 10, w: tw, h: th });
  return spots.find(r => placer.fits(r)) || (crowded ? spots.find(r => placer.clear(r)) || null : null);
}

/** A name tag beside a poster rect: right of it, left, below, then above. Same rules as labelSpot. */
export function tagSpot(p, tw, th, placer, { crowded = false, preferLeft = false } = {}) {
  const midY = p.y + p.h / 2 - th / 2;
  const right = { x: p.x + p.w + 4, y: midY, w: tw, h: th }, left = { x: p.x - 4 - tw, y: midY, w: tw, h: th };
  const spots = preferLeft ? [left, right] : [right, left];
  spots.push({ x: p.x + p.w / 2 - tw / 2, y: p.y + p.h + 4, w: tw, h: th }, { x: p.x + p.w / 2 - tw / 2, y: p.y - th - 4, w: tw, h: th });
  return spots.find(r => placer.fits(r)) || (crowded ? spots.find(r => placer.clear(r)) || null : null);
}

// Spots a poster may take around its film, nearest first, in half-poster steps (up to a poster and a half away).
const STEPS = (() => {
  const out = [];
  for (let gx = -3; gx <= 3; gx++) for (let gy = -3; gy <= 3; gy++) out.push([gx, gy]);
  return out.sort((a, b) => Math.hypot(a[0], a[1] * 1.45) - Math.hypot(b[0], b[1] * 1.45)); // (a step down is longer than one across)
})();

/**
 * Finds room for posters so none overlap. Each goes on its film if that is free, else where it sat last frame
 * (so posters don't hop while you pan and zoom), else the nearest free spot; with nowhere free nearby it sits on its film.
 * A rect that was moved has `moved: true` (the drawing joins it to its film with a thin line). Bucketed by 64 px cells, so a few
 * hundred posters cost little per frame.
 * @param memo Map film -> spot index from earlier frames (kept by the caller), or null
 */
export function createSpotFinder(blocked = [], gap = 4) {
  const cell = 64, grid = new Map();
  const cellsOf = r => {
    const out = [];
    for (let cx = Math.floor(r.x / cell); cx <= Math.floor((r.x + r.w) / cell); cx++) for (let cy = Math.floor(r.y / cell); cy <= Math.floor((r.y + r.h) / cell); cy++) out.push(cx * 100003 + cy);
    return out;
  };
  const free = r => {
    if (blocked.some(b => overlaps(r, b, 0))) return false;
    for (const k of cellsOf(r)) { const l = grid.get(k); if (l && l.some(o => overlaps(r, o, gap))) return false; }
    return true;
  };
  return {
    place(x, y, w, h, memo = null, id = null) {
      const ux = (w + gap) / 2, uy = (h + gap) / 2;
      const at = k => ({ x: x - w / 2 + STEPS[k][0] * ux, y: y - h / 2 + STEPS[k][1] * uy, w, h });
      const prev = memo ? memo.get(id) : undefined;
      let k = free(at(0)) ? 0 : prev != null && free(at(prev)) ? prev : -1;
      if (k < 0) for (let j = 1; j < STEPS.length; j++) if (free(at(j))) { k = j; break; }
      if (k < 0) k = 0;
      if (memo) memo.set(id, k);
      const r = at(k);
      r.moved = k !== 0;
      for (const key of cellsOf(r)) { let l = grid.get(key); if (!l) grid.set(key, l = []); l.push(r); }
      return r;
    },
  };
}

/**
 * Keep the rects that fit: they are tried in the order given (put what matters first), and one that would overlap an
 * earlier kept one is dropped. `must` rects are always kept (and block later ones). Returns the kept items.
 * @param items [{ x, y, w, h, must? }]
 */
export function placeRects(items, gap = 2) {
  const placer = createPlacer(gap);
  for (const it of items) placer.place(it, it.must);
  return placer.kept;
}

// ---------- plain words ----------
/** "Coming of age" -> "coming of age", but "Ku Klux Klan" stays as it is (a name). */
export const lowerLabel = label => (/[A-Z]/.test(String(label).slice(1)) ? String(label) : String(label).toLowerCase());
export const joinWords = words => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The "Around here" note for the films near the pointer: their three strongest feelings and two strongest themes.
 * @param films keys of the films nearby
 * @param feelOf key -> [[id, score]]; labels id -> [label, facet]
 * @returns { count, text } or null when fewer than `min` films are near
 */
export function aroundHere(films, feelOf, labels, { min = 4 } = {}) {
  if (films.length < min) return null;
  const sums = new Map();
  for (const key of films) for (const [id, score] of feelOf(key) || []) sums.set(id, (sums.get(id) || 0) + score);
  const ranked = [...sums].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).filter(([id]) => labels[id]);
  const feelings = ranked.filter(([id]) => labels[id][1] !== 'theme').slice(0, 3).map(([id]) => lowerLabel(labels[id][0]));
  const themes = ranked.filter(([id]) => labels[id][1] === 'theme').slice(0, 2).map(([id]) => lowerLabel(labels[id][0]));
  const count = `${films.length} films.`;
  if (!feelings.length && !themes.length) return null;
  const head = feelings.length ? `${capital(joinWords(feelings))} films` : 'Films';
  // "coming of age and adolescence" already has an "and": two such themes read better joined with "as well as"
  const about = themes.length === 2 && themes.some(t => / and /.test(t)) ? `${themes[0]} as well as ${themes[1]}` : joinWords(themes);
  const text = `${head}${themes.length ? ` about ${about}` : ''}. ${count}`;
  return { count: films.length, text };
}

// ---------- looking for a feeling or theme ----------
/** The facet names that read as a feeling; the rest of the labels with facet 'theme' are themes. */
export const kindOf = facet => (facet === 'theme' ? 'theme' : 'feeling');

/** How many films have each id (at 0.15 or more), from the map's `feel` table. */
export function countIds(feel, keep = () => true) {
  const n = new Map();
  for (const key of Object.keys(feel)) if (keep(key)) for (const [id] of feel[key]) n.set(id, (n.get(id) || 0) + 1);
  return n;
}

/** Feelings and themes whose names match what was typed (accent- and case-insensitive), most common first. */
export function suggest(text, labels, counts, fold, { limit = 4, min = 2 } = {}) {
  const q = fold(text.trim());
  if (q.length < 2) return { feelings: [], themes: [] };
  const out = { feelings: [], themes: [] };
  const all = Object.entries(labels).filter(([id, [label]]) => fold(label).includes(q) && (counts.get(id) || 0) >= min)
    .sort((a, b) => (fold(a[1][0]).startsWith(q) ? 0 : 1) - (fold(b[1][0]).startsWith(q) ? 0 : 1) || (counts.get(b[0]) || 0) - (counts.get(a[0]) || 0));
  for (const [id, [label, facet]] of all) {
    const list = kindOf(facet) === 'theme' ? out.themes : out.feelings;
    if (list.length < limit) list.push({ id, label, facet, count: counts.get(id) || 0 });
  }
  return out;
}

/**
 * Where a feeling lives: films (in scope) that have it with their strength, the ones that most often come with it, the sentence.
 * @returns { lit: Map key -> score, top: [[key, score]], nearby: [id], watched }
 */
export function whereItLives(id, feel, keep, isWatched, { nearby = 6 } = {}) {
  const lit = new Map();
  for (const key of Object.keys(feel)) {
    if (!keep(key)) continue;
    const hit = feel[key].find(d => d[0] === id);
    if (hit) lit.set(key, hit[1]);
  }
  const top = [...lit].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const together = new Map(), overall = countIds(feel, keep);
  for (const key of lit.keys()) for (const [other] of feel[key]) if (other !== id) together.set(other, (together.get(other) || 0) + 1);
  // Dice score: comes with it often, and is not simply everywhere
  const near = [...together].filter(([, c]) => c >= 2).map(([o, c]) => [o, (2 * c) / (lit.size + (overall.get(o) || 1))])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, nearby).map(([o]) => o);
  let watched = 0;
  for (const key of lit.keys()) if (isWatched(key)) watched++;
  return { lit, top, nearby: near, watched };
}

/** "55 films feel eerie, 11 of them watched." */
export function livesSentence(label, kind, total, watched, scopeIsAll) {
  const word = lowerLabel(label);
  if (!total) return `No films ${kind === 'theme' ? `are about ${word}` : `feel ${word}`} here.`;
  const films = total === 1 ? '1 film' : `${total} films`;
  const verb = kind === 'theme' ? (total === 1 ? 'is' : 'are') + ` about ${word}` : (total === 1 ? 'feels' : 'feel') + ` ${word}`;
  return `${films} ${verb}${scopeIsAll ? `, ${watched === 0 ? 'none' : `${watched} of them`} watched` : ''}.`;
}
