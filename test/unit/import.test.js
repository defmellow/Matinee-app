import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createStore } from '../../core/store.js';
import { importExport } from '../../core/import/export.js';
import { parseCsv, parseCsvRows, parseListCsv, parseExportZip, entryCodeFromViewingId, viewingIdFromEntryCode, NOT_AN_EXPORT } from '../../core/parse/export.js';
import { userFilm, entriesFor } from '../../core/library.js';
import { makeExport, FILES, CODE, VIEWING, lines } from '../fixtures/synthetic/export.js';

const REAL = new URL('../fixtures/private/export.zip', import.meta.url);
const hasReal = fs.existsSync(REAL);
const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-import-')), { debounce: 5 });
const AT = '2026-03-04T05:06:07.000Z';

// ---------- CSV ----------

test('parseCsv: quotes, commas, doubled quotes and embedded newlines', () => {
  const rows = parseCsv('Name,Review\r\n"Hello, ""world""","line one\r\nline two"\r\nplain,text\r\n');
  assert.deepEqual(rows, [{ Name: 'Hello, "world"', Review: 'line one\nline two' }, { Name: 'plain', Review: 'text' }]);
});

test('parseCsv: BOM, blank lines, missing final newline, short rows, trimmed headers', () => {
  const rows = parseCsv('﻿ Name , Year \n\nA,1999\nB\nC,2001');
  assert.deepEqual(rows, [{ Name: 'A', Year: '1999' }, { Name: 'B', Year: '' }, { Name: 'C', Year: '2001' }]);
});

test('parseCsv: empty input, header only, and quotes in the middle of a field', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('A,B\n'), []);
  assert.deepEqual(parseCsv('A,B\n5" pipe,x'), [{ A: '5" pipe', B: 'x' }]);
  assert.deepEqual(parseCsv('A,B\n"",x'), [{ A: '', B: 'x' }]);
});

test('parseCsvRows keeps empty cells and drops blank lines', () => {
  assert.deepEqual(parseCsvRows('a,,c\n\n,\n'), [['a', '', 'c'], ['', '']]);
});

test('parseListCsv reads the metadata lines, then the table', () => {
  const l = parseListCsv(FILES['lists/my-favourites.csv'], 'fallback');
  assert.equal(l.name, 'My favourites');
  assert.equal(l.description, 'First line\nsecond line');
  assert.deepEqual(l.films.map(f => [f.position, f.name, f.year]), [[1, 'Synthetic Alpha', 2001], [2, 'Synthetic Fox', 1990]]);
  assert.equal(parseListCsv('Position,Name,Year,URL,Description\n1,X,2000,https://boxd.it/a,', 'slug').name, 'slug');
});

test('entry short codes are base-62 of viewing id × 10 + 1', () => {
  assert.equal(entryCodeFromViewingId(0), '1');
  assert.equal(viewingIdFromEntryCode(entryCodeFromViewingId(1529812941)), 1529812941);
  assert.equal(viewingIdFromEntryCode('2'), null);            // 2 = a film-type code, not a viewing
  assert.equal(viewingIdFromEntryCode('not-a-code!'), null);
  assert.equal(viewingIdFromEntryCode(null), null);
});

// ---------- the ZIP ----------

test('rejects files that are not Letterboxd exports, with a friendly message', () => {
  const notZip = new TextEncoder().encode('hello');
  const wrongZip = zipSync({ 'readme.txt': strToU8('hi'), 'photos/a.csv': strToU8('a,b\n1,2') });
  for (const bytes of [notZip, wrongZip, new Uint8Array(0)]) {
    assert.throws(() => importExport(tmpStore(), bytes), { message: NOT_AN_EXPORT });
  }
  assert.match(NOT_AN_EXPORT, /Settings → Data → Export your data/);
});

test('a failed import changes nothing', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  const snapshot = JSON.stringify([store.library, store.films]);
  assert.throws(() => importExport(store, new Uint8Array([1, 2, 3])), { message: NOT_AN_EXPORT });
  assert.equal(JSON.stringify([store.library, store.films]), snapshot);
});

test('finds the CSVs inside a wrapper folder and ignores deleted/ and orphaned/', () => {
  const inner = unzipSync(makeExport());
  const wrapped = zipSync(Object.fromEntries(Object.entries(inner).map(([n, b]) => [`letterboxd-synth-2025/${n}`, b])));
  const d = parseExportZip(wrapped);
  assert.equal(d.diary.length, 4);
  assert.ok(!d.diary.some(r => r.name === 'Synthetic Deleted'));
  assert.equal(d.reviews.length, 3);
});

// ---------- importing ----------

