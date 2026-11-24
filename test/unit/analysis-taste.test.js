// Taste profile and Tonight picker tests. All films and people here are SYNTHETIC (invented for the tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../core/analysis/similarity.js';
import { tasteProfile, rankTonight, blindSpots, stars, formatMinutes } from '../../core/analysis/taste.js';

const P = (name, id) => ({ name, id });
function film(key, title, year, o = {}) {
  return {
    key, title, year, runtime: o.runtime === undefined ? 100 : o.runtime,
    genres: o.genres ?? [], countries: o.countries ?? [], languages: o.languages ?? [],
    people: { director: [], writer: [], cinematography: [], composer: [], editor: [], cast: [], ...(o.people || {}) },
    keywords: o.keywords ?? [], subjects: o.subjects ?? [], collection: o.collection ?? null, basedOn: o.basedOn ?? [],
    awards: [], score: o.score ?? null, ratings: {},
    user: { watched: false, rating: null, liked: false, watchlist: false, watchlistOrder: null, tags: [], ...(o.user || {}) },
    timesWatched: 0, lastWatched: null,
  };
}
const seen = (rating, liked = false) => ({ watched: true, rating, liked });
const waiting = { watchlist: true };

const vogt = P('Lena Vogt', 'wd:Q1001');
const mullner = P('Jonas Müllner', 'wd:Q1002');
const aranda = P('Tomás Aranda', 'wd:Q1003');
const hanne = P('Hanne Brandt', 'tmdb:2001');
const pavel = P('Pavel Kuric', 'tmdb:2002');
const haddad = P('Omar Haddad', 'wd:Q1010');
const aydin = P('Selin Aydin', 'wd:Q1011');
const nakamura = P('Kai Nakamura', 'wd:Q1012');
const whitfield = P('Dana Whitfield', 'wd:Q1020');
const bell = P('Marcus Bell', 'tmdb:2010');
const delgado = P('Rosa Delgado', 'wd:Q1030');

function fixture() {
  return [
    film('w1', 'Highway Dust', 1984, { genres: ['Drama', 'Adventure'], countries: ['Germany'], languages: ['German'], keywords: ['road trip', 'friendship'],
      people: { director: [vogt], cinematography: [mullner], composer: [aranda], cast: [hanne, pavel] }, user: seen(10, true) }),
    film('w2', 'Desert Postcard', 1985, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], keywords: ['road trip'],
      people: { director: [vogt], cinematography: [mullner], composer: [aranda], cast: [hanne] }, user: seen(9) }),
    film('w3', 'Night Station', 1987, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], runtime: 150, score: 84,
      people: { director: [vogt], cast: [pavel] }, user: waiting }),
    film('w4', 'Border Lights', 1986, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], keywords: ['road trip'],
      people: { director: [P('Ines Falk', 'wd:Q1005')], cast: [P('Ole Brandt', 'tmdb:2005')] } }),
    film('s1', 'Sand Orbit', 2021, { genres: ['Science Fiction', 'Adventure'], countries: ['United States'], languages: ['English'], collection: 'Sand Orbit Collection',
      people: { director: [haddad], writer: [aydin], composer: [nakamura] }, user: seen(8) }),
    film('s2', 'Sand Orbit: Part Two', 2024, { genres: ['Science Fiction', 'Adventure'], countries: ['United States'], languages: ['English'], collection: 'Sand Orbit Collection',
      people: { director: [haddad], writer: [aydin], composer: [nakamura] }, user: seen(9) }),
    film('s3', 'Cold Signal', 2016, { genres: ['Science Fiction', 'Drama'], countries: ['United States'], runtime: 110, score: 72,
      people: { director: [haddad], writer: [aydin] }, user: waiting }),
    film('s4', 'Glass Planet', 2014, { genres: ['Science Fiction'], countries: ['United States'], runtime: null, people: { director: [P('Rufus Cole', 'wd:Q1040')] }, user: waiting }),
    film('t1', 'Paper Alibi', 1994, { genres: ['Thriller', 'Crime'], countries: ['United States'], people: { director: [whitfield], cast: [bell] }, user: seen(7) }),
    film('t2', 'Last Edit', 1996, { genres: ['Thriller'], countries: ['United States'], runtime: 95, score: 88, people: { director: [whitfield], cast: [bell] }, user: waiting }),
    film('t3', 'Midnight Ledger', 1997, { genres: ['Thriller', 'Crime'], countries: ['United States'], people: { director: [P('Gil Navarro', 'wd:Q1041')], cast: [bell] }, user: seen(5) }),
    film('c1', 'Laundromat Love', 1996, { genres: ['Comedy', 'Romance'], countries: ['United States'], people: { director: [delgado] }, user: seen(6) }),
    film('c2', 'Sunday Brunch', 1998, { genres: ['Comedy', 'Romance'], countries: ['United States'], runtime: 90, people: { director: [delgado] }, user: { ...waiting, tags: ['cozy'] } }),
    film('x1', 'Bare Bones', 1975, { genres: ['Drama'] }),
    film('x2', 'Lonely Western', 1952, { genres: ['Western'], countries: ['Argentina'], languages: ['Spanish'], user: waiting }),
  ];
}
const watchlist = (films) => films.filter((f) => f.user.watchlist);

