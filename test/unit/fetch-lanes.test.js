// Priority lanes in enrich() and fetchNow(). Fake providers, fake http and synthetic films only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrich } from '../../core/enrich.js';
import { createCore } from '../../core/api.js';

const OLD = '2020-01-01T00:00:00.000Z';
const mkStore = films => ({ library: { settings: {}, films: {} }, films, touch() {}, flush() {} });
const film = (key, extra = {}) => ({ key, title: key, year: 1990, ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };
/** A fake http whose withPriority(n) hands back an object tagged with n. */
const fakeHttp = () => ({ withPriority: n => ({ priority: n }) });
const recorder = (id, extra = {}) => { const lanes = []; return { lanes, p: { id, label: id, ...extra, async enrich(fs, ctx) { lanes.push(ctx.http.priority); for (const f of fs) ctx.done(f, { v: 1 }); } } }; };

test('background first-time work uses lane 3, feel-only extras and quiet refreshes lane 4', async () => {
  const a = recorder('a'), feel = recorder('wikicats');
  await enrich({ store: mkStore({ n: film('n') }), providers: [a.p, feel.p], http: fakeHttp() });
  assert.deepEqual(a.lanes, [3]);
  assert.deepEqual(feel.lanes, [4]);
  const r = recorder('a', { refreshDays: 1 });
  const store = mkStore({ o: film('o', { checked: { a: OLD }, src: { a: { keep: 1 } } }) });
  await enrich({ store, providers: [r.p], http: fakeHttp(), full: true });
  assert.deepEqual(r.lanes, [4], 'the quiet re-read pass is lane 4');
});

test('an explicit lane applies to every provider, including feel extras', async () => {
  for (const lane of [0, 1, 2]) {
    const a = recorder('a'), feel = recorder('wikicats');
    await enrich({ store: mkStore({ n: film('n') }), providers: [a.p, feel.p], http: fakeHttp(), only: ['n'], lane });
    assert.deepEqual([a.lanes, feel.lanes], [[lane], [lane]]);
  }
});

test('without withPriority the plain http is passed through', async () => {
  const http = { marker: 1 };
  let seen;
  const p = { id: 'a', label: 'a', async enrich(fs, ctx) { seen = ctx.http; for (const f of fs) ctx.done(f, { v: 1 }); } };
  await enrich({ store: mkStore({ n: film('n') }), providers: [p], http });
  assert.equal(seen, http);
});

test('the quiet pass still refuses the page window when the lane http is used', async () => {
  let page;
  const p = { id: 'a', label: 'a', refreshDays: 1, async enrich(fs, ctx) { page = ctx.http.page; for (const f of fs) ctx.done(f, { v: 1 }); } };
  const store = mkStore({ o: film('o', { checked: { a: OLD }, src: { a: { keep: 1 } } }) });
  await enrich({ store, providers: [p], http: { ...fakeHttp(), page: async () => 'window' }, full: true });
  await assert.rejects(page(), { status: 403 });
});

// ---- fetchNow ----
function fake(id, rec) {
  return {
    id, label: id,
    async enrich(films, ctx) {
      for (const film of films) {
        if (ctx.skip(film)) continue;
        rec.calls.push(film.key); rec.signals.push(ctx.signal);
        await new Promise(res => { rec.gates[film.key] = res; });
        ctx.done(film, { ok: 1 });
      }
    },
  };
}
function setup(p, { fetch, n = 8 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-lanes-'));
  const core = createCore({ dataDir: dir, providers: [p], onEvent: () => {}, ...(fetch ? { fetch } : {}) });
  for (let i = 0; i < n; i++) core.store.films['f' + i] = { key: 'f' + i, title: 'Film ' + i, year: 2000 + i };
  return core;
}

test('fetchNow queues all its films at once, in the order given, and cancelling stops them', async () => {
  const rec = { calls: [], signals: [], gates: {} };
  const core = setup(fake('lbpage', rec));
  assert.equal((await core.call('fetchNow', { keys: ['f3', 'f1', 'f2'], slot: 'visible' })).queued, 3);
  await until(() => rec.calls.length === 3);
  assert.deepEqual(rec.calls, ['f3', 'f1', 'f2'], 'every film is in flight before any finishes, in on-screen order');
  assert.ok(rec.signals.every(s => s && !s.aborted));
  await core.call('cancel');
  assert.ok(rec.signals.every(s => s.aborted), 'the signal reaches the providers');
});

test('an opened film jumps ahead of films queued earlier for the visible slot', async () => {
  const urls = [];
  const fetch = async url => { urls.push(String(url)); return new Response('ok', { status: 200 }); };
  const p = { id: 'lbpage', label: 'lbpage', async enrich(films, ctx) { for (const f of films) { if (ctx.skip(f)) continue; await ctx.http.text('https://example.test/' + f.key, { signal: ctx.signal }); ctx.done(f, { ok: 1 }); } } };
  const core = setup(p, { fetch });
  await core.call('fetchNow', { keys: ['f0', 'f1', 'f2', 'f3', 'f4'], slot: 'visible' });
  await sleep(20);
  await core.call('fetchNow', { keys: ['f7'], tier: 'full', slot: 'open' });
  await until(() => core.store.films.f4.checked?.lbpage && core.store.films.f7.checked?.lbpage);
  const order = urls.map(u => u.split('/').pop());
  assert.ok(order.indexOf('f7') < order.indexOf('f4'), 'opened film was fetched before the last visible one: ' + order);
});
