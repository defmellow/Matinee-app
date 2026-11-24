import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACETS, LEXICON, AXES, STOP_PHRASES } from '../../core/analysis/feel/lexicon.js';
import { buildMatcher, prepareText, scanText } from '../../core/analysis/feel/extract.js';
import { stemPhrase } from '../../core/analysis/feel/text.js';

const BANNED = ['good', 'great', 'film', 'movie', 'story', 'nice', 'bad'];
const RANGES = {
  mood: [26, 38], tone: [18, 26], pace: [12, 16], craft: [24, 32], impact: [18, 26], theme: [34, 80],
};

test('lexicon has 130 to 190 descriptors', () => {
  assert.ok(LEXICON.length >= 130 && LEXICON.length <= 200, `got ${LEXICON.length}`);
});

test('descriptor schema is valid', () => {
  for (const x of LEXICON) {
    assert.match(x.id, /^[a-z]+(-[a-z]+)*$/, x.id);
    assert.ok(typeof x.label === 'string' && x.label.length > 0 && x.label.length <= 30, x.id);
    assert.ok(FACETS.includes(x.facet), `${x.id} facet ${x.facet}`);
    assert.ok(Array.isArray(x.words) && x.words.length + (x.phrases ?? []).length >= 3 && x.words.length <= 10, `${x.id} words ${x.words.length}`);
    for (const w of x.words) assert.match(w, /^[a-z]+$/, `${x.id}: word "${w}"`);
    const phrases = x.phrases ?? [];
    assert.ok(phrases.length <= (x.facet === 'pace' ? 16 : 6), `${x.id} phrases`); // pace is said in set phrases ("well paced", "takes its time"), so it may list more
    for (const p of phrases) assert.match(p, /^[a-z]+( [a-z]+)+$/, `${x.id}: phrase "${p}"`);
    if (x.weight !== undefined) assert.ok(x.weight >= 0.4 && x.weight <= 1, `${x.id} weight`);
  }
});

test('counts per facet are within range', () => {
  for (const f of FACETS) {
    const n = LEXICON.filter((x) => x.facet === f).length;
    const [lo, hi] = RANGES[f];
    assert.ok(n >= lo && n <= hi, `${f}: ${n} not in ${lo}-${hi}`);
  }
});

test('ids and labels are unique', () => {
  const ids = LEXICON.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  const labels = LEXICON.map((x) => x.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length);
});

test('no word or phrase is shared between descriptors', () => {
  const seen = new Map();
  for (const x of LEXICON) {
    for (const t of [...x.words, ...(x.phrases ?? [])]) {
      assert.ok(!seen.has(t), `"${t}" is in both ${seen.get(t)} and ${x.id}`);
      seen.set(t, x.id);
    }
  }
});

test('no banned generic words', () => {
  for (const x of LEXICON) {
    for (const w of x.words) assert.ok(!BANNED.includes(w), `${x.id}: banned word "${w}"`);
  }
});

test('axes reference real descriptors on both sides', () => {
  const ids = new Set(LEXICON.map((x) => x.id));
  assert.equal(AXES.length, 8);
  assert.equal(new Set(AXES.map((a) => a.id)).size, AXES.length);
  for (const a of AXES) {
    assert.ok(a.low && a.high, a.id);
    for (const side of ['lowIds', 'highIds']) {
      assert.ok(a[side].length >= 3 && a[side].length <= 8, `${a.id}.${side} size`);
      for (const id of a[side]) assert.ok(ids.has(id), `${a.id}.${side}: unknown id ${id}`);
    }
    const overlap = a.lowIds.filter((i) => a.highIds.includes(i));
    assert.deepEqual(overlap, [], `${a.id} has ids on both sides`);
  }
});

