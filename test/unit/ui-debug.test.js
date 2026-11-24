import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, describeCall, isBackgroundCall, makeGate, problemTime, ageText, debugRows, idLink, fieldsByProvider, countLevels, levelText, levelLabel, groupProblems, dataSummary } from '../../ui/debug/model.js';

test('describeError never throws and keeps the message', () => {
  assert.match(describeError(new TypeError('boom')), /TypeError: boom/);
  assert.equal(describeError('plain'), 'plain');
  assert.equal(describeError(null), 'unknown error');
  assert.equal(typeof describeError({ get message() { throw new Error('x'); } }), 'string');
  assert.ok(describeError(Object.assign(new Error('e'), { code: 'E1' })).includes('[E1]'));
});

test('describeCall gives a plain area and message, with a fallback', () => {
  assert.deepEqual(describeCall('getFilm'), { area: 'Film page', message: "Couldn't load the film." });
  assert.deepEqual(describeCall('setPoster'), { area: 'Film page', message: "Couldn't finish the poster." });
  assert.equal(describeCall('somethingNew').area, 'Matinee');
});

test('background calls are warnings; actions the user triggers are not', () => {
  assert.ok(isBackgroundCall('fetchNow'));
  assert.ok(!isBackgroundCall('setUserFilm'));
});

test('gate drops repeats inside the window only', () => {
  const g = makeGate({ windowMs: 1000 });
  assert.equal(g('a', 0), true);
  assert.equal(g('a', 500), false);
  assert.equal(g('b', 500), true);
  assert.equal(g('a', 1500), true);
});

test('time and age text', () => {
  const now = new Date('2026-11-10T12:00:00');
  assert.match(problemTime('2026-11-10T09:05:00', now), /9:05/);
  assert.match(problemTime('2026-11-08T09:05:00', now), /8 Nov/);
  assert.equal(problemTime('nope'), '');
  assert.equal(ageText(1000, 31000), '30 s');
  assert.equal(ageText(0, 5000), '');
  assert.equal(ageText(Date.now() - 3 * 3600e3), '3 h');
});

test('debugRows drops empties and flattens lists', () => {
  assert.deepEqual(debugRows({ a: 1, b: '', c: null, d: [], e: ['x', 'y'], f: false, g: 0 }), [['a', '1'], ['e', 'x, y'], ['g', '0']]);
});

test('idLink knows the obvious sites', () => {
  assert.equal(idLink('imdb', 'tt1'), 'https://www.imdb.com/title/tt1/');
  assert.equal(idLink('tmdb', 5), 'https://www.themoviedb.org/movie/5');
  assert.equal(idLink('rt', 'm/x'), null);
});

test('fieldsByProvider groups, biggest first', () => {
  const r = fieldsByProvider({ poster: 'tmdb', title: 'tmdb', score: 'omdb' });
  assert.deepEqual(r, [{ provider: 'tmdb', fields: ['poster', 'title'] }, { provider: 'omdb', fields: ['score'] }]);
});

test('flag counts and text', () => {
  const c = countLevels([{ level: 'error', count: 2, isNew: true }, { level: 'warning', count: 5 }, { level: 'warning', isNew: true }]);
  assert.deepEqual(c, { unseen: 2, total: 8, error: 2, warning: 6, unseenError: 1, unseenWarning: 1 });
  assert.equal(levelText({ error: 2, warning: 5 }), '2 errors · 5 warnings');
  assert.equal(levelText({ error: 1, warning: 0 }), '1 error');
  assert.equal(levelText({}), 'No problems');
  assert.equal(levelLabel('warning'), 'Warning');
  assert.equal(levelLabel('error'), 'Error');
});

test('groupProblems folds the same warning across films', () => {
  const g = groupProblems([
    { id: 1, level: 'warning', area: 'Rotten Tomatoes', message: 'Nothing found', film: 'a' },
    { id: 2, level: 'warning', area: 'Rotten Tomatoes', message: 'Nothing found', film: 'b' },
    { id: 3, level: 'error', area: 'Film page', message: 'x' },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].rows.length, 2);
  assert.equal(g[1].key, 3);
});

test('dataSummary is short', () => {
  assert.deepEqual(dataSummary({ a: [1, 2], b: { x: 1 }, c: 'z' }), { a: '2 items', b: '{1 keys}', c: 'z' });
  assert.deepEqual(dataSummary(null), {});
});
