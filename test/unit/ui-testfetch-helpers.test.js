import test from 'node:test';
import assert from 'node:assert/strict';
import { clampFilms, elapsedText, foldStep, headline, needsCheck, phaseText, reportFilename } from '../../ui/screens/settings/testfetch.js';

test('clampFilms keeps the stepper in 8 to 40', () => {
  assert.equal(clampFilms(3), 8);
  assert.equal(clampFilms(99), 40);
  assert.equal(clampFilms(24), 24);
  assert.equal(clampFilms('x'), 24);
});

test('elapsedText', () => {
  assert.equal(elapsedText(0), '0:00');
  assert.equal(elapsedText(83000), '1:23');
  assert.equal(elapsedText(3725000), '1:02:05');
});

test('foldStep counts finished steps per phase and tracks the current one', () => {
  let s = {};
  s = foldStep(s, { phase: 'providers', provider: 'imdb', film: 'Heat', state: 'start' });
  assert.equal(s.current, 'imdb · Heat');
  s = foldStep(s, { phase: 'providers', provider: 'imdb', film: 'Heat', state: 'done' });
  s = foldStep(s, { phase: 'providers', provider: 'rt', film: 'Heat', state: 'failed' });
  assert.deepEqual([s.done, s.failed], [1, 1]);
  s = foldStep(s, { phase: 'feel', state: 'start' });
  assert.deepEqual([s.phase, s.done, s.failed], ['feel', 0, 0]);
});

test('needsCheck and phaseText', () => {
  assert.equal(needsCheck({ window: true }), true);
  assert.equal(needsCheck({ state: 'done' }), false);
  assert.equal(needsCheck(null), false);
  assert.match(phaseText('plain-check'), /quick and full/);
  assert.equal(phaseText('nope'), 'Working');
});

test('headline takes the first lines and says how many were left', () => {
  const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
  const h = headline(text, 40);
  assert.equal(h.text.split('\n').length, 40);
  assert.equal(h.more, 10);
  assert.deepEqual(headline('', 40), { text: '', more: 0 });
});

test('reportFilename', () => {
  assert.equal(reportFilename(new Date('2026-10-29T03:00:00Z')), 'matinee-test-fetch-2026-10-29.txt');
});
