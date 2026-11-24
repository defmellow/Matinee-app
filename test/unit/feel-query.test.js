// P0 feel fixes: query double counting and aliases, shift needs a toward-descriptor, rewatchable, places, year invariance.
// Synthetic fixtures, not real reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeelIndex, queryFeel, shift, similar, facets } from '../../core/analysis/feel/index.js';
import { ALIASES } from '../../core/analysis/feel/query.js';

const LEX = [
  { id: 'hilarious', label: 'Hilarious', facet: 'impact', words: ['hilarious', 'uproarious'] },
  { id: 'heartwarming', label: 'Heartwarming', facet: 'mood', words: ['heartwarming'] },
  { id: 'terrifying', label: 'Terrifying', facet: 'impact', words: ['terrifying'] },
  { id: 'friendship', label: 'Friendship', facet: 'theme', words: ['friendship'] },
  { id: 'playful', label: 'Playful', facet: 'tone', words: ['playful'] },
  { id: 'bleak', label: 'Bleak', facet: 'mood', words: ['bleak'] },
  { id: 'wistful', label: 'Wistful', facet: 'mood', words: ['wistful'] },
  { id: 'rewatchable', label: 'Rewatchable', facet: 'impact', words: ['rewatchable'] },
];
const AX = [{ id: 'weight', low: 'Lighter', high: 'Heavier', lowIds: ['playful'], highIds: ['bleak'] }];
const classify = (labels) => {
  const themes = [], settings = [];
  for (const l of labels) {
    const m = /^Films about (.+)$/.exec(l);
    if (m) themes.push({ id: m[1].replace(/ /g, '-'), label: m[1], kind: 'about' });
    const s = /^Films set in (.+)$/.exec(l);
    if (s) settings.push({ id: s[1].toLowerCase(), label: s[1], kind: 'place' });
  }
  return { themes, settings, noise: 0 };
};
const OPTS = { lexicon: LEX, axes: AX, classify, dims: 8 };
const noPeople = { director: [], writer: [], cinematography: [], composer: [], editor: [], cast: [] };
const film = (key, over = {}) => ({
  key, title: key, year: 2000, texts: [], categories: [], keywords: [], subjects: [], locations: [], basedOn: [], genres: [],
  people: { ...noPeople }, countries: [], languages: [], runtime: null, collection: null, ...over,
});
const v = (text) => ({ voice: 'viewers', source: 'mcreviews.users', text });

test('query: a descriptor and a theme with the same idea count once', () => {
  const films = [
    film('a', { texts: [v('A story of friendship, friendship and more friendship.'), v('Friendship throughout.')], categories: ['Films about friendship'] }),
    film('b', { texts: [v('Something bleak.')] }),
  ];
  const idx = buildFeelIndex(films, OPTS);
  const r = queryFeel(idx, { descriptors: ['friendship'], themes: ['friendship'] });
  assert.equal(r[0].key, 'a');
  assert.equal(new Set(r[0].why).size, r[0].why.length, 'no repeated reasons');
  const text = queryFeel(idx, { text: 'friendship' });
  assert.equal(new Set(text[0].why).size, text[0].why.length);
  const once = queryFeel(idx, { descriptors: ['friendship'] })[0].score;
  assert.equal(r[0].score, once, 'asking for the same idea twice scores the same as once');
});

test('query: everyday words reach their descriptor groups', () => {
  const films = [
    film('comic', { texts: [v('Uproarious and hilarious, a riot.')] }),
    film('cosy', { texts: [v('So heartwarming.')] }),
    film('scare', { texts: [v('Truly terrifying.')] }),
    film('grim', { texts: [v('Utterly bleak.')] }),
  ];
  const idx = buildFeelIndex(films, OPTS);
  assert.equal(queryFeel(idx, { text: 'funny' })[0].key, 'comic');
  assert.equal(queryFeel(idx, { text: 'something warm' })[0].key, 'cosy');
  assert.equal(queryFeel(idx, { text: 'scary' })[0].key, 'scare');
  assert.ok(!queryFeel(idx, { text: 'funny' }).some(x => x.key === 'grim'));
  assert.ok(ALIASES.funny.includes('hilarious') && ALIASES.warm.includes('heartwarming') && ALIASES.scary.includes('terrifying'));
});

test('shift: only films that carry a toward-descriptor are returned', () => {
  const films = [
    film('src', { texts: [v('Bleak and bleak.')] }),
    film('light', { texts: [v('Playful and bleak in places.')] }),
    film('empty', { texts: [v('A film.')] }),
    film('plain', { texts: [v('Wistful.')] }),
  ];
  const idx = buildFeelIndex(films, OPTS);
  const keys = shift(idx, 'src', { axis: 'weight', dir: -1 }).map(x => x.key);
  assert.deepEqual(keys, ['light']);
  const none = shift(buildFeelIndex(films.filter(f => f.key !== 'light'), OPTS), 'src', { axis: 'weight', dir: -1 });
  assert.deepEqual(none, [], 'no film is lighter: no results, not a fallback');
});

