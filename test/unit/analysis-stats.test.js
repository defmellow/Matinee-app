// Synthetic library and diary only. 2024-06-15 is a Saturday.
import test from 'node:test';
import assert from 'node:assert/strict';
import { insights } from '../../core/analysis/stats.js';

const person = (name, id) => ({ name, id });
const film = (key, { user, ...o } = {}) => ({
  key, title: `Film ${key}`, year: null, runtime: null, genres: [], countries: [], languages: [], directors: [], cast: [],
  keywords: [], subjects: [], score: null, ...o,
  user: { watched: true, rating: null, liked: false, watchlist: false, tags: [], ...user },
});
const entry = (id, key, date, o = {}) => ({ id, key, date, rating: null, liked: false, rewatch: false, review: '', tags: [], ...o });

const D1 = person('Dir One', 'wd:1'), D2 = person('Dir Two', 'wd:2'), D3 = person('Dir Three', 'wd:3');
const X = person('Actor X', 'wd:10'), Y = person('Actor Y', 'wd:11');

const summaries = [
  film('a', { year: 1984, runtime: 120, genres: ['Drama'], countries: ['United States of America'], languages: ['English'], directors: [D1], cast: [X, Y], keywords: ['road trip'], subjects: ['loneliness'], score: 70, user: { rating: 8, liked: true } }),
  film('b', { year: 1986, runtime: 90, genres: ['Drama', 'Comedy'], countries: ['United States'], languages: ['English'], directors: [D1], cast: [X], subjects: ['loneliness'], score: 60, user: { rating: 10 } }),
  film('c', { year: 1991, runtime: 150, genres: ['Drama'], countries: ['Japan'], languages: ['Japanese'], directors: [D2], cast: [Y, person('p3'), person('p4'), person('p5'), person('p6'), X], subjects: ['loneliness'], score: 90, user: { rating: 6 } }),
  film('d', { year: 1999, runtime: null, genres: ['Comedy'], countries: ['France'], languages: ['French'], directors: [D2], score: 50 }),
  film('e', { year: 2001, runtime: 100, user: { watched: false, watchlist: true } }),
  film('f', { year: 1999, runtime: 60, genres: ['Thriller'], countries: ['Japan'], languages: ['Japanese'], directors: [D3], subjects: ['loneliness'], score: 85, user: { rating: 9, liked: true } }),
];
const entries = [
  entry(1, 'a', '2024-06-15'),
  entry(2, 'b', '2024-06-14', { review: 'Great.' }),
  entry(3, 'c', '2024-06-13'),
  entry(4, 'a', '2024-06-13', { rewatch: true, review: '   ' }),
  entry(5, 'b', '2024-03-02'),
  entry(6, 'c', '2023-12-31'),
  entry(7, 'zzz', '2022-01-01'),          // a film that is no longer in the library
  entry(8, 'a', 'not a date'),            // counted as an entry, but not placed on the calendar
];
const report = insights({ summaries, entries, today: '2024-06-15' });

test('totals', () => {
  assert.deepEqual(report.totals, {
    films: 5,        // a b c d f are watched
    entries: 8,
    hours: 15,       // entries: 120+90+150+120+90+150+0+120 = 840 min; f has no entry so adds 60; d has no runtime
    rewatches: 1,
    reviews: 1,      // blank review text does not count
    liked: 2,
    watchlist: 1,
    rated: 4,
  });
});

test('hours add a watched film once when it has no diary entries, and use each entry for repeats', () => {
  const r = insights({ summaries: [film('x', { runtime: 100 })], entries: [], today: '2024-01-01' });
  assert.equal(r.totals.hours, 1.7); // 100 min
  const r2 = insights({ summaries: [film('x', { runtime: 100 })], entries: [entry(1, 'x', '2024-01-01'), entry(2, 'x', '2024-01-05')], today: '2024-01-10' });
  assert.equal(r2.totals.hours, 3.3); // two viewings, 200 min
  const r3 = insights({ summaries: [film('x', { runtime: 100, user: { watched: false, watchlist: true } })], entries: [], today: '2024-01-01' });
  assert.equal(r3.totals.hours, 0); // watchlist only
});

test('byYear counts and hours by entry date, in order', () => {
  assert.deepEqual(report.byYear, [
    { year: 2022, count: 1, hours: 0 },
    { year: 2023, count: 1, hours: 2.5 },
    { year: 2024, count: 5, hours: 9.5 },
  ]);
});

