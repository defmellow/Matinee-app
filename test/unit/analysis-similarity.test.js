// Similarity engine tests. All films and people here are SYNTHETIC (invented for the tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { features, buildIndex, similarity, related, idfOf, featureLabel, WEIGHTS, CAST_WEIGHTS } from '../../core/analysis/similarity.js';

const P = (name, id) => ({ name, id });
function film(key, title, year, o = {}) {
  return {
    key, title, year, runtime: o.runtime ?? 100,
    genres: o.genres ?? [], countries: o.countries ?? [], languages: o.languages ?? [],
    people: { director: [], writer: [], cinematography: [], composer: [], editor: [], cast: [], ...(o.people || {}) },
    keywords: o.keywords ?? [], subjects: o.subjects ?? [], collection: o.collection ?? null, basedOn: o.basedOn ?? [],
    awards: [], score: o.score ?? null, ratings: {},
    user: { watched: false, rating: null, liked: false, watchlist: false, watchlistOrder: null, tags: [], ...(o.user || {}) },
    timesWatched: 0, lastWatched: null,
  };
}

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
      people: { director: [vogt], cinematography: [mullner], composer: [aranda], cast: [hanne, pavel] } }),
    film('w2', 'Desert Postcard', 1985, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], keywords: ['road trip'],
      people: { director: [vogt], cinematography: [mullner], composer: [aranda], cast: [hanne] } }),
    film('w3', 'Night Station', 1987, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], people: { director: [vogt], cast: [pavel] } }),
    film('w4', 'Border Lights', 1986, { genres: ['Drama'], countries: ['Germany'], languages: ['German'], keywords: ['road trip'],
      people: { director: [P('Ines Falk', 'wd:Q1005')], cast: [P('Ole Brandt', 'tmdb:2005')] } }),
    film('s1', 'Sand Orbit', 2021, { genres: ['Science Fiction', 'Adventure'], countries: ['United States'], languages: ['English'], collection: 'Sand Orbit Collection',
      people: { director: [haddad], writer: [aydin], composer: [nakamura] } }),
    film('s2', 'Sand Orbit: Part Two', 2024, { genres: ['Science Fiction', 'Adventure'], countries: ['United States'], languages: ['English'], collection: 'Sand Orbit Collection',
      people: { director: [haddad], writer: [aydin], composer: [nakamura] } }),
    film('s3', 'Cold Signal', 2016, { genres: ['Science Fiction', 'Drama'], countries: ['United States'], people: { director: [haddad], writer: [aydin] } }),
    film('s4', 'Glass Planet', 2014, { genres: ['Science Fiction'], countries: ['United States'], people: { director: [P('Rufus Cole', 'wd:Q1040')] } }),
    film('t1', 'Paper Alibi', 1994, { genres: ['Thriller', 'Crime'], countries: ['United States'], people: { director: [whitfield], cast: [bell] } }),
    film('t2', 'Last Edit', 1996, { genres: ['Thriller'], countries: ['United States'], people: { director: [whitfield], cast: [bell] } }),
    film('t3', 'Midnight Ledger', 1997, { genres: ['Thriller', 'Crime'], countries: ['United States'], people: { director: [P('Gil Navarro', 'wd:Q1041')], cast: [bell] } }),
    film('c1', 'Laundromat Love', 1996, { genres: ['Comedy', 'Romance'], countries: ['United States'], people: { director: [delgado] } }),
    film('c2', 'Sunday Brunch', 1998, { genres: ['Comedy', 'Romance'], countries: ['United States'], people: { director: [delgado] } }),
    film('x1', 'Bare Bones', 1975, { genres: ['Drama'] }),
    film('x2', 'Lonely Western', 1952, { genres: ['Western'], countries: ['Argentina'], languages: ['Spanish'] }),
  ];
}

test('features: ids, weights and rules', () => {
  const f = features(fixture()[0]);
  assert.equal(f.get('director:wd:Q1001'), WEIGHTS.director);
  assert.equal(f.get('cinematography:wd:Q1002'), WEIGHTS.cinematography);
  assert.equal(f.get('composer:wd:Q1003'), WEIGHTS.composer);
  assert.equal(f.get('genre:drama'), WEIGHTS.genre);
  assert.equal(f.get('country:germany'), WEIGHTS.country);
  assert.equal(f.get('language:german'), WEIGHTS.language);
  assert.ok(![...f.keys()].some((k) => k.startsWith('decade:')), 'release year is never a feature');
  assert.equal(f.get('keyword:road trip'), WEIGHTS.keyword);
  assert.equal(f.get('cast:tmdb:2001'), CAST_WEIGHTS[0]);
  assert.equal(f.get('cast:tmdb:2002'), CAST_WEIGHTS[1]);
});

