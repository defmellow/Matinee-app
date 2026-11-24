// The Map's arithmetic: where a film sits on screen, the view that frames some of them, dot sizes, and which films a filter keeps. Pure.
import { WORLD } from './sim.js';
import { FAMILIES, FAMILY_WORDS } from '../../../core/analysis/feel-families.js';

export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The five feeling colours as the key names them (hexes from core/analysis/feel-families.js), in the app's palette order (docs/DESIGN.md 2.1.1). */
export const FEELING_COLOURS = Object.entries(FAMILY_WORDS).map(([id, [word, about]]) => ({ id, word, about, colour: FAMILIES[id].c }));

/** "Alike in": which parts of a film's likeness place it on the map. `emphasis` is what similar() takes (same numbers as core/analysis/feel-map.js LENSES). */
export const LENSES = {
  feel: { label: 'How it feels', emphasis: { feel: 1, themes: 0.15, craft: 0.5, people: 0, directors: 0.1 }, about: 'Films that feel alike are placed together, whatever they are about.' },
  about: { label: "What it's about", emphasis: { feel: 0.1, themes: 1, craft: 0.1, people: 0, directors: 0.15 }, about: 'Films about the same things are placed together, however they feel.' },
};
/** How a line between two films looks: three clear steps, the same on hover, on a picked film and in the key.
 * `min` is closeness next to the film's closest (1 = as close as its closest), as in By feel's tiers. */
export const LINE_STEPS = [
  { id: 'very', label: 'Very close', min: 0.8, width: 4.2, alpha: 0.95 },
  { id: 'close', label: 'Close', min: 0.55, width: 2, alpha: 0.6 },
  { id: 'some', label: 'A little alike', min: 0, width: 0.8, alpha: 0.3 },
];
export const lineStep = ratio => LINE_STEPS.find(t => (ratio || 0) >= t.min) || LINE_STEPS[LINE_STEPS.length - 1];
/** A film's lines as closeness next to its strongest one: Map neighbour -> 0..1. */
export function relativeTo(strengths) {
  let best = 0;
  for (const v of strengths.values()) best = Math.max(best, v);
  const out = new Map();
  for (const [j, v] of strengths) out.set(j, best > 0 ? v / best : 0);
  return out;
}

export const LENS_OPTIONS = Object.entries(LENSES).map(([value, l]) => ({ value, label: l.label }));

// ---------- colour ----------
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mixHex = (a, b, t) => {
  const p = rgb(a), q = rgb(b);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
};
// ---------- dot size ----------
// Dots are always coloured by general feel (the layout's own colour). Their SIZE says how highly rated the film is, in a few clear steps.
export const SIZE_BY = [{ value: 'mine', label: 'Your rating' }, { value: 'letterboxd', label: 'Letterboxd' }, { value: 'matinee', label: 'Matinee' }]; // short: three must fit the side panel under "Size by"
/** An older or unknown saved choice falls back to your own rating. */
export const sizeChoice = v => (v === 'letterboxd' || v === 'matinee' ? v : 'mine');
/**
 * The size steps for each choice: what a film has nothing for (the smallest dot), then [lowest value, what it means] from small to big.
 * Your rating runs 1..10 in half stars; the Letterboxd average 0..5 (`ratings.letterboxd.value`); the Matinee score 0..100 (`score`).
 * 20 Nov: the Letterboxd average split finely at the top (4, 4.25, 4.5) and below 3.7, the lowest step under 2.
 */
export const SIZE_STEPS = {
  mine: { none: 'Not rated, or on your watchlist', steps: [[0, 'Under 3½ stars'], [7, '3½ or 4 stars'], [9, '4½ or 5 stars']] },
  letterboxd: { none: 'No average yet', steps: [[0, 'Under 2'], [2, '2 to 3'], [3, '3 to 3.5'], [3.5, '3.5 to 3.7'], [3.7, '3.7 to 4'], [4, '4 to 4.25'], [4.25, '4.25 to 4.5'], [4.5, '4.5 and up']] },
  matinee: { none: 'No score yet', steps: [[0, 'Under 40'], [40, '40 to 50'], [50, '50 to 60'], [60, '60 to 70'], [70, '70 to 80'], [80, '80 to 85'], [85, '85 to 90'], [90, '90 and up']] },
};
/** What each dot size means, smallest first, for the key (matches sizeTier's steps). */
export const SIZE_ROWS = Object.fromEntries(Object.entries(SIZE_STEPS).map(([by, d]) => [by, [d.none, ...d.steps.map(x => x[1])]]));
export const TIERS = SIZE_ROWS.mine.length; // your rating's steps (the others have more)
const SMALLEST = 0.45; // the smallest dot's share of the biggest

