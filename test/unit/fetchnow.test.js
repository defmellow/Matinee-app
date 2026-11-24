// On-demand fetching (core/api.js fetchNow + ctx.skip in enrich.js). Fake providers and synthetic films only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };
const aborted = () => Object.assign(new Error('aborted'), { code: 'aborted' });

/** A fake provider with the given id. Each film waits on its own gate (or an abort) before it is recorded. */
function fake(id, rec) {
  return {
    id, label: id,
    async enrich(films, ctx) {
      for (const film of films) {
        if (ctx.skip(film)) continue;
        rec.calls.push(id + ':' + film.key);
        rec.signals.push(ctx.signal);
        await new Promise((res, rej) => {
          const open = () => res();
          rec.gates[film.key] = open;
          if (rec.auto) return res();
          ctx.signal?.addEventListener('abort', () => rej(aborted()));
        });
        ctx.done(film, { ok: 1 });
      }
    },
  };
}

function setup(ids, { auto = false, n = 30 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-fn-'));
  const rec = { calls: [], signals: [], gates: {}, auto };
  const events = [];
  const core = createCore({ dataDir: dir, providers: ids.map(id => fake(id, rec)), onEvent: (e, p) => events.push(e) });
  for (let i = 0; i < n; i++) { const k = 'f' + i; core.store.films[k] = { key: k, title: 'Film ' + i, year: 2000 + i }; }
  return { core, rec, events };
}

test('fetchNow runs outside the job slot, and skip stops duplicates with the background run', async () => {
  const { core, rec } = setup(['lbpage']);
  assert.equal((await core.call('refresh')).started, true);
  await until(() => rec.calls.includes('lbpage:f0')); // background run is busy with f0 (gated)
  assert.ok((await core.call('getState')).job, 'main job is running');

  const r = await core.call('fetchNow', { keys: ['f0', 'f5'] });
  assert.equal(r.queued, 2);
  await until(() => rec.calls.includes('lbpage:f5'));
  assert.equal(rec.calls.filter(c => c === 'lbpage:f0').length, 1, 'f0 is in flight in the background run, so on-demand skips it');
  rec.gates.f5(); // on-demand finishes f5
  await until(() => core.store.films.f5.checked?.lbpage);
  assert.ok((await core.call('getState')).job, 'main job still running');

  // Open every gate as the background run reaches it; f5 must not be fetched a second time.
  const t = Date.now();
  while ((await core.call('getState')).job && Date.now() - t < 3000) { for (const g of Object.values(rec.gates)) g(); await sleep(5); }
  assert.equal(rec.calls.filter(c => c === 'lbpage:f5').length, 1, 'f5 fetched once');
  assert.equal(rec.calls.filter(c => c === 'lbpage:f0').length, 1, 'f0 fetched once');
  core.close();
});

test('a new request for the same slot aborts the previous one', async () => {
  const { core, rec } = setup(['lbpage']);
  await core.call('fetchNow', { keys: ['f1'] });
  await until(() => rec.signals.length === 1);
  const first = rec.signals[0];
  assert.equal(first.aborted, false);
  await core.call('fetchNow', { keys: ['f2'] });
  assert.equal(first.aborted, true, 'previous visible-set fetch aborted');
  await until(() => rec.signals.length === 2);
  // The opened film has its own slot: it does not abort the visible set.
  await core.call('fetchNow', { keys: ['f3'], tier: 'full' });
  assert.equal(rec.signals[1].aborted, false);
  core.close();
});

test('stopping the main job aborts on-demand fetches', async () => {
  const { core, rec } = setup(['lbpage']);
  await core.call('fetchNow', { keys: ['f1'] });
  await until(() => rec.signals.length === 1);
  await core.call('cancel');
  assert.equal(rec.signals[0].aborted, true);
  core.close();
});

test('tiers pick providers; unknown keys are ignored; at most 24 keys; recent attempts are not repeated', async () => {
  const { core, rec } = setup(['wikipedia', 'rt'], { auto: true });
  assert.deepEqual(await core.call('fetchNow', { keys: ['nope'] }), { queued: 0 });
  const big = Array.from({ length: 30 }, (_, i) => 'f' + i);
  assert.equal((await core.call('fetchNow', { keys: big })).queued, 24);
  await until(() => rec.calls.length === 24);
  await sleep(30);
  assert.ok(rec.calls.every(c => c.startsWith('wikipedia:')), 'quick tier skips rt');

  assert.equal((await core.call('fetchNow', { keys: ['f30', 'f1'] })).queued, 0, 'f30 unknown, f1 just done');
  rec.calls.length = 0;
  assert.equal((await core.call('fetchNow', { keys: ['f25'], tier: 'full' })).queued, 1);
  await until(() => rec.calls.length === 2);
  assert.deepEqual(rec.calls.sort(), ['rt:f25', 'wikipedia:f25']);
  core.close();
});

test('on-demand fetches do not touch sync.problems', async () => {
  const { core } = setup(['lbpage'], { auto: true });
  core.store.library.sync.problems = [{ message: 'earlier' }];
  core.store.films.f1.checked = undefined;
  await core.call('fetchNow', { keys: ['f1'] });
  await sleep(30);
  assert.deepEqual(core.store.library.sync.problems, [{ message: 'earlier' }]);
  core.close();
});
