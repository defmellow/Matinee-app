// Draws the Map on a 2D canvas: fine lines, then matte dots, then rings and name labels. Reads state, changes nothing.

import { createPlacer, labelSpot, tagSpot, createSpotFinder } from './layout.js';
import { lineStep } from './model.js';

const clamp01 = v => Math.max(0, Math.min(1, v));
export const POSTER_ZOOM = 6;     // zoomed in this many times past the whole map, films in view become posters
export const TITLE_ZOOM = 2.6;    // and past this, the larger dots (and every film, later) get their titles
const POSTER = { w: 40, h: 58 };
const widths = new Map();
const textWidth = (c, text) => { const k = c.font + text; let w = widths.get(k); if (w == null) { w = c.measureText(text).width; if (widths.size > 3000) widths.clear(); widths.set(k, w); } return w; };

/**
 * The fine lines between films: cream hairlines, fainter the longer they are, so local bundles build up and long ones nearly vanish.
 * They do not depend on the pointer, so the engine can keep them as a picture while only the view slides (see engine.js).
 */
export function drawLinks(c, s) {
  const { w, h, view: v, sim, links, theme, cuts } = s;
  const X = i => sim.x[i] * v.k + v.tx, Y = i => sim.y[i] * v.k + v.ty;
  c.lineCap = 'round';
  const lw = Math.min(1.8, 0.8 * s.zoomF ** 0.35);
  const buckets = new Map(); // links with about the same strength are stroked together: one path each, not one per line
  for (const [i, j, sim01] of links) {
    const fa = Math.min(sim.fade[i], sim.fade[j]);
    if (fa <= 0.01) continue;
    const ax = X(i), ay = Y(i), bx = X(j), by = Y(j);
    if ((ax < -20 && bx < -20) || (ax > w + 20 && bx > w + 20) || (ay < -20 && by < -20) || (ay > h + 20 && by > h + 20)) continue;
    const len = Math.hypot(sim.x[j] - sim.x[i], sim.y[j] - sim.y[i]);
    const lf = Math.max(0.12, Math.min(1, 90 / Math.max(1, len)));
    const step = cuts && sim01 >= cuts[1] ? 2 : cuts && sim01 >= cuts[0] ? 1 : 0; // weak, middling, strong (this map's own spread)
    let a = 0.2 * [0.45, 1, 1.7][step] * lf * lf * fa;
    if (s.keyLit) a *= s.keyLit.has(i) && s.keyLit.has(j) ? 1 : 0.06;
    if (s.focus) a *= i === s.pick || j === s.pick || (s.focus.has(i) && s.focus.has(j)) ? 1 : 0.3;
    else if (s.glow) a *= s.glow.has(i) && s.glow.has(j) ? 1.5 : 0.2;
    if (a < 0.012) continue; // too faint to see: not worth drawing
    const level = Math.max(1, Math.round(Math.min(1, a) * 60)), id = level * 3 + step;
    let b = buckets.get(id);
    if (!b) buckets.set(id, b = []);
    b.push(ax, ay, bx, by);
  }
  for (const [id, segs] of buckets) {
    c.strokeStyle = `rgba(${theme.line},${(Math.floor(id / 3) / 60).toFixed(3)})`;
    c.lineWidth = lw * [0.55, 1.05, 1.9][id % 3];
    c.beginPath();
    for (let q = 0; q < segs.length; q += 4) {
      const ax = segs[q], ay = segs[q + 1], bx = segs[q + 2], by = segs[q + 3];
      c.moveTo(ax, ay);
      c.quadraticCurveTo((ax + bx) / 2 - (by - ay) * 0.08, (ay + by) / 2 + (bx - ax) * 0.08, bx, by);
    }
    c.stroke();
  }
}

/**
 * @param c the canvas context (already scaled for the screen's pixel density)
 * @param s { w, h, view, zoomF, sim, links, colours[], radii[], watched[], hover, pick, focus: Map(i -> closeness 0..1) | null,
 *            hoverSet: Set of the hovered film's neighbours that are on the map, paintLinks(c): optional, draws the lines itself,
 *            matches: Set | null, labels: [{ i, text }], theme: { bg, text, accent, font } }
 */
