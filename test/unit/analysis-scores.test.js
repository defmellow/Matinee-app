// Synthetic ratings only: nothing here is real film data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matineeScore, yourTake, hotTakes } from '../../core/analysis/scores.js';

const byLabel = (r, source) => r.parts.find(p => p.source === source);
// The mapping, written out again here: score = CENTRE + SPREAD * zbar / shrink(k), k = (sum w)^2 / sum w^2.
const CENTRE = 34, SPREAD = 26, RHO = 0.7;
const mapped = (zs, ws, bases = ws) => {
  const ev = ws.length === 1 ? ws[0] / bases[0] : 1;
  const sw = ws.reduce((a, b) => a + b), k = sw * sw / ws.reduce((a, b) => a + b * b, 0);
  const zbar = zs.reduce((a, z, i) => a + z * ws[i], 0) / sw;
  return Math.round(Math.min(100, Math.max(0, CENTRE + SPREAD * ev * zbar / Math.sqrt((1 + (k - 1) * RHO) / k))));
};

test('score is null with no ratings at all', () => {
  assert.deepEqual(matineeScore(null), { score: null, parts: [] });
  assert.deepEqual(matineeScore(undefined), { score: null, parts: [] });
  assert.deepEqual(matineeScore({}), { score: null, parts: [] });
  assert.deepEqual(matineeScore({ imdb: null, rt: {}, metacritic: { critics: null } }), { score: null, parts: [] });
});

test('each source is normalised to 0–100 and shown with its display text', () => {
  const r = matineeScore({
    letterboxd: { value: 4.36, votes: 10000 },
    imdb: { value: 8.1, votes: 10000 },
    rt: { critics: 95, criticsCount: 100, audience: 89, audienceCount: 10000 },
    metacritic: { critics: 78, criticsCount: 100, users: 8.2, usersCount: 10000 },
    tmdb: { value: 7.9, votes: 10000 },
  });
  assert.equal(r.parts.length, 7);
  assert.deepEqual(r.parts.map(p => p.source), ['letterboxd', 'imdb', 'rt-critics', 'rt-audience', 'metacritic', 'metacritic-users', 'tmdb']);
  assert.deepEqual(r.parts.map(p => p.display), [
    'Letterboxd 4.36', 'IMDb 8.1', 'Rotten Tomatoes 95%', 'Popcornmeter 89%', 'Metacritic 78', 'Metacritic users 8.2', 'TMDB 7.9',
  ]);
  assert.deepEqual(r.parts.map(p => p.label), ['Letterboxd', 'IMDb', 'Rotten Tomatoes', 'Popcornmeter', 'Metacritic', 'Metacritic users', 'TMDB']);
  assert.deepEqual(r.parts.map(p => p.value100), [87.2, 81, 95, 89, 78, 82, 79]);
});

test('with full confidence the weights are the base weights and the score is the weighted mean of the z-scores', () => {
  const r = matineeScore({
    letterboxd: { value: 4, votes: 10000 },  // 80, weight 0.7
    imdb: { value: 6, votes: 100000 },       // 60, weight 1.0
    tmdb: { value: 10, votes: 10000 },       // 100, weight 0.4
  });
  assert.deepEqual(r.parts.map(p => p.weight), [0.7, 1, 0.4]);
  // z against the frozen references: letterboxd (80-66)/9, imdb (60-65.8)/10.1, tmdb (100-65)/9
  assert.equal(r.score, mapped([14 / 9, -5.8 / 10.1, 35 / 9], [0.7, 1, 0.4]));
  assert.equal(r.score, 62);
});

test('a single source is mapped straight from its own z-score (no shrink correction, so never inflated)', () => {
  assert.equal(matineeScore({ imdb: { value: 7.4, votes: 50000 } }).score, Math.round(34 + 26 * (74 - 65.8) / 10.1));
  assert.equal(matineeScore({ imdb: { value: 8.1, votes: 50000 } }).score, 73);
  assert.equal(matineeScore({ rt: { critics: 91, criticsCount: 200 } }).score, Math.round(34 + 26 * 41 / 29)); // RT runs wide
  assert.equal(matineeScore({ letterboxd: { value: 3.5, votes: 100000 } }).score, Math.round(34 + 26 * 4 / 9));
});

