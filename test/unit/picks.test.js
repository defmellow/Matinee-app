// Synthetic fixtures only (made-up films). Feel functions are stubbed so every number is checkable by hand;
// one test runs the real feel index to check the mood descriptor ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPicks, nudgePick, choosePick, mmr, MOODS, feelLine, confidenceLine, starText, jitterOf } from '../../core/analysis/picks.js';
import { buildFeelIndex, LEXICON } from '../../core/analysis/feel/index.js';
import { buildFit } from '../../core/analysis/fit.js';
import { MOOD_LABELS } from '../../ui/screens/tonight/moods.js';

const TODAY = '2026-10-22';
const film = (key, o = {}) => ({
  key, title: key.toUpperCase(), year: 2000, released: '2000-05-05', runtime: 100, genres: ['Drama'], kind: 'film', ratings: { imdb: { value: 7, votes: 50000 } },
  user: { watched: false, rating: null, watchlist: true, watchlistAddedAt: '2025-06-01' }, lastWatched: null, ...o,
});
const seen = (key, rating, last) => film(key, { user: { watched: true, rating, watchlist: false }, lastWatched: last });

// Fit table: score and tier per candidate; neighbours optional.
function model(table) {
  return { fit: k => ({ score: 0, tier: 'know', neighbours: [], caution: null, ...(table[k] || {}) }) };
}
// Feel stub: sims[a][b]; descriptors by film; weight position by film.
function stubFeel({ sims = {}, profile = {}, shiftRows = {}, weight = {} } = {}) {
  const keys = Object.keys(sims);
  const feel = { axes: [{ id: 'weight', low: 'Lighter', high: 'Heavier' }], byKey: new Map([...new Set([...keys, ...Object.keys(weight), ...Object.keys(profile)])].map(k => [k, { key: k }])) };
  const fns = {
    similar: (idx, key, { among, limit = 12 } = {}) => Object.entries(sims[key] || {}).filter(([k]) => !among || [...among].includes(k)).map(([k, score]) => ({ key: k, score })).sort((a, b) => b.score - a.score).slice(0, limit),
    profileOf: (idx, key) => profile[key] || { coverage: { viewers: 1, critics: 1 }, descriptors: [] },
    queryFeel: (idx, q, { among }) => (stubFeel.hits || []).filter(h => among.includes(h.key)),
    shift: (idx, key, { axis, dir }, { among }) => (shiftRows[`${key}:${axis}:${dir}`] || []).filter(r => among.includes(r.key)),
    axisPosition: (rec) => weight[rec.key] ?? 0,
  };
  return { feel, fns };
}

const base = [
  film('a', { runtime: 95 }), film('b', { runtime: 120 }), film('c', { runtime: 80 }), film('d', { runtime: 150 }),
  film('e', { runtime: 110 }), film('f', { runtime: 100 }), film('g', { runtime: 90 }),
  seen('w1', 8, '2026-10-01'), seen('w2', 6, '2026-09-20'),
];
const table = { a: { score: 2 }, b: { score: 1.5 }, c: { score: 1 }, d: { score: 0.5 }, e: { score: 0 }, f: { score: -0.5 }, g: { score: -1 } };

test('three roles, three distinct films, each with the right rule', () => {
  const { feel, fns } = stubFeel({ sims: {
    w1: { a: 0.9, b: 0.8, c: 0.1, d: 0.5, e: 0.4, f: 0.3, g: 0.2 },
    w2: { a: 0.9, b: 0.8, c: 0.1, d: 0.5, e: 0.4, f: 0.3, g: 0.2 },
  } });
  const r = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns });
  assert.deepEqual(r.picks.map(p => p.role), ['safe', 'stretch', 'waiting']);
  assert.equal(new Set(r.picks.map(p => p.key)).size, 3);
  assert.equal(r.picks[0].key, 'a');                 // top fit
  assert.equal(r.picks[1].key, 'c');                 // above median (b score >= 0 .. median is 'd'), least like the user's recent watches
  assert.deepEqual(r.picks.map(p => p.roleLabel), ['Safe bet', 'A stretch', 'Been waiting']);
});

