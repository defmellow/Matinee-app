// The Map (pass 1): one layout for every film, so positions never change between views. Films that feel alike sit close.
// Pure and repeatable: the same input always gives the same positions.
//
// Steps: (1) each film's closest matches by feel are made symmetric (the larger of the two directions) and turned into a
// distance; (2) t-SNE (perplexity and early exaggeration in MAP below, written here in plain JavaScript) lays them out; (3) films
// with no match at all sit on a ring just outside the cloud; (4) everything is fitted into a 0..1 box.
// The positions are each film's HOME: the screen runs a small live simulation around them.

import { topLinks } from './map-links.js';
import { NEUTRAL, familyWeights, blendColour, tornPair, FAMILIES } from './feel-families.js';
export { NEUTRAL, familyWeights, blendColour };

export const MAP = {
  perplexity: 25,  // 8 left 39% of each film's 8 closest beyond its 50 nearest dots on a real library, 15 left 36% (20 Nov). 25 with rowsK 40 (21 Nov):
                   // dots that sit near each other are more alike (57% -> 62% of a film's 10 nearest dots are among its 30 closest by feel),
                   // at a small cost to the closest few (36% beyond 50 dots, median rank 18 -> 19); same on seeds 3, 11 and 29. A picked
                   // film's closest drift in around it anyway, so what you see while browsing is what matters.
  rowsK: 40,       // how many of each film's closest films t-SNE looks at (was 24); perplexity 25 needs more than 24 to mean anything
  exaggeration: 4,   // 24 (the design's value) left each film's closest matches a third further away on a real library (18 Nov)
  exaggerationSteps: 250,
  steps: 1000,
  q: 0.98,       // similarity at this percentile counts as "as alike as it gets"
  linkTop: 5,    // each film's strongest links drawn
  linkFloor: 0.4,  // a link beyond a film's closest one must be at least this share of the 98th-percentile similarity (each lens has its own scale)
  nearTop: 30,   // each film's closest list sent to the screen: enough to find 5 lines among the films a view leaves on show
};

/** Small seeded generator (mulberry32) so the layout is repeatable. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * t-SNE on a sparse neighbour distance list. Exact repulsion, sparse attraction.
 * @param n points; rows[i] = [[j, distance], ...] (the nearest, distance < 1)
 * @returns Float64Array of 2n coordinates
 */