test('spread: a film every source loves reaches the 90s, an all-average film sits at the centre', () => {
  const high = matineeScore({
    letterboxd: { value: 4.4, votes: 100000 }, imdb: { value: 8.8, votes: 500000 },
    rt: { critics: 97, criticsCount: 300, audience: 95, audienceCount: 20000 },
    metacritic: { critics: 90, criticsCount: 60, users: 8.8, usersCount: 5000 },
  });
  assert.ok(high.score >= 92, `all-high film scored ${high.score}`);
  const average = matineeScore({
    letterboxd: { value: 3.3, votes: 100000 }, imdb: { value: 6.58, votes: 500000 },
    rt: { critics: 50, criticsCount: 300, audience: 65.2, audienceCount: 20000 },
    metacritic: { critics: 54, criticsCount: 60, users: 6.37, usersCount: 5000 },
  });
  assert.ok(Math.abs(average.score - 34) <= 2, `average film scored ${average.score}`);
});

test('single-source films are not stretched: one great source scores below the same greatness across sources', () => {
  const one = matineeScore({ imdb: { value: 8.8, votes: 500000 } }).score;
  const many = matineeScore({
    imdb: { value: 8.8, votes: 500000 }, letterboxd: { value: 4.4, votes: 100000 },
    rt: { critics: 98, criticsCount: 300 }, metacritic: { critics: 92, criticsCount: 60 },
  }).score;
  assert.equal(one, Math.round(34 + 26 * (88 - 65.8) / 10.1)); // exactly its own z, unscaled
  assert.ok(one < many);
});

test('a single rating on very little evidence is pulled toward the centre', () => {
  const few = matineeScore({ metacritic: { critics: 98, criticsCount: 5 } }).score;   // weight 0.9 * 0.35
  const many = matineeScore({ metacritic: { critics: 98, criticsCount: 100 } }).score;
  assert.ok(few < many && few < 80, `few ${few}, many ${many}`);
  assert.equal(many, 100);
});

test('the score never goes down when a source gets better', () => {
  let last = -1;
  for (let v = 3; v <= 9.5; v += 0.5) {
    const s = matineeScore({ imdb: { value: v, votes: 100000 }, rt: { critics: 70, criticsCount: 200 }, metacritic: { critics: 65, criticsCount: 50 } }).score;
    assert.ok(s >= last, `imdb ${v}: ${s} < ${last}`);
    last = s;
  }
  last = -1;
  for (let c = 0; c <= 100; c += 10) {
    const s = matineeScore({ rt: { critics: c, criticsCount: 200 } }).score;
    assert.ok(s >= last);
    last = s;
  }
});

test('confidence: more votes weigh more, clamped between 0.25 and 1', () => {
  const w = votes => matineeScore({ imdb: { value: 7, votes } }).parts[0].weight;
  assert.equal(w(10000), 1);
  assert.equal(w(1e7), 1);                 // capped
  assert.equal(w(1000), 0.75);
  assert.equal(w(100), 0.5);
  assert.equal(w(3), 0.25);                // floor
  assert.equal(w(0), 0.25);
  assert.equal(w(undefined), 0.6);         // unknown count
  assert.equal(w(null), 0.6);
});

test('critic counts reach full weight at 100 reviews', () => {
  const w = n => matineeScore({ rt: { critics: 80, criticsCount: n } }).parts[0].weight;
  assert.equal(w(100), 0.6);
  assert.equal(w(10), 0.3);                // 0.6 * 0.5
  assert.equal(w(5000), 0.6);
  assert.equal(w(undefined), 0.36);        // 0.6 * 0.6
  assert.equal(w(1), 0.15);                // 0.6 * 0.25
  const m = n => matineeScore({ metacritic: { critics: 80, criticsCount: n } }).parts[0].weight;
  assert.equal(m(50), Math.round(0.9 * (Math.log10(50) / 2) * 1000) / 1000);
});

test('a popular rating outweighs an obscure one', () => {
  const r = matineeScore({
    letterboxd: { value: 5, votes: 100000 },  // 100, weight 1
    imdb: { value: 1, votes: 10 },            // 10, weight 0.25
  });
  // letterboxd z = (100-66)/9 at weight 0.7, imdb z = (10-65.8)/10.1 at weight 0.25
  assert.equal(r.score, mapped([34 / 9, -55.8 / 10.1], [0.7, 0.25], [0.7, 1]));
  assert.ok(r.score > 65);               // the obscure 1/10 barely dents it
});

test('zero means "no ratings yet" for the 0-means-none sources, but 0% is a real critics score', () => {
  assert.deepEqual(matineeScore({ tmdb: { value: 0, votes: 0 }, imdb: { value: 0 }, letterboxd: { value: 0 } }).parts, []);
  assert.equal(matineeScore({ rt: { critics: 0, criticsCount: 100 } }).score, 0); // a real, very low critics score: 34 - 26*50/29 clamps to 0
});

