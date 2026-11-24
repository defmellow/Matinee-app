import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, matchScore, bestScore } from '../../ui/screens/feel/rank.js';

test('fold strips accents and case', () => assert.equal(fold('  Amélie '), 'amelie'));
test('matchScore ranks prefix, word start, inside, none', () => {
  assert.equal(matchScore('ame', 'amelie'), 3);
  assert.equal(matchScore('lie', 'the lie'), 2);
  assert.equal(matchScore('eli', 'amelie'), 1);
  assert.equal(matchScore('xyz', 'amelie'), 0);
  assert.equal(matchScore('red dog', 'the dog is red'), 2);
});
test('bestScore takes the best text and skips blanks', () => assert.equal(bestScore('ame', ['', 'amelie', 'x']), 3));
