// Audit fixes in core/api.js, core/features and the export import. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';
import { parseExportZip, BAD_FILE } from '../../core/parse/export.js';
import { parseRss } from '../../core/parse/letterboxd.js';
import { discover } from '../../core/features/discover.js';
import { series } from '../../core/features/series.js';

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const exportZip = () => zipSync({
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa']])),
  'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
});
const fake404 = async () => new Response('not found', { status: 404 });
const newCore = (events = []) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-audit-'));
  return createCore({ dataDir: dir, fetch: fake404, onEvent: (e, p) => events.push([e, p]) });
};
const rejects = (p, code) => assert.rejects(p, e => (code ? e.code === code : true));

// ---- -1 zip bomb ----
test('a zip with one huge file is refused before it is unpacked', () => {
  const bomb = zipSync({ 'watched.csv': new Uint8Array(51e6) }); // 51 MB of zeros, a few KB zipped
  assert.ok(bomb.length < 200e3);
  assert.throws(() => parseExportZip(bomb), e => e.message === BAD_FILE);
});
test('a zip with too many files is refused', () => {
  const files = {};
  for (let i = 0; i < 5001; i++) files[`f${i}.txt`] = new Uint8Array(0);
  assert.throws(() => parseExportZip(zipSync(files)), e => e.message === BAD_FILE);
});
test('a normal export still imports', () => {
  assert.equal(parseExportZip(exportZip()).watched.length, 1);
});

// ---- -2, -9 tags, notes, views, settings ----
test('renaming a tag to its own name keeps it; renaming onto an existing tag merges', async () => {
  const core = newCore();
  try {
    await core.call('importExport', { bytes: exportZip() });
    const key = Object.keys(core.store.library.films).find(k => core.store.library.films[k].watchlist);
    await core.call('setUserFilm', { key, tags: ['x', 'y'] });
    assert.deepEqual(await core.call('renameTag', { from: 'x', to: 'x' }), { ok: true });
    assert.ok(core.store.library.tags.x);
    core.store.library.tags.y.createdAt = 'keep-me';
    await core.call('renameTag', { from: 'x', to: 'y' });
    assert.equal(core.store.library.tags.x, undefined);
    assert.equal(core.store.library.tags.y.createdAt, 'keep-me');
    assert.deepEqual(core.store.library.films[key].tags, ['y']);
  } finally { core.close(); }
});
test('setUserFilm, setSettings and saveView refuse junk', async () => {
  const core = newCore();
  try {
    await core.call('importExport', { bytes: exportZip() });
    const before = Object.keys(core.store.library.films).length;
    await rejects(core.call('setUserFilm', { key: 'nope', tags: ['a'] }), 'bad-request');
    assert.equal(Object.keys(core.store.library.films).length, before, 'no record made for an unknown film');
    const key = Object.keys(core.store.library.films).find(k => core.store.library.films[k].watchlist);
    await rejects(core.call('setUserFilm', { key, tags: 'abc' }), 'bad-request');
    const u = await core.call('setUserFilm', { key, tags: ['t'.repeat(200)], note: 'n'.repeat(20000) });
    assert.equal(u.tags[0].length, 60);
    assert.equal(u.note.length, 10000);
    await rejects(core.call('setSettings', { theme: 'banana' }), 'bad-request');
    await rejects(core.call('setSettings', { region: 'ZZZ' }), 'bad-request');
    assert.notEqual(core.store.library.settings.theme, 'banana');
    await core.call('setSettings', { theme: 'neutral' });
    assert.equal(core.store.library.settings.theme, 'neutral');
    for (const th of ['neutral-light']) { await core.call('setSettings', { theme: th }); assert.equal(core.store.library.settings.theme, th); }
    await core.call('setSettings', { theme: 'dark', region: 'nz' });
    assert.equal(core.store.library.settings.region, 'NZ');
    await rejects(core.call('setSettings', { motion: 'fast' }), 'bad-request');
    await core.call('setSettings', { motion: 'less' });
    assert.equal(core.store.library.settings.motion, 'less');
    assert.equal((await core.call('getState')).settings.motion, 'less');
    await core.call('setSettings', { motion: 'system' });
    assert.equal(core.store.library.settings.motion, undefined);
    assert.equal((await core.call('getState')).settings.feelColours, true); // feel colours: on unless switched off
    await core.call('setSettings', { feelColours: false });
    assert.equal(core.store.library.settings.feelColours, 'off');
    assert.equal((await core.call('getState')).settings.feelColours, false);
    await core.call('setSettings', { feelColours: true });
    assert.equal(core.store.library.settings.feelColours, undefined);
    await core.call('setSettings', { keys: { notASource: 'abc' } });
    assert.equal(core.store.library.settings.keys.notASource, undefined);
    await rejects(core.call('saveView', { name: 'x' }), 'bad-request');
    await rejects(core.call('saveView', { name: 'x', query: 'text', id: 'a' }), 'bad-request');
    await rejects(core.call('saveView', { name: 'x', query: {}, id: '../../x' }), 'bad-request');
    assert.equal((await core.call('saveView', { name: 'ok', query: { text: 'a' } })).name, 'ok');
  } finally { core.close(); }
});