test('stars and runtime wording', () => {
  assert.equal(stars(10), '★★★★★');
  assert.equal(stars(9), '★★★★½');
  assert.equal(stars(7), '★★★½');
  assert.equal(stars(2), '★');
  assert.equal(stars(1), '½');
  assert.equal(formatMinutes(100), '1 h 40 m');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(formatMinutes(45), '45 m');
});

test('tasteProfile: mean, shrunk affinities, labels and counts', () => {
  const films = fixture();
  const p = tasteProfile(films);
  const rated = [10, 9, 8, 9, 7, 5, 6];
  assert.ok(Math.abs(p.mean - rated.reduce((a, b) => a + b) / rated.length) < 1e-9);
  assert.equal(p.ratedCount, 7);

  const d = p.features.get('director:wd:Q1001');
  assert.equal(d.label, 'Lena Vogt');
  assert.equal(d.count, 2);
  // (10 − mean + 1 liked) + (9 − mean), shrunk by count + 3.
  const expected = ((10 - p.mean + 1) + (9 - p.mean)) / (2 + 3);
  assert.ok(Math.abs(d.affinity - expected) < 1e-9);
  assert.ok(d.affinity > 0.5);

  assert.ok(p.features.get('director:wd:Q1030').affinity < 0, 'a director whose film you rated below your average');
  assert.ok(p.features.get('genre:drama').affinity > 0);
  assert.ok(p.features.get('genre:comedy') === undefined, 'seen once, not a director: ignored');
  assert.ok(p.features.get('director:wd:Q1020'), 'a director seen once is kept');
  assert.ok(!p.features.has('cast:tmdb:2002') || p.features.get('cast:tmdb:2002').count >= 2);
  assert.ok(!p.features.has('cast:tmdb:2005'), 'unwatched films contribute nothing');
});

test('tasteProfile: liked adds a point of affinity, and shrinkage keeps rare features modest', () => {
  const mk = (liked) => [
    film('a', 'A', 2000, { genres: ['Drama'], user: seen(8, liked) }),
    film('b', 'B', 2001, { genres: ['Drama'], user: seen(6) }),
    film('c', 'C', 2002, { genres: ['Horror'], user: seen(6) }),
    film('d', 'D', 2003, { genres: ['Horror'], user: seen(8) }),
  ];
  const plain = tasteProfile(mk(false)).features.get('genre:drama').affinity;
  const liked = tasteProfile(mk(true)).features.get('genre:drama').affinity;
  assert.ok(Math.abs(liked - plain - 1 / 5) < 1e-9, '+1 on one film, divided by count + 3');
  assert.ok(Math.abs(plain) < 1e-9);

  const few = tasteProfile([film('a', 'A', 2000, { genres: ['Drama'], user: seen(10) }), film('b', 'B', 2001, { genres: ['Drama'], user: seen(10) }), film('c', 'C', 2002, { genres: ['Horror'], user: seen(2) })]);
  assert.ok(few.features.get('genre:drama').affinity < few.mean * 0.5, 'two films do not outshout the average');
});

