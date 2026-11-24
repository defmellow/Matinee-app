import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, stem, STOPWORDS, ngrams, stemPhrase } from '../../core/analysis/feel/text.js';
import { buildMatcher, prepareText, scoreDescriptors, excerpt } from '../../core/analysis/feel/extract.js';
import {
  buildFeelIndex, profileOf, similar, queryFeel, shift, describe, facets, LEXICON, AXES,
} from '../../core/analysis/feel/index.js';

// Synthetic fixtures. Not real reviews.
const LEX = [
  { id: 'lonely', label: 'Lonely', facet: 'mood', words: ['lonely', 'solitary'] },
  { id: 'slowburn', label: 'Slow-burn', facet: 'pace', words: ['languid'], phrases: ['slow burn'] },
  { id: 'wistful', label: 'Wistful', facet: 'mood', words: ['wistful', 'elegiac'] },
  { id: 'frenetic', label: 'Frenetic', facet: 'pace', words: ['frenetic', 'breakneck'] },
  { id: 'loud', label: 'Loud', facet: 'tone', words: ['loud', 'explosive'] },
  { id: 'playful', label: 'Playful', facet: 'tone', words: ['playful', 'silly'] },
  { id: 'bleak', label: 'Bleak', facet: 'mood', words: ['bleak', 'grim'] },
  { id: 'grief', label: 'Grief', facet: 'theme', words: ['grief', 'mourning'] },
];
const AX = [
  { id: 'weight', low: 'Lighter', high: 'Heavier', lowIds: ['playful'], highIds: ['bleak'] },
  { id: 'pace', low: 'Slower', high: 'Faster', lowIds: ['slowburn', 'lonely'], highIds: ['frenetic', 'loud'] },
];
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
const OPTS = { lexicon: LEX, axes: AX, classify, dims: 16 };
const noPeople = { director: [], writer: [], cinematography: [], composer: [], editor: [], cast: [] };
const film = (key, over = {}) => ({
  key, title: key, year: 2000, texts: [], categories: [], keywords: [], subjects: [], locations: [], basedOn: [], genres: [],
  people: { ...noPeople }, countries: [], languages: [], runtime: null, collection: null, ...over,
});
const viewers = (text) => ({ voice: 'viewers', source: 'mcreviews.users', text });