test('rewatchable stays a descriptor but is out of the feel vector', () => {
  const films = [film('a', { texts: [v('So rewatchable and rewatchable.')] }), film('b', { texts: [v('Rewatchable, rewatchable.')] })];
  const idx = buildFeelIndex(films, OPTS);
  assert.ok(idx.byKey.get('a').descs.has('rewatchable'), 'still found');
  assert.equal(idx.byKey.get('a').feel.m.has('rewatchable'), false);
  assert.equal(idx.byKey.get('a').feel.n, 0, 'a film that is only rewatchable has no feel vector');
});

test('places: a shared setting alone cannot carry a match, and adds little next to real themes', () => {
  const films = [
    film('a', { categories: ['Films set in Paris'] }),
    film('b', { categories: ['Films set in Paris'] }),
    film('c', { categories: ['Films about friendship', 'Films set in Paris'], texts: [v('Friendship.')] }),
    film('d', { categories: ['Films about friendship', 'Films set in Rome'], texts: [v('Friendship.')] }),
  ];
  const idx = buildFeelIndex(films, OPTS);
  const ab = similar(idx, 'a').find(x => x.key === 'b');
  assert.ok(!ab || ab.parts.themes <= 0.15, `setting-only themes part is capped (got ${ab?.parts.themes})`);
  const cd = similar(idx, 'c').find(x => x.key === 'd');
  assert.ok(cd.parts.themes > 0.5, 'a shared theme still matches across settings');
});

test('year invariance: shuffling years changes no feel result', () => {
  const mk = (years) => [
    film('a', { year: years[0], texts: [v('Playful and hilarious.')], categories: ['Films about friendship'] }),
    film('b', { year: years[1], texts: [v('Hilarious, playful.')], categories: ['Films about friendship'] }),
    film('c', { year: years[2], texts: [v('Bleak and wistful.')] }),
  ];
  const run = (fs) => { const i = buildFeelIndex(fs, OPTS); return [similar(i, 'a'), queryFeel(i, { text: 'funny' }), shift(i, 'c', { axis: 'weight', dir: -1 })]; };
  assert.deepEqual(run(mk([1950, 1990, 2024])), run(mk([2024, 1950, 1990])));
});

// ---- Letterboxd groups and set-in filters (lb: / set: ids)
test('query: lb: and set: filters match what the film lists', () => {
  const films = [
    film('a', { lbThemes: ['Humanity and the world around us'], categories: ['Films set in Paris'], texts: [v('Something bleak.')] }),
    film('b', { categories: ['Films set in Rome'], texts: [v('Something bleak.')] }),
    film('c', { lbThemes: ['Moving relationship stories'], texts: [v('Something bleak.')] }),
  ];
  const idx = buildFeelIndex(films, OPTS);
  const lb = queryFeel(idx, { themes: ['lb:humanity and the world around us'] });
  assert.deepEqual(lb.map(r => r.key), ['a']);
  assert.deepEqual(lb[0].why, ['humanity']); // an old long name reads as its short main idea
  const set = queryFeel(idx, { themes: ['set:paris'] });
  assert.deepEqual(set.map(r => r.key), ['a']);
  assert.deepEqual(set[0].why, ['set in paris']);
  const avoid = queryFeel(idx, { descriptors: ['bleak'], avoid: ['set:paris'] });
  assert.deepEqual(avoid.map(r => r.key).sort(), ['b', 'c']);
  assert.deepEqual(queryFeel(idx, { themes: ['lb:Nothing like this'] }), []);
  // the short tag matches too, and so does the old long name (saved filters)
  assert.deepEqual(queryFeel(idx, { themes: ['lb:Relationships'] }).map(r => r.key), ['c']);
  assert.deepEqual(queryFeel(idx, { themes: ['lb:Moving relationship stories'] }).map(r => r.key), ['c']);
});

test('facets: Letterboxd groups, sections and set: ids', () => {
  const films = [
    film('a', { lbThemes: ['Moving relationship stories'], categories: ['Films set in Paris', 'Films about grief'], texts: [v('Something bleak.')] }),
    film('b', { lbThemes: ['Moving relationship stories'], categories: ['Films set in Paris'], texts: [v('Something bleak.')] }),
  ];
  const f = facets(buildFeelIndex(films, OPTS));
  // Letterboxd's long group names are split into short tags (lbthemes.js); the long name is never a facet.
  const lb = f.themes.find(t => t.id === 'lb:Relationships');
  assert.deepEqual([lb.section, lb.count, lb.label], ['lb', 2, 'Relationships']);
  assert.equal(f.themes.find(t => t.id === 'lb:Moving relationship stories'), undefined);
  assert.equal(f.themes.find(t => t.id === 'grief').section, 'subject');
  assert.deepEqual(f.settings.map(s => [s.id, s.count]), [['set:paris', 2]]);
});
