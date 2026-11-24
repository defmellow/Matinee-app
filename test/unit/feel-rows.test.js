// The 11 Nov reforms: per-row chip limits, weak stand-ins, pace families, list-only themes, "wants both" searches, how sure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeelIndex, profileOf, queryFeel, forDisplay } from '../../core/analysis/feel/index.js';
import { chipsFor, oneDirection, ROW_LIMIT, CHIP_FLOOR } from '../../core/analysis/feel/floor.js';
import { buildMatcher, prepareText, scoreDescriptors } from '../../core/analysis/feel/extract.js';
import { LEXICON, FAMILIES } from '../../core/analysis/feel/lexicon.js';
import { certaintyOf } from '../../core/analysis/feel/certainty.js';
import { tierFor } from '../../ui/screens/feel/model.js';
import { sureNote, rowView, shadeOf, weighted, chipTitle, ROW_SHOWN } from '../../ui/screens/film/feelModel.js';

const matcher = buildMatcher(LEXICON);
const review = (text, source = 'lbpage.reviews') => ({ voice: 'viewers', source, text });
const critic = (text) => ({ voice: 'critics', source: 'mcreviews.critics', text });
const list = (text) => ({ voice: 'viewers', source: 'lbpage.themes', text });
const filler = (words) => review(Array.from({ length: words }, (_, i) => 'plain' + (i % 7 ? ' word' : ' text')).join(' '));
const scored = (texts) => scoreDescriptors(texts.map(prepareText), matcher);
const row = (id, facet, score, extra = {}) => ({ id, label: id, facet, score, ...extra });

test('each row has its own limit: a pile of impact words cannot push tone off the page', () => {
  const impact = Array.from({ length: ROW_LIMIT.impact + 3 }, (_, i) => row('i' + String(i).padStart(2, '0'), 'impact', 0.9 - i * 0.02));
  const all = [...impact, row('t1', 'tone', 0.3), row('p1', 'pace', 0.25)].sort((a, b) => b.score - a.score);
  const chips = chipsFor(all);
  assert.equal(chips.filter(d => d.facet === 'impact').length, ROW_LIMIT.impact);
  assert.deepEqual(chips.filter(d => d.facet === 'impact').map(d => d.id), impact.slice(0, ROW_LIMIT.impact).map(d => d.id), 'the strongest are the ones kept');
  assert.ok(chips.some(d => d.id === 't1') && chips.some(d => d.id === 'p1'));
});

test('pace: one passing "slow" is hidden on a text-rich film, but backed by another slow word it is a light chip', () => {
  const alone = scored([filler(1200), review('It was slow for me.')]).find(d => d.id === 'slow-paced');
  assert.ok(alone.score < CHIP_FLOOR.min.default);
  const backed = scored([filler(1200), review('It was slow for me.'), review('A real slow burn of a film.')]);
  const slow = backed.find(d => d.id === 'slow-paced'), burn = backed.find(d => d.id === 'slow-burn');
  assert.ok(slow.score >= CHIP_FLOOR.min.default, `backed slow ${slow.score}`);
  assert.ok(burn.score >= CHIP_FLOOR.min.default);
  // only pace has families: a lone "eerie" next to a lone "chilling" is still two passing mentions
  const fear = scored([filler(1200), review('An eerie one.'), review('Quite chilling.')]);
  assert.ok(fear.find(d => d.id === 'eerie').score < CHIP_FLOOR.min.default);
});

test('pace reads one way: the weaker direction is dropped unless it is nearly as strong', () => {
  const slow = row('slow-paced', 'pace', 0.5), fast = row('breakneck', 'pace', 0.16), mood = row('eerie', 'mood', 0.4);
  assert.deepEqual(oneDirection([slow, mood, fast], FAMILIES).map(d => d.id), ['slow-paced', 'eerie']);
  const fast2 = row('breakneck', 'pace', 0.4);
  assert.equal(oneDirection([slow, fast2], FAMILIES).length, 2, 'a film that changes gear keeps both');
});