test('synthetic export: summary, user, films and flags', () => {
  const store = tmpStore();
  const s = importExport(store, makeExport(), { now: AT });
  const { newFilmKeys, ...counts } = s;
  assert.deepEqual(counts, {
    films: 8,            // alpha beta gamma untitled delta fox zeta + epsilon (made from the diary)
    watched: 4,          // alpha beta + epsilon (diary only) + zeta (review only)
    rated: 2, liked: 2, watchlist: 2,
    entries: 5,          // 4 diary rows + 1 review-only
    reviews: 3,
    lists: 1,
  });
  assert.equal(newFilmKeys.length, 8);
  assert.equal(store.library.sync.lastImport, AT);

  assert.deepEqual(store.library.user, {
    username: 'synth_user', name: 'Sam', joined: '2024-01-02', bio: 'Line one,\nline two "quoted"', location: 'Nowhere',
    favourites: ['lid:aaa'],       // the second favourite isn't a film we know about, so it's left out
  });

  const alpha = userFilm(store, 'lid:aaa');
  assert.deepEqual([alpha.watched, alpha.rating, alpha.liked, alpha.watchlist], [true, 7, true, false]);
  assert.equal(userFilm(store, 'lid:bbb').rating, 10);
  const gamma = userFilm(store, 'lid:ccc');
  assert.deepEqual([gamma.watched, gamma.watchlist, gamma.watchlistAddedAt], [false, true, '2025-01-02']);
  const delta = userFilm(store, 'lid:ddd');
  assert.deepEqual([delta.watched, delta.liked], [false, true]);       // liking doesn't mean watched
  assert.equal(store.films['lid:ccd'].year, null);                     // a film with no year is still a film
  assert.equal(store.films['lid:bbb'].title, 'Synthetic Beta, The "Sequel"');
  assert.equal(store.films['lid:aaa'].lid, 'aaa');
});

test('synthetic export: diary entries, review joins, review-only entries', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  const E = store.library.entries;
  assert.equal(Object.keys(E).length, 5);
  assert.ok(Object.values(E).every(e => e.source === 'export' && e.liked === false && e.spoiler === false));

  const first = E[`e:${CODE.alphaFirst}`];
  assert.deepEqual(
    { key: first.key, date: first.date, loggedAt: first.loggedAt, rating: first.rating, rewatch: first.rewatch, tags: first.tags, review: first.review },
    { key: 'lid:aaa', date: '2025-03-01', loggedAt: '2025-03-02', rating: 7, rewatch: false, tags: ['in cinema', 'friends'], review: null },
  );
  const rewatch = E[`e:${CODE.alphaRewatch}`];
  assert.deepEqual([rewatch.rewatch, rewatch.rating, rewatch.review], [true, 8, 'Better the second time.']);   // joined by title + year + date
  const beta = E[`e:${CODE.betaReview}`];
  assert.equal(beta.review, 'Great.\n\nSecond paragraph, with "quotes".');                                     // joined by entry link
  const eps = E[`e:${CODE.epsilon}`];
  assert.equal(eps.rating, null);
  assert.equal(store.films[eps.key].title, 'Synthetic Épsilon & Co');
  assert.ok(eps.key.startsWith('ty:'));                                                                       // film made from the diary row
  const zeta = E[`e:${CODE.zetaReview}`];
  assert.deepEqual([zeta.date, zeta.loggedAt, zeta.rating, zeta.review], ['2025-07-07', '2025-07-07', 4, 'Not for me.']);
  assert.equal(entriesFor(store, 'lid:aaa').length, 2);
  assert.equal(entriesFor(store, 'lid:aaa')[0].date, '2025-06-01');
});

test('synthetic export: Letterboxd tags go on the film and in the tag list', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  assert.deepEqual(store.library.tags, {
    'in cinema': { source: 'letterboxd', createdAt: AT },
    friends: { source: 'letterboxd', createdAt: AT },
  });
  assert.deepEqual(userFilm(store, 'lid:aaa').tags, ['in cinema', 'friends']);
  assert.deepEqual(userFilm(store, 'lid:bbb').tags, ['in cinema']);
});

test('synthetic export: lists keep their order and resolve to film keys', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  assert.deepEqual(store.library.lists['l:my-favourites'], {
    id: 'l:my-favourites', name: 'My favourites', description: 'First line\nsecond line', url: 'https://boxd.it/lst01', films: ['lid:aaa', 'lid:fff'], source: 'export',
  });
  assert.equal(store.films['lid:fff'].title, 'Synthetic Fox');
});

