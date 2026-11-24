// Eligibility for recommendations. All films here are SYNTHETIC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eligible, maxVotes, scoreIsTiny } from '../../core/analysis/eligible.js';

const today = '2026-10-22';
const base = { title: 'X', year: 2019, runtime: 90, genres: ['Drama'], ratings: {} };

test('a released 90-minute film is eligible', () => {
  assert.equal(eligible(base, { today }), true);
  assert.equal(eligible({ ...base, released: '2019-05-01' }, { today }), true);
});

test('unreleased films are out: by date, or by year when there is no date', () => {
  assert.equal(eligible({ ...base, year: 2027 }, { today }), false);
  assert.equal(eligible({ ...base, year: 2026, released: '2026-12-18' }, { today }), false);
  assert.equal(eligible({ ...base, year: 2026, released: '2026-10-22' }, { today }), true, 'released today counts');
  assert.equal(eligible({ ...base, year: 2026, released: '2026-03-01' }, { today }), true);
});

test('this year with no exact date needs real votes', () => {
  const y = { ...base, year: 2026 };
  assert.equal(eligible(y, { today }), false);
  assert.equal(eligible({ ...y, ratings: { imdb: { value: 7, votes: 5 } } }, { today }), false, 'tiny count is no evidence');
  assert.equal(eligible({ ...y, ratings: { imdb: { value: 7, votes: 400 } } }, { today }), true);
});

test('shorts are out unless asked for', () => {
  const short = { ...base, runtime: 17 };
  assert.equal(eligible(short, { today }), false);
  assert.equal(eligible(short, { today, includeShorts: true }), true);
  assert.equal(eligible({ ...base, runtime: 44 }, { today }), false);
  assert.equal(eligible({ ...base, runtime: 45 }, { today }), true);
  assert.equal(eligible({ ...base, runtime: 120, genres: ['Short'] }, { today }), false);
});

test('TV is out unless asked for', () => {
  const tv = { ...base, kind: 'tv' };
  assert.equal(eligible(tv, { today }), false);
  assert.equal(eligible(tv, { today, includeTV: true }), true);
});

test('a time cap drops long films and films with no runtime', () => {
  assert.equal(eligible({ ...base, runtime: 150 }, { today, maxRuntime: 120 }), false);
  assert.equal(eligible({ ...base, runtime: 100 }, { today, maxRuntime: 120 }), true);
  assert.equal(eligible({ ...base, runtime: null }, { today, maxRuntime: 120 }), false);
  assert.equal(eligible({ ...base, runtime: null }, { today }), true, 'no cap: unknown runtime is fine');
});

test('tiny counts are not evidence', () => {
  assert.equal(maxVotes({ ratings: {} }), null);
  assert.equal(maxVotes({ ratings: { imdb: { votes: 12 }, rt: { criticsCount: 300 } } }), 300);
  assert.equal(scoreIsTiny({ ratings: { imdb: { votes: 12 } } }), true);
  assert.equal(scoreIsTiny({ ratings: { imdb: { votes: 12000 } } }), false);
  assert.equal(scoreIsTiny({ ratings: {} }), false, 'no counts at all is unknown, not tiny');
});

test('null and a Date for today are handled', () => {
  assert.equal(eligible(null), false);
  assert.equal(eligible({ ...base, year: 2030 }, { today: new Date('2026-10-22T00:00:00Z') }), false);
});
