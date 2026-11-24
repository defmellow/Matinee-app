// Synthetic library and diary only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { yearInReview } from '../../core/analysis/year.js';

const P = (name, id) => ({ name, id });
const film = (key, o = {}) => ({ key, title: `Film ${key}`, year: 2000, runtime: 60, genres: [], directors: [], cast: [], score: null, user: { watched: true, rating: null }, ...o });
const entry = (id, key, date, o = {}) => ({ id, key, date, rating: null, rewatch: false, review: '', ...o });

const D = P('Dir', 'wd:1');
const summaries = [
  film('a', { year: 1931, runtime: 120, genres: ['Drama'], directors: [D], score: 70, user: { watched: true, rating: 8 } }),
  film('b', { year: 1999, runtime: 90, genres: ['Drama', 'Comedy'], directors: [D], cast: [P('Act', 'wd:2')], score: 60, user: { watched: true, rating: 10 } }),
  film('c', { year: 2020, runtime: null, genres: ['Comedy'], cast: [P('Act', 'wd:2')], score: 90, user: { watched: true, rating: 6 } }),
  film('d', { year: 2010, user: { watched: true, rating: null } }),
];
const entries = [
  entry(1, 'a', '2023-12-31'),
  entry(2, 'a', '2024-03-02', { rewatch: true, rating: 8 }),
  entry(3, 'b', '2024-03-03', { review: 'Great', rating: 10 }),
  entry(4, 'c', '2024-03-04', { rating: 6 }),
  entry(5, 'd', '2024-03-04'),
  entry(6, 'b', '2025-01-01'),
  entry(7, 'zzz', 'not a date'),
];

test('years are newest first and default to the latest', () => {
  const r = yearInReview({ summaries, entries });
  assert.deepEqual(r.years, [2025, 2024, 2023]);
  assert.equal(r.year, 2025);
});

test('totals for 2024', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.deepEqual(r.totals, { films: 4, entries: 4, hours: 4.5, rewatches: 1, reviews: 1, firstTimes: 3, newToYou: 3 });
});

test('top films, first and last, months', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.deepEqual(r.topFilms, [{ key: 'b', rating: 10 }, { key: 'a', rating: 8 }, { key: 'c', rating: 6 }]);
  assert.deepEqual(r.firstFilm, { key: 'a', date: '2024-03-02' });
  assert.deepEqual(r.lastFilm, { key: 'd', date: '2024-03-04' });
  assert.equal(r.months.length, 12);
  assert.deepEqual(r.months[2], { month: '2024-03', count: 4 });
  assert.equal(r.months[0].count, 0);
});

test('mosaic: rated films first, highest first, then unrated; capped at 24', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.deepEqual(r.mosaic.map(m => m.key), ['b', 'a', 'c', 'd']);
  const many = Array.from({ length: 30 }, (_, i) => entry(100 + i, 'k' + i, '2022-05-01'));
  assert.equal(yearInReview({ summaries: [], entries: many, year: 2022 }).mosaic.length, 24);
});

test('people, genres, decades, streaks, oldest and newest', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.deepEqual(r.favouritePeople.map(p => [p.name, p.role, p.count]), [['Dir', 'director', 2], ['Act', 'cast', 2]]);
  assert.equal(r.favouritePeople[0].averageRating, 4.5);
  assert.deepEqual(r.genres, [{ name: 'Comedy', count: 2 }, { name: 'Drama', count: 2 }]);
  assert.deepEqual(r.decades.map(d => d.decade), [1930, 1990, 2010, 2020]);
  assert.deepEqual(r.longestStreak, { days: 3, from: '2024-03-02', to: '2024-03-04' });
  assert.deepEqual(r.busiestDay, { date: '2024-03-04', count: 2 });
  assert.deepEqual(r.oldestFilm, { key: 'a', year: 1931 });
  assert.deepEqual(r.newestFilm, { key: 'c', year: 2020 });
});

test('rating average and rating versus the crowd', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.equal(r.ratingAverage, 4); // (4 + 5 + 3) / 3
  assert.equal(r.ratingVsCrowd, 0.33); // diffs 10, 40, -30 -> 6.67 points -> 0.33 stars
});

test('a year with no entries gives zeros and says so', () => {
  const r = yearInReview({ summaries, entries, year: 2019 });
  assert.equal(r.totals.films, 0);
  assert.deepEqual(r.topFilms, []);
  assert.equal(r.firstFilm, null);
  assert.equal(r.months.length, 12);
  assert.equal(r.ratingAverage, null);
  assert.equal(r.longestStreak.days, 0);
  assert.match(r.highlights[0], /Nothing in your diary for 2019/);
});

test('empty input does not throw and is deterministic', () => {
  const a = yearInReview({}), b = yearInReview({});
  assert.deepEqual(a, b);
  assert.deepEqual(a.years, []);
});

test('highlights are 3 to 5 sentences for a busy year', () => {
  const r = yearInReview({ summaries, entries, year: 2024 });
  assert.ok(r.highlights.length >= 3 && r.highlights.length <= 5, r.highlights.join(' | '));
  assert.ok(r.highlights.some(h => /4 films in March/.test(h)));
});
