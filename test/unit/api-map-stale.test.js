// The Map opens on its saved layout even when film data changed, then a fresh one arrives once, announced by a 'map' event.
// SYNTHETIC films.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const exportZip = () => zipSync({
  'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'testuser', 'Tess', '', '', '', '', '', '', '']])),
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ...['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((n, i) => ['2024-02-0' + (i + 1), n + ' Film', String(1990 + i), 'https://boxd.it/a' + i])])),
  'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Zeta Film', '2010', 'https://boxd.it/z']])),
});
const fake404 = async () => new Response('not found', { status: 404 });
const waitFor = async (pred, ms = 8000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); } };

test('a changed film is not waited for: saved layout at once, fresh one later, one recompute', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-mapstale-'));
  const events = [];
  let core;
  try {
    core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
    await core.call('importExport', { bytes: exportZip() });
    const first = await core.call('getMap');
    assert.equal(first.stale, undefined, 'the first layout is worked out fresh');
    assert.equal(first.nodes.length, 6);
    core.close();

    // "a fetch landed": one film's data changed, so the saved layout no longer matches its fingerprint
    const filmsFile = path.join(dir, 'films.json');
    const films = JSON.parse(fs.readFileSync(filmsFile, 'utf8'));
    const holder = films.films || films;
    const firstKey = Object.keys(holder)[0];
    holder[firstKey].checked = { ...(holder[firstKey].checked || {}), tmdb: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(filmsFile, JSON.stringify(films));

    core = createCore({ dataDir: dir, fetch: fake404, onEvent: (e, p) => { if (e === 'map') events.push(p); } });
    const slow = await core.call('getMap'); // stale: no waiting for the recompute
    assert.equal(slow.stale, true);
    assert.deepEqual(slow.nodes, first.nodes, 'exactly what was saved');
    const again = await core.call('getMap'); // a second request while it works
    assert.equal(again.stale, true);
    await waitFor(() => events.length >= 1);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(events, [{ lens: 'feel' }], 'announced once, for the lens that was asked for');
    const fresh = await core.call('getMap');
    assert.equal(fresh.stale, undefined);
    assert.equal(fresh.nodes.length, 6);
    assert.deepEqual(fresh.nodes.map(n => n.key), first.nodes.map(n => n.key));
    // aligned with the layout it replaces: same films stay close to where they were (a flip or turn would move them far)
    const moved = fresh.nodes.map((n, i) => Math.hypot(n.x - first.nodes[i].x, n.y - first.nodes[i].y));
    assert.ok(Math.max(...moved) < 0.35, 'no flip: ' + moved.map(m => m.toFixed(2)).join(' '));
  } finally { if (core) core.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('when films were added or removed the map is worked out fresh, not shown stale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-mapstale-'));
  let core;
  try {
    core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
    await core.call('importExport', { bytes: exportZip() });
    await core.call('getMap');
    core.close();
    const cacheFile = path.join(dir, 'cache.json');
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const holder = cache.cache || cache;
    const saved = holder['map:layout:feel'].value.value;
    saved.nodes = saved.nodes.slice(1); // the saved layout has one film fewer than the library...
    holder['map:layout:feel'].value.fp = 'older data'; // ...and was made from older data
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
    const m = await core.call('getMap');
    assert.equal(m.stale, undefined);
    assert.equal(m.nodes.length, 6);
  } finally { if (core) core.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
