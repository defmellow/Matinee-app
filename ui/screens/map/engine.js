// The Map's engine: owns the canvas, the live simulation, the camera and the pointer. The screen (Map.jsx) tells it
// what to show; it tells the screen what is under the pointer and what was clicked. It only draws while something
// moves or the view changes, and goes idle when everything has settled.
import { WORLD, createSim } from './sim.js';
import { topLinks } from '../../../core/analysis/map-links.js';
import { isMac } from '../../platform.js';
import { wheelAction, boxOf, fitBox, zoomAt, toWorld, nearestDot, easeOut, liveNeighbours, canPoint, tierRadius, biggestRadius, relativeTo } from './model.js';
import { draw, drawLinks, POSTER_ZOOM, TITLE_ZOOM } from './draw.js';
import { createPosterCache } from './posters.js';
import { imageUrl } from '../../api.js';

const GLIDE_MS = 520;
const LAYER_MARGIN = 220; // the lines are kept as a picture this much wider than the map, so sliding the view needs no redrawing
const AROUND_MS = 400, AROUND_REACH = 95; // pointing at empty map for this long shows what is around; films within this many pixels count

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const get = n => cs.getPropertyValue(n).trim();
  const text = get('--text') || '#f8eee7';
  const m = /^#([0-9a-f]{6})$/i.exec(text);
  const line = m ? [1, 3, 5].map(i => parseInt(m[1].slice(i - 1, i + 1), 16)).join(',') : '255,236,224';
  return { bg: get('--bg') || '#221d1d', text, accent: get('--accent') || '#f4a9c4', line, font: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif' };
}

/**
 * @param o { canvas, map: { nodes, links }, reduced, onHover(i, x, y), onPick(i), onFail(error) }  (i is -1 for "nothing")
 */