test('a film seen first by title gets its short id from a later row', () => {
  const store = tmpStore();
  // Same film already known from RSS (no short id): the export upgrades its key and keeps its data and entries.
  store.films['slug:synthetic-alpha'] = { key: 'slug:synthetic-alpha', lid: null, slug: 'synthetic-alpha', title: 'Synthetic Alpha', year: 2001, ids: { tmdb: 900001 }, src: { rss: { poster: { url: 'p' } } }, checked: {}, missed: {} };
  store.library.entries['v:5'] = { id: 'v:5', key: 'slug:synthetic-alpha', date: '2026-01-01', rating: 9, liked: true, rewatch: false, review: null, spoiler: false, tags: [], source: 'rss' };
  store.library.films['slug:synthetic-alpha'] = { watched: true, rating: 9, liked: true, watchlist: false, tags: [], note: 'my note' };
  const s = importExport(store, makeExport(), { now: AT });
  assert.ok(!store.films['slug:synthetic-alpha']);
  assert.equal(store.films['lid:aaa'].slug, 'synthetic-alpha');
  assert.deepEqual(store.films['lid:aaa'].src.rss, { poster: { url: 'p' } });
  assert.ok(!s.newFilmKeys.includes('lid:aaa'));
  assert.equal(store.library.entries['v:5'].key, 'lid:aaa');          // the kept RSS entry followed the film
  assert.equal(userFilm(store, 'lid:aaa').note, 'my note');
  assert.equal(userFilm(store, 'lid:aaa').rating, 9);                  // newer than the export's entries, so it wins
});

// ---------- re-importing ----------

test('re-import: the export replaces what it put in and keeps what Matinee made', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });

  // Things made inside Matinee
  store.library.tags.mine = { createdAt: 'x' };
  userFilm(store, 'lid:aaa').tags.push('mine');
  userFilm(store, 'lid:aaa').note = 'remember this';
  store.library.views.v1 = { id: 'v1', name: 'Short ones', query: {} };
  store.library.lists['l:mine'] = { id: 'l:mine', name: 'Mine', description: '', films: ['lid:aaa'], source: 'matinee' };

  // A smaller export: no watchlist, no likes, no ratings, only one diary row (no tags), no list.
  const smaller = makeExport({
    replace: {
      'watchlist.csv': lines('Date,Name,Year,Letterboxd URI'),
      'likes/films.csv': lines('Date,Name,Year,Letterboxd URI'),
      'ratings.csv': lines('Date,Name,Year,Letterboxd URI,Rating', '2024-01-03,Synthetic Alpha,2001,https://boxd.it/aaa,2'),
      'diary.csv': lines('Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date', `2025-06-01,Synthetic Alpha,2001,https://boxd.it/${CODE.alphaRewatch},4,Yes,,2025-06-01`),
      'reviews.csv': null, 'lists/my-favourites.csv': null,
    },
  });
  const s = importExport(store, smaller, { now: '2026-04-01T00:00:00.000Z' });

  assert.deepEqual([s.watched, s.rated, s.liked, s.watchlist, s.entries, s.reviews, s.lists], [2, 1, 0, 0, 1, 0, 0]);
  const alpha = userFilm(store, 'lid:aaa');
  assert.deepEqual([alpha.watched, alpha.rating, alpha.liked], [true, 4, false]);
  assert.deepEqual(alpha.tags, ['mine']);                                       // Letterboxd tags gone, personal tag kept
  assert.equal(alpha.note, 'remember this');
  const gamma = userFilm(store, 'lid:ccc');
  assert.deepEqual([gamma.watchlist, gamma.watchlistAddedAt], [false, undefined]);
  assert.equal(userFilm(store, 'lid:ddd').liked, false);
  assert.equal(userFilm(store, 'lid:bbb').rating, null);
  assert.deepEqual(Object.keys(store.library.entries), [`e:${CODE.alphaRewatch}`]);
  assert.deepEqual(Object.keys(store.library.tags), ['mine']);
  assert.deepEqual(Object.keys(store.library.lists), ['l:mine']);
  assert.deepEqual(Object.keys(store.library.views), ['v1']);
  assert.equal(store.library.sync.lastImport, '2026-04-01T00:00:00.000Z');
  assert.ok(store.films['lid:fff'], 'film records (and their enrichment) are never thrown away');
});

test('re-import: Letterboxd tags keep their original creation time', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  importExport(store, makeExport(), { now: '2027-01-01T00:00:00.000Z' });
  assert.equal(store.library.tags['in cinema'].createdAt, AT);
  assert.equal(Object.keys(store.library.entries).length, 5);
  assert.deepEqual(userFilm(store, 'lid:aaa').tags, ['in cinema', 'friends']);   // no duplicates
});

