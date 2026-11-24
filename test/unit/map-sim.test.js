// The Map's live physics: it settles and stops, pulls linked films along, keeps dots apart, and heals back home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, SIM } from '../../ui/screens/map/sim.js';

// SYNTHETIC: a line of ten films, each linked to the next, laid out 20 units apart.
const nodes = Array.from({ length: 10 }, (_, i) => ({ hx: 300 + i * 20, hy: 500 }));
const links = nodes.slice(1).map((_, i) => [i, i + 1, 0.5]);

test('it starts at home and settles and stops by itself', () => {
  const s = createSim(nodes, links);
  assert.equal(s.moving, false);
  s.heat(0.5);
  assert.equal(s.moving, true);
  let t = 0;
  while (s.tick() && t < 2000) t++;
  assert.ok(t < 400, `${t} ticks`);
  assert.equal(s.moving, false);
  const before = Array.from(s.x);
  for (let k = 0; k < 20; k++) s.tick();
  assert.deepEqual(Array.from(s.x), before, 'no wobble once stopped');
});

test('dragging a film pulls the films linked to it along, and releasing lets the map heal', () => {
  const s = createSim(nodes, links);
  s.heat(0.3);
  s.settle();
  const rest = Array.from(s.x), restY = Array.from(s.y);
  for (let k = 0; k < 60; k++) { s.pin(0, 300, 500 - k * 3); s.tick(); } // drag film 0 upwards
  assert.ok(s.y[0] < 330);
  assert.ok(s.y[1] < restY[1] - 20, 'its neighbour followed');
  assert.ok(s.y[1] < s.y[5] + 0 || s.y[5] <= restY[5], 'the pull fades along the chain');
  s.unpin();
  let t = 0;
  while (s.tick() && t < 3000) t++;
  assert.equal(s.moving, false);
  for (let i = 0; i < 10; i++) assert.ok(Math.hypot(s.x[i] - rest[i], s.y[i] - restY[i]) < 6, `film ${i} is back home`);
});

test('dots never end up on top of each other', () => {
  const crowd = Array.from({ length: 40 }, (_, i) => ({ hx: 500 + (i % 7) * 1.5, hy: 500 + Math.floor(i / 7) * 1.5 }));
  const s = createSim(crowd, []);
  s.heat(0.5);
  s.settle();
  let min = Infinity;
  for (let i = 0; i < 40; i++) for (let j = i + 1; j < 40; j++) min = Math.min(min, Math.hypot(s.x[i] - s.x[j], s.y[i] - s.y[j]));
  assert.ok(min > SIM.radius * 1.2, `closest pair ${min}`);
});

test('filtering removes films from the physics, fades them out, and bringing them back fades them in at home', () => {
  const s = createSim(nodes, links);
  s.setActive(i => i < 5);
  assert.equal(s.moving, true);
  assert.equal(s.fade[7], 1, 'starts to fade, does not vanish at once');
  s.settle();
  assert.equal(s.fade[7], 0);
  assert.equal(s.fade[2], 1);
  assert.equal(s.moving, false);
  const gone = [s.x[7], s.y[7]];
  for (let k = 0; k < 30; k++) s.tick();
  assert.deepEqual([s.x[7], s.y[7]], gone, 'a removed film does not move');
  s.setActive(() => true);
  assert.equal(s.x[7], s.hx[7]);
  s.settle();
  assert.equal(s.fade[7], 1);
});

test('reduced motion: fades jump and settle() reaches rest', () => {
  const s = createSim(nodes, links, { instantFade: true });
  s.setActive(i => i % 2 === 0);
  s.settle();
  assert.equal(s.fade[1], 0);
  assert.equal(s.moving, false);
});

test('a new arrangement (another lens): the films flow to their new homes and settle there', () => {
  const s = createSim(nodes, links);
  s.heat(0.3); s.settle();
  const moved = nodes.map((p, i) => ({ hx: 300 + i * 20, hy: 400 + (i % 2) * 60 }));
  s.retarget(moved, links);
  assert.equal(s.moving, true);
  assert.ok(Math.abs(s.y[0] - 500) < 5, 'it starts from where it was');
  s.settle();
  assert.equal(s.moving, false);
  for (let i = 0; i < 10; i++) assert.ok(Math.abs(s.y[i] - moved[i].hy) < 12, `film ${i} is near its new home: ${s.y[i]} vs ${moved[i].hy}`);
});

test('a picked film\'s closest films drift in around it, the closest nearest, and go home when let go', () => {
  // film 0 in the middle; 1 and 2 far away, each tied by a strong link to a neighbour of its own (3, 4) that stays put
  const nodes = [{ hx: 500, hy: 500 }, { hx: 900, hy: 500 }, { hx: 500, hy: 100 }, { hx: 950, hy: 520 }, { hx: 520, hy: 60 }];
  const links = [[1, 3, 0.9], [2, 4, 0.9]];
  const s = createSim(nodes, links);
  const dist = (a, b) => Math.hypot(s.x[a] - s.x[b], s.y[a] - s.y[b]);
  s.setGuests(0, [[1, 1], [2, 0.3]]);
  s.settle(2000);
  assert.ok(dist(0, 1) < SIM.guestNear + 8, `closest drifts right in: ${dist(0, 1)}`);
  assert.ok(dist(0, 2) > dist(0, 1) && dist(0, 2) < SIM.guestNear + SIM.guestSpread + 10, `less close sits further out: ${dist(0, 2)}`);
  assert.ok(s.x[1] > 500, 'it comes from its own side');
  assert.ok(Math.hypot(s.x[3] - 950, s.y[3] - 520) < 30, 'the rest of the map keeps its place');
  s.clearGuests();
  s.settle(2000);
  assert.ok(Math.hypot(s.x[1] - 900, s.y[1] - 500) < 15 && Math.hypot(s.x[2] - 500, s.y[2] - 100) < 15, 'home again when let go');
});
