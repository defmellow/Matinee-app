// The Map's live physics: a small force simulation that settles and stops. Pure (no DOM, no dependencies).
// World units: the layout's 0..1 box is WORLD units wide, so a node's home is (hx, hy) = layout * WORLD.
// Forces: link springs (closer films pull tighter), short-range push between neighbours (grid, not every pair),
// collision so dots never overlap, and a soft pull toward each node's HOME so the shape holds and heals.
// "alpha" is the heat: it cools to nothing and the simulation reports it has stopped, so the CPU is idle when settled.

export const WORLD = 1000;
export const SIM = {
  alphaMin: 0.004,
  decay: 0.03,         // share of the heat lost each tick
  damping: 0.55,       // share of speed lost each tick
  anchor: 0.14,        // pull toward home
  push: 0.9,           // push between neighbours closer than `reach`
  reach: 15,
  radius: 4.2,         // collision radius, world units
  springMin: 0.03,     // spring strength for a weak link; up to springMin + springGain for the closest
  springGain: 0.16,
  fadeStep: 0.1,       // per tick, towards present (1) or gone (0)
  guestNear: 24,       // a picked film's closest films drift in to this far from it (world units), the very closest nearest
  guestSpread: 46,     // and the least close up to this much further out
};

/**
 * @param nodes [{ hx, hy }] home positions in world units
 * @param links [[i, j, s]] similarity s in 0..1
 * @param opts { instantFade: bool } reduced motion: fades jump
 */
