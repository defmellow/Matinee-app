// The Insights remake's extra figures. Synthetic library and diary only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moreInsights, feelTaste, groupFilms, LEAN_MIN } from '../../core/analysis/insights-more.js';

const P = (name, id) => ({ name, id });
const film = (key, o = {}) => ({ key, title: `Film ${key}`, year: 2000, runtime: 100, genres: [], directors: [], cast: [], people: {}, ratings: {}, score: null, timesWatched: 1, ...o, user: { watched: true, rating: null, liked: false, watchlist: false, ...(o.user || {}) } });
const entry = (key, date, o = {}) => ({ key, date, rating: null, rewatch: false, ...o });
const D = P('Dir', 'p:dir');

const summaries = [
  film('a', { year: 1950, runtime: 200, genres: ['Drama'], directors: [D], people: { composer: [P('Comp', 'p:c')] }, score: 90, ratings: { letterboxd: { votes: 50 } }, user: { rating: 10, liked: true }, timesWatched: 2 }),
  film('b', { year: 2020, runtime: 80, genres: ['Drama'], directors: [D], people: { composer: [P('Comp', 'p:c')] }, score: 40, ratings: { letterboxd: { votes: 9000 } }, user: { rating: 10 } }),
  film('c', { year: 2021, runtime: 110, genres: ['Drama', 'Comedy'], user: { rating: 8 } }),
  film('d', { year: 2022, runtime: 95, genres: ['Comedy'], user: { rating: 4 } }),
  film('e', { year: 2022, runtime: 95, genres: ['Comedy'], user: { rating: 4 } }),
  film('f', { year: 2023, runtime: 30, genres: ['Comedy'], user: { rating: 2 } }),
  film('w1', { year: 1960, runtime: 90, genres: ['Drama'], directors: [D], score: 95, user: { watched: false, watchlist: true } }),
  film('w2', { year: 1961, runtime: 180, genres: ['Horror'], directors: [D], score: 60, user: { watched: false, watchlist: true } }),
  film('w3', { year: 1962, runtime: null, user: { watched: false, watchlist: true } }),
];
const entries = [
  entry('a', '2024-02-01', { rating: 10 }), entry('a', '2025-02-01', { rating: 10, rewatch: true }),
  entry('b', '2024-06-01', { rating: 10 }), entry('c', '2025-03-01', { rating: 8 }),
  entry('d', '2025-08-01', { rating: 4 }), entry('e', '2025-12-01', { rating: 4 }), entry('zzz', 'nope'),
];
const r = moreInsights({ summaries, entries, today: '2025-06-30', perMonth: 2 });

test('genres carry counts, averages and a lean against their own average', () => {
  const drama = r.genres.find(g => g.name === 'Drama'), comedy = r.genres.find(g => g.name === 'Comedy');
  assert.equal(drama.count, 3); assert.equal(drama.averageRating, 4.67);
  assert.ok(drama.lean > 0 && comedy.lean < 0);
  assert.equal(r.genreLean.higher[0].name, 'Drama'); assert.equal(r.genreLean.lower[0].name, 'Comedy');
  assert.deepEqual(drama.keys.slice(0, 2).sort(), ['a', 'b'], 'the highest rated films of the genre come first');
});

test('a group with too few rated films has no lean', () => {
  const rows = groupFilms(summaries.slice(0, LEAN_MIN - 1), s => [{ key: 'x', name: 'X' }], 4);
  assert.equal(rows[0].lean, null);
});

test('length bands, longest, and shortest feature (shorts are left out)', () => {
  assert.deepEqual(r.runtime.bands.map(b => b.count), [2, 3, 0, 1]);
  assert.equal(r.runtime.longest.key, 'a'); assert.equal(r.runtime.shortest.key, 'b');
});

test('age at first watch ignores rewatches', () => {
  assert.equal(r.age.count, 5);
  assert.equal(r.age.bands[0].count, 0); assert.equal(r.age.bands[4].count, 1);
});

test('pace compares this year so far with the same day last year', () => {
  assert.deepEqual(r.pace, { year: 2025, thisYear: 4, lastYearToDate: 2, lastYear: 2 });
});

