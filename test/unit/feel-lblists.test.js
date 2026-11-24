// Letterboxd's shared word lists are a hint, not evidence. Texts are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeelIndex, profileOf } from '../../core/analysis/feel/index.js';
import { LIST_SUPPORT, buildMatcher, prepareText, scoreDescriptors, scanText } from '../../core/analysis/feel/extract.js';
import { CHIP_FLOOR } from '../../core/analysis/feel/floor.js';
import { LEXICON } from '../../core/analysis/feel/lexicon.js';

const matcher = buildMatcher(LEXICON);
const list = (text) => ({ voice: 'viewers', source: 'lbpage.themes', text });
const review = (text) => ({ voice: 'viewers', source: 'lbpage.reviews', text });
const score = (texts, id) => scoreDescriptors(texts.map(prepareText), matcher).find(d => d.id === id)?.score ?? 0;
const chipIds = (texts) => {
  const idx = buildFeelIndex([{ key: 'k', title: 'Test', texts }]);
  return profileOf(idx, 'k').descriptors.map(d => d.id);
};

const confidentIds = (texts) => profileOf(buildFeelIndex([{ key: 'k', title: 'Test', texts }]), 'k').descriptors.filter(d => !d.fragile).map(d => d.id);

const filler = (words) => review(Array.from({ length: words }, (_, i) => 'plain' + (i % 7 ? ' word' : ' text')).join(' ').slice(0, words * 6));
const plenty = filler(1200); // more own text than LIST_SUPPORT.plentyWords, saying nothing about feelings

test('a thin film keeps list-only feelings, lighter than a confirmed one', () => {
  const one = [list('supernatural chilling eerie terrifying dread')];
  assert.ok(chipIds(one).includes('eerie'));
  assert.ok(score(one, 'eerie') < score([review('An eerie watch.'), ...one], 'eerie'));
  assert.ok(score([list('chilling eerie'), list('eerie blood')], 'eerie') > score(one, 'eerie'), 'two lists agreeing weigh more');
});

test('with plenty of own text, a feeling named only by a list falls under the chip floor', () => {
  const texts = [plenty, list('supernatural chilling eerie terrifying dread'), list('chilling eerie terrifying terror')];
  assert.ok(score(texts, 'eerie') > 0, 'still scored for similarity');
  assert.ok(score(texts, 'eerie') < CHIP_FLOOR.min.default);
  assert.ok(!confidentIds(texts).includes('eerie'), 'it can only show as a fragile (dashed) chip');
});

test('the list-only score falls smoothly as own text grows', () => {
  const l = [list('eerie spooky')];
  const at = (n) => score([filler(n), ...l], 'eerie');
  assert.ok(at(100) > at(500) && at(500) > at(1200));
  assert.equal(at(100), at(200), 'flat below the thin line');
});

test('one mention in one review, no list, on a film with plenty of text, stays under the floor; thin films are exempt', () => {
  const cosy = review('Warm and cozy for a few minutes.');
  assert.ok(!confidentIds([plenty, cosy]).includes('cosy'));
  assert.ok(chipIds([cosy]).includes('cosy'));
  assert.ok(confidentIds([plenty, cosy, list('cosy comforting warm')]).includes('cosy'), 'a list that also names it makes it a confident chip');
  assert.ok(confidentIds([plenty, review('Cosy and warm.'), review('So cosy.')]).includes('cosy'), 'two mentions are a pattern');
});

test('own text plus a list survives and scores higher than own text alone', () => {
  const own = [review('An eerie, unsettling watch.')];
  const both = [...own, list('chilling eerie terrifying')];
  assert.ok(score(both, 'eerie') > score(own, 'eerie'));
  assert.ok(chipIds(both).includes('eerie'));
});

test('a list counts once: repeats beyond the cap add nothing', () => {
  const many = Array.from({ length: 12 }, () => list('eerie spooky'));
  const some = Array.from({ length: 3 }, () => list('eerie spooky'));
  assert.equal(score(many, 'eerie'), score(some, 'eerie'));
  const own = [review('Eerie.')];
  assert.equal(score([...own, ...many], 'eerie'), score([...own, ...some], 'eerie'));
  assert.ok(LIST_SUPPORT.cap > 0);
});

test('genre names do not make a film Romantic', () => {
  const found = (t) => [...scanText(prepareText({ text: t, voice: 'editors' }), matcher).keys()];
  assert.ok(!found('is a 2003 romantic comedy drama film').includes('romantic'));
  assert.ok(!found('a romantic comedy-drama').includes('romantic'));
  assert.ok(found('a deeply romantic and tender watch').includes('romantic'));
});
