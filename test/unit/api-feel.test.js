// Feel methods through core/api.js: they work (thinly) on a library with no text, and never throw or return NaN.
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
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa'], ['2024-02-02', 'Beta Film', '2005', 'https://boxd.it/bbb']])),
  'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
});
const fake404 = async () => new Response('not found', { status: 404 });

test('feel methods answer on a library with no text yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-feel-'));
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
  try {
    await core.call('importExport', { bytes: exportZip() });
    const films = (await core.call('getLibrary')).films;
    const key = films.find(f => f.title === 'Alpha Film').key;
    const feel = await core.call('getFeel', { key });
    assert.ok(feel.summary.thin, 'no viewer text → thin');
    const sim = await core.call('getFeelSimilar', { key, limit: 5 });
    assert.ok(Array.isArray(sim));
    for (const r of sim) assert.ok(Number.isFinite(r.score) && r.film);
    const facets = await core.call('getFeelFacets');
    assert.equal(facets.axes.length, 8);
    const found = await core.call('searchFeel', { text: 'quiet and lonely' });
    assert.ok(Array.isArray(found));
    await assert.rejects(core.call('shiftFeel', { key, axis: 'nope' }), /isn't available/);
    assert.equal(await core.call('getFeel', { key: 'missing' }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
