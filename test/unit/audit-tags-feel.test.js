import test from 'node:test';
import assert from 'node:assert/strict';
import { sparqlDetails, readDetails, mapEntity, sourceKind } from '../../core/parse/wikidata.js';
import { autoTags } from '../../core/analysis/tags.js';
import { buildFeelIndex } from '../../core/analysis/feel/index.js';
import { buildIndex, nearest, vectorAt } from '../../core/analysis/similarity.js';
import { parseQueryText, applyQuery } from '../../core/analysis/query.js';

const uri = q => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` });
const lit = v => ({ type: 'literal', value: v });

test('the details query asks for the type of each source work', () => {
  assert.match(sparqlDetails(['Q1']), /wdt:P144 \?role \. \?role wdt:P31 \?v \. BIND\("P144\/P31" AS \?kind\)/);
});

// Synthetic rows shaped like the query service's answer (not recorded from the live service).
const rows = [
  { item: uri('Q1'), kind: lit('P144'), v: uri('Q10'), vl: lit('Dune') },
  { item: uri('Q1'), kind: lit('P144'), v: uri('Q11'), vl: lit('Some Poem') },
  { item: uri('Q1'), kind: lit('P144/P31'), v: uri('Q20'), vl: lit('novel'), role: uri('Q10') },
  { item: uri('Q1'), kind: lit('P144/P31'), v: uri('Q21'), vl: lit('written work'), role: uri('Q10') },
  { item: uri('Q1'), kind: lit('P144/P31'), v: uri('Q22'), vl: lit('poem'), role: uri('Q11') },
  { item: uri('Q1'), kind: lit('meta'), vl: lit('Dune') },
];

test('source works carry their kind and the tag fires', () => {
  const { entities, labels } = readDetails({ results: { bindings: rows } }, ['Q1']);
  const { data } = mapEntity(entities.get('Q1'), id => labels.get(id) ?? null);
  assert.deepEqual(data.basedOn, ['Dune (novel)', 'Some Poem']);
  assert.deepEqual(autoTags(data).filter(t => t.group === 'source').map(t => t.label), ['Based on a novel']);
});

test('a film stored without kinds still works', () => {
  const stored = ['Dune', 'Akira (manga)'];
  assert.deepEqual(autoTags({ basedOn: stored }).filter(t => t.group === 'source').map(t => t.label), ['Based on a comic']);
});

test('source kinds: closed set, comic first', () => {
  assert.equal(sourceKind(['graphic novel']), 'comic');
  assert.equal(sourceKind(['stage play', 'literary work']), 'play');
  assert.equal(sourceKind(['short story']), 'short story');
  assert.equal(sourceKind(['non-fiction book']), 'book');
  assert.equal(sourceKind(['film']), null);
  assert.deepEqual(autoTags({ basedOn: ['X (short story)'] }).filter(t => t.group === 'source').map(t => t.label), ['Based on a short story']);
});

// ---------- feel index memo ----------
const mk = (key, text) => ({ key, title: key, year: 2000, texts: [{ voice: 'viewers', source: 's', text }], categories: [], keywords: [], subjects: [], locations: [], basedOn: [], genres: ['Drama'], people: { director: [{ id: 'd' + key, name: 'D' + key }] }, countries: [], languages: [], runtime: 100, collection: null });
const inputs = () => Array.from({ length: 12 }, (_, i) => mk('f' + i, i % 2 ? 'A slow, wistful, tender story about grief and a mother.' : 'A tense, thrilling chase full of dread and violence.'));
const strip = idx => JSON.parse(JSON.stringify(idx, (k, v) => (v instanceof Map ? [...v] : typeof v === 'function' ? undefined : v === Infinity ? 'inf' : v)));

test('memoised feel index equals a cold build, also after one film changes', () => {
  const memo = new Map();
  const a = buildFeelIndex(inputs(), { memo });
  assert.deepEqual(strip(a.recs), strip(buildFeelIndex(inputs()).recs));
  const next = inputs(); next[3] = mk('f3', 'A joyful, funny romp.');
  const warm = buildFeelIndex(next, { memo });
  assert.deepEqual(strip(warm.recs), strip(buildFeelIndex(next).recs));
  assert.deepEqual(strip(warm.latent), strip(buildFeelIndex(next).latent));
  const dropped = buildFeelIndex(next.slice(1), { memo });
  assert.equal(memo.size, 11);
  assert.deepEqual(strip(dropped.recs), strip(buildFeelIndex(next.slice(1)).recs));
});

// ---------- ties ----------
test('equal scores order by film key, not store position', () => {
  const mkS = key => ({ key, title: key, year: 2000, genres: ['Drama'], directors: [{ id: 'x', name: 'X' }], keywords: [], subjects: [], cast: [], people: {}, countries: [], languages: [] });
  const order = keys => { const idx = buildIndex(keys.map(mkS)); return nearest(idx, vectorAt(idx, 0), { self: 0, k: 5 }).map(r => idx.keys[r.j]); };
  assert.deepEqual(order(['q', 'a', 'm', 'z']), ['a', 'm', 'z']);
  assert.deepEqual(order(['q', 'z', 'm', 'a']), ['a', 'm', 'z']);
});

// ---------- search-box ----------
test('is:unwatched filters; rated:>7.5 steps to 8; bad bounds are ignored', () => {
  assert.equal(parseQueryText('is:unwatched').status, 'unwatched');
  assert.equal(parseQueryText('is:unwatched').text, '');
  assert.equal(parseQueryText('rated:>7.5').ratingMin, 8);
  assert.equal(parseQueryText('rated:<7.5').ratingMax, 7);
  assert.equal(parseQueryText('rated:>7').ratingMin, 8);
  const list = [{ key: 'a', title: 'A', year: 2000, user: { watched: true } }, { key: 'b', title: 'B', year: 2001, user: { watched: false } }];
  assert.deepEqual(applyQuery(list, { status: 'unwatched' }).map(s => s.key), ['b']);
  assert.equal(applyQuery(list, { yearMin: 'abc' }).length, 2);
});
