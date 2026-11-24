// Synthetic inputs only (invented films); no real-film words are built into the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreThemes, rankThemes, CENTRALITY, labelStems } from '../../core/analysis/feel/centrality.js';
import { buildFeelIndex, profileOf } from '../../core/analysis/feel/index.js';

const th = (id, label, sources, kind = 'subject') => ({ id, label, kind, voices: ['editors'], sources });
const run = (themes, texts, title = 'Untitled') => rankThemes(scoreThemes(themes, { texts, titleStems: labelStems(title, []) }));
const by = (list, id) => list.find(t => t.id === id);

test('constants live in one exported object', () => {
  assert.ok(CENTRALITY.prior.p921 > CENTRALITY.prior['about-category']);
  assert.ok(CENTRALITY.prior['about-category'] >= CENTRALITY.prior.keyword);
  assert.ok(CENTRALITY.prior.keyword > CENTRALITY.prior.style && CENTRALITY.prior.style > CENTRALITY.prior.adaptation);
});

test('main subject with critic and viewer hits outranks a category-only theme with no hits', () => {
  const themes = [
    th('chinese-military-personnel', 'Chinese military personnel', ['about-category'], 'about'),
    th('linguistics', 'Linguistics', ['p921']),
    th('alien-language', 'Alien language', ['keyword']),
  ];
  const texts = [
    { voice: 'critics', text: 'A quiet study of linguistics and how people learn.' },
    { voice: 'viewers', text: 'I loved the alien language and the way it shaped the story.' },
    { voice: 'viewers', text: 'The linguistics angle was great.' },
  ];
  const r = run(themes, texts);
  assert.deepEqual(r.map(t => t.id), ['linguistics', 'alien-language', 'chinese-military-personnel']);
  assert.equal(by(r, 'linguistics').tier, 2);
  assert.equal(by(r, 'chinese-military-personnel').tier, 0);
  assert.ok(by(r, 'linguistics').why.includes('Wikidata main subject'));
  assert.ok(by(r, 'linguistics').why.some(w => /critics and viewers/.test(w)));
});

test('no text hits: category-only themes are tier 0, a lone main subject is tier 1', () => {
  const r = run([th('a', 'Ghost towns', ['about-category'], 'about'), th('b', 'Growing up', ['keyword']), th('c', 'Magic', ['p921'])], []);
  assert.equal(by(r, 'a').tier, 0);
  assert.equal(by(r, 'b').tier, 0);
  assert.equal(by(r, 'c').tier, 1);
  assert.equal(r[0].id, 'c');
});

test('thin film: only plot text, so nothing is above tier 1', () => {
  const themes = [th('a', 'Revenge', ['p921']), th('b', 'Revenge plot', ['about-category'], 'about'), th('c', 'Prison', ['keyword'])];
  const r = run(themes, [{ voice: 'editors', text: 'A man seeks revenge. He escapes prison and plots revenge.' }]);
  assert.ok(r.every(t => t.tier <= 1));
});

test('a text must contain every content word of the label, minus the title words', () => {
  const themes = [th('x', 'Space exploration', ['keyword'])];
  const half = run(themes, [{ voice: 'critics', text: 'A film about space and loneliness.' }]);
  assert.equal(half[0].hits.interpretive, 0);
  const all = run(themes, [{ voice: 'critics', text: 'Space exploration done well.' }]);
  assert.equal(all[0].hits.interpretive, 1);
  // a title word does not count as evidence: "Orbit" in the label is dropped when the film is called Orbit
  const t2 = [th('y', 'Orbit mechanics', ['keyword'])];
  const withTitle = rankThemes(scoreThemes(t2, { texts: [{ voice: 'critics', text: 'Orbit orbit orbit.' }, { voice: 'critics', text: 'The mechanics are rich.' }], titleStems: labelStems('Orbit', []) }));
  assert.equal(withTitle[0].hits.interpretive, 1);
  const noTitle = run(t2, [{ voice: 'critics', text: 'Orbit orbit orbit.' }]);
  assert.equal(noTitle[0].hits.interpretive, 0);
  // a label made only of title words has nothing left to look for
  const only = rankThemes(scoreThemes([th('z', 'Orbit', ['keyword'])], { texts: [{ voice: 'critics', text: 'Orbit' }], titleStems: labelStems('Orbit', []) }));
  assert.equal(only[0].hits.interpretive, 0);
});

test('deterministic and order independent; C in 0..1', () => {
  const themes = [th('b', 'Beta thing', ['keyword']), th('a', 'Alpha thing', ['keyword']), th('c', 'Gamma', ['style'], 'style')];
  const a = run(themes, []);
  const b = run([...themes].reverse(), []);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map(t => t.id), ['a', 'b', 'c']);
  for (const t of a) assert.ok(t.centrality >= 0 && t.centrality <= 1);
});

test('the index keeps every theme, ranked by centrality, with tier and why', () => {
  const themes = Array.from({ length: 16 }, (_, i) => `Films about topic number${String.fromCharCode(97 + i)}`);
  const input = { key: 'k', title: 'Sample', texts: [{ voice: 'critics', text: 'Rich in topic numberp ideas.' }], categories: themes, subjects: ['Deep subject'], keywords: [] };
  const idx = buildFeelIndex([input], { classify: (labels) => ({ themes: labels.map(l => ({ id: l.toLowerCase().replace(/ /g, '-'), label: l.replace('Films about ', ''), kind: 'about' })), settings: [], noise: 0 }) });
  const p = profileOf(idx, 'k');
  assert.equal(p.themes.length, 17);
  // Changed with the agreement term (feel-engine/prior): a category that a critic also names (two independent sources) now
  // edges out a lone Wikidata subject (0.62 vs 0.55), so the top is no longer fixed; the order must still follow C.
  assert.deepEqual(p.themes.slice(0, 2).map(t => t.id).sort(), ['deep-subject', 'films-about-topic-numberp']);
  assert.equal(p.themes[0].id, 'films-about-topic-numberp');
  for (let i = 1; i < p.themes.length; i++) assert.ok(p.themes[i - 1].centrality >= p.themes[i].centrality);
  for (const t of p.themes) assert.ok(Array.isArray(t.why) && t.tier >= 0 && t.centrality >= 0);
});