export function createSim(nodes, links, opts = {}) {
  const n = nodes.length;
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const hx = new Float64Array(n), hy = new Float64Array(n);
  const alive = new Uint8Array(n).fill(1), fade = new Float64Array(n).fill(1);
  nodes.forEach((p, i) => { hx[i] = x[i] = p.hx; hy[i] = y[i] = p.hy; });
  const ohx = Float64Array.from(hx), ohy = Float64Array.from(hy); // the layout's own homes; hx/hy differ only for a picked film's guests
  let guests = null;
  const guest = new Uint8Array(n); // 1 while a film sits beside a picked film: its own links let go of it and its new place holds it firmly
  const linkList = ls => {
    const smax = ls.reduce((m, l) => Math.max(m, l[2]), 0) || 1;
    return ls.map(([i, j, s]) => {
      const sn = Math.min(1, s / smax);
      // rest length: a share of how far apart the two sit at home, shorter for closer films
      return { i, j, rest: Math.max(SIM.radius * 2, Math.hypot(hx[i] - hx[j], hy[i] - hy[j]) * (0.55 + 0.4 * (1 - sn))), k: SIM.springMin + SIM.springGain * sn };
    });
  };
  let L = linkList(links), boost = 1;
  let alpha = 0, pinned = -1, ticks = 0;
  // each film's collision radius (world units): the drawn size, so dots never overlap once settled (setRadii)
  const R = new Float64Array(n).fill(SIM.radius);
  // grid for neighbours (cells are at least as wide as the longest pair reach)
  const gx0 = -300;
  let cell = SIM.reach, gw = Math.ceil((WORLD + 600) / cell) + 1, head = new Int32Array(gw * gw);
  const next = new Int32Array(n);
  const cellOf = v => Math.min(gw - 1, Math.max(0, Math.floor((v - gx0) / cell)));

  const sim = {
    n, x, y, hx, hy, alive, fade,
    get alpha() { return alpha; },
    get pinned() { return pinned; },
    get ticks() { return ticks; },
    /** A new arrangement (another "Alike in" lens): new homes and links, and the films flow to them, then settle. */
    retarget(next, nextLinks) {
      guests = null; guest.fill(0);
      next.forEach((p, i) => { hx[i] = ohx[i] = p.hx; hy[i] = ohy[i] = p.hy; });
      L = linkList(nextLinks);
      boost = 3; alpha = 1;
      if (opts.instantFade) { for (let i = 0; i < n; i++) if (alive[i]) { x[i] = hx[i]; y[i] = hy[i]; } sim.heat(0.3); sim.settle(); }
    },
    /** Collision radius per film in world units (`r[i]`); heats the map a little so crowded dots ease apart. */
    setRadii(r, heat = 0.25) {
      let top = 0;
      for (let i = 0; i < n; i++) { R[i] = r[i] > 0 ? r[i] : SIM.radius; top = Math.max(top, R[i]); }
      cell = Math.max(SIM.reach, 2 * top + 1);
      gw = Math.ceil((WORLD + 600) / cell) + 1;
      head = new Int32Array(gw * gw);
      alpha = Math.max(alpha, heat);
    },
    /** Heat it up (never cools an already hotter one). */
    heat(a = 0.3) { alpha = Math.max(alpha, a); },
    /** Where film i is heading (its home, or its place beside a picked film). */
    homeOf(i) { return [hx[i], hy[i]]; },
    /**
     * A picked film's closest films drift in around it while it is picked: each keeps the side it came from, the closest nearest.
     * `list` is [[film, closeness 0..1]]. A film already nearer than its place stays where it is. The rest of the map keeps its homes.
     */
    setGuests(c, list = []) {
      sim.clearGuests(false);
      if (c < 0 || !list.length) return;
      guests = [];
      list.forEach(([j, close], k) => {
        if (j === c || j == null) return;
        let dx = ohx[j] - ohx[c], dy = ohy[j] - ohy[c];
        const d = Math.hypot(dx, dy);
        if (d < 1e-6) { dx = Math.cos(k * 2.4); dy = Math.sin(k * 2.4); } else { dx /= d; dy /= d; }
        const ring = Math.min(d, SIM.guestNear + SIM.guestSpread * (1 - Math.max(0, Math.min(1, close))));
        hx[j] = ohx[c] + dx * ring; hy[j] = ohy[c] + dy * ring;
        guests.push(j); guest[j] = 1;
      });
      sim.stir();
    },
    /** Send a picked film's guests home again. */
    clearGuests(stir = true) {
      if (!guests) return;
      for (const j of guests) { hx[j] = ohx[j]; hy[j] = ohy[j]; guest[j] = 0; }
      guests = null;
      if (stir) sim.stir();
    },
    /** Warm the map enough for films to reach new homes (jump there at once with less motion). */
    stir() {
      boost = Math.max(boost, 2.5); alpha = Math.max(alpha, 0.8);
      if (opts.instantFade) { for (let i = 0; i < n; i++) if (alive[i]) { x[i] = hx[i]; y[i] = hy[i]; } sim.settle(); }
    },
    /** Hold node i at (px, py); its links pull the others along. */
    pin(i, px, py) {
      pinned = i; x[i] = px; y[i] = py; vx[i] = vy[i] = 0;
      alpha = Math.max(alpha, 0.35);
    },
    unpin() { if (pinned >= 0) { pinned = -1; alpha = 1; } },
    /** Which films are on the map: `keep(i)` true for those that stay. The rest fade out and leave the physics. */
    setActive(keep, heat = 0.4) {
      for (let i = 0; i < n; i++) {
        const on = keep(i) ? 1 : 0;
        if (on && !alive[i]) { x[i] = hx[i]; y[i] = hy[i]; vx[i] = vy[i] = 0; if (opts.instantFade) fade[i] = 0; }
        if (!on && opts.instantFade) fade[i] = 0;
        alive[i] = on;
      }
      if (pinned >= 0 && !alive[pinned]) pinned = -1;
      alpha = Math.max(alpha, heat);
    },
    /** True while something is still moving or fading (draw and tick again). */
    get moving() {
      if (alpha > SIM.alphaMin || pinned >= 0) return true;
      for (let i = 0; i < n; i++) if (fade[i] !== alive[i]) return true;
      return false;
    },
    /** One step. Returns whether more steps are needed. */
    tick() {
      ticks++;
      for (let i = 0; i < n; i++) { // fades
        const t = alive[i];
        if (fade[i] !== t) fade[i] = opts.instantFade ? t : t ? Math.min(1, fade[i] + SIM.fadeStep) : Math.max(0, fade[i] - SIM.fadeStep);
      }
      if (alpha > SIM.alphaMin || pinned >= 0) {
        const a = alpha;
        for (const l of L) { // springs
          const i = l.i, j = l.j;
          if (!alive[i] || !alive[j] || guest[i] || guest[j]) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          const d = Math.hypot(dx, dy) || 1e-6;
          const f = ((d - l.rest) / d) * l.k * a;
          dx *= f; dy *= f;
          if (i !== pinned) { vx[i] += dx; vy[i] += dy; }
          if (j !== pinned) { vx[j] -= dx; vy[j] -= dy; }
        }
        head.fill(-1);
        for (let i = 0; i < n; i++) if (alive[i]) { const c = cellOf(y[i]) * gw + cellOf(x[i]); next[i] = head[c]; head[c] = i; }
        const r2 = SIM.reach * SIM.reach;
        for (let i = 0; i < n; i++) { // push and collide, each pair once
          if (!alive[i]) continue;
          const cx = cellOf(x[i]), cy = cellOf(y[i]);
          for (let gy = Math.max(0, cy - 1); gy <= Math.min(gw - 1, cy + 1); gy++) {
            for (let gxx = Math.max(0, cx - 1); gxx <= Math.min(gw - 1, cx + 1); gxx++) {
              for (let j = head[gy * gw + gxx]; j !== -1; j = next[j]) {
                if (j <= i) continue;
                let dx = x[j] - x[i], dy = y[j] - y[i];
                let d2 = dx * dx + dy * dy;
                const rad = R[i] + R[j];
                if (d2 >= r2 && d2 >= rad * rad) continue;
                if (d2 < 1e-6) { dx = ((i * 7919 + j) % 13) / 13 - 0.5 + 1e-3; dy = ((i * 104729 + j) % 11) / 11 - 0.5 + 1e-3; d2 = dx * dx + dy * dy; }
                const d = Math.sqrt(d2);
                let f = d < SIM.reach ? SIM.push * (1 - d / SIM.reach) * a / d : 0;
                if (d < rad) f += ((rad - d) * 0.5) / d; // collision pushes apart straight away, whatever the heat
                dx *= f; dy *= f;
                if (i !== pinned) { vx[i] -= dx; vy[i] -= dy; }
                if (j !== pinned) { vx[j] += dx; vy[j] += dy; }
              }
            }
          }
        }
        const keep = 1 - SIM.damping, anchorK = SIM.anchor * a * boost * (pinned >= 0 ? 0.25 : 1); // while a film is held, the map lets go of home a little so the pull shows
        for (let i = 0; i < n; i++) { // anchor, then move
          if (!alive[i] || i === pinned) continue;
          const ak = guest[i] ? Math.max(anchorK * 4, 0.05) : anchorK;
          vx[i] += (hx[i] - x[i]) * ak; vy[i] += (hy[i] - y[i]) * ak;
          vx[i] *= keep; vy[i] *= keep;
          x[i] += vx[i]; y[i] += vy[i];
        }
        alpha += (0 - alpha) * SIM.decay;
        if (alpha <= SIM.alphaMin && pinned < 0) { alpha = 0; boost = 1; vx.fill(0); vy.fill(0); } // settled: stop
      }
      return sim.moving;
    },
    /** Run to rest without drawing (the start, and reduced motion). */
    settle(maxTicks = 400) {
      let t = 0;
      while (sim.tick() && t++ < maxTicks) { if (pinned >= 0) break; }
      return t;
    },
  };
  return sim;
}