const quiet = (k, extra = {}) => film(k, {
  texts: [viewers('A lonely, wistful slow burn about a solitary man. Languid and elegiac, quiet landscapes and silence.'),
    viewers('So lonely and wistful, a slow burn that lingers with quiet desert silence.')],
  categories: ['Films about atonement', 'Films set in Texas'], ...extra,
});
const loud = (k, extra = {}) => film(k, {
  texts: [viewers('Loud, frenetic and explosive. A breakneck chase with car crashes and gunfire everywhere.'),
    viewers('Frenetic, loud, breakneck action with explosions and stunts.')],
  categories: ['Films about revenge'], ...extra,
});
const library = () => [quiet('q1'), quiet('q2'), quiet('q3'), loud('l1'), loud('l2'), loud('l3'), film('thin')];
const finite = (o) => {
  const s = JSON.stringify(o);
  const walk = (v) => { if (typeof v === 'number') assert.ok(Number.isFinite(v), 'non-finite number'); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(JSON.parse(s)); walk(o);
};

test('tokenize', () => {
  assert.deepEqual(tokenize("It's a Slow-burn, 1984 — Father's day!"), ["it's", 'a', 'slow', 'burn', 'father\'s', 'day']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize('Müller'), ['müller']);
});

test('stem is consistent and conservative', () => {
  assert.equal(stem('haunting'), stem('haunted'));
  assert.equal(stem('stories'), stem('story'));
  assert.equal(stem('quietly'), stem('quiet'));
  assert.equal(stem('fathers'), stem('father'));
  assert.equal(stem('loving'), stem('love'));
  assert.equal(stem('is'), 'is');
  assert.equal(stem('glass'), 'glass');
  assert.notEqual(stem('mournful'), stem('mourn'));
  assert.ok(STOPWORDS.has('the'));
  assert.deepEqual(ngrams(['a', 'b', 'c'], 2), ['a b', 'b c']);
});

test('no two real lexicon descriptors collapse to the same stem', () => {
  const seen = new Map();
  const clashes = [];
  for (const d of LEXICON) {
    for (const w of [...d.words, ...(d.phrases || [])]) {
      const k = stemPhrase(w).join(' ');
      const prev = seen.get(k);
      if (prev && prev !== d.id) clashes.push(`${k}: ${prev} vs ${d.id}`);
      seen.set(k, d.id);
    }
  }
  assert.deepEqual(clashes, []);
});

test('extraction: descriptors, voices, editors damping, saturation', () => {
  const m = buildMatcher(LEX);
  const mk = (voice, text, source = 'x') => prepareText({ voice, source, text });
  const v = scoreDescriptors([mk('viewers', 'such a lonely film, truly lonely')], m);
  const e = scoreDescriptors([mk('editors', 'such a lonely film, truly lonely')], m);
  assert.equal(v[0].id, 'lonely');
  assert.deepEqual(v[0].voices, ['viewers']);
  assert.ok(v[0].evidence.length <= 100);
  assert.ok(e[0].score < v[0].score / 2, 'editors damped for mood');
  const g = scoreDescriptors([mk('editors', 'grief and mourning')], m);
  const gv = scoreDescriptors([mk('viewers', 'grief and mourning')], m);
  assert.ok(g[0].score > gv[0].score * 0.3, 'editors count for theme facet');
  const many = scoreDescriptors(Array.from({ length: 50 }, () => mk('viewers', 'lonely lonely lonely')), m);
  assert.ok(many[0].score < 1 && many[0].score > 0.9);
  const mixed = scoreDescriptors([mk('viewers', 'a slow burn'), mk('critics', 'a languid slow burn')], m);
  assert.equal(mixed[0].id, 'slowburn');
  assert.deepEqual(mixed[0].voices, ['viewers', 'critics']);
  assert.ok(excerpt('x'.repeat(500), 250).length <= 100);
});

test('long text does not drown a short review', () => {
  const m = buildMatcher(LEX);
  const long = prepareText({ voice: 'viewers', source: 'a', text: 'lonely ' + 'word '.repeat(600) });
  const short = prepareText({ voice: 'viewers', source: 'b', text: 'So lonely.' });
  assert.ok(scoreDescriptors([short], m)[0].score > scoreDescriptors([long], m)[0].score * 2);
});

test('similar ranks the cluster, excludes self, honours among/limit/emphasis', () => {
  const idx = buildFeelIndex(library(), OPTS);
  const r = similar(idx, 'q1');
  assert.ok(!r.some(x => x.key === 'q1'));
  assert.deepEqual(r.slice(0, 2).map(x => x.key).sort(), ['q2', 'q3']);
  assert.ok(r[0].score > 0 && r[0].score <= 1);
  assert.ok(r[0].reasons.length >= 1 && r[0].reasons.length <= 3);
  assert.ok(r[0].reasons.some(x => /lonely|wistful/.test(x.text)));
  assert.ok(r[0].reasons.some(x => /atonement/.test(x.text)));
  assert.equal(similar(idx, 'q1', { limit: 1 }).length, 1);
  assert.ok(similar(idx, 'q1', { among: ['l1', 'q2'] }).every(x => ['l1', 'q2'].includes(x.key)));
  assert.ok(similar(idx, 'q1', { among: new Set(['q3']) }).every(x => x.key === 'q3'));
  assert.deepEqual(similar(idx, 'nope'), []);
  finite(r);
});

test('emphasis changes order', () => {
  const inputs = [
    film('a', { texts: [viewers('lonely wistful slow burn quiet')], people: { ...noPeople, director: [{ id: 'd1', name: 'Dee' }] } }),
    film('b', { texts: [viewers('lonely wistful slow burn quiet')], people: { ...noPeople, director: [{ id: 'd9', name: 'Zed' }] } }),
    film('c', { texts: [viewers('frenetic loud breakneck')], people: { ...noPeople, director: [{ id: 'd1', name: 'Dee' }] } }),
    quiet('f1'), loud('f2'), quiet('f3'), loud('f4'),
  ];
  const idx = buildFeelIndex(inputs, OPTS);
  const feelOnly = similar(idx, 'a', { emphasis: { feel: 1, themes: 0, craft: 0, people: 0 } }).map(x => x.key);
  assert.ok(feelOnly.includes('b') && !feelOnly.includes('c'));
  assert.equal(similar(idx, 'a', { emphasis: { feel: 0, themes: 0, craft: 0, people: 1 } })[0].key, 'c');
  const r = similar(idx, 'a', { emphasis: { feel: 0, themes: 0, craft: 0, people: 1 } })[0];
  assert.ok(r.reasons.some(x => x.text === 'Same director: Dee.'));
});

test('thin films do not crash and stay finite', () => {
  const idx = buildFeelIndex(library(), OPTS);
  const r = similar(idx, 'thin');
  finite(r);
  finite(similar(idx, 'q1'));
  assert.equal(profileOf(idx, 'thin').confidence, 0);
  assert.equal(describe(profileOf(idx, 'thin')).thin, true);
  assert.deepEqual(buildFeelIndex([], OPTS).recs, []);
  assert.deepEqual(similar(buildFeelIndex([], OPTS), 'x'), []);
});

test('reasons stay honest about editors-only feel', () => {
  const mk = (k) => film(k, { keywords: ['lonely wistful'], categories: ['Films about exile'] });
  const idx = buildFeelIndex([mk('e1'), mk('e2'), loud('x1'), quiet('x2')], OPTS);
  const r = similar(idx, 'e1').find(x => x.key === 'e2');
  const feel = r.reasons.find(x => x.facet === 'feel');
  assert.ok(feel);
  assert.ok(/articles/.test(feel.text) && !/^Both feel/.test(feel.text));
});

test('queryFeel: descriptors, text, avoid', () => {
  const idx = buildFeelIndex(library(), OPTS);
  const a = queryFeel(idx, { descriptors: ['frenetic'] });
  assert.deepEqual(a.map(x => x.key).sort(), ['l1', 'l2', 'l3']);
  assert.ok(a[0].why.includes('frenetic'));
  const t = queryFeel(idx, { text: 'a lonely, wistful film about atonement' });
  assert.ok(t.slice(0, 3).every(x => x.key.startsWith('q')));
  assert.ok(t[0].why.some(w => /lonely|wistful|atonement/.test(w)));
  const av = queryFeel(idx, { descriptors: ['lonely', 'frenetic'], avoid: ['frenetic'] });
  assert.ok(av.every(x => x.key.startsWith('q')));
  assert.deepEqual(queryFeel(idx, {}), []);
  // only an exclusion: every film that doesn't carry it, not an empty list
  const only = queryFeel(idx, { avoid: ['frenetic'] });
  assert.ok(only.length > 0 && only.every(x => !['l1', 'l2', 'l3'].includes(x.key)));
  assert.ok(queryFeel(idx, { text: 'lonely', }, { limit: 2 }).length <= 2);
  assert.ok(queryFeel(idx, { descriptors: ['lonely'] }, { among: ['q1'] }).every(x => x.key === 'q1'));
  finite(t);
});

test('shift moves toward the requested side', () => {
  const lib = [
    film('src', { texts: [viewers('lonely wistful slow burn bleak')], categories: ['Films about exile'] }),
    film('brighter', { texts: [viewers('lonely wistful playful silly')], categories: ['Films about exile'] }),
    film('darker', { texts: [viewers('lonely wistful bleak grim')], categories: ['Films about exile'] }),
    loud('l1'), quiet('q1'), loud('l2'), quiet('q2'),
  ];
  const idx = buildFeelIndex(lib, OPTS);
  const light = shift(idx, 'src', { axis: 'weight', dir: -1 });
  assert.ok(light.length && light[0].key === 'brighter');
  assert.ok(!light.some(x => x.key === 'src'));
  assert.ok(/^Similar feel, but lighter: playful/.test(light[0].reasons[0].text));
  const heavy = shift(idx, 'src', { axis: 'weight', dir: 1 });
  assert.ok(!heavy.some(x => x.key === 'brighter'));
  assert.throws(() => shift(idx, 'src', { axis: 'nonsense', dir: 1 }), /Unknown axis/);
  finite(light);
});

test('describe: headline, chips, honest basedOn, thin', () => {
  const idx = buildFeelIndex(library(), OPTS);
  const d = describe(profileOf(idx, 'q1'));
  assert.match(d.headline, /^[A-Z]/);
  assert.ok(!/— about/.test(d.headline), 'the headline no longer ends with an about line');
  assert.equal(d.thin, false);
  assert.ok(d.basedOn.includes('viewer reviews') && d.basedOn.includes('article categories'));
  assert.ok(!d.basedOn.includes('critic quotes'));
  assert.ok(d.chips.every(c => c.label && c.facet && c.voice));
  const kw = buildFeelIndex([film('k', { keywords: ['grim'] }), quiet('a'), quiet('b')], OPTS);
  const dk = describe(profileOf(kw, 'k'));
  assert.equal(dk.thin, true);
  assert.deepEqual(dk.basedOn, ['keywords']);
  assert.equal(dk.chips[0].voice, 'editors');
});

test('facets counts', () => {
  const f = facets(buildFeelIndex(library(), OPTS));
  const lonely = f.descriptors.find(x => x.id === 'lonely');
  assert.equal(lonely.count, 3);
  assert.equal(f.themes.find(x => x.id === 'atonement').count, 3);
  assert.equal(f.settings.find(x => x.id === 'set:texas').count, 3);
  for (let i = 1; i < f.descriptors.length; i++) assert.ok(f.descriptors[i - 1].count >= f.descriptors[i].count);
});

test('deterministic', () => {
  const a = buildFeelIndex(library(), OPTS), b = buildFeelIndex(library(), OPTS);
  assert.deepEqual(a.recs.map(r => r.profile), b.recs.map(r => r.profile));
  assert.deepEqual(similar(a, 'q1'), similar(b, 'q1'));
  assert.deepEqual(queryFeel(a, { text: 'lonely road' }), queryFeel(b, { text: 'lonely road' }));
});

test('works with the real lexicon and axes', () => {
  assert.ok(LEXICON.length > 100 && AXES.length >= 6);
  const lib = [
    film('r1', { texts: [viewers('A wistful, melancholy and quietly devastating slow burn about grief. Haunting and lyrical.')] }),
    film('r2', { texts: [viewers('Wistful, elegiac, slow burn and haunting, a meditation on grief and loss.')] }),
    film('r3', { texts: [viewers('Hilarious, silly and playful. A fast, frantic comedy full of energy.')] }),
    film('r4', { texts: [viewers('Frantic, funny, playful and fast-paced, a joyous romp.')] }),
    film('bare'),
  ];
  const idx = buildFeelIndex(lib);
  assert.ok(profileOf(idx, 'r1').descriptors.length >= 3);
  assert.equal(similar(idx, 'r1')[0].key, 'r2');
  assert.equal(similar(idx, 'r3')[0].key, 'r4');
  for (const a of AXES) for (const dir of [-1, 1]) finite(shift(idx, 'r1', { axis: a.id, dir }));
  finite(describe(profileOf(idx, 'r1')));
});

test('performance: 1,500 synthetic films build in under 3 seconds', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const vocab = Array.from({ length: 1500 }, (_, i) => 'word' + i.toString(36).replace(/\d/g, c => 'qwertyuiop'[c]));
  const sample = ['lonely', 'wistful', 'bleak', 'playful', 'frenetic', 'grief', 'slow burn'];
  const inputs = Array.from({ length: 1500 }, (_, i) => {
    const words = [];
    for (let k = 0; k < 400; k++) words.push(rnd() < 0.02 ? sample[(rnd() * sample.length) | 0] : vocab[(rnd() * vocab.length) | 0]);
    return film('f' + i, { texts: [viewers(words.slice(0, 200).join(' ')), { voice: 'editors', source: 'wikipedia.plot', text: words.slice(200).join(' ') }], genres: ['Drama'] });
  });
  const t0 = performance.now();
  const idx = buildFeelIndex(inputs, { lexicon: LEX, axes: AX, classify, dims: 48 });
  const ms = performance.now() - t0;
  console.log(`# build 1500 films: ${Math.round(ms)} ms`);
  assert.ok(ms < 3000, `took ${ms} ms`);
  const t1 = performance.now();
  similar(idx, 'f0');
  assert.ok(performance.now() - t1 < 500);
});

