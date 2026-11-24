import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createStore } from '../../core/store.js';
import { importExport } from '../../core/import/export.js';
import { refreshFromRss } from '../../core/sources/rss.js';
import { parseRss } from '../../core/parse/letterboxd.js';
import { parseCsvRows, entryCodeFromViewingId, viewingIdFromEntryCode } from '../../core/parse/export.js';
import { userFilm } from '../../core/library.js';
import { makeExport, VIEWING, CODE } from '../fixtures/synthetic/export.js';
import { feed, item, inExport, newer } from '../fixtures/synthetic/rss.js';

const REAL_ZIP = new URL('../fixtures/private/export.zip', import.meta.url);
const REAL_RSS = new URL('../fixtures/private/rss.xml', import.meta.url);
const hasReal = fs.existsSync(REAL_ZIP) && fs.existsSync(REAL_RSS);
const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-rss-')), { debounce: 5 });
const NOW = '2026-05-06T07:08:09.000Z';

/** A fake http: `answers` maps a URL to { status, text } (or a function). No network. */
function fakeHttp(answers) {
  const calls = [];
  return {
    calls,
    async text(url) {
      calls.push(url);
      const a = typeof answers === 'function' ? answers(url) : answers[url];
      if (!a) throw new Error(`unexpected request: ${url}`);
      return { status: 200, url, ...a };
    },
  };
}
const FEED_URL = 'https://letterboxd.com/synth_user/rss/';
const serve = xml => fakeHttp({ [FEED_URL]: { text: xml } });

// ---------- short codes and viewing ids ----------

test('the export short code of a diary entry is base-62 of the RSS viewing id × 10 + 1', () => {
  for (const id of Object.values(VIEWING)) assert.equal(viewingIdFromEntryCode(entryCodeFromViewingId(id)), id);
  assert.equal(entryCodeFromViewingId(1), 'b');                      // 1 × 10 + 1 = 11 → 'b'
});

// ---------- errors ----------

test('refreshFromRss: unknown member → friendly no-user error', async () => {
  const store = tmpStore();
  const http = fakeHttp({ 'https://letterboxd.com/nobody_here/rss/': { status: 404, text: 'Not found' } });
  await assert.rejects(refreshFromRss(store, http, 'nobody_here'), e => {
    assert.equal(e.code, 'no-user');
    assert.equal(e.message, "There's no Letterboxd member called “nobody_here”.");
    return true;
  });
  assert.equal(store.library.sync.lastRefresh, null);
});

test('refreshFromRss: other failures are friendly too, and empty usernames are refused', async () => {
  const store = tmpStore();
  await assert.rejects(refreshFromRss(store, fakeHttp({ [FEED_URL]: { status: 503, text: '' } }), 'synth_user'), { code: 'http' });
  await assert.rejects(refreshFromRss(store, serve('<html><title>Just a moment...</title></html>'), 'synth_user'), { code: 'bad-feed' });
  await assert.rejects(refreshFromRss(store, serve(''), '  '), { code: 'no-username' });
  assert.deepEqual(Object.keys(store.films), []);
});

test('refreshFromRss asks for the member\'s feed (case and "@" tolerated in the name)', async () => {
  const store = tmpStore();
  const http = fakeHttp(() => ({ text: feed([]) }));
  assert.deepEqual(await refreshFromRss(store, http, ' @synth_user '), { added: 0, updated: 0 });
  assert.deepEqual(http.calls, [FEED_URL]);
});

// ---------- a store with no export ----------

test('refreshFromRss on an empty library: films, entries, posters, ids and flags', async () => {
  const store = tmpStore();
  const xml = feed([...inExport(), ...newer(), '<item> <title>A list</title> <guid isPermaLink="false">letterboxd-list-1</guid> </item>']);
  const r = await refreshFromRss(store, serve(xml), 'synth_user', { now: NOW });
  assert.deepEqual(r, { added: 4, updated: 0 });
  assert.equal(store.library.sync.lastRefresh, NOW);

  const E = store.library.entries;
  assert.deepEqual(Object.keys(E).sort(), ['v:1000000001', 'v:1000000002', 'v:1000000010', 'v:1000000011']);
  const e = E['v:1000000011'];
  assert.deepEqual(
    { key: e.key, date: e.date, loggedAt: e.loggedAt, rating: e.rating, liked: e.liked, rewatch: e.rewatch, review: e.review, spoiler: e.spoiler, tags: e.tags, source: e.source },
    { key: 'slug:synthetic-omega-and-sons', date: '2026-02-03', loggedAt: '2026-02-03', rating: 5, liked: false, rewatch: false, review: 'Loud.', spoiler: true, tags: [], source: 'rss' },
  );
  assert.equal(E['v:1000000001'].loggedAt, '2025-03-02');                 // logged a day after it was watched

  const omega = store.films['slug:synthetic-omega-and-sons'];
  assert.equal(omega.title, 'Synthetic Omega & Sons');
  assert.deepEqual(omega.src.rss, { poster: { url: 'https://img.example.invalid/synthetic-omega-and-sons.jpg' } });
  assert.deepEqual(omega.ids, { tmdb: 900002, letterboxd: 'synthetic-omega-and-sons' });
  assert.deepEqual(userFilm(store, omega.key), { watched: true, rating: 5, liked: false, watchlist: false, tags: [] });

  // Three entries for one film: the newest (2026-01-01, 4.5 stars, liked) speaks for it.
  const alpha = userFilm(store, 'slug:synthetic-alpha');
  assert.deepEqual([alpha.watched, alpha.rating, alpha.liked], [true, 9, true]);
});

