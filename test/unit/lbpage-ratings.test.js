import test from 'node:test';
import assert from 'node:assert/strict';
import { toData } from '../../core/providers/lbpage.js';
import { compose } from '../../core/model.js';

test('lbpage stores the Letterboxd average as a rating that compose() picks up', () => {
  const data = toData({ themes: ['grief'], average: 3.94, ratingCount: 120345 });
  assert.deepEqual(data.ratings, { letterboxd: { value: 3.94, votes: 120345 } });
  const c = compose({ key: 'k', title: 'T', src: { lbpage: data } });
  assert.equal(c.ratings.letterboxd.value, 3.94);
});

test('lbpage without an average stores no ratings', () => {
  assert.equal(toData({ themes: ['grief'] }).ratings, undefined);
});
