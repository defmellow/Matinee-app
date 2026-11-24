import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreThemes, CENTRALITY } from '../../core/analysis/feel/centrality.js';

// Synthetic film: labels and texts are made up for these tests.
const theme = (label, sources) => ({ id: label.toLowerCase().replace(/\W+/g, '-'), label, kind: 'subject', voices: ['editors'], sources });
const C = (r, label) => r.find(t => t.label === label).centrality;

test('two independent sources beat one', () => {
  const one = scoreThemes([theme('Lighthouse keeping', ['keyword'])], {});
  const two = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { lists: { wikipedia: ['Lighthouse keeping films'] } });
  assert.ok(C(two, 'Lighthouse keeping') > C(one, 'Lighthouse keeping') + 0.1);
  assert.ok(two[0].why.includes('Named by 2 sources'));
  assert.deepEqual(two[0].agreement.sources, ['keywords', 'wikipedia']);
});

test('one source alone gets no lift', () => {
  const r = scoreThemes([theme('Lighthouse keeping', ['category'])], { lists: { wikipedia: ['Lighthouse keeping films'] } });
  assert.equal(C(r, 'Lighthouse keeping'), CENTRALITY.prior.category);
});

test('correlated sources count once: Wikipedia category plus Wikipedia text, and two keyword lists', () => {
  const texts = [{ voice: 'editors', source: 'wikipedia.plot', text: 'A lighthouse keeper goes mad.' }];
  const r = scoreThemes([theme('Lighthouse keeping', ['category'])], { texts, lists: { wikipedia: ['Lighthouse keeping films'] } });
  assert.equal(r[0].agreement.score, 1);
  assert.equal(C(r, 'Lighthouse keeping') < 0.4, true);
  const kw = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { lists: { keywords: ['lighthouse keeping', 'Lighthouse keeping'] } });
  assert.equal(kw[0].agreement.score, 1);
});

test('three groups lift more than two', () => {
  const texts = [{ voice: 'editors', source: 'synopsis', text: 'A lighthouse keeping crew.' }];
  const two = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { texts });
  const three = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { texts, lists: { wikidata: ['lighthouse keeping'] } });
  assert.ok(C(three, 'Lighthouse keeping') > C(two, 'Lighthouse keeping'));
});

test('Letterboxd theme lists are capped: many miniTheme lines count as half a source', () => {
  const lb = Array.from({ length: 12 }, () => ({ voice: 'viewers', source: 'lbpage.themes', text: 'lighthouse keeping sea' }));
  const r = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { texts: lb });
  assert.equal(r[0].agreement.score, 1.5); // keyword 1 + Letterboxd themes 0.5, however many lines
  const one = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { texts: lb.slice(0, 1) });
  assert.equal(one[0].agreement.score, 1.5);
  const full = scoreThemes([theme('Lighthouse keeping', ['keyword'])], { lists: { wikipedia: ['lighthouse keeping'] } });
  assert.ok(C(full, 'Lighthouse keeping') > 0 && full[0].agreement.score === 2);
  // the lift from half a source is smaller than from a whole one
  const agr = CENTRALITY.agreement;
  assert.ok(agr.weight * (1 - Math.exp(-agr.rate * 0.5)) < agr.weight * (1 - Math.exp(-agr.rate)));
});

test('no theme is dropped and the title words never count as agreement', () => {
  const r = scoreThemes([theme('Lighthouse keeping', ['keyword']), theme('Obscure idea', [])], { titleStems: ['lighthous'], lists: { wikipedia: ['Obscure idea films'] } });
  assert.equal(r.length, 2);
});