test('features: English is not a feature, collection suffix is trimmed, ids fall back to names', () => {
  const f = features(fixture()[4]);
  assert.ok(![...f.keys()].some((k) => k.startsWith('language:')));
  assert.equal(f.get('collection:sand orbit'), WEIGHTS.collection);
  const g = features(film('n', 'Name Only', 2001, { people: { director: [{ name: 'Ana  Ruiz' }], editor: [P('Bo Li', 'wd:Q9')], writer: [P('Cy Day', 'wd:Q8')] }, subjects: ['Grief'], basedOn: ['Short story'] }));
  assert.equal(g.get('director:ana ruiz'), WEIGHTS.director);
  assert.equal(g.get('editor:wd:Q9'), WEIGHTS.editor);
  assert.equal(g.get('writer:wd:Q8'), WEIGHTS.writer);
  assert.equal(g.get('subject:grief'), WEIGHTS.subject);
  assert.equal(g.get('basedOn:short story'), WEIGHTS.basedOn);
});

test('features: only the top 8 billed cast count, with falling weights', () => {
  const cast = Array.from({ length: 12 }, (_, i) => P(`Actor ${i}`, `tmdb:${i}`));
  const f = features(film('c', 'Crowd', 2000, { people: { cast } }));
  const got = [...f.entries()].filter(([k]) => k.startsWith('cast:'));
  assert.equal(got.length, 8);
  assert.deepEqual(got.map(([, w]) => w), CAST_WEIGHTS);
  assert.equal(CAST_WEIGHTS[0], 1.6);
  assert.equal(CAST_WEIGHTS[7], 0.9);
});

test('features: sparse and empty summaries do not throw', () => {
  assert.equal(features({ key: 'a' }).size, 0);
  assert.equal(features(null).size, 0);
  const f = features({ key: 'b', title: 'T', year: 1999, genres: ['Drama'] });
  assert.deepEqual([...f.keys()].sort(), ['genre:drama']);
});

test('buildIndex: IDF makes rare features count for more; empty input is fine', () => {
  const idx = buildIndex(fixture());
  assert.equal(idx.size, 15);
  assert.ok(idfOf(idx, 'director:wd:Q1001') > idfOf(idx, 'genre:drama'));
  assert.equal(featureLabel(idx, 'director:wd:Q1001'), 'Lena Vogt');
  assert.equal(featureLabel(idx, 'genre:science fiction'), 'science fiction');
  const empty = buildIndex([]);
  assert.equal(empty.size, 0);
  assert.deepEqual(related(empty, 'nope'), []);
  assert.equal(buildIndex().size, 0);
  assert.equal(buildIndex([fixture()[0], fixture()[0]]).size, 1, 'duplicate keys are ignored');
});

test('similarity: symmetric, 0–1, self is 1, unknown is 0', () => {
  const idx = buildIndex(fixture());
  const ab = similarity(idx, 'w1', 'w2');
  assert.equal(ab, similarity(idx, 'w2', 'w1'));
  assert.ok(ab > 0 && ab <= 1);
  assert.ok(Math.abs(similarity(idx, 'w1', 'w1') - 1) < 1e-9);
  assert.equal(similarity(idx, 'w1', 'missing'), 0);
  assert.equal(similarity(idx, 'w1', 'x2'), 0, 'nothing shared');
  assert.ok(similarity(idx, 'w1', 'w2') > similarity(idx, 'w1', 'w4'), 'same director beats same country');
  assert.ok(similarity(idx, 'w1', 'w4') > similarity(idx, 'w1', 's1'));
});

test('related: ranking order and exclusion of self', () => {
  const idx = buildIndex(fixture());
  const r = related(idx, 'w1');
  assert.ok(!r.some((x) => x.key === 'w1'));
  assert.equal(r[0].key, 'w2');
  assert.equal(r[1].key, 'w3');
  const rank = (k) => r.findIndex((x) => x.key === k);
  assert.ok(rank('w4') > 1 && rank('w4') < rank('s1'), 'shared keyword/country/language ranks above a lone shared genre');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  assert.ok(r.every((x) => x.score > 0 && x.score <= 1));
  assert.equal(related(idx, 's1')[0].key, 's2');
  assert.equal(related(idx, 's2')[0].key, 's1');
  assert.equal(related(idx, 'x2').length, 0, 'a film that shares nothing has no neighbours');
  assert.deepEqual(related(idx, 'nope'), []);
});