export function tsne(n, rows, { perplexity = MAP.perplexity, exaggeration = MAP.exaggeration, exaggerationSteps = MAP.exaggerationSteps, steps = MAP.steps, seed = 3 } = {}) {
  const rand = seededRandom(seed);
  // conditional probabilities: binary search for the spread that gives the wanted perplexity
  const target = Math.log(perplexity);
  const cond = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = rows[i] || [];
    const p = new Float64Array(r.length);
    let beta = 1, lo = 0, hi = Infinity;
    for (let it = 0; it < 60 && r.length; it++) {
      let sum = 0, dp = 0;
      for (let k = 0; k < r.length; k++) { p[k] = Math.exp(-beta * r[k][1]); sum += p[k]; dp += r[k][1] * p[k]; }
      if (sum < 1e-300) { hi = beta; beta = (lo + hi) / 2; continue; }
      const h = Math.log(sum) + (beta * dp) / sum;
      if (Math.abs(h - target) < 1e-5) break;
      if (h > target) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2; } else { hi = beta; beta = (beta + lo) / 2; }
    }
    let sum = 0;
    for (let k = 0; k < r.length; k++) { p[k] = Math.exp(-beta * r[k][1]); sum += p[k]; }
    for (let k = 0; k < r.length; k++) p[k] /= sum || 1;
    cond[i] = p;
  }
  // symmetrise into a CSR list: P_ij = (p_j|i + p_i|j) / 2n
  const acc = Array.from({ length: n }, () => new Map());
  for (let i = 0; i < n; i++) {
    const r = rows[i] || [];
    for (let k = 0; k < r.length; k++) {
      const j = r[k][0], v = cond[i][k] / (2 * n);
      acc[i].set(j, (acc[i].get(j) || 0) + v);
      acc[j].set(i, (acc[j].get(i) || 0) + v);
    }
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + acc[i].size;
  const col = new Int32Array(start[n]), val = new Float64Array(start[n]);
  for (let i = 0; i < n; i++) { let o = start[i]; for (const j of [...acc[i].keys()].sort((a, b) => a - b)) { col[o] = j; val[o] = acc[i].get(j); o++; } }

  const Y = new Float64Array(2 * n);
  for (let i = 0; i < 2 * n; i += 2) { // small normal start (Box-Muller)
    const u = Math.max(rand(), 1e-12), v = rand(), m = Math.sqrt(-2 * Math.log(u)) * 1e-4;
    Y[i] = m * Math.cos(2 * Math.PI * v); Y[i + 1] = m * Math.sin(2 * Math.PI * v);
  }
  const G = new Float64Array(2 * n), U = new Float64Array(2 * n), gain = new Float64Array(2 * n).fill(1), R = new Float64Array(2 * n);
  const rate = Math.max(n / exaggeration / 4, 50);
  for (let it = 0; it < steps; it++) {
    const ex = it < exaggerationSteps ? exaggeration : 1;
    R.fill(0);
    let Z = 0;
    for (let i = 0; i < n; i++) { // repulsion, every pair once
      const xi = Y[2 * i], yi = Y[2 * i + 1];
      let fx = 0, fy = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = xi - Y[2 * j], dy = yi - Y[2 * j + 1];
        const w = 1 / (1 + dx * dx + dy * dy);
        Z += w;
        const w2 = w * w;
        fx += w2 * dx; fy += w2 * dy;
        R[2 * j] -= w2 * dx; R[2 * j + 1] -= w2 * dy;
      }
      R[2 * i] += fx; R[2 * i + 1] += fy;
    }
    Z *= 2;
    const mom = it < exaggerationSteps ? 0.5 : 0.8;
    for (let i = 0; i < n; i++) {
      const xi = Y[2 * i], yi = Y[2 * i + 1];
      let ax = 0, ay = 0;
      for (let o = start[i]; o < start[i + 1]; o++) {
        const j = col[o], dx = xi - Y[2 * j], dy = yi - Y[2 * j + 1];
        const f = (ex * val[o]) / (1 + dx * dx + dy * dy);
        ax += f * dx; ay += f * dy;
      }
      G[2 * i] = 4 * (ax - R[2 * i] / Z); G[2 * i + 1] = 4 * (ay - R[2 * i + 1] / Z);
    }
    for (let k = 0; k < 2 * n; k++) {
      gain[k] = Math.max(0.01, (G[k] > 0) !== (U[k] > 0) ? gain[k] + 0.2 : gain[k] * 0.8);
      U[k] = mom * U[k] - rate * gain[k] * G[k];
      Y[k] += U[k];
    }
  }
  return Y;
}

/** Symmetric similarity from each film's own closest list: the larger of the two directions. */
function symmetric(keys, neighbours) {
  const index = new Map(keys.map((k, i) => [k, i]));
  const sym = keys.map(() => new Map());
  keys.forEach((k, i) => {
    for (const r of neighbours.get(k) || []) {
      const j = index.get(r.key);
      if (j == null || j === i || !(r.score > 0)) continue;
      if (!(sym[i].get(j) >= r.score)) { sym[i].set(j, r.score); sym[j].set(i, r.score); }
    }
  });
  return sym;
}

/**
 * @param keys film keys (watched and watchlist together)
 * @param neighbours Map key -> [{ key, score }] each film's closest by feel
 * @param extra optional Map key -> [{ key, score }] more close films (closest among watched, among watchlist): they join `near`
 *        so a view can find each film's lines among the films it shows, and never move the layout or the whole-library lines
 * @param descriptorsOf key -> [{ id, label, facet, score, fragile }] a film's feelings
 * @returns { total, nodes: [{ key, x, y, colour, family }], links: [[i, j, s]], near: { key: [[otherKey, score]] }, loose: [key], lines: { top, floor } }
 */
