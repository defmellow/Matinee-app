// "Finish the series": which Wikidata series count, and what Discover shows. Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { genuineSeries, isEdition } from '../../core/features/series-rules.js';
import { seriesMembers } from '../../core/features/wikidata-graph.js';
import { discover } from '../../core/features/discover.js';
import { mapEntity, pickCollection, isCatalogueName } from '../../core/parse/wikidata.js';

const f = (id, title, year, linked, ordinal = null) => ({ id: `wd:${id}`, title, year, kind: 'film', ordinal, linked });

test('isEdition catches 3D and other re-release labels, not real titles', () => {
  for (const t of ['Dragon (3D)', 'Dragon (IMAX)', 'Dragon (Extended Edition)', 'Dragon (Director’s Cut)'.replace('’', "'"), 'Dragon (2019 re-release)']) assert.equal(isEdition(t), true, t);
  for (const t of ['Dragon 2', '3D Man', 'Dragon: The Hidden World', 'Dragon (film)']) assert.equal(isEdition(t), false, t);
});

test('isCatalogueName: studio catalogues and best-of lists, not franchises', () => {
  for (const n of ['Walt Disney Animation Studios feature film', "BBC's 100 Greatest Films of the 21st Century", 'list of Pixar films', 'Studio Ghibli Feature Films', 'Family Classics']) assert.equal(isCatalogueName(n), true, n);
  for (const n of ['Dune', 'Shrek', 'Marvel Cinematic Universe', 'The Before Trilogy', 'Kung Fu Panda']) assert.equal(isCatalogueName(n), false, n);
});

test('genuineSeries: a studio catalogue is dropped even if it has sequels inside', () => {
  const s = { name: 'Acme Animation Studios feature film', films: [f('A', 'Alpha', 1990, true), f('B', 'Alpha 2', 1993, true)] };
  assert.equal(genuineSeries(s), null);
});

test('genuineSeries: one entry is not a series; editions do not count as entries', () => {
  assert.equal(genuineSeries({ name: 'Solo', films: [f('A', 'Solo', 2000, false, 1)] }), null);
  assert.equal(genuineSeries({ name: 'Dragon', films: [f('A', 'Dragon', 2010, true, 1), f('B', 'Dragon (3D)', 2010, true)] }), null);
  assert.equal(genuineSeries({ name: 'Dragon', films: [f('A', 'Dragon', 2010, true, 1), f('A2', 'Dragon', 2010, false)] }), null);
});

test('genuineSeries: keeps only films that are linked or numbered when links are known', () => {
  const g = genuineSeries({ name: 'Orbit', films: [f('A', 'Orbit', 1980, true), f('B', 'Orbit 2', 1984, true), f('C', 'Unrelated Cameo', 1999, false), f('D', 'Orbit (3D)', 1980, true)] });
  assert.deepEqual(g.films.map(x => x.title), ['Orbit', 'Orbit 2']);
});

test('genuineSeries: short unlinked trilogies are trusted; long unlinked ones are not; unknown links keep everything', () => {
  assert.equal(genuineSeries({ name: 'Qatsi trilogy', films: [f('A', 'K', 1982, false), f('B', 'P', 1988, false), f('C', 'N', 2002, false)] }).films.length, 3);
  const many = Array.from({ length: 9 }, (_, i) => f(`X${i}`, `Film ${i}`, 1990 + i, false));
  assert.equal(genuineSeries({ name: 'Mixed bag', films: many }), null);
  assert.equal(genuineSeries({ name: 'Old data', films: many.map(x => ({ ...x, linked: undefined })) }).films.length, 9);
});

test('pickCollection prefers the franchise that shares a word with the title and skips catalogues', () => {
  const names = { S0: 'DreamWorks Animation feature films', S1: 'Shrek', S2: 'Fairy tale mashups' };
  const label = id => names[id] ?? null;
  assert.equal(pickCollection(['S0', 'S2', 'S1'], label, 'Shrek 2'), 'S1');
  assert.equal(pickCollection(['S0'], label, 'Shrek 2'), null);
  assert.equal(pickCollection(['S0', 'S2'], label, 'Madagascar'), 'S2');
});

test('mapEntity: a film only listed in a studio catalogue gets no collection', () => {
  const snak = v => ({ mainsnak: { snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { id: v } } }, rank: 'normal' });
  const entity = { id: 'Q1', labels: { en: { value: 'Aladdin' } }, claims: { P31: [snak('Q11424')], P179: [snak('S0')] } };
  const { data } = mapEntity(entity, id => ({ S0: 'Walt Disney Animation Studios feature film' })[id] ?? null);
  assert.ok(!data.collectionId);
  assert.ok(!data.collection);
});