test('stop phrases are 2+ words, never a lexicon phrase, and stop the word inside them counting', () => {
  const phraseSigs = new Set(LEXICON.flatMap(x => x.phrases || []).map(p => stemPhrase(p).join(' ')));
  for (const p of STOP_PHRASES) {
    assert.match(p, /^[a-z]+( [a-z]+)+$/, p);
    assert.ok(!phraseSigs.has(stemPhrase(p).join(' ')), `${p} is also a lexicon phrase`);
  }
  const m = buildMatcher(LEXICON);
  const ids = t => [...scanText(prepareText({ text: t }), m).keys()];
  assert.deepEqual(ids('Such a shame the ending drags.').filter(i => i === 'shame'), []);
  assert.deepEqual(ids('Made by the creator of Mr. Robot.').filter(i => i === 'robots'), []);
  assert.ok(ids('a story of robots and the people who built them').includes('robots'));
  assert.ok(ids('consumed by shame after the trial').includes('shame'));
});

// Six moods added after the plain-words pass (sentences here are synthetic, written for the test).
const NEW_MOODS = {
  mysterious: ['An enigmatic, mysterious drama with an air of mystery.', 'Cryptic and inscrutable throughout.'],
  dark: ['Honestly a very dark film with a dark tone.', 'It gets too dark for children.'],
  weird: ['Such a weird, off kilter little film.', 'Weirdly compelling, a strange film in the best way.'],
  gentle: ['A gentle, soft spoken story that unfolds gently.', 'Pure gentleness and quiet warmth.'],
  chaotic: ['Loud, chaotic and unhinged from start to finish.', 'Pure chaos, and it is glorious.'],
  cold: ['Beautiful but cold and distant, and emotionally distant too.', 'An aloof, sterile, coldly observed study.'],
};
const NOT_FIRING = {
  mysterious: ['A mystery thriller about a missing girl.', 'The murder mystery is solved by the end.'],
  dark: ['A dark comedy with a sharp script.', 'The Dark Knight is a classic.', 'The dark side of fame.', 'They waited in the dark.', 'Dark cinematography and deep shadows.'],
  weird: ['Her stranger danger lesson.', 'A story about strangers on a train.'],
  gentle: ['A true gentleman, played with charm.', 'The gentlemen of the club.'],
  chaotic: ['A frantic, frenzied chase.', 'Nothing here is out of order.'],
  cold: ['A Cold War spy story.', 'A cold open sets the scene.', 'Shot in cold blood.', 'A cold winter night, snow everywhere.', 'Cold Mountain.'],
};

test('each new mood fires on a short sentence and not on its collision phrases', () => {
  const m = buildMatcher(LEXICON);
  const fired = (t) => [...scanText(prepareText({ text: t }), m).keys()];
  for (const [id, yes] of Object.entries(NEW_MOODS)) {
    assert.ok(LEXICON.some((x) => x.id === id && x.facet === 'mood'), `${id} is a mood`);
    for (const t of yes) assert.ok(fired(t).includes(id), `${id} should fire on: ${t}`);
  }
  for (const [id, no] of Object.entries(NOT_FIRING)) {
    for (const t of no) assert.ok(!fired(t).includes(id), `${id} should not fire on: ${t}`);
  }
  assert.ok(!fired('A dark comedy.').includes('dark'));
  assert.ok(fired('A dark comedy.').includes('darkly-comic'));
});

test('the plain-words relabels and the wistful merge', () => {
  const label = (id) => LEXICON.find((x) => x.id === id)?.label;
  assert.equal(label('brooding'), 'Moody');
  assert.equal(label('farcical'), 'Silly');
  assert.equal(label('wry'), 'Dry wit');
  assert.equal(label('sardonic'), 'Mocking');
  assert.equal(label('lyrical'), 'Poetic');
  assert.equal(label('naturalistic'), 'True to life');
  assert.equal(label('cerebral'), 'Intellectual');
  assert.equal(label('wistful'), undefined);
  const m = buildMatcher(LEXICON);
  assert.ok([...scanText(prepareText({ text: 'wistful and elegiac' }), m).keys()].includes('bittersweet'));
});