test('a hidden near-copy lends its evidence to the word shown for it', () => {
  const out = forDisplay([row('unhurried', 'pace', 0.3), row('slow-paced', 'pace', 0.2)]);
  assert.ok(Math.abs(out.find(d => d.id === 'slow-paced').score - (1 - 0.7 * 0.8)) < 1e-9);
  const made = forDisplay([row('propulsive', 'pace', 0.3)]).find(d => d.id === 'breakneck');
  assert.equal(made.label, 'Breakneck');
  assert.ok(Math.abs(made.score - 0.3) < 1e-9);
});

test("Letterboxd's word lists count for a theme the way reviews do: two lists naming it stand, one alone is a single mention", () => {
  const two = scored([filler(1200), list('gangster mafia mob crime boss'), list('mafia gangster underworld')]).find(d => d.facet === 'theme' && /gangster/i.test(d.label));
  const one = scored([filler(1200), list('gangster heist')]).find(d => d.facet === 'theme' && /gangster/i.test(d.label));
  assert.ok(two.score >= 0.45, `two lists ${two.score}`);
  assert.ok(one.score < two.score * 0.6, `one list ${one.score}`);
});

test('a By feel search for two things puts films with both above a film very strong on one', () => {
  const both = { key: 'both', title: 'Both', texts: [review('Lonely and hilarious.'), review('So lonely, yet hilarious.')] };
  const one = { key: 'one', title: 'One', texts: [review('Hilarious, hilarious, just hilarious.'), review('The most hilarious film.'), critic('Hilarious.'), review('Hilarious again.')] };
  const idx = buildFeelIndex([both, one]);
  const any = queryFeel(idx, { descriptors: ['lonely', 'hilarious'] });
  assert.equal(any[0].covers, undefined, 'the any-of list (Tonight moods) is unchanged');
  const all = queryFeel(idx, { descriptors: ['lonely', 'hilarious'] }, { all: true });
  // the negative cases: a film with none of what was asked never shows, and "leave out" means out
  const none = { key: 'none', title: 'None', texts: [review('A tense thriller.'), review('Tense and gripping.')] };
  const idx2 = buildFeelIndex([both, one, none]);
  assert.ok(!queryFeel(idx2, { descriptors: ['lonely', 'hilarious'] }, { all: true }).some(r => r.key === 'none'));
  assert.deepEqual(queryFeel(idx2, { descriptors: ['hilarious'], avoid: ['lonely'] }, { all: true }).map(r => r.key), ['one'], 'the film that is also lonely is left out');
  assert.equal(all[0].key, 'both');
  assert.equal(all[0].covers, 1);
  assert.equal(all.find(r => r.key === 'one').covers, 0.5, 'covers counts each idea in full or not at all');
});

test('closeness badge: a search result missing something asked for is never "Very close"', () => {
  assert.equal(tierFor(0.5, 0.5).id, 'very', 'no search context: the list alone decides (film-page chip shades)');
  assert.equal(tierFor(0.5, 0.5, { covers: 1 }).id, 'very');
  assert.equal(tierFor(0.5, 0.5, { covers: 0.67 }).id, 'close', 'two of three');
  assert.equal(tierFor(0.5, 0.5, { covers: 0.5 }).id, 'some', 'one of two');
  assert.equal(tierFor(0.5, 0.5, { covers: 0.3 }).id, 'some');
  assert.equal(tierFor(0.2, 0.2, { covers: 1 }).id, 'close', 'the best of a weak list is not very close');
});

