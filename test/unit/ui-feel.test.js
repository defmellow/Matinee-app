import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../../ui/screens/feel/model.js';

test('parseParam reads film, descriptor and theme links', () => {
  assert.deepEqual(m.parseParam('film:lid:ImWe'), { mode: 'film', key: 'lid:ImWe', filters: m.emptyFilters() });
  assert.equal(m.parseParam('film:').key, null);
  assert.deepEqual(m.parseParam('d:tense').filters.descriptors, ['tense']);
  assert.deepEqual(m.parseParam('t:grief').filters.themes, ['grief']);
  assert.equal(m.parseParam('q:Moving relationship stories').filters.text, 'Moving relationship stories');
  assert.equal(m.parseParam(null).mode, 'describe');
  assert.equal(m.parseParam('nonsense').filters.text, '');
});

test('cycleChip goes include, leave out, off', () => {
  let f = m.emptyFilters();
  f = m.cycleChip(f, 'descriptors', 'wistful');
  assert.deepEqual(f.descriptors, ['wistful']);
  assert.equal(m.chipState(f, 'descriptors', 'wistful'), 'in');
  f = m.cycleChip(f, 'descriptors', 'wistful');
  assert.deepEqual([f.descriptors, f.avoid], [[], ['wistful']]);
  assert.equal(m.chipState(f, 'descriptors', 'wistful'), 'out');
  f = m.cycleChip(f, 'descriptors', 'wistful');
  assert.deepEqual([f.descriptors, f.avoid], [[], []]);
});

test('removeFilter clears an id wherever it is', () => {
  const f = { text: '', descriptors: ['a'], themes: ['b'], avoid: ['c'] };
  assert.deepEqual(m.removeFilter(m.removeFilter(m.removeFilter(f, 'a'), 'b'), 'c'), m.emptyFilters());
});

test('searchArgs and scope', () => {
  const f = { text: ' lonely ', descriptors: ['a'], themes: [], avoid: ['z'] };
  assert.deepEqual(m.searchArgs(f, 'unwatched'), { descriptors: ['a'], themes: [], avoid: ['z'], text: 'lonely', limit: 60, scope: 'watchlist' });
  assert.equal(m.apiScope('watchlist'), 'watchlist');
  assert.equal(m.applyScope([{}, {}, {}]).length, 3);
});

test('hasFilters', () => {
  assert.equal(m.hasFilters(m.emptyFilters()), false);
  assert.equal(m.hasFilters({ ...m.emptyFilters(), text: ' x' }), true);
  assert.equal(m.hasFilters({ ...m.emptyFilters(), text: '  ' }), false);
});

test('capFacets caps by count and keeps chosen chips', () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, label: 'L' + i, count: 20 - i }));
  let r = m.capFacets(list, { cap: 12 });
  assert.equal(r.shown.length, 12); assert.equal(r.hidden, 8); assert.equal(r.shown[0].id, 'i0');
  r = m.capFacets(list, { cap: 12, chosen: ['i19'] });
  assert.equal(r.shown.length, 13); assert.equal(r.hidden, 7);
  assert.equal(m.capFacets(list, { expanded: true }).shown.length, 20);
  assert.deepEqual(m.capFacets(null).shown, []);
});

test('groupByFacet and labelIndex', () => {
  const g = m.groupByFacet([{ id: 'a', facet: 'mood' }, { id: 'b', facet: 'tone' }, { id: 'c', facet: 'mood' }]);
  assert.equal(g.mood.length, 2);
  const l = m.labelIndex({ descriptors: [{ id: 'a', label: 'A' }], themes: [{ id: 't', label: 'T' }], settings: [{ id: 's', label: 'S' }] });
  assert.equal(l.get('t'), 'T'); assert.equal(l.get('s'), 'S');
});

test('trimReason and reasonLines', () => {
  assert.equal(m.trimReason('  short   text '), 'short text');
  const long = 'both wistful and slow-burning, both about atonement and the long quiet shadow of a family secret nobody names';
  const t = m.trimReason(long, 60);
  assert.ok(t.length <= 60 && t.endsWith('…'));
  assert.deepEqual(m.reasonLines({ why: ['a', 'b', 'c'] }), ['a', 'b']);
  assert.deepEqual(m.reasonLines({ reasons: [{ facet: 'feel', text: 'x' }, { text: '' }, { text: 'y' }] }), ['x', 'y']);
  assert.deepEqual(m.reasonLines({}), []);
});

test('barWidths are relative to the best result', () => {
  assert.deepEqual(m.barWidths([{ score: 0.5 }, { score: 0.25 }, { score: 0 }]), [100, 50, 8]);
  assert.deepEqual(m.barWidths([]), []);
});

test('mostlyThin and voiceLabel', () => {
  assert.equal(m.mostlyThin([{ thin: true }, { thin: false }]), true);
  assert.equal(m.mostlyThin([{ thin: false }, { thin: false }, { thin: true }]), false);
  assert.equal(m.mostlyThin([]), false);
  assert.equal(m.voiceLabel('editors'), 'article tags');
  assert.equal(m.voiceLabel('viewers'), 'viewers');
});

test('pickFilms matches titles, accents folded', () => {
  const films = [{ key: 'a', title: 'Amélie' }, { key: 'b', title: 'The Amelie Trap' }, { key: 'c', title: 'Heat' }];
  assert.deepEqual(m.pickFilms(films, 'amelie').map(f => f.key), ['a', 'b']);
  assert.deepEqual(m.pickFilms(films, ''), []);
});

test('emphasisFor and filmHeading', () => {
  assert.equal(m.emphasisFor('people').people, 1.6);
  assert.equal(m.emphasisFor('bogus').feel, 1);
  const axes = [{ id: 'weight', low: 'Lighter', high: 'Heavier' }];
  assert.equal(m.filmHeading('Heat', { axis: 'weight', dir: -1 }, axes), 'Like Heat, but lighter');
  assert.equal(m.filmHeading('Heat', null, axes), 'Films that feel like Heat');
});