test('re-import: RSS entries stay unless the export has the same viewing', () => {
  const store = tmpStore();
  importExport(store, makeExport(), { now: AT });
  const rss = (id, key, date, extra = {}) => ({ id, key, date, rating: 5, liked: false, rewatch: false, review: null, spoiler: false, tags: [], source: 'rss', ...extra });
  const E = store.library.entries;
  E[`v:${VIEWING.alphaFirst}`] = rss(`v:${VIEWING.alphaFirst}`, 'lid:aaa', '2025-03-01');   // same viewing id as an export entry
  E['v:77'] = rss('v:77', 'lid:bbb', '2025-04-01');                                          // same film and day as an export entry
  E['v:78'] = rss('v:78', 'lid:bbb', '2026-05-05', { rating: 3, liked: true });              // genuinely new
  importExport(store, makeExport(), { now: AT });
  assert.ok(!E[`v:${VIEWING.alphaFirst}`] && !E['v:77']);
  assert.ok(E['v:78']);
  assert.equal(Object.keys(E).length, 6);
  const beta = userFilm(store, 'lid:bbb');
  assert.deepEqual([beta.rating, beta.liked, beta.watched], [3, true, true]);   // the newer RSS entry still speaks for the film
});

// ---------- the real export ----------

test('real export: counts match the CSV rows and every entry has a film', { skip: !hasReal && 'test/fixtures/private/export.zip not present' }, () => {
  const bytes = fs.readFileSync(REAL);
  const files = unzipSync(bytes);
  const rows = name => parseCsv(strFromU8(files[name]));
  const store = tmpStore();
  const s = importExport(store, bytes, { now: AT });

  assert.equal(s.watched, rows('watched.csv').length);
  assert.equal(s.rated, rows('ratings.csv').length);
  assert.equal(s.liked, rows('likes/films.csv').length);
  assert.equal(s.watchlist, rows('watchlist.csv').length);
  const diary = rows('diary.csv'), reviews = rows('reviews.csv');
  const diaryUris = new Set(diary.map(r => r['Letterboxd URI']));
  assert.equal(s.entries, diary.length + reviews.filter(r => !diaryUris.has(r['Letterboxd URI'])).length);
  assert.equal(s.reviews, reviews.length);
  assert.equal(s.lists, Object.keys(files).filter(n => /^lists\/.+\.csv$/.test(n)).length);

  const entries = Object.values(store.library.entries);
  assert.equal(entries.length, s.entries);
  for (const e of entries) {
    assert.ok(store.films[e.key], `entry ${e.id} has a film`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.rating == null || (Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 10));
  }
  for (const u of Object.values(store.library.films)) assert.ok(u.rating == null || (Number.isInteger(u.rating) && u.rating >= 1 && u.rating <= 10));
  // The short links in the diary are entry links; none of them became a film.
  assert.ok(Object.keys(store.films).every(k => k.startsWith('lid:') || k.startsWith('ty:')));
  for (const id of Object.keys(store.library.entries)) assert.notEqual(viewingIdFromEntryCode(id.slice(2)), null);
  for (const l of Object.values(store.library.lists)) assert.ok(l.films.length && l.films.every(k => store.films[k]));
  assert.ok(store.library.user.username);

  // Importing again changes nothing.
  const before = JSON.stringify([store.library.entries, store.library.films, store.library.lists]);
  importExport(store, bytes, { now: AT });
  assert.equal(JSON.stringify([store.library.entries, store.library.films, store.library.lists]), before);
});

test('a big library imports in reasonable time', () => {
  // 2,000 synthetic films. film lookups in core/library.js are linear scans, so this is quadratic today (≈3 s here);
  // the bound is loose on purpose and only catches a real blow-up.
  const n = 2000;
  const row = i => `Synthetic Film ${i},${1950 + (i % 70)},https://boxd.it/${(i + 100000).toString(36)}`;
  const body = Array.from({ length: n }, (_, i) => `2024-01-01,${row(i)}`);
  const bytes = makeExport({
    replace: {
      'watched.csv': lines('Date,Name,Year,Letterboxd URI', ...body),
      'ratings.csv': lines('Date,Name,Year,Letterboxd URI,Rating', ...body.map(l => `${l},3`)),
      'diary.csv': lines('Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date', ...body.slice(0, 1500).map((l, i) => `${l.replace(/,https.*$/, '')},https://boxd.it/e${i},3,,,2024-01-01`)),
      'reviews.csv': null,
    },
  });
  const store = tmpStore();
  const t0 = Date.now();
  const s = importExport(store, bytes, { now: AT });
  assert.equal(s.watched, n);
  assert.equal(s.entries, 1500);
  assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0}ms`);
});