export function feelMap({ keys = [], neighbours = new Map(), extra = null, descriptorsOf = () => [], seed = 3 } = {}) {
  const n = keys.length;
  if (!n) return { total: 0, nodes: [], links: [], near: {}, loose: [], lines: { top: MAP.linkTop, floor: 0 } };
  const sym = symmetric(keys, neighbours);
  const all = [];
  for (const m of sym) for (const s of m.values()) all.push(s);
  all.sort((a, b) => a - b);
  const q98 = all.length ? all[Math.min(all.length - 1, Math.floor(MAP.q * all.length))] || all[all.length - 1] : 1;
  const dist = s => 1 - 0.9 * Math.min(1, Math.max(0, s / q98));
  const has = sym.map(m => m.size > 0);
  const idx = []; // films that have at least one neighbour, in input order
  has.forEach((h, i) => { if (h) idx.push(i); });
  const pos = new Map(idx.map((g, k) => [g, k]));
  const rows = idx.map(g => [...sym[g]].map(([j, s]) => [pos.get(j), dist(s)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, MAP.rowsK));

  const X = new Float64Array(2 * n);
  if (idx.length) {
    const Y = idx.length === 1 ? new Float64Array(2) : tsne(idx.length, rows, { seed });
    const m = idx.length;
    let mx = 0, my = 0;
    for (let k = 0; k < m; k++) { mx += Y[2 * k]; my += Y[2 * k + 1]; }
    mx /= m; my /= m;
    let vx = 0, vy = 0;
    for (let k = 0; k < m; k++) { vx += (Y[2 * k] - mx) ** 2; vy += (Y[2 * k + 1] - my) ** 2; }
    const sx = Math.sqrt(vx / m) || 1, sy = Math.sqrt(vy / m) || 1;
    let rad = 0;
    idx.forEach((g, k) => { X[2 * g] = (Y[2 * k] - mx) / sx; X[2 * g + 1] = (Y[2 * k + 1] - my) / sy; rad = Math.max(rad, Math.hypot(X[2 * g], X[2 * g + 1])); });
    rad *= 1.04;
    let o = 0;
    has.forEach((h, g) => { if (h) return; const a = 2.3 + o * 0.16; X[2 * g] = rad * Math.cos(a); X[2 * g + 1] = rad * Math.sin(a); o++; });
  }
  // fit into 0..1, one scale for both axes so the shape is not stretched
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[2 * i]); x1 = Math.max(x1, X[2 * i]); y0 = Math.min(y0, X[2 * i + 1]); y1 = Math.max(y1, X[2 * i + 1]); }
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const ox = (span - (x1 - x0)) / 2, oy = (span - (y1 - y0)) / 2;
  const round = v => Math.round(v * 1e4) / 1e4;

  // colour: a film's own feelings, nudged toward its closest films' so colour drifts across regions
  const own = keys.map(k => familyWeights(descriptorsOf(k)));
  const nodes = keys.map((key, i) => {
    const top = [...sym[i]].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const w = {};
    for (const f in own[i]) {
      let a = 0;
      for (const [j] of top) a += own[j][f];
      w[f] = own[i][f] * 0.6 + (top.length ? a / top.length : 0) * 0.4;
    }
    // its main colour, for the key's highlight: the family it leans to most, or null when there is nothing to go on (grey)
    let family = null, most = 0.05;
    for (const f in w) if (w[f] > most) { most = w[f]; family = f; }
    // torn between two feelings (from its own feelings, not its neighbours'): both colours, for the split ring
    const pair = tornPair(own[i]);
    return { key, x: round((X[2 * i] - x0 + ox) / span), y: round((X[2 * i + 1] - y0 + oy) / span), colour: blendColour(w), family, ...(pair ? { split: pair.map(f => FAMILIES[f].c) } : null) };
  });

  const sorted = m => [...m].map(([j, s]) => [j, Math.round(s * 1e3) / 1e3]).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const floor = Math.round(MAP.linkFloor * q98 * 1e3) / 1e3;
  const links = topLinks(sym.map(m => sorted(m).slice(0, MAP.linkTop)), undefined, { top: MAP.linkTop, floor });
  if (extra) { // the extra closest films join both ways, like the layout's own (the larger score wins)
    const at = new Map(keys.map((k, i) => [k, i]));
    keys.forEach((k, i) => { for (const r of extra.get(k) || []) { const j = at.get(r.key); if (j != null && j !== i && r.score > 0 && has[i] && has[j]) { if (!(sym[i].get(j) >= r.score)) sym[i].set(j, r.score); if (!(sym[j].get(i) >= r.score)) sym[j].set(i, r.score); } } });
  }
  const lists = sym.map(m => sorted(m).slice(0, MAP.nearTop));
  const near = {};
  keys.forEach((k, i) => { if (lists[i].length) near[k] = lists[i].map(([j, s]) => [keys[j], s]); });
  // near is long enough for the Map screen to work the lines out again when a view hides films (topLinks with its own `keep`)
  return { total: n, nodes, links, near, loose: keys.filter((_, i) => !has[i]), lines: { top: MAP.linkTop, floor } };
}

