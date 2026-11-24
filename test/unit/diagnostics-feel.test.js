import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS, groupPresent, ablateSrc, ablateFilm, allGroupsExcept, cosine, jaccard, profileVector, compareIndexes, verdictFor, buildIndexFor, feelSourceImpact } from '../../core/diagnostics/feel-impact.js';
import { profileOf } from '../../core/analysis/feel/index.js';

// Synthetic library: 48 made-up films in two moods. Reviews are invented sentences, not real reviews.
const SAD = ['A wistful, bleak and devastating story of grief.', 'Quietly devastating, lonely and elegiac.', 'Bleak, harrowing and heartbreaking.'];
const FUNNY = ['A hilarious, farcical romp, playful and silly.', 'Deadpan and wry, satirical and absurd.', 'Uproarious, playful and joyful.'];
const mkFilm = (i, mood) => ({
  key: `lid:s${i}`, lid: `s${i}`, slug: `s-${i}`, title: `Synthetic ${i}`, year: 1990 + (i % 30), ids: {}, checked: {}, missed: {},
  src: {
    wikidata: { genres: [mood === 'sad' ? 'Drama' : 'Comedy'], people: { director: [{ id: 'wd:D' + (i % 7), name: 'Director ' + (i % 7) }] } },
    mcreviews: { users: [{ text: (mood === 'sad' ? SAD : FUNNY)[i % 3] }, { text: (mood === 'sad' ? SAD : FUNNY)[(i + 1) % 3] }], critics: [] },
    wikipedia: { synopsis: 'A film.', sections: {} },
  },
});
const library = Array.from({ length: 48 }, (_, i) => mkFilm(i, i % 2 ? 'sad' : 'funny'));
const store = { films: Object.fromEntries(library.map(f => [f.key, f])) };

test('groups: ids are unique and every field path has a provider', () => {
  assert.equal(new Set(GROUPS.map(g => g.id)).size, GROUPS.length);
  for (const g of GROUPS) assert.ok(g.fields.length && g.fields.every(p => p.length >= 2), g.id);
});

test('groupPresent and ablateSrc: removes only the named fields, never the original', () => {
  const src = { mcreviews: { users: [{ text: 'a' }], critics: [{ text: 'b' }] }, wikipedia: { synopsis: 's', sections: { reception: 'r', plot: 'p' } }, rt: { ratings: { rt: 1 }, consensus: 'c' } };
  const before = JSON.stringify(src);
  assert.equal(groupPresent(src, 'mcreviews.users'), true);
  assert.equal(groupPresent(src, 'allmovie'), false);
  assert.equal(groupPresent({ rt: { consensus: '' } }, 'rt.consensus'), false);
  const out = ablateSrc(src, ['mcreviews.users', 'wikipedia.reception', 'rt.consensus']);
  assert.equal(JSON.stringify(src), before);
  assert.equal(out.mcreviews.users, undefined);
  assert.equal(out.mcreviews.critics.length, 1);
  assert.equal(out.wikipedia.sections.reception, undefined);
  assert.equal(out.wikipedia.sections.plot, 'p');
  assert.deepEqual(out.rt.ratings, { rt: 1 }); // ratings stay: only the consensus text goes
  assert.deepEqual(ablateFilm({ key: 'k', src }, []).src, src);
  assert.ok(!allGroupsExcept(['rt.consensus']).includes('rt.consensus'));
});

test('cosine and jaccard', () => {
  assert.equal(cosine(new Map([['a', 1]]), new Map([['a', 2]])), 1);
  assert.equal(cosine(new Map([['a', 1]]), new Map([['b', 1]])), 0);
  assert.equal(cosine(new Map(), new Map()), 1);
  assert.equal(jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(jaccard([], []), 1);
  assert.equal(verdictFor(0.99, 0.95), 'small');
  assert.equal(verdictFor(0.9, 0.8), 'moderate');
  assert.equal(verdictFor(0.5, 0.9), 'large');
  assert.equal(verdictFor(null, null), 'no data');
});

test('compareIndexes: identical indexes do not move; removing reviews does', () => {
  const base = buildIndexFor(library);
  const same = compareIndexes(base, buildIndexFor(library), ['lid:s0', 'lid:s1']);
  assert.equal(same.cosine, 1); assert.equal(same.overlap, 1); assert.equal(same.becameThin, 0);
  const strip = new Set(['lid:s0', 'lid:s1', 'lid:s2', 'lid:s3']);
  const alt = buildIndexFor(library.map(f => (strip.has(f.key) ? ablateFilm(f, ['mcreviews.users']) : f)));
  const moved = compareIndexes(base, alt, [...strip]);
  assert.ok(moved.cosine < 1);
  assert.ok(moved.becameThin >= 1);
  assert.ok(profileVector(profileOf(base, 'lid:s0')).size > 0);
});

test('feelSourceImpact: a source that carries the feel is large, absent ones say no data, the library is untouched', async () => {
  const before = JSON.stringify(store.films);
  const fetched = library.slice(0, 6).map(f => structuredClone(f));
  const res = await feelSourceImpact({ films: fetched, store });
  assert.equal(JSON.stringify(store.films), before);
  assert.equal(res.films, 6); assert.equal(res.library, 48);
  const g = id => res.groups.find(x => x.id === id);
  assert.equal(g('mcreviews.users').films, 6);
  assert.notEqual(g('mcreviews.users').verdict, 'small');
  assert.ok(g('mcreviews.users').becameThin >= 1);
  assert.equal(g('allmovie').verdict, 'no data');
  assert.equal(g('imdbpage.reviews').films, 0);
  assert.equal(res.groups.length, GROUPS.length);
  // ranked: the largest effect first, 'no data' last
  assert.equal(res.groups.at(-1).verdict, 'no data');
  assert.ok(['large', 'moderate'].includes(res.groups[0].verdict));
  assert.ok(res.groups.every(x => x.profileSimilarity == null || (x.profileSimilarity >= 0 && x.profileSimilarity <= 1)));
});

test('feelSourceImpact: copes with no films and with an empty library', async () => {
  const none = await feelSourceImpact({ films: [], store });
  assert.ok(none.groups.every(g => g.verdict === 'no data'));
  const empty = await feelSourceImpact({ films: [structuredClone(library[0])], store: { films: {} } });
  assert.equal(empty.library, 1);
});