test('refreshFromRss is repeatable, and picks up edits to its own entries', async () => {
  const store = tmpStore();
  await refreshFromRss(store, serve(feed(newer())), 'synth_user');
  assert.deepEqual(await refreshFromRss(store, serve(feed(newer())), 'synth_user'), { added: 0, updated: 0 });

  const edited = [
    item({ id: 1000000010, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2026-01-01', logged: '2026-01-02', rating: 3, liked: true, rewatch: true, tmdb: 900001, review: 'Changed my mind.' }),
    newer()[1],
  ];
  assert.deepEqual(await refreshFromRss(store, serve(feed(edited)), 'synth_user'), { added: 0, updated: 1 });
  const e = store.library.entries['v:1000000010'];
  assert.deepEqual([e.rating, e.review], [6, 'Changed my mind.']);
  assert.equal(userFilm(store, 'slug:synthetic-alpha').rating, 6);
});

test('refreshFromRss keeps what a film already has and never overwrites ids', async () => {
  const store = tmpStore();
  store.films['slug:synthetic-alpha'] = {
    key: 'slug:synthetic-alpha', lid: null, slug: 'synthetic-alpha', title: 'Synthetic Alpha', year: 2001,
    ids: { tmdb: 111, imdb: 'tt1' }, src: { rss: { poster: { url: 'kept', width: 600 }, ratings: { letterboxd: { value: 3.9, votes: 10 } } } }, checked: {}, missed: {},
  };
  await refreshFromRss(store, serve(feed(newer())), 'synth_user');
  const f = store.films['slug:synthetic-alpha'];
  assert.deepEqual(f.ids, { tmdb: 111, imdb: 'tt1', letterboxd: 'synthetic-alpha' });
  assert.deepEqual(f.src.rss, { poster: { url: 'kept', width: 600 }, ratings: { letterboxd: { value: 3.9, votes: 10 } } });
});

// ---------- with an export in the store ----------

test('viewings already in the export are recognised exactly, by id, and left alone', async () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: NOW });
  const before = JSON.stringify(Object.values(store.library.entries));

  const r = await refreshFromRss(store, serve(feed(inExport())), 'synth_user', { now: NOW });
  assert.deepEqual(r, { added: 0, updated: 0 });
  assert.equal(JSON.stringify(Object.values(store.library.entries)), before);

  // ...but the films still learn their poster and ids from the feed.
  const alpha = store.films['lid:aaa'];
  assert.deepEqual(alpha.ids, { tmdb: 900001, letterboxd: 'synthetic-alpha' });
  assert.equal(alpha.src.rss.poster.url, 'https://img.example.invalid/synthetic-alpha.jpg');
  assert.equal(alpha.slug, 'synthetic-alpha');
  assert.equal(store.library.entries[`e:${CODE.alphaRewatch}`].review, 'Better the second time.');
});

test('newer entries are added beside the export, and a newer rating or like wins', async () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: NOW });
  const r = await refreshFromRss(store, serve(feed([...inExport(), ...newer()])), 'synth_user', { now: NOW });
  assert.deepEqual(r, { added: 2, updated: 0 });
  assert.equal(Object.keys(store.library.entries).length, 5 + 2);
  const alpha = userFilm(store, 'lid:aaa');
  assert.deepEqual([alpha.rating, alpha.liked], [9, true]);                   // export said 7
  assert.equal(store.library.entries['v:1000000010'].key, 'lid:aaa');
  assert.equal(store.library.entries['v:1000000011'].key, 'slug:synthetic-omega-and-sons');
});

test('an older RSS entry does not change the film\'s rating, and an unrated newer one does not clear it', async () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: NOW });
  const old = item({ id: 1000000020, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2024-12-01', rating: 1, tmdb: 900001 });
  assert.deepEqual(await refreshFromRss(store, serve(feed([old])), 'synth_user'), { added: 1, updated: 0 });
  assert.deepEqual([userFilm(store, 'lid:aaa').rating, userFilm(store, 'lid:aaa').liked], [7, true]);

  const unrated = item({ id: 1000000021, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2026-03-03', liked: true, tmdb: 900001 });
  await refreshFromRss(store, serve(feed([old, unrated])), 'synth_user');
  assert.deepEqual([userFilm(store, 'lid:aaa').rating, userFilm(store, 'lid:aaa').liked], [7, true]);
});

test('importing a newer export drops the RSS entries it now contains, and keeps the rest', async () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: NOW });
  await refreshFromRss(store, serve(feed(newer())), 'synth_user', { now: NOW });
  assert.ok(store.library.entries['v:1000000010'] && store.library.entries['v:1000000011']);

  const diary = `${new TextDecoder().decode(unzipSync(makeExport())['diary.csv'])}2026-01-02,Synthetic Alpha,2001,https://boxd.it/${entryCodeFromViewingId(1000000010)},4.5,Yes,,2026-01-01\r\n`;
  const s = importExport(store, makeExport({ replace: { 'diary.csv': diary } }), { now: NOW });
  assert.equal(s.entries, 6);
  assert.ok(!store.library.entries['v:1000000010']);
  assert.ok(store.library.entries[`e:${entryCodeFromViewingId(1000000010)}`]);
  assert.ok(store.library.entries['v:1000000011']);
  assert.equal(Object.keys(store.library.entries).length, 7);
});