/**
 * Turn a fresh layout so it sits where the previous one did: films the two share are matched as closely as a turn, a mirror image, a shift and
 * one even resize allow (orthogonal Procrustes), then the whole thing is put back in the 0..1 box the way feelMap leaves it.
 * Without three films in common (or if they all sit on one spot) the layout is returned as it is.
 * @param layout   { nodes: [{ key, x, y, ... }], ... }
 * @param previous the same shape, from earlier
 */
export function alignTo(layout, previous) {
  if (!layout || !previous || !Array.isArray(layout.nodes) || !Array.isArray(previous.nodes)) return layout;
  const was = new Map(previous.nodes.map(p => [p.key, p]));
  const pairs = layout.nodes.filter(p => was.has(p.key)).map(p => [p, was.get(p.key)]);
  const m = pairs.length;
  if (m < 3) return layout;
  let px = 0, py = 0, qx = 0, qy = 0;
  for (const [p, q] of pairs) { px += p.x; py += p.y; qx += q.x; qy += q.y; }
  px /= m; py /= m; qx /= m; qy /= m;
  // best turn + resize as one complex number c, with and without a mirror image (y flipped); keep the one that fits better
  const fit = flip => {
    let a = 0, b = 0, v = 0;
    for (const [p, q] of pairs) {
      const zx = p.x - px, zy = flip * (p.y - py), wx = q.x - qx, wy = q.y - qy;
      a += zx * wx + zy * wy; b += zx * wy - zy * wx; v += zx * zx + zy * zy;
    }
    return { a, b, v, gain: v ? (a * a + b * b) / v : 0, flip };
  };
  const plain = fit(1), mirror = fit(-1);
  const best = mirror.gain > plain.gain ? mirror : plain;
  if (!(best.v > 0) || !(best.gain > 0)) return layout;
  const cr = best.a / best.v, ci = best.b / best.v;
  const moved = layout.nodes.map(p => {
    const zx = p.x - px, zy = best.flip * (p.y - py);
    return { ...p, x: cr * zx - ci * zy + qx, y: ci * zx + cr * zy + qy };
  });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of moved) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const ox = (span - (x1 - x0)) / 2, oy = (span - (y1 - y0)) / 2;
  return { ...layout, nodes: moved.map(p => ({ ...p, x: (p.x - x0 + ox) / span, y: (p.y - y0 + oy) / span })) };
}

/** The lenses of "Alike in": which parts of a film's likeness count (the `emphasis` given to similar()). Both is similar()'s own default. */
// On the Map the cast never counts and the director only a little (20 Nov): `directors`, never `people`.
export const LENSES = {
  feel: { feel: 1, themes: 0.15, craft: 0.5, people: 0, directors: 0.1 },
  about: { feel: 0.1, themes: 1, craft: 0.1, people: 0, directors: 0.15 },
};
export const lensEmphasis = lens => (Object.hasOwn(LENSES, lens) ? LENSES[lens] : undefined);

/**
 * What each film has, compactly, for lighting up a feeling or theme on the map and for the "Around here" note.
 * Non-fragile descriptors at 0.15 or more, ids only; the label and facet of each id are listed once.
 * @returns { feel: { key: [[id, score]] strongest first }, labels: { id: [label, facet] } }
 */
export function featureTable(keys, descriptorsOf) {
  const feel = {}, labels = {};
  for (const key of keys) {
    const list = [];
    for (const d of descriptorsOf(key) || []) {
      if (!d || d.fragile || !(d.score >= 0.15)) continue;
      list.push([d.id, Math.round(d.score * 100) / 100]);
      if (!labels[d.id]) labels[d.id] = [d.label, d.facet];
    }
    if (list.length) feel[key] = list.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }
  return { feel, labels };
}
