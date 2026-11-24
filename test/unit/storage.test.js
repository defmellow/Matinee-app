import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sizeOf, measureStorage, createStorageMeter } from '../../core/diagnostics/storage.js';

const put = (f, n) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(n)); };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-storage-'));
  const data = path.join(root, 'data');
  put(path.join(data, 'library.json'), 1000);
  put(path.join(data, 'films.json'), 2000);
  put(path.join(data, 'cache.json'), 300);
  put(path.join(data, 'films.json.bak'), 50);
  put(path.join(root, 'image-cache', 'a', 'x.jpg'), 4000);
  put(path.join(root, 'image-cache', 'y.jpg'), 100);
  put(path.join(root, 'matinee.log'), 20);
  put(path.join(root, 'matinee.log.old'), 10);
  put(path.join(root, 'window.json'), 999); // not counted
  put(path.join(root, 'Partitions', 'matinee-web', 'Cache', 'x'), 700);
  put(path.join(root, 'GPUCache', 'y'), 20);
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-local-')); // LOCALAPPDATA lives outside userData
  put(path.join(local, 'matinee-updater', 'pending', 'setup.exe'), 7000);
  put(path.join(local, 'other-updater', 'z'), 5);
  return { root, data, local };
}

test('measureStorage counts the installed app when given its folder or exe', async () => {
  const { root, data } = fixture();
  put(path.join(root, 'install', 'Matinee.exe'), 900);
  put(path.join(root, 'install', 'resources', 'app.asar'), 600);
  const r = await measureStorage({ dataDir: data, appDir: path.join(root, 'install'), env: {} });
  assert.equal(r.parts.find(p => p.id === 'app').bytes, 1500);
  const r2 = await measureStorage({ dataDir: data, appDir: path.join(root, 'install', 'Matinee.exe'), env: {} });
  assert.equal(r2.parts.find(p => p.id === 'app').bytes, 900);
});

test('sizeOf: files, folders, and a missing path', async () => {
  const { root, data } = fixture();
  assert.equal(await sizeOf(path.join(data, 'library.json')), 1000);
  assert.equal(await sizeOf(path.join(root, 'image-cache')), 4100);
  assert.equal(await sizeOf(path.join(root, 'nope')), 0);
});

test('measureStorage groups the known places', async () => {
  const { data, local } = fixture();
  const r = await measureStorage({ dataDir: data, env: { LOCALAPPDATA: local } });
  const by = Object.fromEntries(r.parts.map(p => [p.id, p.bytes]));
  assert.deepEqual(by, { app: 0, library: 3000, cache: 300, backups: 50, images: 4100, browser: 720, logs: 30, updates: 7000 });
  assert.equal(r.total, 15200);
});

test('measureStorage: nothing there gives zeros, not an error', async () => {
  const r = await measureStorage({ dataDir: path.join(os.tmpdir(), 'matinee-missing-xyz', 'data'), env: {} });
  assert.equal(r.total, 0);
  assert.ok(r.parts.every(p => p.bytes === 0));
});

test('createStorageMeter caches for the ttl', async () => {
  const { data } = fixture();
  let t = 0;
  const get = createStorageMeter({ dataDir: data, env: {}, ttlMs: 60_000, now: () => t });
  const a = await get();
  put(path.join(data, 'library.json'), 5000);
  assert.equal((await get()).total, a.total);
  t = 61_000;
  assert.notEqual((await get()).total, a.total);
});

import { formatBytes } from '../../ui/screens/settings/format.js';
test('formatBytes reads plainly', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(36 * 1024), '36 KB');
  assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  assert.equal(formatBytes(412 * 1024 * 1024), '412 MB');
  assert.equal(formatBytes(1.3 * 1024 ** 3), '1.3 GB');
});

test('clearCache removes only re-fetchable data, never library or films', async () => {
  const { root, data } = fixture();
  let cleared = 0;
  const { clearCache } = await import('../../core/diagnostics/storage.js');
  const r = await clearCache({ dataDir: data, clearLookups() { cleared++; } });
  assert.equal(cleared, 1);
  assert.equal(r.freed, 300 + 10 + 4100);
  assert.equal(fs.existsSync(path.join(data, 'library.json')), true);
  assert.equal(fs.existsSync(path.join(data, 'films.json')), true);
  assert.equal(fs.existsSync(path.join(data, 'films.json.bak')), true);
  assert.equal(fs.existsSync(path.join(root, 'matinee.log')), true);
  assert.equal(fs.existsSync(path.join(root, 'matinee.log.old')), false);
  assert.equal(fs.readdirSync(path.join(root, 'image-cache')).length, 0);
  assert.equal(fs.existsSync(path.join(root, 'window.json')), true);
});