test('byYear fills the quiet years between with zeros', () => {
  const r = insights({ summaries: [film('x', { runtime: 60 })], entries: [entry(1, 'x', '2019-05-05'), entry(2, 'x', '2022-05-05')], today: '2023-01-01' });
  assert.deepEqual(r.byYear, [
    { year: 2019, count: 1, hours: 1 }, { year: 2020, count: 0, hours: 0 }, { year: 2021, count: 0, hours: 0 }, { year: 2022, count: 1, hours: 1 },
  ]);
});

test('byMonth is the last 24 months including empty ones', () => {
  assert.equal(report.byMonth.length, 24);
  assert.equal(report.byMonth[0].month, '2022-07');
  assert.equal(report.byMonth[23].month, '2024-06');
  const get = m => report.byMonth.find(x => x.month === m).count;
  assert.equal(get('2024-06'), 4);
  assert.equal(get('2024-03'), 1);
  assert.equal(get('2024-04'), 0);
  assert.equal(get('2023-12'), 1);
  // 2022-01 is older than the window
  assert.equal(report.byMonth.some(x => x.month === '2022-01'), false);
  // months are consecutive
  report.byMonth.forEach((m, i) => { if (i) assert.ok(m.month > report.byMonth[i - 1].month); });
});

test('byMonth crosses a year boundary', () => {
  const r = insights({ summaries: [], entries: [], today: '2024-01-20' });
  assert.equal(r.byMonth[23].month, '2024-01');
  assert.equal(r.byMonth[22].month, '2023-12');
  assert.equal(r.byMonth[0].month, '2022-02');
  assert.ok(r.byMonth.every(m => m.count === 0));
});

