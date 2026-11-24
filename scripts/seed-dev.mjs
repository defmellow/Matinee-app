// Dev: build a realistic library in .cache/devdata from a Letterboxd export ZIP, with live enrichment.
//   NODE_USE_ENV_PROXY=1 node scripts/seed-dev.mjs [path/to/export.zip] [--fresh]
// Defaults to test/fixtures/private/export.zip. The data dir is gitignored. Re-running continues enrichment.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from '../core/api.js';
import { createPlaywrightFetcher } from '../dev/fetchers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const zip = args.find(a => !a.startsWith('--')) || path.join(root, 'test/fixtures/private/export.zip');
const dataDir = process.env.MATINEE_DATA || path.join(root, '.cache/devdata');
if (fresh) fs.rmSync(dataDir, { recursive: true, force: true });

// MATINEE_RENDER=playwright: pages that need a real browser (Letterboxd film pages, IMDb, AllMovie) load through Chromium.
const renderer = process.env.MATINEE_RENDER === 'playwright' ? await createPlaywrightFetcher() : null;

let last = '';
let done;
const finished = new Promise(r => { done = r; });
const core = createCore({
  dataDir,
  render: renderer ? (u, o) => renderer.render(u, o) : null,
  onEvent(event, p) {
    if (event === 'progress') {
      if (p.phase === 'done') { done(); return; }
      const line = `${p.label} ${p.done ?? ''}/${p.total ?? ''}`;
      if (line !== last && (!p.total || p.done % 20 === 0 || p.done === p.total)) console.log(new Date().toISOString().slice(11, 19), line);
      last = line;
    }
  },
});

const state = await core.call('getState');
if (!state.ready) {
  const summary = await core.call('importExport', { bytes: new Uint8Array(fs.readFileSync(zip)) });
  console.log('imported', summary);
} else {
  console.log('library exists; refreshing (full)');
  await core.call('refresh', { full: false });
}
await finished;
const s = await core.call('getState');
console.log('counts', s.counts, 'problems', (s.sync.problems || []).length);
for (const p of (s.sync.problems || []).slice(0, 8)) console.log(' -', p.provider || p.step, p.key || '', p.message);
core.close();
if (renderer) await renderer.close();
