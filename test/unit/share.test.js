// The data export holds the library and never a key or secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { shareFiles, shareEntries, libraryView, scrub, filledCounts } from '../../core/share.js';
import { readZip, zipChunks } from '../../core/zip.js';
import { createCore } from '../../core/api.js';

const library = () => ({
  user: { username: 'someone', name: 'Some One' },
  films: { 'lid:a': { watched: true, rating: 8, liked: true, watchlist: false, tags: ['cosy'], note: 'my note', posterPick: 'lbpage' }, 'lid:b': { watchlist: true } },
  entries: { e1: { id: 'e1', key: 'lid:a', date: '2024-01-02', rating: 8, rewatch: false, review: 'good' }, e2: { id: 'e2', key: 'lid:a', date: '2024-05-01', rating: 9, rewatch: true } },
  settings: { theme: 'dark', region: 'AU', keys: { tmdb: 'SECRET-TMDB', omdb: 'SECRET-OMDB' }, updaterToken: 'SECRET-UPDATER' },
});
const films = () => ({
  'lid:a': { key: 'lid:a', title: 'A', year: 2000, ids: { imdb: 'tt1' }, src: { imdb: { ratings: {} }, rt: null }, checked: { imdb: 'x' }, missed: {}, failed: { rt: { at: 1, n: 2 } }, token: 'SECRET-TOKEN', extra: { apiKey: 'SECRET-NESTED' } },
  'lid:b': { key: 'lid:b', title: 'B', year: 2001, src: {} },
});

const parse = f => f.split('\n').filter(Boolean).map(l => JSON.parse(l));

test('export holds the full records, library, feel profile, whole log and test report', () => {
  const feelOf = k => (k === 'lid:a' ? { profile: { descriptors: [{ id: 'd', label: 'Warm', facet: 'mood', score: 0.5, voices: ['viewers'] }], themes: [{ id: 't', label: 'Grief', centrality: 0.7, tier: 'about', why: 'reviews' }], settings: [] }, summary: { headline: 'Warm' } } : null);
  const log = Array.from({ length: 3500 }, (_, i) => 'line ' + i).join('\n');
  const files = shareFiles({ library: library(), films: films(), feelOf, fetchLog: log, lastTest: { text: 'report', startedAt: 't' }, appVersion: '0.10', now: new Date('2026-10-29T00:00:00Z') });
  assert.deepEqual(Object.keys(files), ['header.json', 'library.json', 'films.ndjson', 'fetch-log.txt', 'test-fetch.txt']);
  const h = JSON.parse(files['header.json']);
  assert.equal(h.counts.films, 2); assert.equal(h.counts.watched, 1); assert.equal(h.counts.watchlist, 1);
  assert.deepEqual(h.settings, { theme: 'dark', region: 'AU' });
  assert.deepEqual(h.filled, { imdb: 1 });
  assert.equal(files['fetch-log.txt'], log); assert.equal(files['test-fetch.txt'], 'report');
  const lib = JSON.parse(files['library.json']);
  assert.equal(lib.films['lid:a'].rating, 8); assert.deepEqual(lib.films['lid:a'].tags, ['cosy']); assert.equal(Object.keys(lib.entries).length, 2);
  const [a, b] = parse(files['films.ndjson']);
  assert.equal(a.f.failed.rt.n, 2); assert.equal(a.f.src.imdb.ratings !== undefined, true);
  assert.equal(a.p.d[0][1], 'Warm'); assert.equal(a.p.t[0][3], 'about');
  assert.equal(b.p, undefined);
  assert.equal(files['films.ndjson'].trim().split('\n').length, 2);
});

test('the export never contains a key, token or secret, or account details', () => {
  const text = Object.values(shareFiles({ library: library(), films: films(), fetchLog: 'ok', lastTest: null })).join('\n');
  assert.ok(!text.includes('SECRET'), 'a secret leaked into the export');
  assert.ok(!text.includes('someone') && !text.includes('Some One'), 'account details leaked');
});

test('zip then load gives back the same films, library and files', async () => {
  const fl = films();
  fl['lid:a'].src.wikidata = { label: 'Ünï', nested: { list: [1, 2, { x: null }] }, text: 'long text '.repeat(500) };
  const input = { library: library(), films: fl, fetchLog: 'a\nb', lastTest: { text: 'r', startedAt: 't' } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-'));
  const chunks = []; for await (const c of zipChunks(shareEntries(input))) chunks.push(c);
  fs.writeFileSync(path.join(dir, 'x.zip'), Buffer.concat(chunks));
  const r = spawnSync('node', ['scripts/load-share.mjs', path.join(dir, 'x.zip'), path.join(dir, 'out')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out/films.json'), 'utf8')), scrub(fl));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'out/library.json'), 'utf8')), libraryView(input.library));
  assert.equal(fs.readFileSync(path.join(dir, 'out/fetch-log.txt'), 'utf8'), 'a\nb');
});

test('scrub and filledCounts', () => {
  assert.deepEqual(scrub({ a: 1, Keys: { x: 1 }, n: [{ token: 't', ok: 2 }] }), { a: 1, n: [{ ok: 2 }] });
  assert.deepEqual(filledCounts({ x: { src: { a: {}, b: null } } }), { a: 1 });
});

test('core exportShare writes the file, keeps keys out, and falls back to the data folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-'));
  const core = createCore({ dataDir: dir, fetch: async () => { throw new Error('offline'); }, onEvent: () => {} });
  const r = await core.call('exportShare', { dir: path.join(dir, 'docs'), appVersion: '0.1' });
  assert.equal(path.basename(r.path), 'matinee-share.zip');
  assert.equal(path.dirname(r.path), path.join(dir, 'docs'));
  assert.equal(fs.statSync(r.path).size, r.bytes);
  assert.equal(JSON.parse(readZip(fs.readFileSync(r.path)).get('header.json')).version, 2);
  const bad = path.join(dir, 'not-a-folder'); fs.writeFileSync(bad, 'x'); // a file, not a folder: unusable
  const r2 = await core.call('exportShare', { dir: path.join(bad, 'sub') });
  assert.equal(path.dirname(r2.path), dir);
  await core.close?.();
});
