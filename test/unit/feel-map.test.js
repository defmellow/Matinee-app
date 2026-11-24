// The Map's layout: deterministic, linked films closer than unlinked, orphans on a ring, everything in 0..1, colours by feeling.
// Films here are SYNTHETIC: three tight groups of ten, plus three films nothing links to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { feelMap, blendColour, familyWeights, featureTable, lensEmphasis, LENSES, NEUTRAL } from '../../core/analysis/feel-map.js';

const keys = [];
for (const g of 'abc') for (let i = 0; i < 10; i++) keys.push(`${g}${i}`);
keys.push('o1', 'o2', 'o3');
const neighbours = new Map(keys.map(k => [k, []]));
for (const k of keys.slice(0, 30)) {
  const g = k[0];
  neighbours.set(k, keys.filter(o => o !== k && o[0] === g).map((o, n) => ({ key: o, score: 0.6 - n * 0.01 })));
}
// one weak bridge between groups a and b
neighbours.get('a0').push({ key: 'b0', score: 0.13 });

const m = feelMap({ keys, neighbours });
const at = key => m.nodes.find(n => n.key === key);
const dist = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);

test('the layout is deterministic', () => {
  assert.deepEqual(feelMap({ keys, neighbours }), m);
});

test('every position is inside the 0..1 box and every film is present', () => {
  assert.equal(m.total, 33);
  assert.equal(m.nodes.length, 33);
  for (const n of m.nodes) for (const v of [n.x, n.y]) assert.ok(v >= 0 && v <= 1, `${n.key} ${v}`);
  assert.ok(m.nodes.every(n => /^#[0-9a-f]{6}$/.test(n.colour)));
});

test('strongly linked films land closer than unlinked ones', () => {
  const within = [], between = [];
  for (const a of keys.slice(0, 30)) for (const b of keys.slice(0, 30)) if (a < b) (a[0] === b[0] ? within : between).push(dist(a, b));
  const mean = l => l.reduce((x, y) => x + y, 0) / l.length;
  assert.ok(mean(within) < mean(between) * 0.6, `${mean(within)} vs ${mean(between)}`);
});

test('films with no neighbour sit on a ring outside the cloud', () => {
  assert.deepEqual(m.loose, ['o1', 'o2', 'o3']);
  const cloud = m.nodes.slice(0, 30), cx = cloud.reduce((s, n) => s + n.x, 0) / 30, cy = cloud.reduce((s, n) => s + n.y, 0) / 30;
  const far = Math.max(...cloud.map(n => Math.hypot(n.x - cx, n.y - cy)));
  for (const k of m.loose) assert.ok(Math.hypot(at(k).x - cx, at(k).y - cy) > far * 0.95, k);
});

test('links point at node indexes, are not repeated, and always include a film\'s closest', () => {
  const seen = new Set();
  for (const [i, j, s] of m.links) { assert.ok(i < j && j < 33); assert.ok(s > 0); assert.ok(!seen.has(i + '-' + j)); seen.add(i + '-' + j); }
  assert.ok(seen.has('0-1') || m.links.some(([i]) => i === 0));
  assert.ok(m.near.a0.length <= 30 && m.near.a0[0][1] >= m.near.a0.at(-1)[1]);
  assert.equal(m.near.o1, undefined);
});

test('colour: tense and eerie drifts toward red, heartwarming toward yellow, nothing is neutral', () => {
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const d = (id, score) => ({ id, label: id[0].toUpperCase() + id.slice(1), facet: 'mood', score });
  const tense = blendColour(familyWeights([d('tense', 0.6), d('eerie', 0.5)]));
  const warm = blendColour(familyWeights([d('heartwarming', 0.7)]));
  assert.ok(hex(tense)[0] > hex(tense)[2] + 40 && hex(tense)[0] > hex(tense)[1] + 40, tense); // red-heavy
  assert.ok(hex(warm)[0] > hex(warm)[2] + 50 && hex(warm)[1] > hex(warm)[2] + 50, warm);      // red + green, little blue: yellow
  assert.equal(blendColour(familyWeights([])), NEUTRAL);
  assert.equal(blendColour(familyWeights([{ ...d('tense', 0.9), fragile: true }])), NEUTRAL);
  assert.equal(blendColour(familyWeights([{ ...d('tense', 0.9), facet: 'theme' }])), NEUTRAL);
});

test('empty and tiny inputs are fine', () => {
  assert.deepEqual(feelMap({}), { total: 0, nodes: [], links: [], near: {}, loose: [], lines: { top: 5, floor: 0 } });
  const one = feelMap({ keys: ['x'] });
  assert.deepEqual(one.loose, ['x']);
  assert.ok(one.nodes[0].x >= 0 && one.nodes[0].x <= 1);
});

test('the lenses of "Alike in": the cast never counts on the Map, the director only a little; feel and about lean the two ways', () => {
  assert.equal(lensEmphasis('both'), undefined);
  assert.deepEqual(lensEmphasis('feel'), { feel: 1, themes: 0.15, craft: 0.5, people: 0, directors: 0.1 });
  assert.deepEqual(lensEmphasis('about'), { feel: 0.1, themes: 1, craft: 0.1, people: 0, directors: 0.15 });
  assert.equal(lensEmphasis('nonsense'), undefined);
  assert.deepEqual(Object.keys(LENSES), ['feel', 'about']);
});

test('the feature table: strong, sure feelings and themes only, ids with one label list', () => {
  const d = (id, label, facet, score, fragile) => ({ id, label, facet, score, fragile });
  const all = { a: [d('eerie', 'Eerie', 'mood', 0.6), d('weak', 'Weak', 'mood', 0.1), d('shaky', 'Shaky', 'mood', 0.9, true), d('family', 'Family', 'theme', 0.31)], b: [d('eerie', 'Eerie', 'mood', 0.2)], c: [] };
  const t = featureTable(['a', 'b', 'c', 'missing'], k => all[k]);
  assert.deepEqual(t.feel, { a: [['eerie', 0.6], ['family', 0.31]], b: [['eerie', 0.2]] });
  assert.deepEqual(t.labels, { eerie: ['Eerie', 'mood'], family: ['Family', 'theme'] });
});

test('a weaker lens still links each film to its closest, and floors links by its own scale', () => {
  const nb = new Map(keys.map(k => [k, []]));
  for (const k of keys.slice(0, 30)) nb.set(k, keys.filter(o => o !== k && o[0] === k[0]).map((o, n) => ({ key: o, score: 0.06 - n * 0.001 })));
  const weak = feelMap({ keys, neighbours: nb });
  assert.ok(weak.links.length > 20, 'tiny absolute scores still make links when they are the library\'s best');
});