test('Safe bet needs tier fair or better; Been waiting takes the oldest of the top third', () => {
  const films = base.map(s => (s.key === 'b' ? film('b', { runtime: 120, user: { watched: false, watchlist: true, watchlistAddedAt: '2019-01-01' } }) : s));
  const { feel, fns } = stubFeel({ sims: { w1: {}, w2: {} } });
  const t = { ...table, a: { score: 2, tier: 'guess' }, b: { score: 1.5 } };
  const r = buildPicks({ summaries: films, fitModel: model(t), feel, today: TODAY, fns });
  assert.equal(r.picks.find(p => p.role === 'safe').key, 'b');           // a is a guess, so skipped
  const near = stubFeel({ sims: { w1: { b: 0.9 }, w2: {} } }); // b feels like the user's recent watches, so it is not the stretch
  const w = buildPicks({ summaries: films, fitModel: model({ ...table, b: { score: 1.5 } }), feel: near.feel, today: TODAY, fns: near.fns });
  assert.equal(w.picks.find(p => p.role === 'waiting').key, 'b');        // oldest watchlistAddedAt within the top third (a, b, c)
  // when everything is only a guess there is no safe bet, and we say so rather than faking one
  const all = Object.fromEntries(Object.keys(table).map(k => [k, { score: 1, tier: 'guess' }]));
  assert.ok(!buildPicks({ summaries: base, fitModel: model(all), feel, today: TODAY, fns }).picks.some(p => p.role === 'safe'));
});

test('shorts, unreleased, TV and films that fail the time cap are never picked; missing runtime fails a cap', () => {
  const bad = [
    film('short', { runtime: 20 }), film('future', { released: '2027-01-01', year: 2027 }), film('show', { kind: 'tv' }),
    film('long', { runtime: 200 }), film('noRuntime', { runtime: null }),
  ];
  const t = { short: { score: 9 }, future: { score: 9 }, show: { score: 9 }, long: { score: 9 }, noRuntime: { score: 9 }, ...table };
  const { feel, fns } = stubFeel({ sims: { w1: {}, w2: {} } });
  const all = buildPicks({ summaries: [...base, ...bad], fitModel: model(t), feel, today: TODAY, fns });
  const shown = [...all.picks, ...all.more].map(p => p.key);
  for (const k of ['short', 'future', 'show']) assert.ok(!shown.includes(k), k);
  assert.ok(shown.includes('long') && shown.includes('noRuntime'));
  const capped = buildPicks({ summaries: [...base, ...bad], fitModel: model(t), feel, today: TODAY, fns, dials: { maxMinutes: 100 } });
  const cs = [...capped.picks, ...capped.more].map(p => p.key);
  assert.ok(!cs.includes('long') && !cs.includes('noRuntime') && !cs.includes('b'));
  assert.ok(cs.every(k => base.find(s => s.key === k)?.runtime <= 100));
});

test('mood keeps only films the mood query returns; empty states say which dial blocked', () => {
  const { feel, fns } = stubFeel({ sims: { w1: {}, w2: {} } });
  stubFeel.hits = [{ key: 'c', score: 0.4 }, { key: 'e', score: 0.2 }, { key: 'g', score: 0.01 }];
  const r = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, dials: { mood: 'Make me laugh' } });
  assert.deepEqual([...r.picks, ...r.more].map(p => p.key).sort(), ['c', 'e']);
  stubFeel.hits = [];
  const none = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, dials: { mood: 'A good cry' } });
  assert.equal(none.picks.length, 0);
  assert.equal(none.empty.why, 'mood');
  assert.equal(buildPicks({ summaries: [seen('w1', 8, '2026-10-01')], fitModel: model({}), feel, today: TODAY, fns }).empty.why, 'watchlist');
  assert.equal(buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, dials: { maxMinutes: 30 } }).empty.why, 'time');
  stubFeel.hits = [];
});

test('Lighter and Heavier dial keep films that lean that way', () => {
  const { feel, fns } = stubFeel({ sims: { w1: {}, w2: {} }, weight: { a: -1, b: 1, c: -2, d: 0, e: 1, f: -1, g: 0 } });
  const light = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, dials: { weight: -1 } });
  assert.deepEqual([...light.picks, ...light.more].map(p => p.key).sort(), ['a', 'c', 'f']);
  const heavy = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, dials: { weight: 1 } });
  assert.deepEqual([...heavy.picks, ...heavy.more].map(p => p.key).sort(), ['b', 'e']);
});

test('deterministic with a seed; a different seed may change picks; seed 0 is the plain best', () => {
  const { feel, fns } = stubFeel({ sims: { w1: { a: 0.2, b: 0.3 }, w2: {} } });
  const run = seed => buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, seed });
  const keys = r => [...r.picks, ...r.more].map(p => p.key);
  assert.deepEqual(keys(run(7)), keys(run(7)));
  assert.deepEqual(keys(run(0)), keys(run(0)));
  assert.equal(jitterOf(3, 'x'), jitterOf(3, 'x'));
  assert.ok(jitterOf(3, 'x') >= 0 && jitterOf(3, 'x') < 1);
});

