import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';

// Closing the app mid-fetch and reopening it soon after must carry on with the films still waiting (it used to wait an hour,
// because checking Letterboxd at the start of a run already counts as "the last refresh").
function coreWith(sync) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-resume-'));
  const p = { id: 'slowsite', label: 'Slow site', async enrich(films, ctx) { await new Promise(r => setTimeout(r, 5)); for (const f of films) ctx.fail(f, new Error('offline')); } };
  const core = createCore({ dataDir: dir, providers: [p] });
  core.store.films.f0 = { key: 'f0', title: 'Film 0', year: 2000, ids: {}, src: {}, checked: {} };
  core.store.library.sync = { ...(core.store.library.sync || {}), ...sync };
  return core;
}
const ago = min => new Date(Date.now() - min * 60_000).toISOString();

test('a run cut short a few minutes ago starts again at launch', async () => {
  const core = coreWith({ lastRefresh: ago(5), refreshStarted: ago(5) });
  const r = await core.call('autoRefresh');
  assert.notEqual(r.started, false);
  core.close();
});

test('a run that finished a few minutes ago does not start again (the hourly limit still holds)', async () => {
  const core = coreWith({ lastRefresh: ago(5), refreshStarted: ago(6), refreshDone: ago(5) });
  const r = await core.call('autoRefresh');
  assert.equal(r.started, false);
  core.close();
});

test('a library from before these marks keeps the old rule', async () => {
  const core = coreWith({ lastRefresh: ago(5) });
  const r = await core.call('autoRefresh');
  assert.equal(r.started, false);
  core.close();
});