// ---------- the real data ----------

/** Rebuild the real export without its newest `n` diary entries (and their reviews). Returns the zip and the dropped entry codes. */
function exportWithoutNewest(n) {
  const files = unzipSync(fs.readFileSync(REAL_ZIP));
  const toCsv = rows => rows.map(r => r.map(c => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
  const diary = parseCsvRows(strFromU8(files['diary.csv']));
  const last = diary.slice(1).map((r, i) => ({ r, i })).sort((a, b) => b.r[7].localeCompare(a.r[7]) || b.i - a.i).slice(0, n);
  const dropped = new Set(last.map(({ r }) => r[3]));
  const reviews = parseCsvRows(strFromU8(files['reviews.csv']));
  files['diary.csv'] = strToU8(toCsv(diary.filter((r, i) => i === 0 || !dropped.has(r[3]))));
  files['reviews.csv'] = strToU8(toCsv(reviews.filter((r, i) => i === 0 || !dropped.has(r[3]))));
  return { zip: zipSync(files), codes: [...dropped].map(u => u.split('/').pop()) };
}

test('real data: every feed item that is also in the export matches it by id', { skip: !hasReal && 'private fixtures not present' }, async () => {
  const xml = fs.readFileSync(REAL_RSS, 'utf8');
  const items = parseRss(xml);
  assert.ok(items.length > 0);
  const store = tmpStore();
  importExport(store, fs.readFileSync(REAL_ZIP), { now: NOW });
  const exportCodes = new Set(Object.keys(store.library.entries).map(id => id.slice(2)));
  const dates = Object.values(store.library.entries).map(e => e.date).sort();
  const lastExported = dates.at(-1);

  // Every feed item whose date is inside the export's range is found by decoding its viewing id.
  const inside = items.filter(i => (i.date || '') <= lastExported);
  assert.ok(inside.length > 0);
  for (const i of inside) assert.ok(exportCodes.has(entryCodeFromViewingId(i.viewingId)), `viewing ${i.viewingId} (${i.title}, ${i.date}) not found by id`);

  const entriesBefore = Object.keys(store.library.entries).length;
  const r = await refreshFromRss(store, fakeHttp({ 'https://letterboxd.com/real_user/rss/': { text: xml } }), 'real_user', { now: NOW });
  assert.deepEqual(r, { added: items.length - inside.length, updated: 0 });
  assert.equal(Object.keys(store.library.entries).length, entriesBefore + r.added);
  // Posters and TMDB ids arrive for every film in the feed.
  for (const i of items) {
    const f = Object.values(store.films).find(x => x.slug === i.slug);
    assert.ok(f, `film for ${i.slug}`);
    assert.ok(f.src.rss.poster?.url || !i.poster);
    if (i.tmdbId) assert.equal(f.ids.tmdb, i.tmdbId);
  }
});

test('real data: an older export plus the feed, then the full export, ends with no duplicates', { skip: !hasReal && 'private fixtures not present' }, async () => {
  const xml = fs.readFileSync(REAL_RSS, 'utf8');
  const items = parseRss(xml);
  const { zip, codes } = exportWithoutNewest(5);
  const missingIds = new Set(codes.map(viewingIdFromEntryCode));
  assert.ok(!missingIds.has(null));

  const store = tmpStore();
  importExport(store, zip, { now: NOW });
  const full = importExport(tmpStore(), fs.readFileSync(REAL_ZIP), { now: NOW });
  const r = await refreshFromRss(store, fakeHttp({ 'https://letterboxd.com/real_user/rss/': { text: xml } }), 'real_user', { now: NOW });
  assert.equal(r.added, items.filter(i => missingIds.has(i.viewingId)).length);
  assert.ok(r.added > 0);
  assert.ok(Object.keys(store.library.entries).every(id => id.startsWith('e:') || missingIds.has(Number(id.slice(2)))));

  const s = importExport(store, fs.readFileSync(REAL_ZIP), { now: NOW });
  assert.equal(s.entries, full.entries);
  assert.equal(Object.keys(store.library.entries).length, full.entries);
  assert.ok(Object.values(store.library.entries).every(e => e.source === 'export'));
});

test('a feed with zero items is fine', async () => {
  const store = tmpStore();
  assert.deepEqual(await refreshFromRss(store, serve('<?xml version="1.0"?><rss version="2.0"><channel><title>Letterboxd - Sam</title></channel></rss>'), 'synth_user'), { added: 0, updated: 0 });
});
