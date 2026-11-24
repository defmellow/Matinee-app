import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore, SCHEMA } from '../../core/store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-store-'));
const fast = { retryDelays: [1, 1, 1], rearmDelays: [20, 20], debounce: 10 };
const lib = extra => JSON.stringify({ schema: SCHEMA, films: { a: { tags: ['x'] } }, ...extra });
const names = dir => fs.readdirSync(dir).sort();

// Synthetic fixtures only.
test('a transient read error is retried, then succeeds', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'library.json'), lib());
  const real = fs.readFileSync; let failed = 0;
  fs.readFileSync = (f, ...a) => { if (String(f).endsWith('library.json') && failed++ < 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return real(f, ...a); };
  try { assert.deepEqual(createStore(dir, fast).library.films, { a: { tags: ['x'] } }); } finally { fs.readFileSync = real; }
});

test('a read that keeps failing throws instead of starting empty, and touches nothing', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'library.json'), lib()); fs.writeFileSync(path.join(dir, 'films.json'), '{"k":{}}');
  const real = fs.readFileSync;
  fs.readFileSync = (f, ...a) => { if (String(f).endsWith('library.json')) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return real(f, ...a); };
  try { assert.throws(() => createStore(dir, fast), /busy/); } finally { fs.readFileSync = real; }
  assert.deepEqual(names(dir), ['films.json', 'library.json']);
});

test('truncated library.json: kept aside once, films.json still loads, .bak is used', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), '{"schema": 2, "fil');
  fs.writeFileSync(path.join(dir, 'library.json.bak'), lib());
  fs.writeFileSync(path.join(dir, 'films.json'), '{"k":{"title":"K"}}');
  const s = createStore(dir, fast);
  assert.deepEqual(s.films, { k: { title: 'K' } });
  assert.deepEqual(s.library.films, { a: { tags: ['x'] } }, 'restored from .bak');
  assert.equal(names(dir).filter(n => n.includes('.corrupt-')).length, 1);
  createStore(dir, fast); // a second launch must not pile up copies
  assert.ok(names(dir).filter(n => n.includes('.corrupt-')).length <= 1);
});

test('a library with another schema is backed up, not silently lost; films.json and cache.json still load', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ schema: 99, films: { z: {} } }));
  fs.writeFileSync(path.join(dir, 'films.json'), '{"k":{}}'); fs.writeFileSync(path.join(dir, 'cache.json'), '{"c":{"at":"2026-01-01","value":1}}');
  const s = createStore(dir, fast);
  assert.deepEqual(s.films, { k: {} }); assert.ok(s.cache.c);
  assert.deepEqual(s.library.films, {});
  assert.ok(fs.existsSync(path.join(dir, 'library.json.schema-99.bak')));
});

test('saves keep one previous copy and leave no temp file', () => {
  const dir = tmp(); const s = createStore(dir, fast);
  s.library.films.a = { n: 1 }; s.touch('library'); s.flush();
  s.library.films.a = { n: 2 }; s.touch('library'); s.flush();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'library.json'))).films.a.n, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'library.json.bak'))).films.a.n, 1);
  assert.ok(!names(dir).some(n => n.endsWith('.tmp')));
});

test('a failing write does not throw from the timer, stays dirty, and flush still saves the other files', async () => {
  const dir = tmp(); const s = createStore(dir, fast);
  const real = fs.openSync; let fail = true;
  fs.openSync = (f, ...a) => { if (fail && String(f).endsWith('films.json.tmp')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return real(f, ...a); };
  try {
    s.films.k = { t: 1 }; s.touch('films');
    await new Promise(r => setTimeout(r, 40)); // timer fires and fails; must not crash the process
    assert.match(String(s.lastError), /disk full/);
    s.library.films.a = {}; s.touch('library');
    assert.throws(() => s.flush(), /disk full/);
    assert.ok(fs.existsSync(path.join(dir, 'library.json')), 'library written despite films failing');
    fail = false;
    await new Promise(r => setTimeout(r, 60)); // re-armed timer succeeds
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'films.json'))), { k: { t: 1 } });
  } finally { fs.openSync = real; }
});

test('rename is retried when the file is busy', () => {
  const dir = tmp(); const s = createStore(dir, fast);
  const real = fs.renameSync; let n = 0;
  fs.renameSync = (a, b) => { if (String(b).endsWith('films.json') && n++ < 2) throw Object.assign(new Error('perm'), { code: 'EPERM' }); return real(a, b); };
  try { s.films.k = {}; s.touch('films'); s.flush(); } finally { fs.renameSync = real; }
  assert.ok(fs.existsSync(path.join(dir, 'films.json')));
});

test('a constantly touched file is still written within the max wait', async () => {
  const dir = tmp(); const s = createStore(dir, { ...fast, debounce: 60, maxWait: 150 });
  const end = Date.now() + 400;
  while (Date.now() < end) { s.touch('films'); await new Promise(r => setTimeout(r, 20)); }
  assert.ok(fs.existsSync(path.join(dir, 'films.json')), 'written before the touching stopped');
  s.flush();
});
