// Synthetic fixtures only. Fake feel similarity is injected so the arithmetic is checkable by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFit, zFn, tierOf, crowdOf, CAUTION_SIM } from '../../core/analysis/fit.js';
import { buildFeelIndex } from '../../core/analysis/feel/index.js';

const film = (key, score, rating = null) => ({ key, score, year: 2000, user: { watched: rating != null, rating } });

// R1..R3 rated; candidates A, B, C. Sims are fixed per (target, neighbour).
const SIMS = { A: { R1: 0.4, R2: 0.1 }, B: { R3: 0.4 }, C: {} };
const similarFn = (idx, key, { among }) => Object.entries(SIMS[key] || {}).filter(([k]) => among.includes(k)).map(([key2, score]) => ({ key: key2, score })).sort((a, b) => b.score - a.score);
const COV = { A: { viewers: 3 }, B: { critics: 1 }, C: { editors: 2 } };
const profileFn = (idx, key) => ({ coverage: COV[key] || {} });
const summaries = [film('R1', 80, 10), film('R2', 50, 4), film('R3', 60, 2), film('A', 70), film('B', 70), film('C', 90)];

test('zFn handles flat lists and normal ones', () => {
  assert.equal(zFn([5, 5, 5])(5), 0);
  const z = zFn([1, 2, 3]);
  assert.ok(Math.abs(z(2)) < 1e-9);
  assert.ok(z(3) > 1 && z(1) < -1);
});

test('tierOf follows what the film has', () => {
  assert.equal(tierOf({ viewers: 1, critics: 1 }), 'know');
  assert.equal(tierOf({ critics: 2 }), 'fair');
  assert.equal(tierOf({ editors: 5 }), 'guess');
  assert.equal(tierOf(null), 'guess');
});

test('crowdOf uses the score, falls back to ratings', () => {
  assert.equal(crowdOf({ score: 77 }), 77);
  assert.equal(crowdOf({ ratings: { imdb: { value: 8, votes: 100000 } } }), 71); // IMDb alone: 34 + 26 * z(8.0)
  assert.equal(crowdOf({}), null);
});

test('kNN: similarity-weighted deviation from the mean, with the 0.5 prior', () => {
  const m = buildFit({ summaries, feel: {}, similarFn, profileFn });
  const mean = (10 + 4 + 2) / 3;
  const a = m.fit('A');
  assert.equal(a.neighbours.length, 2);
  assert.deepEqual(a.neighbours[0], { key: 'R1', sim: 0.4, rating: 10 });
  const expected = (0.4 * (10 - mean) + 0.1 * (4 - mean)) / (0.5 + 0.5);
  assert.ok(Math.abs(a.raw.knn - expected) < 1e-9);
  assert.equal(m.fit('C').raw.knn, 0);
});

test('fit blends the two z-scores 50/50 over the candidate pool', () => {
  const m = buildFit({ summaries, feel: {}, similarFn, profileFn });
  const a = m.fit('A'), b = m.fit('B');
  assert.ok(Math.abs(a.score - (0.5 * a.z.crowd + 0.5 * a.z.feel)) < 1e-9);
  assert.equal(a.tier, 'know');
  assert.equal(b.tier, 'fair');
  assert.ok(a.score > b.score, 'liked neighbour beats disliked neighbour at equal crowd score');
});

test('article-only films are ranked on the crowd alone', () => {
  const m = buildFit({ summaries, feel: {}, similarFn, profileFn });
  const c = m.fit('C');
  assert.equal(c.tier, 'guess');
  assert.equal(c.score, c.z.crowd);
});

test('caution names a close film the user rated 2.5 stars or less', () => {
  const m = buildFit({ summaries, feel: {}, similarFn, profileFn });
  assert.deepEqual(m.fit('B').caution, { key: 'R3', rating: 2 });
  assert.equal(m.fit('A').caution, null, 'R2 is 2 stars but only 0.1 similar');
  assert.ok(CAUTION_SIM > 0.1 && CAUTION_SIM <= 0.4);
});

test('rank sorts best first and is stable', () => {
  const m = buildFit({ summaries, feel: {}, similarFn, profileFn });
  const r = m.rank(['A', 'B', 'C']);
  assert.deepEqual([...r].sort(), ['A', 'B', 'C']);
  assert.deepEqual(m.rank(['C', 'B', 'A']), r);
  assert.equal(m.rank(['x']).length, 1);
});

test('year and today never change the ranking', () => {
  const m1 = buildFit({ summaries, feel: {}, similarFn, profileFn, today: '2026-10-22' });
  const shuffled = summaries.map((s, i) => ({ ...s, year: 1900 + i * 17 }));
  const m2 = buildFit({ summaries: shuffled, feel: {}, similarFn, profileFn, today: '1999-01-01' });
  assert.deepEqual(m2.rank(['A', 'B', 'C']), m1.rank(['A', 'B', 'C']));
  assert.equal(m2.fit('A').score, m1.fit('A').score);
});

test('no rated films, missing scores and an empty library do not throw', () => {
  const m = buildFit({ summaries: [film('A', null), film('B', 60)], feel: {}, similarFn, profileFn });
  assert.equal(m.fit('A').score, 0);
  assert.equal(Number.isFinite(m.fit('B').score), true);
  assert.deepEqual(buildFit({ summaries: [], feel: {} }).rank([]), []);
});

test('works against a real feel index (synthetic films)', () => {
  const mk = (key, text, voice = 'viewers') => ({ key, title: key, texts: [{ voice, source: 't', text }], genres: [], people: {} });
  const inputs = [
    mk('R1', 'A tender, wistful and moving drama, slow and beautiful.'),
    mk('R2', 'A loud, frantic and brutal action film, relentless and violent.'),
    mk('A', 'A tender, wistful and moving story, quietly beautiful.'),
    mk('B', 'A loud, frantic and brutal chase, violent and relentless.', 'critics'),
  ];
  const feel = buildFeelIndex(inputs);
  const s = [film('R1', 70, 10), film('R2', 70, 2), film('A', 70), film('B', 70)];
  const m = buildFit({ summaries: s, feel });
  const a = m.fit('A'), b = m.fit('B');
  assert.equal(a.tier, 'know');
  assert.equal(b.tier, 'fair');
  assert.ok(a.score > b.score);
});