test('parseParam: lb: and set: links become pills in the themes list', () => {
  assert.deepEqual(m.parseParam('lb:Humanity and the world around us').filters.themes, ['lb:Humanity and the world around us']);
  assert.deepEqual(m.parseParam('set:chicago').filters.themes, ['set:chicago']);
  assert.deepEqual(m.parseParam('set:1970s').filters.themes, ['set:1970s']);
  assert.equal(m.parseParam('lb:Humanity').filters.text, '');
  assert.equal(m.parseParam('q:old link').filters.text, 'old link'); // old links still type the text
});

const SECTIONS = [
  { id: 'mood', label: 'Mood', items: [{ id: 'tense', label: 'Tense', kind: 'descriptors', count: 9 }, { id: 'intense', label: 'Intense', kind: 'descriptors', count: 30 }] },
  { id: 'themes', label: 'Themes', items: [{ id: 'lb:Ten things', label: 'Ten things', kind: 'themes', count: 2 }, { id: 'war', label: 'War', kind: 'descriptors', count: 50 }, { id: 'lb:War and peace', label: 'War and peace', kind: 'themes', count: 5 }] },
  { id: 'settings', label: 'Set in', items: [{ id: 'set:tennessee', label: 'Tennessee', kind: 'themes', count: 4 }, { id: 'set:wartime', label: 'Wartime', kind: 'themes', count: 1 }] },
];

test('matchingTags: word starts first, then contains, biggest first, section named', () => {
  const r = m.matchingTags(SECTIONS, 'TEN');
  assert.equal(r.term, 'ten');
  assert.deepEqual(r.tags.map(t => t.label), ['Tense', 'Tennessee', 'Ten things', 'Intense']);
  assert.deepEqual(r.tags.map(t => t.section), ['Mood', 'Set in', 'Themes', 'Mood']);
  const w = m.matchingTags(SECTIONS, 'war').tags.map(t => t.label);
  assert.deepEqual(w, ['War', 'War and peace', 'Wartime']);
});

test('matchingTags: empty box, one letter, no match, limit, excluded ids, last-word fallback', () => {
  assert.deepEqual(m.matchingTags(SECTIONS, '').tags, []);
  assert.deepEqual(m.matchingTags(SECTIONS, 't').tags, []);
  assert.deepEqual(m.matchingTags(SECTIONS, 'zzz').tags, []);
  assert.equal(m.matchingTags(SECTIONS, 'ten', { limit: 2 }).tags.length, 2);
  assert.ok(!m.matchingTags(SECTIONS, 'ten', { exclude: ['tense'] }).tags.some(t => t.id === 'tense'));
  const r = m.matchingTags(SECTIONS, 'quietly war');
  assert.equal(r.term, 'war');
  assert.equal(r.tags[0].label, 'War');
});

test('pickTag adds the pill in the right list and clears the typed text', () => {
  const f = { ...m.emptyFilters(), text: 'quietly war' };
  const a = m.pickTag(f, { id: 'war', kind: 'descriptors' }, 'war');
  assert.deepEqual([a.descriptors, a.text], [['war'], '']);
  const b = m.pickTag({ ...m.emptyFilters(), text: 'robot takeover' }, { id: 'set:tennessee', kind: 'themes' }, 'takeover');
  assert.deepEqual([b.themes, b.text], [['set:tennessee'], '']);
});

test('facetSections uses the film page names and puts Letterboxd groups under Themes', () => {
  const facets = {
    descriptors: [{ id: 'tense', label: 'Tense', facet: 'mood', count: 3 }, { id: 'war', label: 'War', facet: 'theme', count: 2 }, { id: 'epic', label: 'Epic', facet: 'craft', count: 1 }, { id: 'terrifying', label: 'Terrifying', facet: 'impact', count: 1 }],
    themes: [{ id: 'lb:Group', label: 'Group', section: 'lb', count: 1 }, { id: 'grief', label: 'Grief', section: 'subject', count: 1 }, { id: 'noir', label: 'Noir', section: 'kind', count: 1 }, { id: 'x', label: 'X', section: 'other', count: 1 }],
    settings: [{ id: 'set:paris', label: 'Paris', count: 1 }],
  };
  const s = m.facetSections(facets);
  assert.deepEqual(s.map(x => x.label), ['Mood', 'Tone', 'Pace', 'Craft', 'Emotional impact', 'Themes', 'Subjects', 'Kind of film', 'Set in']);
  const by = Object.fromEntries(s.map(x => [x.label, x.items.map(i => i.id)]));
  assert.deepEqual(by.Themes, ['war', 'lb:Group']);
  assert.deepEqual([by.Subjects, by['Kind of film'], by['Set in']], [['grief'], ['noir'], ['set:paris']]);
  assert.equal(s.find(x => x.label === 'Set in').items[0].kind, 'themes');
  assert.deepEqual(m.facetSections(null), []);
});

test('matchingTags shows one pill per label, the earlier section winning', async () => {
  const { matchingTags } = await import('../../ui/screens/feel/model.js');
  const sections = [
    { id: 'theme', label: 'Themes', items: [{ id: 'war', label: 'War', kind: 'descriptors', count: 5 }] },
    { id: 'subject', label: 'Subjects', items: [{ id: 't:war', label: 'War', kind: 'themes', count: 9 }, { id: 't:ww2', label: 'World War II', kind: 'themes', count: 3 }] },
  ];
  const { tags } = matchingTags(sections, 'war');
  assert.deepEqual(tags.map(t => t.id), ['war', 't:ww2']);
});