test('tasteProfile: no ratings gives an empty profile', () => {
  const p = tasteProfile([film('a', 'A', 2000, { genres: ['Drama'], user: { watched: true } }), film('b', 'B', 2000)]);
  assert.equal(p.mean, null);
  assert.equal(p.features.size, 0);
  assert.equal(tasteProfile([]).features.size, 0);
  assert.equal(tasteProfile().features.size, 0);
});

test('rankTonight: ranks the watchlist by taste and closeness to favourites', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const profile = tasteProfile(films);
  const r = rankTonight(profile, idx, watchlist(films));
  assert.equal(r.length, 6);
  assert.equal(r[0].key, 'w3', 'a director you adore beats everything');
  const rank = (k) => r.findIndex((x) => x.key === k);
  assert.ok(rank('w3') < rank('s3'));
  assert.ok(rank('s3') < rank('c2'), 'sci-fi you like beats a comedy you rated below average');
  assert.ok(rank('x2') < rank('c2'), 'unknown territory beats a disliked one');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].fit >= r[i].fit);
  for (const x of r) { assert.ok(Number.isInteger(x.fit) && x.fit >= 0 && x.fit <= 100); assert.ok(x.reasons.length <= 3); }
});

test('rankTonight: reasons read as sentences', () => {
  const films = fixture();
  const r = rankTonight(tasteProfile(films), buildIndex(films), watchlist(films));
  const w3 = r.find((x) => x.key === 'w3');
  assert.deepEqual(w3.reasons, ['Because you rated Highway Dust ★★★★★', 'You rate Lena Vogt highly', 'Highly rated everywhere (84)']);
});

test('rankTonight: time filter drops long films and films with no runtime (P0 eligibility)', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const profile = tasteProfile(films);
  const list = watchlist(films);
  const open = rankTonight(profile, idx, list);
  const capped = rankTonight(profile, idx, list, { maxMinutes: 120 });
  assert.ok(open.some((x) => x.key === 'w3'));
  assert.ok(!capped.some((x) => x.key === 'w3'), '150 minutes does not fit in 120');
  assert.ok(open.some((x) => x.key === 's4'), 'unknown runtime is fine with no time cap');
  assert.ok(!capped.some((x) => x.key === 's4'), 'unknown runtime fails any time cap');
  assert.equal(capped.find((x) => x.key === 's3').fit, open.find((x) => x.key === 's3').fit, 'known runtimes are not penalised');
  // `minutes` works the same when maxMinutes is not given, and maxMinutes wins when both are.
  assert.deepEqual(rankTonight(profile, idx, list, { minutes: 120 }), capped);
  assert.deepEqual(rankTonight(profile, idx, list, { minutes: 30, maxMinutes: 120 }), capped);
});

test('rankTonight: "Fits in …" reason', () => {
  const films = fixture();
  const r = rankTonight(tasteProfile(films), buildIndex(films), watchlist(films), { maxMinutes: 100 });
  assert.deepEqual(r.find((x) => x.key === 't2').reasons, ['Fits in 1 h 40 m', 'Highly rated everywhere (88)']);
  assert.deepEqual(r.map((x) => x.key).sort(), ['c2', 't2', 'x2']);
});

test('rankTonight: mood must match a genre, keyword, subject or your own tag', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const profile = tasteProfile(films);
  const list = watchlist(films);
  assert.deepEqual(rankTonight(profile, idx, list, { mood: 'thriller' }).map((x) => x.key), ['t2']);
  assert.deepEqual(rankTonight(profile, idx, list, { mood: 'Drama' }).map((x) => x.key).sort(), ['s3', 'w3']);
  assert.deepEqual(rankTonight(profile, idx, list, { mood: 'cozy' }).map((x) => x.key), ['c2']);
  assert.deepEqual(rankTonight(profile, idx, list, { mood: 'nothing like this' }), []);
  assert.ok(rankTonight(profile, idx, list, { mood: 'drama' }).find((x) => x.key === 'w3').reasons.includes('Fits your mood: drama'));
});