test('how sure: plenty of text, several voices and agreement read "Very sure"; one short review is a rough guess', () => {
  const agreed = [row('eerie', 'mood', 0.6, { voices: ['viewers', 'critics'] }), row('tense', 'mood', 0.5, { voices: ['viewers', 'critics'] })];
  const high = certaintyOf({ viewers: 1500, critics: 400, articles: 300, total: 2200 }, agreed, { viewers: 30, critics: 10 });
  assert.equal(high.level, 'high');
  assert.equal(high.label, 'Very sure');
  assert.match(high.reasons[0], /30 viewer reviews, 10 critic quotes, article text/);
  const low = certaintyOf({ viewers: 120, critics: 0, articles: 0, total: 120 }, [row('eerie', 'mood', 0.3, { voices: ['viewers'] })], { viewers: 1 });
  assert.equal(low.level, 'low');
  assert.match(low.reasons.join(' '), /1 viewer review\b/);
  assert.equal(certaintyOf({ viewers: 0, critics: 0, articles: 0, total: 0 }, []).level, 'none');
  assert.equal(sureNote({ certainty: high }).label, 'Very sure');
  assert.match(sureNote({ certainty: high }).text, /about this film's feel$/, 'worded as a line about the film, not a key for the chips');
  assert.equal(sureNote({ certainty: { level: 'none' } }), null);
});

test('the profile carries how sure it is', () => {
  const p = profileOf(buildFeelIndex([{ key: 'k', title: 'T', texts: [review('Eerie and tense, an eerie slow burn.'), critic('Eerie, tense and slow.')] }]), 'k');
  assert.ok(['high', 'medium', 'low'].includes(p.certainty.level));
  assert.ok(p.certainty.reasons.length >= 1);
});

test('fragile chips: one review, one keyword tag or one list; they come last, and two agreeing are not fragile', () => {
  const p = profileOf(buildFeelIndex([{ key: 'k', title: 'T', keywords: ['absurd'],
    texts: [review('A tense watch.'), review('So tense throughout.'), review('Oddly cosy in places.'), list('eerie fog dread'), list('moody stylish noir'), list('stylish neon cool')] }]), 'k');
  const of = id => p.descriptors.find(d => d.id === id);
  assert.ok(of('tense') && !of('tense').fragile, 'two reviews');
  assert.deepEqual([of('cosy').fragile, of('cosy').fragileBy], [true, 'review']);
  assert.deepEqual([of('absurd').fragile, of('absurd').fragileBy], [true, 'tag']);
  assert.deepEqual([of('eerie').fragile, of('eerie').fragileBy], [true, 'list']);
  assert.ok(of('stylish') && !of('stylish').fragile, 'two lists agreeing');
  const firstFragile = p.descriptors.findIndex(d => d.fragile);
  assert.ok(p.descriptors.slice(firstFragile).every(d => d.fragile), 'every confident chip comes before every fragile one');
  // a review and a list agreeing are not fragile either
  const both = profileOf(buildFeelIndex([{ key: 'k', title: 'T', texts: [review('An eerie one.'), list('eerie fog dread')] }]), 'k').descriptors.find(d => d.id === 'eerie');
  assert.ok(both && !both.fragile);
});

test('fragile chips in a row: list-backed first, then a review, then a lone tag; pace never shows one', () => {
  const chips = chipsFor([row('a', 'mood', 0.08, { fragile: true, fragileBy: 'tag' }), row('b', 'mood', 0.08, { fragile: true, fragileBy: 'review' }), row('c', 'mood', 0.07, { fragile: true, fragileBy: 'list' }),
    row('d', 'mood', 0.12), row('p', 'pace', 0.3, { fragile: true, fragileBy: 'review' }), row('q', 'pace', 0.15), row('r', 'pace', 0.25), row('tiny', 'tone', 0.04, { fragile: true, fragileBy: 'review' })]);
  assert.deepEqual(chips.filter(d => d.facet === 'mood').map(d => d.id), ['d', 'c', 'b', 'a']);
  assert.deepEqual(chips.filter(d => d.facet === 'pace').map(d => d.id), ['r'], 'pace: confident and clearly there, or nothing');
  assert.ok(!chips.some(d => d.id === 'tiny'));
});

test('what a row shows first: confident chips, dashed ones only to top up a thin row on a film Matinee is not very sure about', () => {
  const sureChips = n => Array.from({ length: n }, (_, i) => row('s' + i, 'mood', 0.9 - i * 0.05));
  const unsure = n => Array.from({ length: n }, (_, i) => row('u' + i, 'mood', 0.08, { fragile: true, fragileBy: 'review' }));
  const ids = v => [v.shown.map(d => d.id), v.more.map(d => d.id)];
  assert.deepEqual(ids(rowView([...sureChips(1), ...unsure(4)], 'mood', { thin: true })), [['s0', 'u0', 'u1'], ['u2', 'u3']]);
  assert.deepEqual(ids(rowView([...sureChips(1), ...unsure(4)], 'mood', { thin: false })), [['s0'], ['u0', 'u1', 'u2', 'u3']], 'a well-covered film keeps them behind Show more');
  assert.deepEqual(ids(rowView([...sureChips(3), ...unsure(2)], 'mood', { thin: true })), [['s0', 's1', 's2'], ['u0', 'u1']], 'three confident chips: no dashed ones up front');
  assert.deepEqual(ids(rowView(unsure(4), 'tone', { thin: false, lonely: true })), [['u0', 'u1', 'u2'], ['u3']], 'a row with nothing sure shows its dashed chips rather than vanishing');
  assert.deepEqual(ids(rowView([...sureChips(1), ...unsure(2)], 'tone', { thin: false, lonely: true })), [['s0'], ['u0', 'u1']], 'one sure chip is enough: the dashed ones wait');
  const big = rowView(sureChips(9), 'mood', { thin: true });
  assert.equal(big.shown.length, ROW_SHOWN.default);
  assert.equal(big.more.length, 9 - ROW_SHOWN.default);
});

test('shade is the darker of own strength and standing next to the film\'s best; a fragile chip is always the lightest and says why', () => {
  assert.equal(shadeOf(0.65, 0.95), 3, 'strong in its own right, whatever leads');
  assert.equal(shadeOf(0.35, 0.95), 2);
  assert.equal(shadeOf(0.28, 0.3), 3, 'the best of a thinly reviewed film still reads as its strongest');
  assert.equal(shadeOf(0.18, 0.3), 2);
  assert.equal(shadeOf(0.12, 0.9), 1);
  const w = weighted([row('x', 'mood', 0.3, { fragile: true, fragileBy: 'tag', voices: ['editors'] }), row('y', 'mood', 0.2, { voices: ['viewers'] })]);
  assert.deepEqual(w.map(d => [d.id, d.weight]), [['y', 3], ['x', 1]], 'confident first even when the fragile one scores higher');
  assert.match(chipTitle(w[1]), /^Very unsure: only one keyword tag says it\./);
});

test('fewer reviews: a feeling two of twelve reviewers share scores like the same share of a well-reviewed film; one mention is never scaled', async () => {
  const { thinFactor, reviewCount, THIN_SHARE } = await import('../../core/analysis/feel/extract.js');
  assert.equal(thinFactor(THIN_SHARE.ref), 1);
  assert.equal(thinFactor(60), 1);
  assert.equal(thinFactor(0), 1, 'no reviews: nothing to scale');
  assert.ok(thinFactor(12) > 1.9 && thinFactor(12) <= THIN_SHARE.max);
  assert.ok(thinFactor(1) <= THIN_SHARE.max);
  const plain = (n) => Array.from({ length: n }, (_, i) => review('Plain words about nothing in particular, number ' + i + '.'));
  assert.equal(reviewCount([...plain(3), list('eerie'), { voice: 'critics', source: 'wikipedia.reception', text: 'x' }].map(prepareText)), 3, 'lists and article text are not reviewers');
  const few = scored([review('An eerie film.'), review('Eerie from the first shot.'), ...plain(10)]).find(d => d.id === 'eerie');
  const many = scored([review('An eerie film.'), review('Eerie from the first shot.'), ...plain(40)]).find(d => d.id === 'eerie');
  assert.ok(few.score > many.score * 1.3, `${few.score} vs ${many.score}`);
  const once = scored([review('An eerie film.'), ...plain(11)]).find(d => d.id === 'eerie');
  const onceMany = scored([review('An eerie film.'), ...plain(40)]).find(d => d.id === 'eerie');
  assert.ok(Math.abs(once.score - onceMany.score) < 1e-9, 'one mention is not scaled');
});