test('year-shuffle invariance: swapping release years among past films changes nothing', () => {
  const { feel, fns } = stubFeel({ sims: { w1: { a: 0.2, b: 0.3 }, w2: { c: 0.4 } } });
  const years = [1950, 1977, 1999, 2012, 2020, 1985, 2003];
  const swapped = base.map((s, i) => (i < 7 ? { ...s, year: years[(i + 3) % 7], released: `${years[(i + 3) % 7]}-03-03` } : s));
  const keys = r => JSON.stringify([r.picks.map(p => [p.role, p.key]), r.more.map(p => p.key)]);
  const a = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, seed: 4 });
  const b = buildPicks({ summaries: swapped, fitModel: model(table), feel, today: TODAY, fns, seed: 4 });
  assert.equal(keys(a), keys(b));
});

test('More like these: up to nine, no repeats of the picks, diversified', () => {
  // Ten near-identical high-fit films (cluster X) and a lower-fit, different pair (cluster Y).
  const xs = Array.from({ length: 10 }, (_, i) => film('x' + i));
  const ys = [film('y0'), film('y1')];
  const t = {};
  xs.forEach((s, i) => { t[s.key] = { score: 2 - i * 0.01 }; });
  ys.forEach((s, i) => { t[s.key] = { score: 1.2 - i * 0.01 }; });
  const sims = { w1: {}, w2: {} };
  for (const a of xs) { sims[a.key] = {}; for (const b of xs) if (a !== b) sims[a.key][b.key] = 0.9; }
  for (const a of ys) { sims[a.key] = {}; for (const b of xs) sims[a.key][b.key] = 0.05; sims[a.key][a.key === 'y0' ? 'y1' : 'y0'] = 0.3; }
  for (const a of xs) for (const b of ys) sims[a.key][b.key] = 0.05;
  const { feel, fns } = stubFeel({ sims });
  const r = buildPicks({ summaries: [...xs, ...ys, seen('w1', 8, '2026-10-01'), seen('w2', 6, '2026-09-01')], fitModel: model(t), feel, today: TODAY, fns });
  assert.equal(r.more.length, 9);
  const pickKeys = new Set(r.picks.map(p => p.key));
  assert.ok(r.more.every(p => !pickKeys.has(p.key)));
  const ysInMore = r.more.filter(p => p.key.startsWith('y')).length + r.picks.filter(p => p.key.startsWith('y')).length;
  assert.ok(ysInMore >= 1, 'the different cluster shows up');
});

test('mmr: variety beats a near-duplicate', () => {
  const sim = { a: { b: 0.95, c: 0.1 }, b: { a: 0.95, c: 0.1 }, c: { a: 0.1, b: 0.1 } };
  const out = mmr({ keys: ['a', 'b', 'c'], rel: k => ({ a: 1, b: 0.95, c: 0.7 })[k], simFrom: k => new Map(Object.entries(sim[k])), k: 2 });
  assert.deepEqual(out, ['a', 'c']);
});

