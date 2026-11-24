// API key flow in core/api.js: save -> validate -> run, status on each key row, rejected/limit surfacing. Fake providers, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import tmdb from '../../core/providers/tmdb.js';
import omdb from '../../core/providers/omdb.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };
const SECRET = 'abcd1234secretWXYZ';

function fake({ validate = async () => ({ ok: true, message: 'That key works.' }), enrich } = {}) {
  return {
    id: 'kp', label: 'KP', needsKey: true, adds: 'Adds things.', since: '2020-01-01',
    enabled: s => !!s?.keys?.kp, validateKey: validate,
    async enrich(films, ctx) { if (enrich) return enrich(films, ctx); for (const f of films) ctx.done(f, { synopsis: 'x' }); },
  };
}
function setup(p, n = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-keys-'));
  const core = createCore({ dataDir: dir, providers: [p] });
  for (let i = 0; i < n; i++) { const k = 'f' + i; core.store.films[k] = { key: k, title: 'Film ' + i, year: 2000 + i, src: {} }; core.store.library.films[k] = { watchlist: true, tags: [] }; }
  const row = () => core.call('getState').then(s => s.providers.find(x => x.id === p.id));
  const idle = async () => { await sleep(10); await until(async () => true); let s; do { s = await core.call('getState'); await sleep(10); } while (s.job); };
  return { core, row, idle };
}

test('saving a key enables the source and fills pending films without a restart (1)(6)', async () => {
  const { core, row } = setup(fake());
  const r = await core.call('setSettings', { keys: { kp: SECRET } });
  assert.equal(r.ok, true);
  await until(() => core.store.films.f2.src.kp);
  const p = await row();
  assert.equal(p.filled, 3);
  assert.equal(p.key.state, 'ok');
});

test('films checked before the key was added are re-run once (6)', async () => {
  const { core } = setup(fake());
  core.store.films.f0.checked = { kp: '2019-01-01T00:00:00.000Z' };
  core.store.films.f0.missed = { kp: '2019-01-01T00:00:00.000Z' };
  await core.call('setSettings', { keys: { kp: SECRET } });
  await until(() => core.store.films.f0.src.kp);
  assert.ok(Date.parse(core.store.films.f0.checked.kp) > Date.parse('2020-01-01'));
});

test('a key the source refuses is not saved, and the message is passed on (2)', async () => {
  const { core, row } = setup(fake({ validate: async () => ({ ok: false, message: "KP didn't accept that key." }) }));
  const r = await core.call('setSettings', { keys: { kp: SECRET } });
  assert.deepEqual(r, { ok: false, message: "KP didn't accept that key." });
  assert.equal((await row()).hasKey, false);
});

test('the key itself never reaches the UI, only the last four characters (4)', async () => {
  const { core, row } = setup(fake());
  await core.call('setSettings', { keys: { kp: SECRET } });
  const state = await core.call('getState');
  assert.equal(JSON.stringify(state).includes(SECRET), false);
  assert.equal(state.settings.keys.kp, '••••WXYZ');
  assert.equal((await row()).key.hint, '••••WXYZ');
  assert.ok((await row()).key.testedAt);
});

test('every source row says what it adds (5)', async () => {
  assert.match(tmdb.adds, /TMDB rating/);
  assert.match(omdb.adds, /Rotten Tomatoes/);
  const { core, row } = setup(fake());
  assert.equal((await row()).adds, 'Adds things.');
});

test('a source that answers 401 for every film shows Key rejected, not a silent zero (7)', async () => {
  const p = fake({ enrich: async () => { throw new Error('Your KP key stopped working: KP no longer accepts it.'); } });
  const { core, row } = setup(p);
  await core.call('setSettings', { keys: { kp: SECRET } });
  await until(async () => true);
  await sleep(100);
  const r = await row();
  assert.equal(r.filled, 0);
  assert.equal(r.key.state, 'rejected');
  assert.match(r.key.lastError, /key rejected/i);
});

test('rate limits and failed lookups show as the last error; a clean run clears it (3)', async () => {
  let mode = 'limit';
  const p = fake({ enrich: async (films, ctx) => {
    if (mode === 'limit') { ctx.log("KP's free daily limit has been reached."); return; }
    if (mode === 'fail') { for (const f of films) ctx.fail(f, new Error('HTTP 500')); return; }
    for (const f of films) ctx.done(f, { synopsis: 'x' });
  } });
  const { core, row } = setup(p);
  await core.call('setSettings', { keys: { kp: SECRET } });
  await sleep(100);
  assert.match((await row()).key.lastError, /limit/);
  mode = 'fail';
  await core.call('refresh'); await sleep(100);
  assert.match((await row()).key.lastError, /3 lookups didn't go through/);
  mode = 'ok';
  await core.call('refresh'); await sleep(100);
  assert.equal((await row()).key.lastError, null);
  assert.equal((await row()).filled, 3);
});

test('Test again re-checks the saved key, records the time, and restarts work if it had been rejected (3)', async () => {
  let ok = true;
  const p = fake({ validate: async () => (ok ? { ok: true, message: 'That key works.' } : { ok: false, message: "KP didn't accept that key." }) });
  const { core, row, idle } = setup(p);
  await core.call('setSettings', { keys: { kp: SECRET } });
  await until(() => core.store.films.f2.src.kp);
  await idle();
  ok = false;
  const bad = await core.call('retestKey', { provider: 'kp' });
  assert.equal(bad.ok, false);
  assert.equal((await row()).key.state, 'rejected');
  ok = true;
  for (const f of Object.values(core.store.films)) { delete f.src.kp; }
  const good = await core.call('retestKey', { provider: 'kp' });
  assert.equal(good.ok, true);
  await until(() => core.store.films.f2.src.kp);
  assert.equal((await row()).key.state, 'ok');
});

test('Test again with no saved key says so', async () => {
  const { core } = setup(fake());
  assert.equal((await core.call('retestKey', { provider: 'kp' })).ok, false);
});

test('saving a key while a run is going queues a fresh run afterwards (1)', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const p = fake({ enrich: async (films, ctx) => { if (!ctx.settings.keys.kp) return; await gate; for (const f of films) ctx.done(f, { synopsis: 'x' }); } });
  const { core } = setup(p);
  core.store.library.settings.keys.kp = 'first';
  core.call('refresh');
  await sleep(20);
  const r = await core.call('setSettings', { keys: { kp: SECRET } });
  assert.equal(r.ok, true);
  release();
  await until(() => core.store.films.f2.src.kp);
});

test('removing a key clears its status', async () => {
  const { core, row } = setup(fake());
  await core.call('setSettings', { keys: { kp: SECRET } });
  await core.call('setSettings', { keys: { kp: '' } });
  const p = await row();
  assert.equal(p.hasKey, false);
  assert.equal(p.key, null);
});