test('one row per diary year with its best film and month counts', () => {
  assert.deepEqual(r.years.map(y => [y.year, y.count, y.best]), [[2025, 4, 'a'], [2024, 2, 'a']]);
  assert.equal(r.years[0].months[1], 1);
  assert.deepEqual(r.years[0].top, ['a', 'c', 'd', 'e']);
});

test('people: crew with two films, directors with posters', () => {
  assert.equal(r.people.composers[0].name, 'Comp'); assert.equal(r.people.composers[0].count, 2);
  assert.equal(r.people.directors[0].id, 'p:dir'); assert.equal(r.people.directorCount, 1);
});

test('records and rewatches', () => {
  const by = Object.fromEntries(r.records.map(x => [x.label, x]));
  assert.equal(by['Highest Matinee score'].key, 'a'); assert.equal(by['Oldest'].value, '1950');
  assert.equal(by['Least watched on Letterboxd'].key, 'a');
  assert.deepEqual(r.rewatched, [{ key: 'a', times: 2 }]);
});

test('watchlist: size, hours, pace, best waiting, genre shares against watched', () => {
  const w = r.watchlist;
  assert.equal(w.count, 3); assert.equal(w.hours, 5); assert.equal(w.untimed, 1); assert.equal(w.yearsAtPace, 0.1);
  assert.deepEqual(w.topScored.map(x => x.key), ['w1', 'w2']);
  assert.deepEqual(w.quick.map(x => x.key), ['w1']);
  assert.deepEqual(w.genres.find(g => g.name === 'Drama'), { name: 'Drama', count: 1, share: 33, watchedShare: 50 });
  assert.equal(w.directors[0].count, 2);
});

test('at a glance is plain sentences; empty input is safe', () => {
  assert.ok(r.glance.length >= 2 && r.glance.every(g => typeof g === 'string' && g.endsWith('.')));
  const e = moreInsights({});
  assert.equal(e.mean, null); assert.deepEqual(e.glance, []); assert.equal(e.watchlist.count, 0); assert.deepEqual(e.records, []);
});

test('feelTaste: which feelings go with their higher and lower ratings; fragile and weak chips are ignored', () => {
  const chips = { a: ['eerie'], b: ['eerie'], c: ['eerie', 'silly'], d: ['silly'], e: ['silly'], f: ['silly'], w1: ['eerie'], w2: ['bleak'] };
  const profileOf = key => (chips[key] ? { descriptors: [...chips[key].map(id => ({ id, label: id, facet: 'mood', score: 0.5 })), { id: 'weak', label: 'weak', facet: 'mood', score: 0.5, fragile: true }, { id: 'faint', label: 'faint', facet: 'tone', score: 0.05 }] } : null);
  const t = feelTaste({ summaries, profileOf });
  assert.equal(t.films, 6);
  assert.equal(t.feelings.higher[0].id, 'eerie'); assert.equal(t.feelings.lower[0].id, 'silly');
  assert.ok(!t.feelings.common.some(x => x.id === 'weak' || x.id === 'faint'));
  assert.equal(t.feelings.common[0].share, 67);
  assert.equal(t.watchlist.films, 2);
  assert.deepEqual(feelTaste({}).feelings.common, []);
});

test('yearFeel: the year\'s commonest feelings, and what turned up more than in their other years', async () => {
  const { yearFeel } = await import('../../core/analysis/insights-more.js');
  const many = [];
  for (let i = 0; i < 12; i++) many.push(film('o' + i));
  for (let i = 0; i < 4; i++) many.push(film('y' + i));
  const es = [0, 1, 2, 3].map(i => entry('y' + i, '2025-01-0' + (i + 1)));
  const profileOf = key => ({ descriptors: [{ id: key[0] === 'y' ? 'eerie' : 'silly', label: key[0] === 'y' ? 'Eerie' : 'Silly', facet: 'mood', score: 0.5 }] });
  const r2 = yearFeel({ summaries: many, entries: es, year: 2025, profileOf });
  assert.equal(r2.films, 4); assert.equal(r2.feelings[0].id, 'eerie'); assert.equal(r2.feelings[0].share, 100);
  assert.deepEqual(r2.more.map(x => [x.id, x.otherShare]), [['eerie', 0]]);
  assert.deepEqual(yearFeel({ year: 2025 }).feelings, []);
});
