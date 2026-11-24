// Sentences with links (core/analysis/text-parts.js) and the Library link forms they use. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkPart, personPart, partsText } from '../../core/analysis/text-parts.js';
import { moreInsights } from '../../core/analysis/insights-more.js';
import { yearInReview } from '../../core/analysis/year.js';
import { calibration } from '../../core/analysis/calibration.js';
import { queryFromParam } from '../../ui/screens/library/model.js';
import { fromParam } from '../../ui/screens/proto/shared/query.js';
import { linkHref, filterHref } from '../../ui/components/chip.js';

const linksOf = parts => parts.filter(p => typeof p !== 'string');

test('parts join back into the plain sentence', () => {
  const parts = ['Made by ', personPart({ name: 'Agnès Varda', id: 'p:varda' }, 'director'), ' in ', linkPart(1962, 'year', 1962), '.'];
  assert.equal(partsText(parts), 'Made by Agnès Varda in 1962.');
  assert.deepEqual(parts[1], { text: 'Agnès Varda', to: { kind: 'person', value: 'p:varda', role: 'director' } });
  assert.deepEqual(personPart({ name: 'No Id' }).to, { kind: 'person', value: 'No Id' }, 'no id: the name, and no role when none is given');
  assert.equal(partsText([]), '');
  assert.equal(partsText(null), '');
});

const film = (key, o = {}) => ({ key, title: `Film ${key}`, year: 2000, runtime: 100, genres: [], directors: [], cast: [], people: {}, ratings: {}, score: null, timesWatched: 1, ...o, user: { watched: true, rating: null, liked: false, watchlist: false, ...(o.user || {}) } });
const D = { name: 'Dir', id: 'p:dir' };

test('Insights at a glance: the same sentences, with genres, the director, years and the watchlist as links', () => {
  const summaries = [
    ...Array.from({ length: 6 }, (_, i) => film('d' + i, { year: 2010 + i, genres: ['Drama'], directors: [D], user: { rating: 10 } })),
    ...Array.from({ length: 6 }, (_, i) => film('c' + i, { year: 1990 + i, genres: ['Comedy'], user: { rating: 4 } })),
    film('w', { user: { watched: false, watchlist: true } }),
  ];
  const entries = [{ key: 'd0', date: '2025-02-01' }, { key: 'd1', date: '2024-02-01' }];
  const r = moreInsights({ summaries, entries, today: '2025-06-30', perMonth: 0.05 }); // a slow pace, so the watchlist sentence shows
  assert.equal(r.glanceParts.length, r.glance.length);
  r.glanceParts.forEach((parts, i) => assert.equal(partsText(parts), r.glance[i]));
  const all = r.glanceParts.flatMap(linksOf).map(p => p.to);
  assert.ok(all.some(t => t.kind === 'genre' && t.value === 'Drama'));
  assert.ok(all.some(t => t.kind === 'genre' && t.value === 'Comedy'));
  assert.ok(all.some(t => t.kind === 'person' && t.value === 'p:dir' && t.role === 'director'));
  assert.ok(all.some(t => t.kind === 'year' && t.value === 2025));
  assert.ok(all.some(t => t.kind === 'text' && /^year:\d{4}$/.test(t.value)));
  assert.ok(all.some(t => t.kind === 'status' && t.value === 'watchlist'));
  assert.deepEqual(moreInsights({}).glanceParts, []);
});

test('Year in review highlights: the same sentences, with the films named as links', () => {
  const summaries = [film('a', { year: 1931, user: { rating: 10 } }), film('b', { year: 2020, user: { rating: 6 } })];
  const entries = [{ id: 1, key: 'a', date: '2024-03-02', rating: 10 }, { id: 2, key: 'b', date: '2024-03-03', rating: 6 }];
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.equal(r.highlightParts.length, r.highlights.length);
  r.highlightParts.forEach((parts, i) => assert.equal(partsText(parts), r.highlights[i]));
  const to = r.highlightParts.flatMap(linksOf).map(p => p.to);
  assert.ok(to.some(t => t.kind === 'film' && t.value === 'a'), 'the highest rated film');
  assert.deepEqual(yearInReview({ summaries, entries, year: 1990 }).highlightParts, [['Nothing in your diary for 1990 yet.']]);
});

test('Calibration notes: the same sentences, with the genre as a link', () => {
  const f = (i, rating, score, genres) => ({ key: 'f' + i, title: 'F' + i, year: 1990 + i, score, user: { watched: true, rating }, genres, directors: [], countries: [] });
  const c = calibration([f(1, 6, 80, ['Horror']), f(2, 6, 70, ['Horror']), f(3, 5, 70, ['Horror', 'Drama']), f(4, 9, 80, ['Drama']), f(5, 9, 80, ['Drama']), f(6, 8, 80, ['Comedy'])]);
  assert.deepEqual(c.noteParts.map(partsText), c.notes);
  assert.ok(c.noteParts.flatMap(linksOf).some(p => p.text === 'horror' && p.to.kind === 'genre' && p.to.value === 'Horror'));
  assert.deepEqual(calibration([]).noteParts, []);
});

test('Library links: rating and runtime', () => {
  assert.deepEqual([queryFromParam('rating:8').ratingMin, queryFromParam('rating:8').ratingMax], [8, 8]);
  assert.deepEqual([queryFromParam('rating:7-9').ratingMin, queryFromParam('rating:7-9').ratingMax], [7, 9]);
  for (const bad of ['rating:0', 'rating:11', 'rating:9-7', 'rating:abc', 'rating:4.5']) assert.equal(queryFromParam(bad), null, bad);
  const r = fromParam('runtime:91-120');
  assert.deepEqual([r.runtimeMin, r.runtimeMax], [91, 120]);
  assert.deepEqual([fromParam('runtime:-90').runtimeMin, fromParam('runtime:-90').runtimeMax], [null, 90]);
  assert.deepEqual([fromParam('runtime:151-').runtimeMin, fromParam('runtime:151-').runtimeMax], [151, null]);
  for (const bad of ['runtime:-', 'runtime:120-90', 'runtime:abc']) assert.equal(queryFromParam(bad), null, bad);
  assert.equal(fromParam('rating:8').status, 'all');
});

test('linkHref sends each kind to its place', () => {
  assert.equal(linkHref({ kind: 'person', value: 'p:dir', role: 'director' }), '#/person/p%3Adir?role=director');
  assert.equal(linkHref({ kind: 'person', value: 'Some Name' }), '#/person/Some%20Name');
  assert.equal(linkHref({ kind: 'year', value: 2025 }), '#/year/2025');
  assert.equal(linkHref({ kind: 'film', value: 'lid:abc' }), '#/film/lid%3Aabc');
  assert.equal(linkHref({ kind: 'genre', value: 'Drama' }), filterHref('genre', 'Drama'));
  assert.equal(linkHref({ kind: 'text', value: 'year:1984' }), '#/library/q%3Ayear%3A1984');
  assert.equal(linkHref(null), null);
  assert.equal(linkHref({ kind: 'genre', value: '' }), null);
});
