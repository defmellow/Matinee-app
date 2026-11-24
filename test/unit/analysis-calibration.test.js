// Synthetic summaries only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calibration, pointsText } from '../../core/analysis/calibration.js';

const film = (i, rating, score, extra = {}) => ({
  key: 'f' + i, title: 'F' + i, year: 1990 + i, score,
  user: { watched: true, rating },
  genres: ['Drama'], directors: [], countries: [], ...extra,
});

test('empty and unscored input gives an empty result', () => {
  const c = calibration([film(1, null, 80), film(2, 8, null)]);
  assert.deepEqual(c.overall, { diff: 0, count: 0 });
  assert.deepEqual([c.byGenre, c.byDecade, c.byDirector, c.byCountry, c.notes], [[], [], [], [], []]);
});

test('overall diff and genre rows need three films', () => {
  const fs = [
    film(1, 6, 80, { genres: ['Horror'] }), film(2, 6, 70, { genres: ['Horror'] }), film(3, 5, 70, { genres: ['Horror', 'Drama'] }),
    film(4, 9, 80, { genres: ['Drama'] }), film(5, 9, 80, { genres: ['Drama'] }), film(6, 8, 80, { genres: ['Comedy'] }),
  ];
  const c = calibration(fs);
  assert.equal(c.overall.count, 6);
  const horror = c.byGenre.find(r => r.name === 'Horror');
  assert.deepEqual(horror, { name: 'Horror', diff: -16.7, count: 3 });
  assert.equal(c.byGenre.find(r => r.name === 'Comedy'), undefined);
  assert.ok(Math.abs(c.byGenre[0].diff) >= Math.abs(c.byGenre.at(-1).diff));
  assert.ok(c.notes.length >= 2 && c.notes.length <= 4);
  assert.match(c.notes.join(' '), /tougher than most on horror films \(−17 points, about ¾★, across 3 films\)/);
});

test('directors need two films; countries are merged by canonical name', () => {
  const fs = [
    film(1, 9, 70, { directors: [{ name: 'A Dir', id: 'p:1' }], countries: ['United States'] }),
    film(2, 9, 70, { directors: [{ name: 'A Dir', id: 'p:1' }], countries: ['USA'] }),
    film(3, 5, 70, { directors: [{ name: 'B Dir', id: 'p:2' }], countries: ['United States of America'] }),
  ];
  const c = calibration(fs);
  assert.deepEqual(c.byDirector, [{ name: 'A Dir', id: 'p:1', diff: 20, count: 2 }]);
  assert.equal(c.byCountry.length, 1);
  assert.equal(c.byCountry[0].count, 3);
});

test('decades group by year', () => {
  const fs = [1, 2, 3].map(i => film(i, 5, 60, { year: 1975 + i }));
  assert.deepEqual(calibration(fs).byDecade, [{ name: '1970s', diff: -10, count: 3 }]);
});

test('pointsText gives points and stars', () => {
  assert.equal(pointsText(-14), '14 points (about ¾★)');
  assert.equal(pointsText(1), '1 point (under ¼★)');
  assert.equal(pointsText(40), '40 points (about 2★)');
});