// ---- end to end through seriesMembers and discover, with a fake query service ----

const uri = q => ({ value: `http://www.wikidata.org/entity/${q}` });
const lit = x => ({ value: String(x) });
// series → [film qid, title, year, links, ordinal]
const DATA = {
  Q1: { name: 'Orbit', rows: [['Q101', 'Orbit', 1980, 1, 1], ['Q102', 'Orbit 2', 1984, 1, 2], ['Q103', 'Orbit 3', 1990, 1, 3], ['Q104', 'Orbit 3 (3D)', 2012, 0, null]] },
  Q2: { name: 'Acme Animation Studios feature film', rows: [['Q111', 'Gem', 1991, 0, null], ['Q112', 'Gem Two', 1994, 1, null], ['Q113', 'Gem Three', 1999, 1, null]] },
  Q3: { name: 'Lone', rows: [['Q121', 'Lone Wolf', 2001, 0, 1]] },
  Q4: { name: 'Done', rows: [['Q131', 'Done', 2000, 1, 1], ['Q132', 'Done 2', 2003, 1, 2]] },
  Q5: { name: 'Mixed', rows: [['Q141', 'Mixed', 2000, 1, 1], ['Q142', 'Mixed 2', 2003, 1, 2], ['Q143', 'Mixed Cameo', 2005, 0, null]] },
};
function fakeHttp() {
  return {
    async json(url, opts = {}) {
      if (!url.startsWith('https://query.wikidata.org/')) throw Object.assign(new Error('offline'), { status: 404 });
      const query = new URLSearchParams(opts.body).get('query');
      const bindings = [];
      if (query.includes('?series ?film')) {
        for (const [q, s] of Object.entries(DATA)) if (new RegExp(`wd:${q}\\b`).test(query)) {
          for (const [film, title, year, links, ord] of s.rows) {
            bindings.push({ series: uri(q), sname: lit(s.name), film: uri(film), title: lit(title), date: lit(`${year}-01-01T00:00:00Z`), types: lit('Q11424'), links: lit(links), ...(ord ? { ord: lit(ord) } : {}) });
          }
        }
      }
      return { results: { bindings } };
    },
    async response() { return { ok: false, status: 500 }; },
  };
}

test('seriesMembers returns only genuine series, with editions and unrelated members removed', async () => {
  const m = await seriesMembers(fakeHttp(), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
  assert.deepEqual([...m.keys()].sort(), ['Q1', 'Q4', 'Q5']);
  assert.deepEqual(m.get('Q1').films.map(x => x.title), ['Orbit', 'Orbit 2', 'Orbit 3']);
  assert.deepEqual(m.get('Q5').films.map(x => x.title), ['Mixed', 'Mixed 2']);
});

function store(entries) { // entries: [key, title, year, wikidata qid, collection qid, watched]
  const films = {}, user = {};
  for (const [key, title, year, qid, coll, watched] of entries) {
    films[key] = { key, title, year, ids: qid ? { wikidata: qid } : {}, src: coll ? { wikidata: { collectionId: `wd:${coll}`, collection: coll } } : {} };
    user[key] = { watched, rating: watched ? 8 : null };
  }
  return { films, library: { films: user }, cached: () => undefined, setCached: (n, v) => v };
}
const NOW = new Date('2026-10-21T00:00:00Z');
const finish = async s => (await discover({ store: s, http: fakeHttp(), summaries: [], now: NOW })).sections.find(x => x.id === 'series');

test('discover: finish the series shows only unwatched real entries of series with a watched entry', async () => {
  const sec = await finish(store([
    ['k1', 'Orbit', 1980, 'Q101', 'Q1', true],          // started: Orbit 2 and 3 remain, the 3D copy never shows
    ['k2', 'Gem', 1991, 'Q111', 'Q2', true],            // studio catalogue: ignored
    ['k3', 'Done', 2000, 'Q131', 'Q4', true], ['k4', 'Done 2', 2003, 'Q132', 'Q4', true], // fully watched
    ['k5', 'Mixed', 2000, 'Q141', 'Q5', true],          // cameo is not an entry
    ['k6', 'Lone Wolf', 2001, 'Q121', 'Q3', true],      // single-entry "series"
  ]));
  assert.deepEqual(sec.items.map(i => i.title).sort(), ['Mixed 2', 'Orbit 2', 'Orbit 3']);
});

test('discover: a series you have only on the watchlist (nothing watched) is not offered', async () => {
  const sec = await finish(store([['k1', 'Orbit', 1980, 'Q101', 'Q1', false]]));
  assert.equal(sec, undefined);
});