test('rankTonight: exclude and limit', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const profile = tasteProfile(films);
  const list = watchlist(films);
  const r = rankTonight(profile, idx, list, { exclude: ['w3'], limit: 2 });
  assert.equal(r.length, 2);
  assert.ok(!r.some((x) => x.key === 'w3'));
  assert.deepEqual(rankTonight(profile, idx, list, { limit: 0 }), []);
});

test('rankTonight: shuffleSeed gives repeatable but different picks, within ±8 of the plain fit', () => {
  // Twelve near-identical candidates so the jitter decides the order.
  const base = fixture();
  const twins = Array.from({ length: 12 }, (_, i) => film(`twin${i}`, `Twin ${i}`, 1986, { genres: ['Drama'], countries: ['Germany'], score: 70, user: waiting }));
  const films = [...base, ...twins];
  const idx = buildIndex(films);
  const profile = tasteProfile(films);
  const plain = rankTonight(profile, idx, twins, { limit: 12 });
  assert.deepEqual(plain.map((x) => x.key), twins.map((t) => t.key), 'seed 0 keeps a stable order');
  assert.equal(new Set(plain.map((x) => x.fit)).size, 1);

  const a1 = rankTonight(profile, idx, twins, { shuffleSeed: 1, limit: 12 });
  const a2 = rankTonight(profile, idx, twins, { shuffleSeed: 1, limit: 12 });
  const b = rankTonight(profile, idx, twins, { shuffleSeed: 2, limit: 12 });
  assert.deepEqual(a1, a2, 'same seed, same result');
  assert.notDeepEqual(a1.map((x) => x.key), b.map((x) => x.key), 'a new seed shuffles');
  assert.notDeepEqual(a1.map((x) => x.key), plain.map((x) => x.key));
  for (const x of [...a1, ...b]) assert.ok(Math.abs(x.fit - plain[0].fit) <= 9, `${x.fit} vs ${plain[0].fit}`);
  assert.deepEqual(new Set(a1.map((x) => x.key)), new Set(twins.map((t) => t.key)));
});

test('rankTonight: no ratings yet, ranking falls back to the crowd score', () => {
  const films = [film('hi', 'High', 2000, { genres: ['Drama'], score: 90, user: waiting }), film('lo', 'Low', 2001, { genres: ['Drama'], score: 40, user: waiting }), film('none', 'Unrated', 2002, { genres: ['Drama'], user: waiting })];
  const r = rankTonight(tasteProfile(films), buildIndex(films), films);
  assert.deepEqual(r.map((x) => x.key), ['hi', 'none', 'lo'], 'no score counts as 0.6, between the two');
  assert.deepEqual(r[0].reasons, ['Highly rated everywhere (90)']);
});

test('rankTonight: candidates that are not in the index still work; empty inputs give []', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const outsider = film('new', 'Outsider', 1988, { genres: ['Drama'], countries: ['Germany'], people: { director: [vogt] } });
  const r = rankTonight(tasteProfile(films), idx, [outsider, ...watchlist(films).filter((f) => f.key === 'c2')]);
  assert.equal(r[0].key, 'new');
  assert.ok(r[0].reasons.includes('You rate Lena Vogt highly'));
  assert.ok(r[0].reasons[0].startsWith('Because you rated '));
  assert.deepEqual(rankTonight(tasteProfile([]), buildIndex([]), []), []);
  assert.deepEqual(rankTonight(tasteProfile([]), buildIndex([]), undefined), []);
  assert.deepEqual(rankTonight(tasteProfile(films), idx, []), []);
});

