import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, familyOf, familyWeights, blendColour, NEUTRAL } from '../../core/analysis/feel-families.js';

test('families: five plainly named colours in palette order', () => {
  assert.deepEqual(Object.keys(FAMILIES), ['red', 'yellow', 'green', 'blue', 'purple']);
  assert.equal(FAMILIES.red.c, '#ec9481');
  assert.equal(FAMILIES.purple.c, '#bea6e8');
});

test('familyOf: labels and ids reach their family, unknown words give null', () => {
  assert.equal(familyOf('Eerie'), 'red');
  assert.equal(familyOf('Dry wit'), 'yellow');
  assert.equal(familyOf('Thrilling'), 'green');
  assert.equal(familyOf('Thought-provoking'), 'blue');
  assert.equal(familyOf('Surreal'), 'purple');
  assert.equal(familyOf('Epic'), null);
  assert.equal(familyOf(''), null);
});

test('familyWeights and blendColour live here too', () => {
  assert.equal(blendColour(familyWeights([])), NEUTRAL);
  assert.equal(blendColour({ red: 1, yellow: 0, green: 0, blue: 0, purple: 0 }), '#ec9481');
});

test('every feeling word has a colour to be written in; WORD_ONLY words never move a film colour', async () => {
  const { wordFamilyOf, familyWeights, WORD_ONLY } = await import('../../core/analysis/feel-families.js');
  const { LEXICON } = await import('../../core/analysis/feel/lexicon.js');
  const missing = LEXICON.filter(d => ['mood', 'tone', 'pace', 'craft', 'impact'].includes(d.facet) && !wordFamilyOf(d.label) && !wordFamilyOf(d.id)).map(d => d.label);
  assert.deepEqual(missing, []);
  assert.equal(wordFamilyOf('Epic'), 'green');
  const w = familyWeights([{ id: 'epic', label: 'Epic', facet: 'craft', score: 0.9 }, { id: 'visually-striking', label: 'Visually striking', facet: 'craft', score: 0.9 }]);
  assert.deepEqual(w, { red: 0, yellow: 0, green: 0, blue: 0, purple: 0 });
  for (const words of Object.values(WORD_ONLY)) for (const x of words.split(' ')) assert.equal(familyOf(x), null, x + ' is in both lists');
});

test('feelWordParts: whole feelings up to three words, themes after ", about" stay plain', async () => {
  const { feelWordParts } = await import('../../core/analysis/feel-families.js');
  const show = t => feelWordParts(t).map(p => (p.fam ? `[${p.fam}:${p.text}]` : p.text)).join('');
  assert.equal(show('Moving, sad and slow-paced, about redemption'), '[blue:Moving], [blue:sad] and [blue:slow-paced], about redemption');
  assert.equal(show('Tense and thrilling, about crime'), '[red:Tense] and [green:thrilling], about crime');
  assert.equal(show('Visually striking, darkly comic and true to life'), '[purple:Visually striking], [yellow:darkly comic] and [blue:true to life]');
  assert.equal(show('Both feel melancholic; Same director: Wim Wenders'), 'Both feel [blue:melancholic]; Same director: Wim Wenders');
  assert.equal(show('Terrifying, eerie and epic, about moving on'), '[red:Terrifying], [red:eerie] and [green:epic], about moving on');
  assert.equal(show('Terrifying, eerie and epic, with a sense of moving on'), '[red:Terrifying], [red:eerie] and [green:epic], with a sense of moving on'); // older saved headlines
  assert.deepEqual(feelWordParts(''), []);
});

test('tornPair: two feelings close in strength give both, a clear leader gives none', async () => {
  const { tornPair } = await import('../../core/analysis/feel-families.js');
  assert.deepEqual(tornPair({ red: 0.9, yellow: 0, green: 0.7, blue: 0.1, purple: 0 }), ['red', 'green']);
  assert.equal(tornPair({ red: 0.9, yellow: 0, green: 0.5, blue: 0.1, purple: 0 }), null);
  assert.equal(tornPair({ red: 0.1, yellow: 0.1, green: 0, blue: 0, purple: 0 }), null); // too little to go on
  assert.equal(tornPair({}), null);
  assert.equal(tornPair(null), null);
});