test('rating histogram covers 1–10 and the average is in stars', () => {
  assert.equal(report.ratingHistogram.length, 10);
  assert.deepEqual(report.ratingHistogram.map(h => h.rating), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(report.ratingHistogram.map(h => h.count), [0, 0, 0, 0, 0, 1, 0, 1, 1, 1]);
  assert.equal(report.averageRating, 4.13); // (8+10+6+9)/4/2 = 4.125
});

test('your ratings against the crowd', () => {
  // diffs: a +10, b +40, c -30, f +5
  assert.equal(report.vsCrowd.averageDiff, 6.3);
  assert.equal(report.vsCrowd.agreeWithCrowdPct, 50); // a and f are within 10
  assert.equal(report.vsCrowd.count, 4);
});

test('vsCrowd skips films without a score or without your rating', () => {
  const r = insights({ summaries: [film('x', { score: null, user: { rating: 8 } }), film('y', { score: 70 }), film('z', { score: 70, user: { rating: 7 } })], entries: [], today: '2024-01-01' });
  assert.deepEqual(r.vsCrowd, { averageDiff: 0, agreeWithCrowdPct: 100, count: 1 });
});

test('top directors need two films; ties break on your average rating', () => {
  assert.deepEqual(report.topDirectors, [
    { name: 'Dir One', id: 'wd:1', count: 2, averageRating: 4.5 },
    { name: 'Dir Two', id: 'wd:2', count: 2, averageRating: 3 }, // d is unrated, c is 3 stars
  ]);
  // Dir Three has one film only
  assert.equal(report.topDirectors.some(d => d.name === 'Dir Three'), false);
});

test('top actors only count the first five billed', () => {
  // X is billed sixth in film c, so only a and b count; Y is first in c
  assert.deepEqual(report.topActors, [
    { name: 'Actor X', id: 'wd:10', count: 2, averageRating: 4.5 },
    { name: 'Actor Y', id: 'wd:11', count: 2, averageRating: 3.5 },
  ]);
});

test('top countries, languages, genres and decades (min count 1, merged spellings)', () => {
  assert.deepEqual(report.topCountries, [
    { name: 'United States of America', count: 2, averageRating: 4.5 }, // "United States" is the same country
    { name: 'Japan', count: 2, averageRating: 3.75 },
    { name: 'France', count: 1, averageRating: null },
  ]);
  assert.deepEqual(report.topLanguages, [
    { name: 'English', count: 2, averageRating: 4.5 },
    { name: 'Japanese', count: 2, averageRating: 3.75 },
    { name: 'French', count: 1, averageRating: null },
  ]);
  assert.deepEqual(report.topGenres, [
    { name: 'Drama', count: 3, averageRating: 4 },
    { name: 'Comedy', count: 2, averageRating: 5 },
    { name: 'Thriller', count: 1, averageRating: 4.5 },
  ]);
  assert.deepEqual(report.topDecades, [
    { name: '1990s', count: 3, averageRating: 3.75 },
    { name: '1980s', count: 2, averageRating: 4.5 },
  ]);
});

test('top lists keep ten at most and leave out unwatched films', () => {
  const many = Array.from({ length: 15 }, (_, i) => film(`g${i}`, { genres: [`Genre ${String(i).padStart(2, '0')}`] }));
  const r = insights({ summaries: [...many, film('w', { genres: ['Watchlisted'], user: { watched: false, watchlist: true } })], entries: [], today: '2024-01-01' });
  assert.equal(r.topGenres.length, 10);
  assert.equal(r.topGenres.some(g => g.name === 'Watchlisted'), false);
  assert.deepEqual(r.topGenres.slice(0, 2).map(g => g.name), ['Genre 00', 'Genre 01']); // equal counts: by name
});

test('weekdays run Monday to Sunday', () => {
  assert.deepEqual(report.weekdays, [
    { day: 'Mon', count: 0 }, { day: 'Tue', count: 0 }, { day: 'Wed', count: 0 }, { day: 'Thu', count: 2 },
    { day: 'Fri', count: 1 }, { day: 'Sat', count: 3 }, { day: 'Sun', count: 1 },
  ]);
});

test('streaks', () => {
  assert.equal(report.streaks.longestDays, 3);   // 13th, 14th, 15th June
  assert.equal(report.streaks.currentDays, 3);   // ends today
  assert.deepEqual(report.streaks.busiestDay, { date: '2024-06-13', count: 2 });
  assert.deepEqual(report.streaks.busiestMonth, { month: '2024-06', count: 4 });
});

test('the current streak survives until the end of the next day, then breaks', () => {
  const run = today => insights({ summaries, entries, today }).streaks.currentDays;
  assert.equal(run('2024-06-15'), 3);
  assert.equal(run('2024-06-16'), 3); // last viewing was yesterday
  assert.equal(run('2024-06-17'), 0);
  assert.equal(run('2024-06-13'), 1); // "today" before the later entries: only the 13th counts
});

test('longest streak is found across month and year boundaries', () => {
  const es = ['2023-12-30', '2023-12-31', '2024-01-01', '2024-01-02', '2024-01-10'].map((d, i) => entry(i, 'x', d));
  const r = insights({ summaries: [film('x')], entries: es, today: '2024-02-01' });
  assert.equal(r.streaks.longestDays, 4);
  assert.equal(r.streaks.currentDays, 0);
});

test('busiest day and month break ties towards the earlier one', () => {
  const es = [entry(1, 'x', '2024-02-02'), entry(2, 'x', '2024-02-02'), entry(3, 'x', '2024-01-05'), entry(4, 'x', '2024-01-05'), entry(5, 'x', '2024-01-06')];
  const r = insights({ summaries: [film('x')], entries: es, today: '2024-03-01' });
  assert.deepEqual(r.streaks.busiestDay, { date: '2024-01-05', count: 2 });
  assert.deepEqual(r.streaks.busiestMonth, { month: '2024-01', count: 3 });
});

test('first and last entry dates and films per month over the active span', () => {
  assert.equal(report.firstEntryDate, '2022-01-01');
  assert.equal(report.lastEntryDate, '2024-06-15');
  // 7 dated entries over Jan 2022 .. Jun 2024 = 30 months
  assert.equal(report.filmsPerMonthAvg, 0.2);
  const r = insights({ summaries: [film('x')], entries: [entry(1, 'x', '2024-01-01'), entry(2, 'x', '2024-01-02'), entry(3, 'x', '2024-02-02')], today: '2024-03-01' });
  assert.equal(r.filmsPerMonthAvg, 1.5); // 3 entries over 2 months
});

test('favourite subjects need three rated films and are ranked by average rating', () => {
  assert.deepEqual(report.favouriteSubjects, [{ name: 'Loneliness', count: 4, averageRating: 4.13 }]);
  const mk = (key, subj, rating) => film(key, { subjects: subj, user: { rating } });
  const r = insights({
    summaries: [
      mk('1', ['alpha', 'beta'], 10), mk('2', ['alpha', 'beta'], 10), mk('3', ['alpha', 'beta'], 10),
      mk('4', ['gamma'], 8), mk('5', ['gamma'], 8), mk('6', ['gamma'], 8), mk('7', ['gamma'], 8),
      mk('8', ['rare'], 10), mk('9', ['rare'], 10),                      // only two rated films
      film('10', { subjects: ['rare'], user: { rating: null } }),         // unrated films don't count
    ],
    entries: [], today: '2024-01-01',
  });
  assert.deepEqual(r.favouriteSubjects.map(s => s.name), ['Alpha', 'Beta', 'Gamma']);
});

test('keywords count as subjects for favourites', () => {
  const r = insights({ summaries: ['1', '2', '3'].map(k => film(k, { keywords: ['ROAD TRIP'], user: { rating: 7 } })), entries: [], today: '2024-01-01' });
  assert.deepEqual(r.favouriteSubjects, [{ name: 'Road trip', count: 3, averageRating: 3.5 }]);
});

test('empty input does not throw and returns a full, empty report', () => {
  for (const input of [undefined, {}, { summaries: [], entries: [] }, { summaries: null, entries: null }]) {
    const r = insights(input);
    assert.deepEqual(r.totals, { films: 0, entries: 0, hours: 0, rewatches: 0, reviews: 0, liked: 0, watchlist: 0, rated: 0 });
    assert.deepEqual(r.byYear, []);
    assert.equal(r.byMonth.length, 24);
    assert.ok(r.byMonth.every(m => m.count === 0));
    assert.equal(r.ratingHistogram.length, 10);
    assert.equal(r.averageRating, null);
    assert.deepEqual(r.vsCrowd, { averageDiff: null, agreeWithCrowdPct: null, count: 0 });
    for (const k of ['topDirectors', 'topActors', 'topCountries', 'topLanguages', 'topGenres', 'topDecades', 'favouriteSubjects']) assert.deepEqual(r[k], []);
    assert.equal(r.weekdays.length, 7);
    assert.deepEqual(r.streaks, { longestDays: 0, currentDays: 0, busiestDay: null, busiestMonth: null });
    assert.equal(r.firstEntryDate, null);
    assert.equal(r.lastEntryDate, null);
    assert.equal(r.filmsPerMonthAvg, 0);
  }
});

test('a library with no diary at all still reports films, hours and ratings', () => {
  const r = insights({ summaries, entries: [], today: '2024-06-15' });
  assert.equal(r.totals.films, 5);
  assert.equal(r.totals.hours, 7); // a 120 + b 90 + c 150 + f 60 (d has no runtime) = 420 min
  assert.equal(r.averageRating, 4.13);
  assert.deepEqual(r.byYear, []);
  assert.equal(r.streaks.longestDays, 0);
});

test('missing user blocks, runtimes and ratings are tolerated', () => {
  const r = insights({
    summaries: [{ key: 'a', title: 'A' }, { key: 'b', user: { watched: true, rating: 11 } }, { key: 'c', user: { watched: true, rating: 0 } }, null],
    entries: [{ key: 'a', date: '2024-01-01' }, { key: 'nope', date: '2024-01-02', review: null }, null],
    today: '2024-01-03',
  });
  assert.equal(r.totals.films, 2);
  assert.equal(r.totals.rated, 0); // 11 and 0 are not valid ratings
  assert.equal(r.averageRating, null);
  assert.equal(r.streaks.longestDays, 2);
});

test('an invalid or missing today falls back to the real date', () => {
  const r = insights({ summaries: [], entries: [], today: 'nonsense' });
  assert.equal(r.byMonth.length, 24);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  assert.equal(r.byMonth[23].month, month);
  assert.equal(insights({}).byMonth[23].month, month);
});

test('insights does not change its input', () => {
  const s = JSON.parse(JSON.stringify(summaries)), e = JSON.parse(JSON.stringify(entries));
  insights({ summaries: s, entries: e, today: '2024-06-15' });
  assert.deepEqual(s, JSON.parse(JSON.stringify(summaries)));
  assert.deepEqual(e, JSON.parse(JSON.stringify(entries)));
});