export function draw(c, s) {
  const { w, h, view: v, sim, links, theme } = s;
  c.clearRect(0, 0, w, h);
  const hoverSet = s.hover >= 0 ? s.hoverSet || new Set() : null; // (only films still on the map: the engine filters them)
  const keyDim = i => (s.keyLit ? (s.keyLit.has(i) ? 1 : 0.1) : 1); // the key's highlight: other colours fade dark
  const dimOf = i => keyDim(i) * dimRest(i);
  const dimRest = i => {
    if (s.focus) return i === s.pick || s.focus.has(i) ? 1 : 0.17;
    if (s.glow) return s.glow.has(i) ? 1 : 0.15;
    if (hoverSet) return i === s.hover || hoverSet.has(i) ? 1 : 0.5;
    return 1;
  };
  const X = i => sim.x[i] * v.k + v.tx, Y = i => sim.y[i] * v.k + v.ty;

  if (s.paintLinks) s.paintLinks(c); else drawLinks(c, s);
  // hovered film's own links, brighter
  if (s.hover >= 0 && !s.focus && sim.fade[s.hover] > 0) {
    for (const j of hoverSet) {
      const st = lineStep(s.hoverW ? s.hoverW.get(j) : 1);
      c.strokeStyle = `rgba(${theme.line},${st.alpha})`; c.lineWidth = st.width;
      c.beginPath(); c.moveTo(X(s.hover), Y(s.hover)); c.lineTo(X(j), Y(j)); c.stroke();
    }
  }
  // picked film: pink lines to its closest films, thicker the closer
  if (s.focus && s.pick >= 0) {
    c.strokeStyle = theme.accent;
    for (const [j, close] of s.focus) {
      const st = lineStep(close);
      c.globalAlpha = st.alpha; c.lineWidth = st.width + 0.4;
      c.beginPath(); c.moveTo(X(s.pick), Y(s.pick)); c.lineTo(X(j), Y(j)); c.stroke();
    }
    c.globalAlpha = 1;
  }

  // which films are drawn as posters (zoomed in far enough), with room found for them and their titles
  const blocked0 = s.blocked || [];
  const placer = createPlacer(2, { bounds: { w, h }, blocked: blocked0 });
  const posters = new Map(), names = [];
  const inView = i => { const x = X(i), y = Y(i); return sim.fade[i] > 0.4 && x > -30 && x < w + 30 && y > -30 && y < h + 30; };
  c.font = `600 12px ${theme.font}`; c.textBaseline = 'middle';
  const wantName = (i, text, must, x, y, below) => {
    if (!text) return;
    const tw = textWidth(c, text) + 10, r = { x: x - tw / 2, y: below ? y : y - 8, w: tw, h: 16 };
    if (!below) r.x = x + 8; // beside a dot
    if (!below && x > w * 0.75) r.x = x - 8 - tw;
    if (!placer.fits(r)) return; // never clipped by the edge, never under the buttons, never over another name
    placer.place(r);
    names.push({ i, text, r, must });
  };
  const rank = [];
  for (const i of s.order) if (inView(i)) rank.push(i);
  // most important first: picked, its closest films, lit, hovered, then the biggest dots
  const weight = i => (i === s.pick ? 1e6 : s.focus && s.focus.has(i) ? 1e5 : i === s.hover ? 9e4 : s.glow && s.glow.has(i) ? 1e4 + s.glow.get(i) * 100 : 0) + s.radii[i];
  rank.sort((a, b) => weight(b) - weight(a));
  // Posters first (posters must not overlap, and each must still point to its film). Zoomed in, every film in
  // view is a poster; a picked film and its close films always are. A poster that would overlap one already placed moves to
  // the nearest free spot, and a thin line in the film's colour runs from it back to the film's own dot.
  const isClose = i => i === s.pick || (s.focus && s.focus.has(i));
  const posterList = s.posterOn ? rank.slice(0, 260) : rank.filter(isClose);
  const spots = createSpotFinder(blocked0);
  for (const i of posterList) {
    const r = spots.place(X(i), Y(i), POSTER.w, POSTER.h, s.spotMemo, i);
    posters.set(i, r);
    placer.place(r, true);
  }
  c.font = `600 13px ${theme.font}`;
  // the picked film's name first, then its closest films' names with the farthest first: those are the ones that are hard to find
  const crowded = sim.moving; // mid-flow, overlaps are fine; once settled, a label with no clear room is dropped
  const sortedLabels = s.labels.filter(l => l.main).concat(s.labels.filter(l => !l.main).sort((a, b) => Math.hypot(X(b.i) - X(s.pick), Y(b.i) - Y(s.pick)) - Math.hypot(X(a.i) - X(s.pick), Y(a.i) - Y(s.pick))));
  for (const l of sortedLabels) {
    const tw = textWidth(c, l.text) + 14, pr = posters.get(l.i);
    const r = pr ? tagSpot(pr, tw, 20, placer, { crowded: crowded || l.main, preferLeft: pr.x > w * 0.7 }) : labelSpot(X(l.i), Y(l.i), tw, 20, placer, { crowded: crowded || l.main, preferLeft: X(l.i) > w * 0.7 });
    if (!r) continue;
    placer.place(r, true); names.push({ i: l.i, text: l.text, r, must: true, main: l.main });
  }
  c.font = `600 12px ${theme.font}`;
  const labelled = new Set(s.labels.map(l => l.i));
  if (s.titlesOn) {
    for (const [i, r] of posters) if (!labelled.has(i)) wantName(i, s.titles[i], false, r.x + r.w / 2, r.y + r.h + 3, true);
    if (!s.posterOn) {
      for (const i of rank) {
        if (!labelled.has(i) && !posters.has(i) && (s.radii[i] >= 5 || s.zoomF > 2.3 || (s.glow && s.glow.has(i)))) wantName(i, s.titles[i], false, X(i), Y(i), false);
      }
    }
  }

  // dots: watchlist first, watched on top, the highlighted last
  const order = s.order;
  const lit = i => i === s.hover || i === s.pick || (s.focus && s.focus.has(i)) || (hoverSet && hoverSet.has(i)) || (s.glow && s.glow.has(i));
  const asPoster = new Map(); // film -> the picture, or false for a plain tile (also while the picture is loading); least important first, so the most important sits on top
  for (const i of [...posters.keys()].reverse()) { const img = s.imgOf(i); asPoster.set(i, img || false); }
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      if (pass === 0 ? lit(i) : !lit(i)) continue;
      const f = sim.fade[i];
      if (f <= 0.01 || asPoster.has(i)) continue;
      const x = X(i), y = Y(i);
      if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
      const r = s.radii[i] * s.zoomF * (lit(i) && (s.focus || hoverSet) ? 1.25 : 1) * (0.6 + 0.4 * f);
      const glowOn = s.glow && s.glow.has(i);
      c.globalAlpha = f * dimOf(i) * (glowOn ? 0.35 + 0.65 * s.glow.get(i) : s.watched[i] ? 1 : 0.82);
      c.fillStyle = glowOn ? theme.accent : s.colours[i];
      c.beginPath(); c.arc(x, y, r * (glowOn ? 1.2 : 1), 0, 6.2832); c.fill();
      if (s.watched[i]) { c.strokeStyle = theme.bg; c.lineWidth = 0.8; c.stroke(); }
    }
  }
  c.globalAlpha = 1;
  // posters: the picture (or a plain tile), ringed in the film's own colour
  for (const [i, img] of asPoster) {
    const r = posters.get(i), f = sim.fade[i];
    c.globalAlpha = f * dimOf(i);
    c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 6);
    if (img) { c.save(); c.clip(); c.drawImage(img, r.x, r.y, r.w, r.h); c.restore(); } else { c.fillStyle = theme.bg; c.fill(); c.globalAlpha = f * dimOf(i) * 0.35; c.fillStyle = s.colours[i]; c.fill(); c.globalAlpha = f * dimOf(i); }
    c.beginPath(); c.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 7);
    c.strokeStyle = i === s.pick ? theme.accent : s.colours[i]; c.lineWidth = i === s.pick ? 2.5 : 2; c.stroke();
  }
  c.globalAlpha = 1;

  // A poster moved aside to keep clear of another: a thin line in its colour from the poster back to where the film really is,
  // ending in a small dot there. Drawn over the posters so it is never hidden under a neighbour.
  for (const [i, r] of posters) {
    if (!r.moved || !asPoster.has(i)) continue;
    const x = X(i), y = Y(i), ex = Math.max(r.x, Math.min(x, r.x + r.w)), ey = Math.max(r.y, Math.min(y, r.y + r.h));
    c.globalAlpha = sim.fade[i] * dimOf(i);
    c.strokeStyle = s.colours[i]; c.lineWidth = 1.25;
    c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
    c.fillStyle = s.colours[i]; c.strokeStyle = theme.bg; c.lineWidth = 1.5;
    c.beginPath(); c.arc(x, y, 3.5, 0, 6.2832); c.fill(); c.stroke();
  }
  c.globalAlpha = 1;

  // rings: search matches, the film under the pointer, the picked film
  if (s.matches) {
    c.strokeStyle = theme.accent; c.lineWidth = 1.5;
    for (const i of s.matches) { if (sim.fade[i] <= 0.01) continue; c.beginPath(); c.arc(X(i), Y(i), s.radii[i] * s.zoomF + 4, 0, 6.2832); c.stroke(); }
  }
  if (s.hover >= 0 && s.hover !== s.pick && sim.fade[s.hover] > 0.01) {
    c.strokeStyle = theme.text; c.lineWidth = 1.5; c.beginPath(); c.arc(X(s.hover), Y(s.hover), s.radii[s.hover] * s.zoomF * 1.25 + 3.5, 0, 6.2832); c.stroke();
  }
  if (s.pick >= 0 && sim.fade[s.pick] > 0.01) {
    c.strokeStyle = theme.accent; c.lineWidth = 2.5; c.beginPath(); c.arc(X(s.pick), Y(s.pick), s.radii[s.pick] * s.zoomF * 1.25 + 5, 0, 6.2832); c.stroke();
  }

  // names: flat little tags, the picked film's in pink
  c.font = `600 12px ${theme.font}`; c.textBaseline = 'middle';
  for (const nm of names) {
    const { r } = nm;
    if (nm.main || nm.must) c.font = `600 13px ${theme.font}`; else c.font = `600 12px ${theme.font}`;
    c.fillStyle = nm.main ? theme.accent : theme.bg; c.globalAlpha = nm.main ? 1 : 0.86;
    c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 6); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = nm.main ? '#3a1424' : theme.text;
    c.fillText(nm.text, r.x + 5 + (nm.must ? 2 : 0), r.y + r.h / 2 + 0.5);
  }
  return { posters };
}