export function createEngine({ canvas, map: first, reduced = false, onHover = () => {}, onPick = () => {}, onAround = () => {}, onFail = () => {} }) {
  let map = first;
  const n = map.nodes.length;
  const keys = map.nodes.map(p => p.key);
  const index = new Map(keys.map((k, i) => [k, i]));
  const sim = createSim(map.nodes.map(p => ({ hx: p.x * WORLD, hy: p.y * WORLD })), map.links, { instantFade: reduced });
  sim.heat(0.3); sim.settle(); // start settled, so opening the map shows no jiggle
  const adj = Array.from({ length: n }, () => new Map()); // film -> its linked films and how alike (the layout's own scale)
  let cuts = [0, 0]; // link strengths that split the lines into weak, middling and strong (the 50th and 85th percentile)
  // The lines drawn are worked out for the films on show (topLinks): a view that hides films must not leave a film without its
  // lines just because its closest matches are hidden. The line widths keep the whole library's scale, so they don't shift per view.
  let shown = map.links, lists = [];
  const relink = () => {
    const all = sim.alive.every(Boolean);
    shown = all || !map.near ? map.links : topLinks(lists, i => !!sim.alive[i], map.lines || {});
    adj.forEach(a => a.clear());
    for (const [i, j, s] of shown) { adj[i].set(j, s); adj[j].set(i, s); }
    layoutVer++;
  };
  const linkUp = () => {
    lists = map.nodes.map(p => (map.near && map.near[p.key] || []).map(([k, s]) => [index.get(k), s]).filter(([j]) => j != null));
    const all = map.links.map(l => l[2]).sort((a, b) => a - b);
    cuts = all.length ? [all[Math.floor(all.length * 0.5)], all[Math.floor(all.length * 0.85)]] : [0, 0];
    relink();
  };
  // a hovered film's lines: its closest films as a click would show them, or the map's own lines until that list is known
  const hoverLines = () => (hoverClose && hoverClose.i === hover ? hoverClose.w : relativeTo(adj[hover]));
  const ctx = canvas.getContext('2d');
  let follow = false, aroundTimer = 0;
  const posterCache = createPosterCache({ make: url => { const im = new Image(); im.decoding = 'async'; im.src = imageUrl(url); return im; }, onReady: () => schedule() });
  const homes = () => map.nodes.map(p => [p.x * WORLD, p.y * WORLD]);

  let size = { w: 0, h: 0, dpr: 1 };
  let view = { k: 1, tx: 0, ty: 0 };
  let kWhole = 1, anim = null, raf = 0, destroyed = false, theme = readTheme();
  let blocked = [];
  let hover = -1, pick = -1, focus = null, matches = null, labels = [], glow = null, keyLit = null;
  let hoverClose = null; // { i, w: Map(j -> closeness 0..1) }: the hovered film's closest films, the same ones a click shows
  let posterRects = new Map(); // film -> where its poster was drawn last frame (it may sit aside from its dot), for pointing and clicking
  const spotMemo = new Map(); // film -> the spot its poster took, so posters keep their places from frame to frame
  let style = { colours: [], radii: [], watched: [], titles: [], posterUrls: [], order: [] };
  let sized = false, lastK = 0;
  let tiers = [], steps = 4; // dot size step per film (0 smallest) out of `steps`, set by setStyle; the radii follow the map's size
  let layer = null, layerKey = null, layerAt = null, layoutVer = 0; // the lines as a picture, and what it was made for
  linkUp();
  const layerCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let drag = null;
  const stats = { last: 0, max: 0, sum: 0, frames: 0, layers: 0 };

  const aliveBox = () => boxOf(homes().filter((_, i) => sim.alive[i]));
  const wholeView = () => fitBox(aliveBox() || boxOf(homes()), size, 36);
  const zoomF = () => Math.max(0.5, view.k / kWhole) ** 0.4;
  const visible = i => canPoint(sim.alive, sim.fade, i);
  // dot sizes in pixels at the whole-map zoom, and the same sizes as the physics' collision radii, so settled dots never overlap
  // While films are still loading the library refreshes every few seconds and each refresh restyles the map: unchanged sizes
  // leave the physics alone, and a few films growing as their ratings arrive only nudge their neighbours (a full reheat each
  // time kept the whole map shaking until loading finished).
  let lastSim = null;
  function applySizes() {
    const big = biggestRadius(size.w || 900, size.h || 700);
    const radii = Array.from({ length: n }, (_, i) => tierRadius(tiers[i] || 0, big, steps));
    style = { ...style, radii };
    const k = kWhole > 0 ? kWhole : 1;
    const simR = radii.map(r => (r + 0.6) / k);
    const changed = !lastSim || simR.some((r, i) => Math.abs(r - lastSim[i]) > 1e-9);
    if (changed) {
      const many = !lastSim || simR.filter((r, i) => Math.abs(r - lastSim[i]) > 1e-9).length > n / 4; // a new size choice, a resize
      sim.setRadii(simR, !sized ? 0.3 : many ? 0.25 : 0.06);
      lastSim = simR;
    }
    if (!sized && size.w) { sized = true; sim.settle(); } // the first sizes are in place before anything is drawn
  }

  function frame() {
    raf = 0;
    if (destroyed || !size.w) return;
    const t0 = performance.now();
    let more = false;
    try {
      if (sim.moving) { sim.tick(); more = sim.moving; }
      if (follow && pick >= 0 && !anim) { // another arrangement is flowing: keep the picked film where you were looking
        view = { k: view.k, tx: view.tx + (size.w / 2 - (sim.x[pick] * view.k + view.tx)) * 0.12, ty: view.ty + (size.h / 2 - (sim.y[pick] * view.k + view.ty)) * 0.12 };
        if (!sim.moving) { follow = false; frameFocus(); } // arrived: show the picked film with its closest films again
      }
      if (anim) {
        const t = Math.min(1, (t0 - anim.t0) / anim.dur), e = easeOut(t);
        view = { k: anim.from.k + (anim.to.k - anim.from.k) * e, tx: anim.from.tx + (anim.to.tx - anim.from.tx) * e, ty: anim.from.ty + (anim.to.ty - anim.from.ty) * e };
        if (t >= 1) anim = null; else more = true;
      }
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      const ratio = view.k / kWhole;
      ({ posters: posterRects } = draw(ctx, { w: size.w, spotMemo, h: size.h, view, zoomF: zoomF(), sim, links: shown, hover, hoverSet: hover >= 0 ? liveNeighbours(hoverLines().keys(), sim.alive) : null, hoverW: hover >= 0 ? hoverLines() : null, cuts, keyLit, pick, focus, matches, labels, glow, theme, blocked, ...style, paintLinks,
        posterOn: ratio >= POSTER_ZOOM, titlesOn: ratio >= TITLE_ZOOM, imgOf: i => posterCache.get(style.posterUrls[i]) }));
    } catch (e) { onFail(e); return; }
    const ms = performance.now() - t0;
    stats.last = ms; stats.max = Math.max(stats.max, ms); stats.sum += ms; stats.frames++;
    if (more) raf = requestAnimationFrame(frame);
  }
  const schedule = () => { if (!raf && !destroyed) raf = requestAnimationFrame(frame); };

  // The lines hold still while only the view slides (panning, hovering): keep them as a picture and place it. Anything else redraws them.
  function paintLinks(c) {
    const m = LAYER_MARGIN, s = { w: size.w + 2 * m, h: size.h + 2 * m, view: { k: view.k, tx: view.tx + m, ty: view.ty + m }, zoomF: zoomF(), sim, links: shown, cuts, focus, pick, glow, keyLit, theme };
    const steady = view.k === lastK; lastK = view.k; // zooming changes every line each frame: no point keeping a picture then
    if (!layerCanvas || sim.moving || size.w * size.h > 4e6) { drawLinks(c, { ...s, w: size.w, h: size.h, view }); return; }
    const key = [view.k, sim.ticks, layoutVer, size.w, size.h, size.dpr].join('|');
    const dx = layerAt ? Math.round((view.tx - layerAt.tx) * size.dpr) / size.dpr : 0, dy = layerAt ? Math.round((view.ty - layerAt.ty) * size.dpr) / size.dpr : 0;
    const same = layer && layerKey === key && layer.focus === focus && layer.glow === glow && layer.keyLit === keyLit && layer.theme === theme && Math.abs(dx) <= m - 4 && Math.abs(dy) <= m - 4;
    if (!same && !steady) { drawLinks(c, { ...s, w: size.w, h: size.h, view }); return; }
    if (!same) {
      layerCanvas.width = Math.round(s.w * size.dpr); layerCanvas.height = Math.round(s.h * size.dpr);
      const lc = layerCanvas.getContext('2d');
      lc.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawLinks(lc, s);
      layer = { focus, glow, keyLit, theme }; layerKey = key; layerAt = { tx: view.tx, ty: view.ty };
      stats.layers++;
      c.drawImage(layerCanvas, -m, -m, s.w, s.h);
      return;
    }
    c.drawImage(layerCanvas, dx - m, dy - m, s.w, s.h);
  }

  function frameFocus() {
    if (pick < 0) return;
    // Show the picked film with all its close films (the view should see all the films). They stay where they
    // are; the view glides to take them in, and they are drawn as posters at any zoom (draw.js).
    const box = boxOf([pick, ...(focus ? focus.keys() : [])].map(j => sim.homeOf(j)));
    const k = Math.min(kWhole * 8, Math.max(kWhole * 0.7, fitBox(box, size, 110).k)), cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    setView({ k, tx: size.w / 2 - cx * k, ty: size.h / 2 - cy * k }, true);
  }
  const setView = (v, glide) => {
    if (glide && !reduced) { anim = { from: view, to: v, t0: performance.now(), dur: GLIDE_MS }; } else { anim = null; view = v; }
    schedule();
  };
  const stopAround = () => { clearTimeout(aroundTimer); aroundTimer = 0; onAround(null); };
  const nearPoint = (px, py, reach) => {
    const out = [], r2 = reach * reach;
    for (let i = 0; i < n; i++) { if (!visible(i)) continue; const dx = sim.x[i] * view.k + view.tx - px, dy = sim.y[i] * view.k + view.ty - py; if (dx * dx + dy * dy <= r2) out.push(i); }
    return out;
  };
  const setHover = (i, x, y, rest = true) => {
    if (i >= 0 || drag || !rest) stopAround();
    else { stopAround(); aroundTimer = setTimeout(() => onAround(x, y, nearPoint(x, y, AROUND_REACH)), AROUND_MS); }
    if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : ''; schedule(); }
    onHover(i, x, y);
  };
  const point = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const hit = p => {
    for (const [j, r] of posterRects) if (visible(j) && p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2) return j; // a poster is hit where it is drawn, most important first
    return nearestDot(sim.x, sim.y, visible, view, p.x, p.y, posterRects.size ? 6 : 9);
  };

  const onDown = e => {
    if (e.button !== 0) return;
    const p = point(e), i = hit(p);
    drag = { i, sx: p.x, sy: p.y, tx: view.tx, ty: view.ty, moved: false, id: e.pointerId };
  };
  const onMove = e => {
    const p = point(e);
    if (!drag) { setHover(hit(p), p.x, p.y); return; }
    if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 5) return;
    if (!drag.moved) { stopAround(); drag.moved = true; canvas.setPointerCapture(drag.id); canvas.style.cursor = 'grabbing'; anim = null; if (drag.i >= 0) { hover = drag.i; } onHover(-1, 0, 0); }
    if (drag.i >= 0) { // a dot: held under the pointer, the films linked to it follow on their springs
      const w = toWorld(view, p.x, p.y);
      sim.pin(drag.i, w.x, w.y);
    } else { view = { k: view.k, tx: drag.tx + p.x - drag.sx, ty: drag.ty + p.y - drag.sy }; }
    schedule();
  };
  const onUp = e => {
    const d = drag; drag = null;
    if (!d) return;
    try { canvas.releasePointerCapture(d.id); } catch { /* it was never captured: a plain click */ }
    canvas.style.cursor = '';
    if (!d.moved) { onPick(d.i); return; }
    if (d.i >= 0) { sim.unpin(); if (reduced) sim.settle(); schedule(); }
    const p = point(e); setHover(hit(p), p.x, p.y);
  };
  const onLeave = () => { stopAround(); if (!drag) setHover(-1, 0, 0, false); };
  const onWheel = e => {
    const act = wheelAction(e, isMac);
    if (!act) return; // Ctrl + wheel is the app's own zoom
    e.preventDefault();
    stopAround(); anim = null; follow = false;
    if (act.pan) view = { k: view.k, tx: view.tx + act.pan[0], ty: view.ty + act.pan[1] };
    else { const p = point(e); view = zoomAt(view, act.zoom, p.x, p.y, kWhole * 0.7, kWhole * 16); }
    schedule();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const api = {
    keys, index, stats, sim,
    get radii() { return style.radii; },
    get view() { return view; },
    get whole() { return kWhole; },
    resize(w, h, dpr) {
      const first = !size.w;
      const was = { ...size };
      size = { w, h, dpr };
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (first) { view = wholeView(); kWhole = fitBox(boxOf(homes()), size, 36).k; }
      else { kWhole = fitBox(boxOf(homes()), size, 36).k; view = { ...view, tx: view.tx + (w - was.w) / 2, ty: view.ty + (h - was.h) / 2 }; }
      applySizes();
      schedule();
    },
    /** Another "Alike in" lens: the films flow to their new homes and settle. A picked film stays picked and the camera follows it. */
    setLayout(next) {
      map = next; layoutVer++;
      sim.retarget(next.nodes.map(p => ({ hx: p.x * WORLD, hy: p.y * WORLD })), next.links);
      linkUp();
      const wasWhole = view.k <= kWhole * 1.2;
      kWhole = fitBox(boxOf(homes()), size, 36).k;
      applySizes();
      follow = pick >= 0 && !reduced;
      if (pick < 0 && wasWhole) setView(wholeView(), true); else schedule();
    },
    /** The key's highlight: a Set of film indexes that stay lit while every other film fades dark (or null for all). */
    setKeyLit(set) { keyLit = set && set.size ? set : null; schedule(); },
    /** Light up films: a Map of film index -> strength 0..1 (or null for normal colours). */
    setGlow(g) { glow = g && g.size ? g : null; schedule(); },
    refreshTheme() { theme = readTheme(); schedule(); },
    /** Colours, dot sizes, names, and who is watched, per film index. */
    setStyle(s) {
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (s.watched[a] ? 1 : 0) - (s.watched[b] ? 1 : 0));
      tiers = s.tiers || []; steps = s.steps || 4;
      style = { ...style, ...s, order }; theme = readTheme(); applySizes(); schedule();
    },
    /** Keep only films whose key passes `keep`: the rest fade out and leave the physics; the others close up and settle. */
    setFilter(keep, { frame = true } = {}) {
      const next = keys.map(k => (keep(k) ? 1 : 0));
      if (next.every((v, i) => v === sim.alive[i])) return false;
      sim.setActive(i => next[i] === 1);
      relink();
      if (reduced) sim.settle();
      if (pick >= 0 && !sim.alive[pick]) { pick = -1; focus = null; labels = []; sim.clearGuests(); onPick(-1); }
      if (hover >= 0 && !sim.alive[hover]) { hover = -1; canvas.style.cursor = ''; stopAround(); onHover(-1, 0, 0); } // the card must not stay on a film that has left
      if (frame && aliveBox()) setView(wholeView(), true);
      schedule();
      return true;
    },
    /** The lines shown while pointing at film i: `list` is [[index, closeness 0..1]], the same list setPick gets, so a click adds no lines. */
    setHoverLines(i, list) { hoverClose = i >= 0 && list && list.length ? { i, w: new Map(list) } : null; if (i === hover) schedule(); },
    /** Pick film i (or -1) and frame it with its closest films: `list` is [[index, closeness 0..1]]. */
    setPick(i, list = [], { glide = true } = {}) {
      pick = i;
      focus = i >= 0 ? new Map(list.filter(([j]) => sim.alive[j])) : null;
      labels = i >= 0 ? [{ i, text: style.titles[i] || '', main: true }, ...[...focus.keys()].map(j => ({ i: j, text: style.titles[j] || '' }))] : [];
      sim.clearGuests(); // nothing moves: the view takes the close films in where they are (frameFocus)
      if (i >= 0 && glide) frameFocus();
      schedule();
    },
    /** Rectangles (canvas pixels) that names must keep clear of: the zoom buttons and the back button. */
    setBlocked(rects) { blocked = rects; schedule(); },
    setMatches(set) { matches = set && set.size ? set : null; schedule(); },
    /** Glide so film i sits in the middle, close enough to read. */
    show(i) {
      const k = Math.max(view.k, kWhole * 3);
      setView({ k, tx: size.w / 2 - sim.x[i] * k, ty: size.h / 2 - sim.y[i] * k }, true);
    },
    showAll() { setView(wholeView(), true); },
    zoomBy(f) {
      const v = zoomAt(view, f, size.w / 2, size.h / 2, kWhole * 0.7, kWhole * 16);
      setView(v, true);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const [ev, fn] of [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['pointerleave', onLeave]]) canvas.removeEventListener(ev, fn);
      canvas.removeEventListener('wheel', onWheel);
      clearTimeout(aroundTimer);
    },
  };
  return api;
}
