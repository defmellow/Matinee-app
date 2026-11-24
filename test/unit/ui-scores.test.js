import test from 'node:test';
import assert from 'node:assert/strict';
import { externalScores, primaryScore, orderParts, rowScores } from '../../ui/components/scores.js';

// Synthetic ratings, for tests only.
const all = { imdb: { value: 7.8, votes: 1200 }, letterboxd: { value: 3.936, votes: 5000 }, rt: { critics: 92, criticsCount: 80, audience: 88 }, metacritic: { critics: 71 } };

test('externalScores orders Letterboxd, RT, Popcornmeter, IMDb, Metacritic', () => {
  assert.deepEqual(externalScores(all).map(s => s.source), ['letterboxd', 'rt-critics', 'rt-audience', 'imdb', 'metacritic']);
  assert.equal(externalScores(all)[0].text, '★ 3.94');
  assert.match(externalScores(all)[0].title, /5,000 ratings/);
});

test('primaryScore falls back with a label when Letterboxd is missing', () => {
  assert.equal(primaryScore({ imdb: { value: 7.8 } }).text, 'IMDb 7.8');
  assert.equal(primaryScore({ rt: { critics: 91.6 } }).text, 'RT 92%');
  assert.equal(primaryScore({}), null);
  assert.equal(primaryScore({ letterboxd: { value: 0 } }), null);
});

test('orderParts sorts by source order, unknown last, without mutating', () => {
  const parts = [{ source: 'imdb' }, { source: 'x' }, { source: 'letterboxd' }];
  assert.deepEqual(orderParts(parts).map(p => p.source), ['letterboxd', 'imdb', 'x']);
  assert.equal(parts[0].source, 'imdb');
});

test('rowScores keeps Letterboxd, RT critics, IMDb in order and falls back to a bare IMDb value', () => {
  assert.deepEqual(rowScores(all).map(s => s.source), ['letterboxd', 'rt-critics', 'imdb']);
  assert.deepEqual(rowScores(null, { value: 6.4, votes: 10 }).map(s => s.text), ['IMDb 6.4']);
  assert.deepEqual(rowScores(null, null), []);
  assert.deepEqual(rowScores({ rt: { critics: 80 } }, { value: 7 }).map(s => s.source), ['rt-critics', 'imdb']);
});