// ---- core.call and feel arguments ----
test('inherited names are not callable; feel methods give plain errors', async () => {
  const core = newCore();
  try {
    await rejects(core.call('toString'), 'unknown-method');
    await rejects(core.call('constructor'), 'unknown-method');
    await rejects(core.call('shiftFeel', { key: 'k', axis: 'nope', dir: 1 }), 'bad-request');
    assert.deepEqual((await core.call('searchFeel', { descriptors: null, themes: 'x', avoid: 5 })), await core.call('searchFeel', {}));
    const fit = await core.call('getFit', { keys: 'x' });
    assert.ok(Array.isArray(fit.ranked));
  } finally { core.close(); }
});

// ---- -10 entities ----
test('review text decodes each entity once, including numeric ones', () => {
  const xml = '<item><guid>letterboxd-review-1</guid><link>https://letterboxd.com/x/film/a/</link><description><![CDATA[<p>I &amp;lt;3 it &#38; &#x2019;ok&#x2019;</p>]]></description></item>';
  assert.equal(parseRss(xml)[0].review, 'I &lt;3 it & ’ok’');
});

// ---- -6, -5, -7 Discover and series ----
const uri = q => ({ value: `http://www.wikidata.org/entity/${q}` });
const lit = x => ({ value: String(x) });
// Synthetic franchise "Dragon": two films seen, a TV spin-off, a short, an unreleased film, an unseen released sequel.
const ROWS = [
  { film: 'Q1', title: 'Dragon One', date: '2010-03-26T00:00:00Z', ord: 1, types: 'Q11424', run: 98 },
  { film: 'Q2', title: 'Dragon Two', date: '2014-06-13T00:00:00Z', ord: 2, types: 'Q11424', run: 102 },
  { film: 'Q3', title: 'Dragon Riders', date: '2012-09-07T00:00:00Z', ord: 3, types: 'Q5398426', run: 24 },
  { film: 'Q4', title: 'Dragon Gift', date: '2011-11-14T00:00:00Z', ord: 4, types: 'Q24862', run: 21 },
  { film: 'Q5', title: 'Dragon Three', date: '2019-02-22T00:00:00Z', ord: 5, types: 'Q11424', run: 104 },
  { film: 'Q6', title: 'Dragon Four', date: '2099-06-01T00:00:00Z', ord: 6, types: 'Q11424' },
];
function fakeHttp() {
  const calls = { sparql: 0 };
  return {
    calls,
    async json(url, opts = {}) {
      if (!url.startsWith('https://query.wikidata.org/')) throw new Error('offline');
      calls.sparql++;
      const q = new URLSearchParams(opts.body).get('query');
      if (!q.includes('?series ?film')) return { results: { bindings: [] } };
      return { results: { bindings: ROWS.map(r => ({
        series: uri('Q900'), sname: lit('Dragon'), film: uri(r.film), title: lit(r.title), date: lit(r.date), types: lit(r.types),
        ord: lit(r.ord), ...(r.run ? { run: lit(r.run) } : {}),
      })) } };
    },
    async response() { return { ok: false, status: 500 }; },
  };
}
function dragonStore() {
  const cache = {};
  const films = {
    S1: { key: 'S1', title: 'Dragon One', year: 2010, ids: { wikidata: 'Q1' }, src: { wikidata: { collectionId: 'wd:Q900' } } },
    S2: { key: 'S2', title: 'Dragon Two', year: 2014, ids: { wikidata: 'Q2' }, src: { wikidata: { collectionId: 'wd:Q900' } } },
  };
  return {
    films, library: { films: { S1: { watched: true, rating: 8 }, S2: { watched: true, rating: 8 } } },
    cached(n, max) { const c = cache[n]; return c && Date.now() - Date.parse(c.at) < max ? c.value : undefined; },
    setCached(n, v) { cache[n] = { at: new Date().toISOString(), value: v }; return v; },
  };
}
const summaries = [
  { key: 'S1', title: 'Dragon One', year: 2010, poster: null, people: {}, user: { watched: true, rating: 8 } },
  { key: 'S2', title: 'Dragon Two', year: 2014, poster: null, people: {}, user: { watched: true, rating: 8 } },
];