test('bad values are ignored, out-of-range ones clamped', () => {
  const r = matineeScore({ imdb: { value: NaN }, letterboxd: { value: '4.5' }, tmdb: { value: 12, votes: 10000 }, rt: { critics: -5 } });
  assert.deepEqual(r.parts.map(p => p.source), ['tmdb']);
  assert.equal(r.parts[0].value100, 100);
});

test('rt audience and critics are separate parts; a missing half does not break the other', () => {
  const r = matineeScore({ rt: { audience: 70, audienceCount: 10000 } });
  assert.deepEqual(r.parts.map(p => p.source), ['rt-audience']);
  assert.equal(r.parts[0].weight, 0.5);
  assert.equal(r.score, Math.round(34 + 26 * (70 - 65.2) / 18.1)); // 70% against a 65.2 / 18.1 reference
});

test('score rounds to an integer', () => {
  const r = matineeScore({ letterboxd: { value: 3.33, votes: 10000 } }); // 66.6 -> z = 0.6 / 9 -> 34 + 26 * z = 35.73
  assert.equal(r.score, 36);
  assert.equal(Number.isInteger(r.score), true);
});

test('yourTake is your rating on a 100 scale minus the score', () => {
  assert.equal(yourTake(9, 70), 20);
  assert.equal(yourTake(5, 80), -30);
  assert.equal(yourTake(1, 10), 0);
  assert.equal(yourTake(null, 70), null);
  assert.equal(yourTake(8, null), null);
  assert.equal(yourTake(undefined, undefined), null);
  assert.equal(yourTake(0, 50), -50); // 0 is a number, not "missing"
});

const s = (key, title, rating, score, watched = true) => ({ key, title, score, user: { watched, rating } });

test('hotTakes splits films you rate above and below the crowd, biggest gap first', () => {
  const list = [
    s('a', 'Alpha', 10, 60),   // +40
    s('b', 'Bravo', 9, 80),    // +10
    s('c', 'Charlie', 2, 70),  // -50
    s('d', 'Delta', 6, 70),    // -10
    s('e', 'Echo', 7, 70),     // 0: neither
    s('f', 'Foxtrot', 8, 40),  // +40 ties Alpha: title decides
  ];
  const { higher, lower } = hotTakes(list);
  assert.deepEqual(higher, [{ key: 'a', diff: 40 }, { key: 'f', diff: 40 }, { key: 'b', diff: 10 }]);
  assert.deepEqual(lower, [{ key: 'c', diff: -50 }, { key: 'd', diff: -10 }]);
});

test('hotTakes only counts watched, rated films that have a score', () => {
  const list = [
    s('a', 'A', 10, 50),
    s('b', 'B', null, 50),          // unrated
    s('c', 'C', 10, null),          // no score
    s('d', 'D', 10, 50, false),     // not watched (e.g. watchlist film with a stray rating)
    { key: 'e', title: 'E', score: 50 }, // no user data at all
  ];
  assert.deepEqual(hotTakes(list).higher, [{ key: 'a', diff: 50 }]);
  assert.deepEqual(hotTakes(list).lower, []);
});

test('hotTakes respects n and handles empty input', () => {
  const list = Array.from({ length: 15 }, (_, i) => s(`k${i}`, `T${i}`, 10, 10 + i));
  assert.equal(hotTakes(list).higher.length, 10);
  assert.equal(hotTakes(list, { n: 3 }).higher.length, 3);
  assert.deepEqual(hotTakes(list, { n: 3 }).higher.map(x => x.key), ['k0', 'k1', 'k2']);
  assert.deepEqual(hotTakes([]), { higher: [], lower: [] });
  assert.deepEqual(hotTakes(undefined), { higher: [], lower: [] });
  assert.deepEqual(hotTakes(list, { n: 0 }), { higher: [], lower: [] });
});

test('hotTakes does not change its input', () => {
  const list = [s('b', 'B', 10, 50), s('a', 'A', 2, 50)];
  const copy = JSON.parse(JSON.stringify(list));
  hotTakes(list);
  assert.deepEqual(list, copy);
});

test('an RT-only 100% does not outrank an IMDb 8.5 film', () => {
  const rt = matineeScore({ rt: { critics: 100, criticsCount: 300 } }).score;
  const imdb = matineeScore({ imdb: { value: 8.5, votes: 200000 } }).score;
  assert.ok(rt <= imdb, `${rt} vs ${imdb}`);
});

test('score is clamped to 0–100', () => {
  assert.ok(matineeScore({ tmdb: { value: 10, votes: 10000 } }).score <= 100);
  assert.ok(matineeScore({ rt: { critics: 0, criticsCount: 500 }, metacritic: { critics: 1, criticsCount: 50 } }).score >= 0);
});