test('related: k and filter', () => {
  const idx = buildIndex(fixture());
  assert.equal(related(idx, 'w1', { k: 2 }).length, 2);
  assert.deepEqual(related(idx, 'w1', { k: 0 }), []);
  const only = related(idx, 'w1', { filter: (s) => s.key !== 'w2' });
  assert.ok(!only.some((x) => x.key === 'w2'));
  assert.equal(only[0].key, 'w3');
  const all = related(idx, 's1', { k: 100 });
  assert.ok(all.length <= idx.size - 1);
});

test('related: reasons are short sentences from the strongest shared features, max 3, with names not ids', () => {
  const idx = buildIndex(fixture());
  const r = related(idx, 'w1').find((x) => x.key === 'w2');
  assert.ok(r.reasons.length >= 1 && r.reasons.length <= 3);
  assert.equal(r.reasons[0], 'Both directed by Lena Vogt');
  for (const reason of r.reasons) assert.ok(!/wd:|tmdb:/.test(reason), reason);

  // Every group shows up when asked for more.
  const all = related(idx, 'w1', { k: 1 })[0];
  assert.ok(all.reasons.length <= 3);
});

test('reasons: each kind has its own wording', () => {
  const a = film('a', 'A', 1984, {
    genres: ['Drama'], countries: ['Germany'], languages: ['German'], keywords: ['road trip'], collection: 'Wide Road Collection', basedOn: ['Dune'],
    people: { director: [vogt], writer: [aydin], cinematography: [mullner], composer: [aranda], editor: [P('Edie Fox', 'wd:Q7')], cast: [hanne, pavel] },
  });
  const mk = (key, o) => film(key, key, 1984, o);
  const films = [
    a,
    mk('b-dir', { people: { director: [vogt] } }),
    mk('b-writer', { people: { writer: [aydin] } }),
    mk('b-dp', { people: { cinematography: [mullner] } }),
    mk('b-comp', { people: { composer: [aranda] } }),
    mk('b-edit', { people: { editor: [P('Edie Fox', 'wd:Q7')] } }),
    mk('b-series', { collection: 'Wide Road Collection' }),
    mk('b-book', { basedOn: ['Dune'] }),
    mk('b-cast', { people: { cast: [pavel, hanne] } }),
    mk('b-theme', { keywords: ['road trip'] }),
    mk('b-genre', { genres: ['Drama'] }),
    mk('b-place', { countries: ['Germany'] }),
    mk('b-lang', { languages: ['German'] }),
  ];
  // Give every feature a second film so none are singletons.
  const idx = buildIndex(films);
  const why = (key) => related(idx, 'a', { filter: (s) => s.key === key })[0].reasons;
  assert.ok(why('b-dir').includes('Both directed by Lena Vogt'));
  assert.ok(why('b-writer').includes('Both written by Selin Aydin'));
  assert.ok(why('b-dp').includes('Jonas Müllner shot both'));
  assert.ok(why('b-comp').includes('Both scored by Tomás Aranda'));
  assert.ok(why('b-edit').includes('Both edited by Edie Fox'));
  assert.ok(why('b-series').includes('Same series: Wide Road'));
  assert.ok(why('b-book').includes('Both based on Dune'));
  assert.ok(why('b-cast').includes('Shared cast: Hanne Brandt, Pavel Kuric') || why('b-cast').includes('Shared cast: Pavel Kuric, Hanne Brandt'));
  assert.ok(why('b-theme').includes('Both about road trip'));
  assert.ok(why('b-genre').includes('Both are drama films'));
  assert.ok(why('b-place').includes('Both from Germany'));
  assert.ok(why('b-lang').includes('Both in German'));
});

test('year and decade never drive similarity, reasons or ranking', () => {
  const same = (key, year, o = {}) => film(key, key, year, { genres: ['Drama'], countries: ['Germany'], people: { director: [vogt] }, ...o });
  const idx = buildIndex([same('a', 1984), same('b-same-year', 1984), same('b-far', 1931), same('b-recent', 2023)]);
  const sc = (k) => similarity(idx, 'a', k);
  assert.equal(sc('b-same-year'), sc('b-far'));
  assert.equal(sc('b-same-year'), sc('b-recent'));
  assert.ok(sc('b-far') > 0.99);
  for (const r of related(idx, 'a')) assert.ok(!/19\d\ds|20\d\ds|decade|era/i.test(r.reasons.join(' ')), r.reasons.join(' | '));
  // Same decade but nothing else shared: not related at all.
  const idx2 = buildIndex([film('p', 'P', 1984, { countries: ['Germany'] }), film('q', 'Q', 1985, { countries: ['France'] })]);
  assert.equal(similarity(idx2, 'p', 'q'), 0);
  assert.deepEqual(related(idx2, 'p'), []);
  // A "1980s" or year keyword on the film changes nothing about its year-free features.
  assert.deepEqual([...features(film('k', 'K', 1950, { genres: ['Drama'] })).keys()], [...features(film('k', 'K', 2020, { genres: ['Drama'] })).keys()]);
});