test('Finish the series skips unreleased films and shorts, and keeps TV out of the counts', async () => {
  const store = dragonStore();
  const d = await discover({ store, http: fakeHttp(), summaries, now: new Date('2026-10-22T00:00:00Z') });
  const sec = d.sections.find(s => s.id === 'series');
  const titles = sec.items.map(i => i.title).sort();
  assert.deepEqual(titles, ['Dragon Riders', 'Dragon Three']); // not the short, not the 2099 film
  const three = sec.items.find(i => i.title === 'Dragon Three');
  assert.match(three.reasons[0], /^Next in the Dragon series/);
  const tv = sec.items.find(i => i.title === 'Dragon Riders');
  assert.equal(tv.kind, 'tv');
  assert.match(tv.reasons[0], /seen 2 of 3/); // films: One, Two, Three (the short, the TV show and the unreleased film are not counted)
});

test('the TV spin-off is only served when TV is on, and logged films drop out at serve time', async () => {
  const core = newCore();
  try {
    const store = core.store;
    store.films.S1 = { key: 'S1', title: 'Dragon One', year: 2010, ids: { wikidata: 'Q1' } };
    store.library.films.S1 = { watched: true };
    store.setCached('discover', { updatedAt: 'x', sections: [{ id: 'series', title: 'Finish the series', subtitle: '', items: [
      { id: 'wd:Q3', title: 'Dragon Riders', year: 2012, kind: 'tv', reasons: [] },
      { id: 'wd:Q5', title: 'Dragon Three', year: 2019, kind: 'film', reasons: [] },
      { id: 'wd:Q1', title: 'Dragon One', year: 2010, kind: 'film', reasons: [] },
    ] }] });
    const off = await core.call('getDiscover', {});
    assert.deepEqual(off.sections[0].items.map(i => i.title), ['Dragon Three']);
    const on = await core.call('getDiscover', { includeTV: true });
    assert.deepEqual(on.sections[0].items.map(i => i.title), ['Dragon Riders', 'Dragon Three']);
  } finally { core.close(); }
});

test('"not a series" is cached', async () => {
  const store = dragonStore();
  store.films.S1.src.wikidata.collectionId = 'wd:Q777';
  const http = { calls: 0, async json() { this.calls++; return { results: { bindings: [] } }; } };
  assert.equal(await series({ store, http, summaries, key: 'S1' }), null);
  const n = http.calls;
  assert.ok(n > 0);
  assert.equal(await series({ store, http, summaries, key: 'S1' }), null);
  assert.equal(http.calls, n, 'second visit makes no request');
});

test('a tag the user adds themselves stays on its film through a re-import, even if the name matches a Letterboxd tag', async () => {
  const core = newCore();
  try {
    await core.call('importExport', { bytes: exportZip() });
    const key = Object.keys(core.store.library.films).find(k => core.store.library.films[k].watchlist);
    core.store.library.tags.cosy = { source: 'letterboxd', createdAt: 'x' }; // a Letterboxd tag with the same name exists
    await core.call('setUserFilm', { key, tags: ['cosy', 'mine'] });
    assert.deepEqual(core.store.library.films[key].mine, ['cosy']);
    await core.call('importExport', { bytes: exportZip() });
    assert.deepEqual(core.store.library.films[key].tags, ['cosy', 'mine']);
    assert.ok(core.store.library.tags.cosy && core.store.library.tags.mine);
    // taking it off again forgets it
    await core.call('setUserFilm', { key, tags: ['mine'] });
    assert.equal(core.store.library.films[key].mine, undefined);
  } finally { core.close(); }
});
