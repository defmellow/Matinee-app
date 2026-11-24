import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import { enrich } from '../../core/enrich.js';

const film = k => ({ key: k, title: k, year: 2000, ids: {}, src: {}, checked: {}, missed: {} });
const mk = (id, ms = 1) => ({ id, label: id, async enrich(films, ctx) { for (const f of films) { await new Promise(r => setTimeout(r, ms)); ctx.done(f, { x: 1 }); } } });

test('every source announces its total up front, so combined progress never goes backwards', async () => {
  const store = { library: { settings: {}, films: {} }, films: { a: film('a'), b: film('b'), c: film('c') }, touch() {}, flush() {} };
  const events = [];
  await enrich({ store, http: {}, providers: [mk('boxd'), mk('wikidata'), mk('rt')], emit: (e, p) => { if (e === 'progress') events.push(p); } });
  assert.deepEqual(events.slice(0, 3).map(e => [e.provider, e.done, e.total]), [['boxd', 0, 3], ['wikidata', 0, 3], ['rt', 0, 3]]);
});

function core(providers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-core-'));
  const events = [];
  const c = createCore({ dataDir: dir, providers, onEvent: (e, p) => events.push([e, p]), fetch: async () => new Response('') });
  for (const k of ['a', 'b', 'c', 'd']) c.store.films[k] = film(k);
  return { c, events };
}

test('combined percent never decreases and done never exceeds total', async () => {
  const { c, events } = core([mk('boxd'), mk('wikidata'), mk('tmdb')]);
  c.store.library.settings.keys = { tmdb: 'k' };
  c.store.library.settings.region = 'AU';
  c.call('refresh');
  await new Promise(r => setTimeout(r, 300));
  const seq = events.filter(([e, p]) => e === 'progress' && p.phase === 'provider').map(([, p]) => { assert.ok(p.done <= p.total); return p.done / p.total; });
  assert.ok(seq.length > 3);
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] >= seq[i - 1] - 1e-9, `step ${i}: ${seq.slice(0, i + 1)}`);
  c.close();
});

test('cancel does not restart a run queued by a new key; a save failure still reaches progress done', async () => {
  let runs = 0;
  const slow = { id: 'rt', label: 'rt', async enrich(films, ctx) { runs++; for (const f of films) { if (ctx.signal.aborted) return; await new Promise(r => setTimeout(r, 30)); ctx.done(f, { x: 1 }); } } };
  const { c, events } = core([slow]);
  c.call('refresh');
  await c.call('setSettings', { keys: { tmdb: 'abcd' } }); // a run is going, so a rerun is queued
  await c.call('cancel');
  await new Promise(r => setTimeout(r, 150));
  assert.equal(runs, 1);
  assert.equal(c.call && (await c.call('getState')).job, null);

  // failing save in the job's finally
  const real = c.store.flush; c.store.flush = () => { throw new Error('locked'); };
  const before = events.length;
  c.call('refresh');
  await new Promise(r => setTimeout(r, 300));
  c.store.flush = real;
  assert.ok(events.slice(before).some(([e, p]) => e === 'progress' && p.phase === 'done'));
  c.close();
});

test('backup file leaves out API keys', async () => {
  const { c } = core([]);
  c.store.library.settings.keys = { tmdb: 'SECRETKEY123', omdb: 'OTHERSECRET' };
  c.store.library.settings.keyStatus = { tmdb: { state: 'ok' } };
  c.store.library.settings.region = 'AU';
  const { json } = await c.call('exportBackup');
  assert.ok(!json.includes('SECRETKEY123') && !json.includes('OTHERSECRET'));
  assert.equal(JSON.parse(json).library.settings.region, 'AU');
  assert.ok(c.store.library.settings.keys.tmdb, 'live settings untouched');
  c.close();
});
