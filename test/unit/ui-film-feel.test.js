import test from 'node:test';
import assert from 'node:assert/strict';
import { mainVoice, weighted, groupByFacet, voicesUsed, chipTitle, trim, caption, basisText, showTmdbHint, shiftButtons, shiftHeading, isEmptyProfile } from '../../ui/screens/film/feelModel.js';

const d = (id, facet, score, voices, evidence) => ({ id, label: id, facet, score, voices, evidence });

test('mainVoice prefers viewers, then critics, then articles', () => {
  assert.equal(mainVoice(['editors', 'viewers']), 'viewers');
  assert.equal(mainVoice(['editors', 'critics']), 'critics');
  assert.equal(mainVoice([]), 'editors');
  assert.equal(mainVoice(undefined), 'editors');
});

test('weighted sorts strongest first and gives weights 3..1 without exposing scores as text', () => {
  const w = weighted([d('a', 'mood', 0.2, ['critics']), d('b', 'mood', 0.9, ['viewers']), d('c', 'tone', 0.5, ['editors']), d('d', 'tone', 0.1, ['editors'])]);
  assert.deepEqual(w.map(x => x.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(w.map(x => x.weight), [3, 2, 1, 1]);
  assert.equal(w[0].voice, 'viewers');
});

test('groupByFacet orders facets and keeps unknown last', () => {
  const g = groupByFacet([d('x', 'impact', 0.5, []), d('y', 'weird', 0.5, []), d('z', 'mood', 0.4, []), d('w', 'mood', 0.8, [])]);
  assert.deepEqual(g.map(x => x.facet), ['mood', 'impact', 'weird']);
  assert.deepEqual(g[0].items.map(i => i.id), ['w', 'z']);
  assert.equal(g[2].label, 'More');
  assert.deepEqual(groupByFacet(), []);
});

test('voicesUsed lists voices present in order', () => {
  assert.deepEqual(voicesUsed([d('a', 'mood', 1, ['editors'])], [{ voices: ['critics'] }]), ['critics', 'editors']);
});

test('chipTitle names the voice and quotes evidence', () => {
  assert.equal(chipTitle(d('a', 'mood', 1, ['viewers'], 'so wistful')), 'Viewers: “so wistful”');
  assert.equal(chipTitle(d('a', 'mood', 1, ['critics', 'editors'])), 'From critics and articles');
  assert.equal(chipTitle(d('a', 'mood', 1, [])), 'From articles');
});

test('trim shortens on a word boundary', () => {
  assert.equal(trim('  short   text '), 'short text');
  const t = trim('one two three four five six seven eight nine ten', 20);
  assert.ok(t.length <= 20 && t.endsWith('…'), t);
  assert.ok(!/\s…/.test(t));
});

test('caption uses the first reason and ends as a sentence', () => {
  assert.equal(caption({ reasons: [{ facet: 'mood', text: 'Both feel wistful and slow-burn' }, { text: 'second' }] }), 'Both feel wistful and slow-burn.');
  assert.equal(caption({ reasons: [{ text: 'Already ends.' }] }), 'Already ends.');
  assert.equal(caption({ reasons: [] }), '');
  assert.equal(caption(null), '');
  assert.ok(caption({ reasons: [{ text: 'word '.repeat(50) }] }).length <= 81);
});

test('basisText and the TMDB hint are honest about thin signal', () => {
  assert.equal(basisText({ basedOn: ['article tags', 'critic quotes'], thin: true }), 'Based on article tags · critic quotes. No viewer reviews found yet.');
  assert.equal(basisText({ basedOn: ['viewer reviews'], thin: false }), 'Based on viewer reviews');
  assert.equal(basisText({ basedOn: [] }), '');
  assert.equal(showTmdbHint({ thin: true }, false), true);
  assert.equal(showTmdbHint({ thin: true }, true), false);
  assert.equal(showTmdbHint({ thin: false }, false), false);
});

test('shiftButtons expands each axis into two directions', () => {
  const b = shiftButtons([{ id: 'weight', low: 'Lighter', high: 'Heavier' }, { id: 'x', low: 'A' }]);
  assert.deepEqual(b.map(x => [x.axis, x.dir, x.label]), [['weight', -1, 'Lighter'], ['weight', 1, 'Heavier'], ['x', -1, 'A']]);
  assert.equal(shiftHeading(b[0]), 'Like this, but lighter');
  assert.deepEqual(shiftButtons(null), []); // getFeelAxes still loading
  assert.deepEqual(shiftButtons(undefined), []);
});

test('isEmptyProfile', () => {
  assert.equal(isEmptyProfile(null), true);
  assert.equal(isEmptyProfile({ profile: { descriptors: [], themes: [], settings: [] } }), true);
  assert.equal(isEmptyProfile({ profile: { descriptors: [], themes: [{ id: 'a' }] } }), false);
});

test('aboutChips keeps the engine order, maps tier to weight and puts the reasons in the hover', async () => {
  const { aboutChips, ABOUT_LIMIT } = await import('../../ui/screens/film/feelModel.js');
  const out = aboutChips([
    { id: 'a', label: 'A', tier: 2, voices: ['critics'], why: ['Wikidata main subject', 'Discussed by critics'] },
    { id: 'b', label: 'B', tier: 1, voices: [], why: [] },
    { id: 'c', label: 'C', tier: 0 },
  ]);
  assert.deepEqual(out.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(out.map(x => x.weight), [3, 2, 1]);
  assert.equal(out[0].title, 'Wikidata main subject. Discussed by critics. From critics');
  assert.equal(out[2].title, 'From articles');
  assert.equal(ABOUT_LIMIT, 6);
});


test('a chip shade means the same on every film: one very strong theme does not fade the feelings beside it', () => {
  const w = weighted([d('romance', 'theme', 0.94, ['viewers']), d('sad', 'mood', 0.44, ['viewers']), d('slow', 'pace', 0.16, ['viewers'])]);
  assert.deepEqual(w.map(x => [x.id, x.weight, x.tierLabel]), [['romance', 3, 'Strong'], ['sad', 2, 'Clear'], ['slow', 1, 'Light']]);
  assert.match(chipTitle(w[1]), /^Clear for this film\. /);
});