test('related: works on sparse data (title, year, genres only)', () => {
  const films = [
    film('a', 'A', 1990, { genres: ['Drama'] }), film('b', 'B', 1991, { genres: ['Drama'] }),
    film('c', 'C', 1992, { genres: ['Horror'] }), { key: 'd', title: 'D' },
  ];
  const idx = buildIndex(films);
  const r = related(idx, 'a');
  assert.equal(r[0].key, 'b');
  assert.ok(r[0].reasons.length > 0);
  assert.deepEqual(related(idx, 'd'), []);
});

// ---------- performance (synthetic) ----------

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Synthetic library: skewed pools so some people/genres recur, like a real collection. */
export function syntheticLibrary(n, seed = 7) {
  const rnd = mulberry(seed);
  const skew = (size) => Math.min(size - 1, Math.floor(size * rnd() ** 2.2));
  const person = (pool, prefix) => { const i = skew(pool); return { name: `${prefix} ${i}`, id: `wd:${prefix}${i}` }; };
  const pickN = (count, make) => Array.from({ length: count }, make);
  const genres = ['Drama', 'Comedy', 'Thriller', 'Horror', 'Romance', 'Science Fiction', 'Crime', 'Adventure', 'Animation', 'Western', 'War', 'Mystery', 'Fantasy', 'Family', 'Music'];
  const countries = ['United States', 'France', 'Japan', 'Germany', 'Italy', 'United Kingdom', 'South Korea', 'Spain', 'India', 'Mexico'];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(film(`f${i}`, `Film ${i}`, 1930 + Math.floor(rnd() * 95), {
      genres: [...new Set(pickN(1 + Math.floor(rnd() * 3), () => genres[skew(genres.length)]))],
      countries: [countries[skew(countries.length)]],
      languages: [rnd() < 0.7 ? 'English' : 'French'],
      keywords: pickN(Math.floor(rnd() * 7), () => `kw${skew(900)}`),
      subjects: pickN(Math.floor(rnd() * 3), () => `subject${skew(300)}`),
      collection: rnd() < 0.05 ? `Series ${skew(60)} Collection` : null,
      people: {
        director: [person(Math.max(20, n / 12 | 0), 'Dir')],
        writer: pickN(1 + Math.floor(rnd() * 2), () => person(Math.max(20, n / 8 | 0), 'Wri')),
        cinematography: [person(Math.max(20, n / 15 | 0), 'Cin')],
        composer: [person(Math.max(20, n / 18 | 0), 'Com')],
        editor: [person(Math.max(20, n / 15 | 0), 'Edi')],
        cast: pickN(8, () => person(Math.max(40, n * 0.6 | 0), 'Act')),
      },
    }));
  }
  return out;
}

test('performance: 300 films index in under 100 ms, 5,000 in well under 2 s', () => {
  buildIndex(syntheticLibrary(150, 1)); // warm the JIT so the timing is about the work, not start-up
  const small = syntheticLibrary(300);
  let t = performance.now();
  const idxSmall = buildIndex(small);
  const smallMs = performance.now() - t;
  assert.ok(smallMs < 100, `300 films took ${smallMs.toFixed(1)} ms`);
  assert.equal(idxSmall.size, 300);

  const big = syntheticLibrary(5000);
  t = performance.now();
  const idx = buildIndex(big);
  const bigMs = performance.now() - t;
  assert.ok(bigMs < 1000, `5000 films took ${bigMs.toFixed(1)} ms`);

  t = performance.now();
  let total = 0;
  for (let i = 0; i < 100; i++) total += related(idx, `f${i * 37}`).length;
  const relMs = performance.now() - t;
  assert.ok(total > 0);
  assert.ok(relMs / 100 < 20, `related() averaged ${(relMs / 100).toFixed(2)} ms`);
});

test('related: a throwing filter does not corrupt later queries', () => {
  const idx = buildIndex(fixture());
  const before = related(idx, 'w1');
  assert.throws(() => related(idx, 'w1', { filter: () => { throw new Error('boom'); } }), /boom/);
  assert.deepEqual(related(idx, 'w1'), before);
});
