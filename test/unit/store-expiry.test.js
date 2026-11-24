import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';

const DAY = 86400000;
test('old per-person and series lookups are dropped on load; other cache entries stay', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-expiry-'));
  const ago = d => new Date(Date.now() - d * DAY).toISOString();
  fs.writeFileSync(path.join(dir, 'cache.json'), JSON.stringify({
    'personfilms:director/old': { at: ago(20), value: 1 },   // 7-day lookup, 20 days old: dropped
    'personfilms:director/new': { at: ago(3), value: 2 },
    'filmography:Q1': { at: ago(70), value: 3 },             // 30-day lookup, 70 days old: dropped
    'filmography:Q2': { at: ago(40), value: 4 },             // past its use but not twice: kept
    'discover': { at: ago(400), value: 5 },                  // not a per-person entry: never dropped here
  }));
  const store = createStore(dir, { debounce: 0, maxWait: 0 });
  assert.deepEqual(Object.keys(store.cache).sort(), ['discover', 'filmography:Q2', 'personfilms:director/new']);
});