test('blindSpots: people you rate highly with films waiting', () => {
  const films = fixture();
  const idx = buildIndex(films);
  const spots = blindSpots(tasteProfile(films), idx, films);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].label, 'Lena Vogt');
  assert.equal(spots[0].reason, 'You rate Lena Vogt highly and have 1 film waiting');
  assert.deepEqual(spots[0].keys, ['w3']);

  // More films waiting, and a series.
  const more = [
    ...films,
    film('w5', 'Harbour Road', 1990, { people: { director: [vogt] }, user: waiting }),
    film('r1', 'Reel One', 2001, { collection: 'Reel Collection', user: seen(10, true) }),
    film('r2', 'Reel Two', 2003, { collection: 'Reel Collection', user: seen(10, true) }),
    film('r3', 'Reel Three', 2005, { collection: 'Reel Collection', user: waiting }),
  ];
  const s2 = blindSpots(tasteProfile(more), buildIndex(more));
  const vogtSpot = s2.find((s) => s.label === 'Lena Vogt');
  assert.equal(vogtSpot.reason, 'You rate Lena Vogt highly and have 2 films waiting');
  const series = s2.find((s) => s.kind === 'collection');
  assert.equal(series.reason, 'You rate the Reel series highly and have 1 film waiting');
  assert.deepEqual(blindSpots(tasteProfile([]), idx, films), []);
  assert.equal(blindSpots(tasteProfile(more), buildIndex(more), more, { limit: 1 }).length, 1);
});

test('rankTonight: release year does not change a film\'s fit', () => {
  const rated = [1, 2, 3].map((i) => film(`r${i}`, `R${i}`, 1980, { genres: ['Drama'], countries: ['Germany'], user: seen(10) }));
  const mk = (key, year) => film(key, key, year, { genres: ['Drama'], countries: ['Germany'], user: waiting });
  const list = [mk('old', 1931), mk('mid', 1984), mk('new', 2024)];
  const films = [...rated, ...list];
  const r = rankTonight(tasteProfile(films), buildIndex(films), list);
  assert.equal(new Set(r.map((x) => x.fit)).size, 1);
  assert.ok(r.every((x) => x.reasons.every((y) => !/19\d\ds|20\d\ds|decade/i.test(y))));
});

test('rankTonight: never picks unreleased films, shorts or TV (P0 eligibility)', () => {
  const films = fixture();
  const bad = [
    film('u1', 'Not Out Yet', 2027, { genres: ['Drama'], countries: ['Germany'], people: { director: [vogt] }, user: waiting }),
    film('sh', 'Tiny Short', 2015, { runtime: 17, genres: ['Drama'], countries: ['Germany'], people: { director: [vogt] }, user: waiting }),
    { ...film('tv', 'Long Series', 2015, { genres: ['Drama'], countries: ['Germany'], people: { director: [vogt] }, user: waiting }), kind: 'tv' },
  ];
  const all = [...films, ...bad];
  const idx = buildIndex(all);
  const list = all.filter((f) => f.user.watchlist);
  const keys = rankTonight(tasteProfile(all), idx, list, { today: '2026-10-22' }).map((x) => x.key);
  for (const k of ['u1', 'sh', 'tv']) assert.ok(!keys.includes(k), `${k} must not be picked`);
  assert.ok(keys.length > 0);
  const withShort = rankTonight(tasteProfile(all), idx, list, { today: '2026-10-22', includeShorts: true, includeTV: true }).map((x) => x.key);
  assert.ok(withShort.includes('sh') && withShort.includes('tv'));
});

test('year invariance: shuffling release years changes no Tonight ranking or taste', () => {
  const films = fixture();
  const years = films.map((f) => f.year);
  const rot = films.map((f, i) => ({ ...f, year: years[(i + 3) % years.length] }));
  const run = (fs) => {
    const idx = buildIndex(fs);
    const p = tasteProfile(fs);
    return { p: [...p.features].map(([k, v]) => [k, v.affinity]).sort(), r: rankTonight(p, idx, fs.filter((f) => f.user.watchlist), { today: '2026-10-22' }) };
  };
  assert.deepEqual(run(rot), run(films));
});