const valueOf = (by, film) => {
  if (by === 'letterboxd') return film.ratings && film.ratings.letterboxd && film.ratings.letterboxd.value;
  if (by === 'matinee') return film.score;
  const u = film.user;
  return u && u.watched ? u.rating : null; // a watchlist film has no rating of hers
};
/** Which step a film's dot takes (0 = smallest: nothing to go on). */
export function sizeTier(by, film) {
  if (!film) return 0;
  const v = valueOf(by, film);
  if (!(v > 0)) return 0;
  const steps = SIZE_STEPS[by] ? SIZE_STEPS[by].steps : SIZE_STEPS.mine.steps;
  let t = 0;
  steps.forEach(([min], k) => { if (v >= min) t = k + 1; });
  return t;
}

/** The biggest dot's radius (screen pixels at the whole-map zoom) for a map area: bigger where there is room, never so big that the steps vanish. */
export const biggestRadius = (w, h) => Math.max(3.6, Math.min(6.4, Math.min(w, h * 1.35) / 150));
/** Radius in pixels for a step, out of `steps` (evenly from the smallest to the biggest). */
export const tierRadius = (tier, biggest, steps = TIERS) => biggest * (SMALLEST + (1 - SMALLEST) * Math.max(0, Math.min(steps - 1, tier | 0)) / Math.max(1, steps - 1));

/** The neighbours of film i that are still on the map (a filtered-out film is not a neighbour, whatever the layout says). */
export function liveNeighbours(adjOfI, alive) {
  const out = new Set();
  if (adjOfI) for (const j of adjOfI) if (alive[j]) out.add(j);
  return out;
}

/** Can the pointer meet this film? Only if it is on the map (not filtered out) and mostly faded in. */
export const canPoint = (alive, fade, i) => !!alive[i] && fade[i] > 0.4;

// ---------- filters ----------
// A filter is a predicate over a film key. Later filters (genre, year, rating, feelings) are more predicates; films must pass all.
export const SCOPES = [{ value: 'all', label: 'Everything' }, { value: 'watched', label: 'Watched' }, { value: 'watchlist', label: 'Watchlist' }];

export function scopeFilter(scope, lib) {
  if (scope === 'all') return () => true;
  return key => {
    const f = lib.get(key);
    const u = f && f.user;
    if (!u) return false;
    return scope === 'watched' ? !!u.watched : !u.watched;
  };
}
/** Orphan films (getMap's `loose`: nothing to place them by, not even genres or people) are left out unless the user asks to see them. */
export function looseFilter(show, loose) {
  if (show || !loose || !loose.length) return () => true;
  const set = new Set(loose);
  return key => !set.has(key);
}
export const allOf = preds => key => preds.every(p => p(key));

// ---------- view ----------
// A view is { k, tx, ty }: screen = world * k + (tx, ty).
export const toScreen = (v, x, y) => ({ x: x * v.k + v.tx, y: y * v.k + v.ty });
export const toWorld = (v, px, py) => ({ x: (px - v.tx) / v.k, y: (py - v.ty) / v.k });

/** The view that frames a world box inside a w × h area with `pad` pixels of air, never closer than kMax. */
export function fitBox(box, size, pad = 40, kMax = Infinity) {
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0);
  const k = Math.min(kMax, Math.max(0.05, Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh)));
  return { k, tx: size.w / 2 - ((box.x0 + box.x1) / 2) * k, ty: size.h / 2 - ((box.y0 + box.y1) / 2) * k };
}

/** The box around some points [[x, y]]; null when there are none. */
export function boxOf(points) {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** Zoom by `factor` keeping the world point under the screen point (px, py) where it is. */
export function zoomAt(v, factor, px, py, kMin, kMax) {
  const k = Math.min(kMax, Math.max(kMin, v.k * factor));
  const f = k / v.k;
  return { k, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f };
}

/**
 * What a wheel event does on the Map. Elsewhere: the wheel zooms the Map, and Ctrl + wheel is left to the app's own zoom.
 * On a Mac trackpad two fingers move around and a pinch (sent as Ctrl + wheel) zooms, as in Maps; ⌘ + wheel zooms too, for a mouse.
 * @returns {{ zoom: number } | { pan: [number, number] } | null}  null: leave the event alone
 */
export function wheelAction({ deltaX = 0, deltaY = 0, deltaMode = 0, ctrlKey = false, metaKey = false } = {}, mac = false) {
  const line = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1; // lines or pages into pixels
  if (!mac) return ctrlKey ? null : { zoom: Math.exp(-deltaY * line * 0.0016) };
  if (ctrlKey || metaKey) return { zoom: Math.min(2, Math.max(0.5, Math.exp(-deltaY * line * (ctrlKey ? 0.01 : 0.0016)))) };
  return { pan: [-deltaX * line, -deltaY * line] };
}

/** The nearest dot to a screen point within `reach` pixels: its index, or -1. Drawn-on-top (later) dots win ties. */
export function nearestDot(xs, ys, visible, v, px, py, reach = 9) {
  let best = -1, bd = reach * reach;
  for (let i = 0; i < xs.length; i++) {
    if (!visible(i)) continue;
    const dx = xs[i] * v.k + v.tx - px, dy = ys[i] * v.k + v.ty - py, d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

/** Ease for camera glides. */
export const easeOut = t => 1 - (1 - t) ** 3;
export { WORLD };
