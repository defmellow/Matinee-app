// The Map's words and name placement: "Around here", label collisions, and the feeling search. SYNTHETIC films.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeRects, createPlacer, labelSpot, overlaps, aroundHere, lowerLabel, suggest, countIds, whereItLives, livesSentence } from '../../ui/screens/map/layout.js';
import { fold } from '../../ui/screens/map/model.js';

const labels = { sad: ['Sad', 'mood'], tender: ['Tender', 'tone'], devastating: ['Devastating', 'impact'], eerie: ['Eerie', 'mood'], 'coming-of-age': ['Coming of age', 'theme'], family: ['Family', 'theme'], klan: ['Ku Klux Klan', 'theme'], war: ['War', 'theme'] };

test('labels never overlap: the first claim wins, and a must-keep label is never dropped', () => {
  const kept = placeRects([{ id: 'a', x: 0, y: 0, w: 50, h: 14 }, { id: 'b', x: 40, y: 5, w: 50, h: 14 }, { id: 'c', x: 60, y: 0, w: 50, h: 14 }, { id: 'm', x: 45, y: 0, w: 50, h: 14, must: true }]);
  assert.deepEqual(kept.map(k => k.id), ['a', 'c', 'm']);
  assert.equal(kept.some(k => k.id === 'b'), false);
  for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) if (!kept[i].must && !kept[j].must) assert.equal(overlaps(kept[i], kept[j]), false);
  assert.equal(overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false, 'touching is fine');
});

test('Around here: top three feelings and top two themes, in plain words', () => {
  const feel = { a: [['sad', 0.6], ['tender', 0.5], ['coming-of-age', 0.4]], b: [['sad', 0.5], ['devastating', 0.6], ['family', 0.3]], c: [['tender', 0.4], ['eerie', 0.2], ['war', 0.1]], d: [['devastating', 0.5], ['klan', 0.2]] };
  const r = aroundHere(['a', 'b', 'c', 'd'], k => feel[k], labels);
  assert.equal(r.text, 'Devastating, sad and tender films about coming of age and family. 4 films.');
  assert.equal(r.count, 4);
  assert.equal(aroundHere(['a', 'b', 'c'], k => feel[k], labels), null, 'fewer than four films: nothing');
  assert.equal(aroundHere(['x', 'y', 'z', 'w'], () => [], labels), null);
  assert.equal(aroundHere(['a', 'a', 'a', 'a'], () => [['war', 1]], labels).text, 'Films about war. 4 films.');
  assert.equal(lowerLabel('Ku Klux Klan'), 'Ku Klux Klan');
  assert.equal(lowerLabel('Coming of age'), 'coming of age');
});

test('feeling search suggests feelings and themes that match, common ones first', () => {
  const feel = { a: [['sad', 0.6], ['family', 0.4]], b: [['sad', 0.6], ['family', 0.4]], c: [['tender', 0.3]], d: [['tender', 0.3], ['sad', 0.3]] };
  const counts = countIds(feel);
  assert.deepEqual(suggest('s', labels, counts, fold), { feelings: [], themes: [] }, 'one letter is too little');
  const s = suggest('ad', labels, counts, fold);
  assert.deepEqual(s.feelings.map(x => x.label), ['Sad']);
  assert.equal(s.feelings[0].count, 3);
  assert.deepEqual(suggest('fam', labels, counts, fold).themes.map(x => x.label), ['Family']);
});

test('where a feeling lives: lit films by strength, what comes with it, and the sentence', () => {
  const feel = { a: [['eerie', 0.9], ['sad', 0.3]], b: [['eerie', 0.4], ['sad', 0.3]], c: [['sad', 0.5]], d: [['eerie', 0.2], ['tender', 0.2]] };
  const w = whereItLives('eerie', feel, k => k !== 'd', k => k === 'a');
  assert.deepEqual(w.top, [['a', 0.9], ['b', 0.4]]);
  assert.equal(w.watched, 1);
  assert.deepEqual(w.nearby, ['sad']);
  assert.equal(livesSentence('Eerie', 'feeling', 55, 11, true), '55 films feel eerie, 11 of them watched.');
  assert.equal(livesSentence('Eerie', 'feeling', 1, 0, true), '1 film feels eerie, none watched.');
  assert.equal(livesSentence('Race and racism', 'theme', 3, 1, false), '3 films are about race and racism.');
  assert.equal(livesSentence('Eerie', 'feeling', 0, 0, false), 'No films feel eerie here.');
});

test('names stay inside the canvas and out from under the buttons', () => {
  const bounds = { w: 400, h: 300 }, blocked = [{ x: 300, y: 240, w: 100, h: 60 }];
  const placer = createPlacer(2, { bounds, blocked });
  // a dot hard against the right edge: the name flips to its left
  const edge = labelSpot(396, 100, 90, 20, placer);
  assert.ok(edge && placer.inside(edge) && edge.x + edge.w <= 400);
  // a dot in the top-left corner: beside it is fine, never above it (that would be off the canvas)
  const corner = labelSpot(4, 4, 90, 20, placer);
  assert.ok(corner && corner.x >= 0 && corner.y >= 0);
  // a dot just left of the buttons: its name must not land under them
  const near = labelSpot(290, 260, 90, 20, placer);
  assert.ok(!near || !overlaps(near, blocked[0]));
  // no room at all (a canvas the label cannot fit in): dropped once settled
  assert.equal(labelSpot(10, 10, 90, 20, createPlacer(2, { bounds: { w: 50, h: 50 } })), null);
  // mid-flow, a label that only clashes with another is still shown, but never outside the canvas
  const p2 = createPlacer(2, { bounds });
  p2.place({ x: 100, y: 90, w: 300, h: 40 });
  const forced = labelSpot(150, 110, 90, 20, p2, { crowded: true });
  assert.ok(forced && p2.inside(forced));
  const settled = labelSpot(150, 110, 90, 20, p2);
  assert.ok(!settled || p2.fits(settled), 'settled labels only take clear room');
});