test('cards: scores come with the film, at most two why-lines, a verbatim-style confidence line, caution when present', () => {
  const { feel, fns } = stubFeel({
    sims: { w1: {}, w2: {} },
    profile: { a: { coverage: { viewers: 4, critics: 2 }, descriptors: [
      { id: 'wistful', label: 'Wistful', facet: 'mood', score: 0.6, voices: ['viewers', 'critics'] },
      { id: 'tender', label: 'Tender', facet: 'mood', score: 0.5, voices: ['viewers'] },
      { id: 'grief', label: 'Grief', facet: 'theme', score: 0.9, voices: ['viewers'] },
    ] } },
  });
  const t = { ...table, a: { score: 2, tier: 'know', neighbours: [{ key: 'w1', sim: 0.3, rating: 9 }, { key: 'w2', sim: 0.2, rating: 4 }, { key: 'w1', sim: 0.1, rating: 9 }, { key: 'w2', sim: 0.1, rating: 9 }, { key: 'w1', sim: 0.1, rating: 9 }, { key: 'w2', sim: 0.1, rating: 9 }], caution: { key: 'w2', rating: 3 } } };
  const r = buildPicks({ summaries: base, fitModel: model(t), feel, today: TODAY, fns });
  const a = r.picks[0];
  assert.equal(a.key, 'a');
  assert.ok(a.film.ratings.imdb);
  assert.deepEqual(a.why.map(w => w.voice), ['viewers', 'you']);
  assert.equal(a.why[0].text, "Viewers say it's wistful and tender.");
  assert.equal(a.why[1].text, 'Because you rated W1 ★★★★½, which feels alike.');
  assert.equal(a.confidence.text, "We know this one well: viewer reviews, critics and 6 films you've rated.");
  assert.equal(a.caution.text, 'It feels close to W2, which you gave ★½.');
  assert.ok(a.why.length <= 2);
  const blob = JSON.stringify(r);
  assert.ok(!/match|you'll love|%/i.test(blob.replace(/"imdb"/g, '')), 'no match percentages or love-promises');
});

test('confidence lines for the other two tiers', () => {
  assert.equal(confidenceLine('fair', { critics: 1, editors: 2 }, 3), 'A fair guess: critics and articles, no viewer reviews yet.');
  assert.equal(confidenceLine('fair', { critics: 1 }, 3), 'A fair guess: critics, no viewer reviews yet.');
  assert.equal(confidenceLine('guess', {}, 0), 'A rough guess: we don\'t know much about how it feels yet, so this leans on its scores.');
  assert.equal(confidenceLine('know', { critics: 0 }, 1), "We know this one well: viewer reviews and 1 film you've rated.");
  assert.equal(starText(5), '★★½');
});

test('feelLine names the voice of the top feeling, and says so when it is only articles', () => {
  const prof = { descriptors: [{ id: 'x', label: 'Eerie', facet: 'mood', score: 0.5, voices: ['editors'] }] };
  assert.equal(feelLine(prof).text, "Going by articles and tags, it's eerie.");
  assert.equal(feelLine({ descriptors: [] }), null);
});

test('nudges: Lighter uses shift, Shorter saves minutes, Something else gives the next film for the role, misses explain', () => {
  const { feel, fns } = stubFeel({ sims: { w1: {}, w2: {} }, shiftRows: { 'a:weight:-1': [{ key: 'c', score: 0.5 }, { key: 'zzz', score: 0.4 }] } });
  const args = { summaries: base, fitModel: model(table), feel, today: TODAY, fns, exclude: ['a', 'c', 'b'] };
  const lighter = nudgePick({ ...args, exclude: ['a', 'b'] }, { role: 'safe', key: 'a', kind: 'lighter' });
  assert.equal(lighter.pick.key, 'c');
  assert.equal(lighter.pick.role, 'safe');
  assert.equal(lighter.pick.nudgeNote, 'Lighter than A.');
  const shorter = nudgePick({ ...args, exclude: [] }, { role: 'safe', key: 'b', kind: 'shorter' }); // b is 120 min; a (95) is the best fit that is 10+ shorter
  assert.equal(shorter.pick.key, 'a');
  assert.equal(shorter.pick.nudgeNote, '25 minutes shorter than B.');
  const else_ = nudgePick({ ...args, exclude: [] }, { role: 'safe', key: 'a', kind: 'else' });
  assert.equal(else_.pick.key, 'b');
  const miss = nudgePick({ ...args, exclude: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, { role: 'safe', key: 'a', kind: 'else' });
  assert.equal(miss.pick, null);
  assert.match(miss.miss, /Try more time or another mood/);
  const noStranger = nudgePick(args, { role: 'safe', key: 'a', kind: 'stranger' });
  assert.equal(noStranger.pick, null);
});

test('mood list: every descriptor id exists in the lexicon, and the UI chips match', () => {
  const ids = new Set(LEXICON.map(d => d.id));
  for (const m of MOODS) for (const id of [...m.descriptors, ...m.avoid]) assert.ok(ids.has(id), `${m.label}: ${id}`);
  assert.equal(MOODS.length, 12);
  assert.deepEqual(MOOD_LABELS, MOODS.map(m => m.label));
});

test('real feel index: the Make me laugh mood finds the funny film, and fit still works end to end', () => {
  const inputs = [
    { key: 'f1', title: 'F1', texts: [{ voice: 'viewers', text: 'A hilarious, farcical romp. Uproarious and playful.' }], genres: ['Comedy'] },
    { key: 'f2', title: 'F2', texts: [{ voice: 'critics', text: 'Deadpan and wry, satirical and absurd.' }], genres: ['Comedy'] },
    { key: 'g1', title: 'G1', texts: [{ voice: 'viewers', text: 'Bleak, harrowing and devastating.' }], genres: ['Drama'] },
    { key: 'r1', title: 'R1', texts: [{ voice: 'viewers', text: 'Gentle and tender.' }], genres: ['Drama'] },
  ];
  const feel = buildFeelIndex(inputs);
  const summaries = [film('f1'), film('f2'), film('g1'), seen('r1', 8, '2026-10-01')];
  const fitModel = buildFit({ summaries, feel, today: TODAY });
  const r = buildPicks({ summaries, fitModel, feel, today: TODAY, dials: { mood: 'Make me laugh' } });
  const keys = [...r.picks, ...r.more].map(p => p.key).sort();
  assert.deepEqual(keys, ['f1', 'f2']);
  assert.ok(r.picks[0].why.some(w => /hilarious|deadpan|farcical|wry|playful|satirical|absurd/.test(w.text)));
});

test('shuffles draw other categories and never repeat a role within one screen', () => {
  const { feel, fns } = stubFeel({ sims: {} });
  const seen = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const r = buildPicks({ summaries: base, fitModel: model(table), feel, today: TODAY, fns, seed });
    assert.equal(r.picks[0].role, 'safe');
    assert.equal(new Set(r.picks.map(p => p.role)).size, r.picks.length);
    assert.equal(new Set(r.picks.map(p => p.key)).size, r.picks.length);
    for (const p of r.picks) seen.add(p.role);
  }
  assert.ok(seen.size > 3, `only saw ${[...seen]}`);
});

test('avoid keeps recently shown films off the next shuffle while others remain', () => {
  const many = Array.from({ length: 30 }, (_, i) => film(`f${String(i).padStart(2, '0')}`, { runtime: 90 + i }));
  const t = Object.fromEntries(many.map((f, i) => [f.key, { score: 3 - i * 0.1 }]));
  const { feel, fns } = stubFeel({ sims: {} });
  const first = buildPicks({ summaries: many, fitModel: model(t), feel, today: TODAY, fns, seed: 1 });
  const shown = [...first.picks, ...first.more].map(p => p.key);
  const next = buildPicks({ summaries: many, fitModel: model(t), feel, today: TODAY, fns, seed: 2, avoid: shown });
  const now = [...next.picks, ...next.more].map(p => p.key);
  assert.ok(now.length >= 9);
  assert.deepEqual(now.filter(k => shown.includes(k)), []);
});

test('choosePick: one bare film, rejected ones never return, and reasons steer the next one', () => {
  const films = [film('a', { runtime: 150 }), film('b', { runtime: 90 }), film('c', { runtime: 100 }), film('d', { runtime: 70 })];
  const t = { a: { score: 3 }, b: { score: 2 }, c: { score: 1 }, d: { score: 0 } };
  const { feel, fns } = stubFeel({ sims: {}, weight: { a: 1, b: 0.5, c: -0.5, d: -1 } });
  feel.axes.push({ id: 'strangeness' });
  const o = { summaries: films, fitModel: model(t), feel, today: TODAY, fns };
  const first = choosePick(o, {});
  assert.equal(first.pick.key, 'a');
  assert.deepEqual(Object.keys(first.pick).sort(), ['film', 'key']);
  assert.equal(choosePick(o, { rejected: ['a'] }).pick.key, 'b');
  assert.equal(choosePick(o, { rejected: ['a'], steers: [{ kind: 'lighter', key: 'a' }] }).pick.key, 'b');
  assert.equal(choosePick(o, { rejected: ['a', 'b'], steers: [{ kind: 'lighter', key: 'b' }] }).pick.key, 'c');
  assert.equal(choosePick(o, { rejected: ['a'], steers: [{ kind: 'shorter', key: 'a' }] }).pick.key, 'b');
  // nothing is lighter than d: the steer is loosened rather than leaving nothing to show
  const loose = choosePick(o, { rejected: ['a', 'b', 'c'], steers: [{ kind: 'lighter', key: 'd' }] });
  assert.equal(loose.pick.key, 'd');
  assert.equal(loose.relaxed, true);
  assert.equal(choosePick(o, { rejected: ['a', 'b', 'c', 'd'] }).pick, null);
});

test('choosePick: avoid-style reasons drop films carrying those feelings', () => {
  const films = [film('a'), film('b'), film('c')];
  const t = { a: { score: 3 }, b: { score: 2 }, c: { score: 1 } };
  const { feel, fns } = stubFeel({ sims: {} });
  // the real exclusion-only search, stubbed: films a and b carry the feeling
  fns.queryFeel = (idx, q, { among }) => among.filter(k => !(q.avoid || []).includes('bleak') || k === 'c').map(k => ({ key: k, score: 1 }));
  const o = { summaries: films, fitModel: model(t), feel, today: TODAY, fns };
  assert.equal(choosePick(o, { rejected: [], steers: [{ kind: 'bleak', key: 'a' }] }).pick.key, 'c');
  assert.equal(choosePick(o, { rejected: [], steers: [{ kind: 'scary', key: 'a' }] }).pick.key, 'a');
});
