import test from 'node:test';
import assert from 'node:assert/strict';
import { softLower } from '../../core/analysis/feel/text.js';
import { buildMatcher, prepareText, scoreDescriptors, extractThemes } from '../../core/analysis/feel/extract.js';
import { classifyAll } from '../../core/analysis/feel/categories.js';
import { buildFeelIndex, descriptorIdf, profileOf, similar, describe, LEXICON } from '../../core/analysis/feel/index.js';

// Synthetic fixtures. Not real reviews.
const score = (text, id, voice = 'viewers', source = 'x') => {
  const m = buildMatcher(LEXICON);
  return scoreDescriptors([prepareText({ voice, source, text })], m).find(d => d.id === id);
};

test('ambiguous stems do not match everyday words', () => {
  assert.equal(score('He went mad and ran off', 'madness'), undefined, '"mad" is not madness');
  assert.ok(score('A descent into madness, all madness', 'madness'));
  assert.equal(score('Just a bit of everything, a cut above, a long road, to be inspired by true events', 'biting'), undefined);
  assert.equal(score('A long way home, and he longs for the long road', 'longing'), undefined);
  assert.ok(score('A story of longing and yearning', 'longing'));
  assert.equal(score('The witness saw a touch of colour. He touches the wall.', 'moving'), undefined);
  assert.ok(score('A touching, moving story', 'moving'));
  assert.equal(score('She moved to town', 'moving'), undefined);
});

test('a theme named in one text is weaker than one named twice or tagged', () => {
  const m = buildMatcher(LEXICON);
  const mk = (voice, source, text) => prepareText({ voice, source, text });
  const once = scoreDescriptors([mk('viewers', 'a', 'a story about grief')], m).find(d => d.id === 'grief');
  const twice = scoreDescriptors([mk('viewers', 'a', 'a story about grief'), mk('critics', 'b', 'grief runs through it')], m).find(d => d.id === 'grief');
  const tagged = scoreDescriptors([mk('editors', 'wikicats', 'grief')], m).find(d => d.id === 'grief');
  assert.ok(twice.score > once.score * 1.5);
  assert.ok(tagged.score > once.score * 0.5, 'a tag counts without a second text');
});

test('descriptorIdf damps what is on most films and ignores tiny libraries', () => {
  const rec = (n, ids) => ({ descs: new Map(ids.map(id => [id, { score: 0.5 }])), entries: { themes: [], craft: [] } });
  const small = Array.from({ length: 10 }, () => rec(1, ['common']));
  assert.equal(descriptorIdf(small).size, 0);
  const recs = Array.from({ length: 100 }, (_, i) => rec(1, i < 40 ? ['common'] : i === 99 ? ['common', 'rare'] : []));
  const idf = descriptorIdf(recs);
  assert.equal(idf.get('rare'), 1);
  assert.ok(idf.get('common') < 0.6 && idf.get('common') >= 0.3);
});

test('genre-like keywords become styles, real subjects stay subjects', () => {
  const t = extractThemes({ keywords: ['Black comedy', "Children's", 'Romantic comedy', 'memory erasure'], subjects: [], categories: [], basedOn: [], locations: [] }, classifyAll);
  const ids = t.themes.map(x => `${x.id}:${x.kind}`);
  assert.ok(ids.includes('black-comedy:style'));
  assert.ok(ids.includes('memory-erasure:subject'));
  assert.ok(!ids.some(x => x.startsWith('children') || x.startsWith('romantic')), 'generic genres are dropped');
});

test('softLower keeps proper nouns', () => {
  assert.equal(softLower('Disability in the United States'), 'disability in the United States');
  assert.equal(softLower('Vietnam War'), 'Vietnam War');
  assert.equal(softLower('World war ii'), 'World War II');
  assert.equal(softLower('Coming-of-age'), 'coming-of-age');
});

test('no lexicon label reads badly after "Both feel"', () => {
  const labels = LEXICON.filter(d => ['mood', 'tone', 'pace', 'impact', 'craft'].includes(d.facet)).map(d => d.label);
  for (const bad of ['Wonder', 'Longing', 'Fluid camerawork', 'Standout performances', 'Gut-punch']) assert.ok(!labels.includes(bad), bad);
});

const film = (key, texts, extra = {}) => ({
  key, title: key, year: 2000,
  texts: texts.map(text => ({ voice: 'viewers', source: 'mcreviews.users', text })),
  categories: [], keywords: [], subjects: [], locations: [], basedOn: [], genres: ['Drama'], people: {}, countries: [], languages: [], runtime: null, collection: null,
  ...extra,
});

test('reasons read naturally for one, two and three shared feelings', () => {
  const idx = buildFeelIndex([
    film('a', ['melancholy, bittersweet and lonely, quietly melancholy']),
    film('b', ['melancholy and lonely, bittersweet too']),
    film('c', ['melancholy only']),
    film('d', ['a wondrous, whimsical, heartwarming romp, truly wondrous']),
    film('e', ['wondrous, whimsical and heartwarming, wondrous']),
  ]);
  const text = (k, other) => similar(idx, k).find(r => r.key === other).reasons.map(r => r.text).join(' ');
  assert.match(text('d', 'e'), /Both feel (wondrous|whimsical|heartwarming)(, | and )/);
  assert.match(text('a', 'c'), /^Both feel melancholic\./);
  assert.doesNotMatch(text('d', 'e'), /Both feel wonder[,.]/);
});

test('headline: varied facets, grammatical, specific "about", no repeats', () => {
  const idx = buildFeelIndex([
    film('x', ['moving, sad and devastating, also wistful, with a haunting tenderness; much grief and mourning about grief'],
      { keywords: ['grief and mourning'] }),
  ]);
  const h = describe(profileOf(idx, 'x')).headline;
  assert.match(h, /^[A-Z][a-z-]+(, [a-z-]+)* and [a-z-]+/);
  assert.ok(!/about grief.*about grief/i.test(h), h);
  assert.ok(!/with a sense of/.test(h), h);
  if (/, about /.test(h)) assert.match(h, /, about [a-z]/, h);
  assert.equal(describe(null).headline, 'Not much has been written about this one yet');
});

test('a neighbour we cannot explain is ranked below one we can', () => {
  const idx = buildFeelIndex([
    film('q', ['wistful and lonely'], { genres: ['Drama'] }),
    film('p', ['wistful and lonely'], { genres: ['Drama'] }),
  ]);
  const r = similar(idx, 'q');
  assert.ok(r[0].reasons.length > 0);
});