test('"set in" eras and release year never connect films or appear in reasons', async () => {
  const { classifyAll } = await import('../../core/analysis/feel/categories.js');
  const real = { lexicon: LEX, axes: AX, classify: classifyAll, dims: 16 };
  const mk = (k, year, cats) => film(k, { year, categories: cats, genres: ['Drama'] });
  // Only an era setting in common (and a different release year): not connected.
  const a = buildFeelIndex([mk('e1', 1950, ['Films set in the 1940s']), mk('e2', 2020, ['Films set in the 1940s']), mk('e3', 1950, ['Films set in the future'])], real);
  assert.deepEqual(similar(a, 'e1').filter(x => x.parts.themes > 0), []);
  // The era is still recorded on the profile for display.
  assert.ok(profileOf(a, 'e1').settings.some(s => s.kind === 'era'));
  // Place settings still connect; release year makes no difference to the score.
  const b = buildFeelIndex([mk('p1', 1950, ['Films set in Texas']), mk('p2', 1951, ['Films set in Texas']), mk('p3', 2022, ['Films set in Texas'])], real);
  const r = similar(b, 'p1');
  assert.equal(r.find(x => x.key === 'p2').score, r.find(x => x.key === 'p3').score);
  assert.ok(r.every(x => x.reasons.every(y => !/194|19\d\ds|20\d\ds|era|decade/i.test(y.text))));
});
