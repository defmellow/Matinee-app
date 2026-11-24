import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_NOTES, compareToTypical, sourceLines } from '../../ui/components/sourceNotes.js';
import { SCORE_SOURCES } from '../../core/analysis/scores.js';

test('every scored source has a note whose mean and sd match the core reference', () => {
  for (const s of SCORE_SOURCES) {
    const n = SOURCE_NOTES[s.source];
    assert.ok(n, s.source);
    assert.equal(n.mean, s.ref[0], `${s.source} mean`);
    assert.equal(n.sd, s.ref[1], `${s.source} sd`);
  }
});

test('compareToTypical uses z thresholds of 0.5', () => {
  assert.equal(compareToTypical('imdb', 75), 'Above typical');   // z ≈ 0.91
  assert.equal(compareToTypical('imdb', 66), 'Typical');
  assert.equal(compareToTypical('imdb', 55), 'Below typical');   // z ≈ -1.07
  assert.equal(compareToTypical('rt-critics', 50 + 0.5 * 29), 'Typical'); // exactly 0.5 is still typical
  assert.equal(compareToTypical('nope', 50), null);
  assert.equal(compareToTypical('imdb', null), null);
});

test('sourceLines stays short and ends with the verdict', () => {
  for (const source of Object.keys(SOURCE_NOTES)) {
    const lines = sourceLines({ source, value100: 80 });
    const words = lines.map(l => l.text).join(' ').split(/\s+/).length;
    assert.ok(words <= 60, `${source}: ${words} words`);
    assert.equal(lines.at(-1).kind, 'verdict');
  }
  assert.equal(sourceLines({ source: 'unknown' }), null);
});
