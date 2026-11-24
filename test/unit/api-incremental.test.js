// Keyed 'library' events, getSummaries and the per-film summary cache in core/api.js. Synthetic films, fake providers, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };

const provider = { id: 'lbpage', label: 'lbpage', async enrich(films, ctx) { for (const f of films) { if (ctx.skip(f)) continue; ctx.done(f, { poster: { url: 'https://x.test/' + f.key + '.jpg' } }); } } };

function setup({ n = 6 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-inc-'));
  const events = [];
  const timers = [];
  let t = 1e6; // a clock that only moves when the test says so
  const clock = { now: () => t, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {} };
  const core = createCore({ dataDir: dir, providers: [provider], clock, onEvent: (e, p) => { if (e === 'library') events.push(p); } });
  for (let i = 0; i < n; i++) {
    const k = 'f' + i;
    core.store.films[k] = { key: k, title: 'Film ' + i, year: 2000 + i, src: {} };
    core.store.library.films[k] = { watchlist: true, tags: [] };
  }
  return { core, events, timers, advance: ms => { t += ms; }, runTimers: () => timers.splice(0).forEach(fn => fn()) };
}

test('enrichment events carry the keys of the films that changed, batched as a union', async () => {
  const { core, events, timers, advance, runTimers } = setup();
  await core.call('fetchNow', { keys: ['f1', 'f2', 'f3'] });
  await until(() => core.store.films.f3.src.lbpage);
  // first film goes out at once, the rest wait for the 1 s gap
  assert.deepEqual(events[0], { keys: ['f1'] });
  assert.equal(events.length, 1);
  assert.ok(timers.length > 0);
  advance(1500); runTimers();
  assert.equal(events.length, 2);
  assert.deepEqual([...events[1].keys].sort(), ['f1', 'f2', 'f3'], 'union of everything queued since the last send');
  assert.ok(events.every(p => Array.isArray(p.keys)));
});

test('edits and resets stay keyless, meaning "reload everything"', async () => {
  const { core, events } = setup();
  await core.call('tagFilms', { keys: ['f0'], add: ['x'] });
  assert.equal(events.length, 1);
  assert.equal(events[0], undefined);
  await core.call('resetAll');
  assert.equal(events.at(-1), undefined);
});

test('getSummaries returns exactly the entries getLibrary has, in the order asked, skipping unknown keys', async () => {
  const { core } = setup();
  const lib = await core.call('getLibrary');
  const res = await core.call('getSummaries', { keys: ['f4', 'nope', 'f1'] });
  assert.deepEqual(res.films.map(f => f.key), ['f4', 'f1']);
  assert.deepEqual(res.films[0], lib.films.find(f => f.key === 'f4'));
  assert.deepEqual(res.films[1], lib.films.find(f => f.key === 'f1'));
  assert.deepEqual((await core.call('getSummaries', {})).films, []);
});

test('only the films named in an event get their summary rebuilt', async () => {
  const { core } = setup();
  const before = await core.call('getLibrary');
  core.store.films.f2.src.lbpage = { poster: { url: 'https://x.test/f2.jpg' } };
  core.store.films.f2.title = 'Renamed';
  await core.call('fetchNow', { keys: ['f2'] }); // runs the provider, which emits { keys: ['f2'] }
  await until(() => core.store.films.f2.checked?.lbpage);
  const after = await core.call('getLibrary');
  assert.equal(after.films.find(f => f.key === 'f2').title, 'Renamed');
  for (const k of ['f0', 'f1', 'f3', 'f4', 'f5']) assert.equal(after.films.find(f => f.key === k), before.films.find(f => f.key === k), k + ' reused as the same object');
  assert.notEqual(after.films.find(f => f.key === 'f2'), before.films.find(f => f.key === 'f2'));
});

test('the library list leaves out what only the film page reads, and getFilm still has it', async () => {
  const { core } = setup();
  const f = (await core.call('getLibrary')).films[0];
  for (const k of ['people', 'scoreParts', 'awards', 'ids', 'keywords', 'subjects']) assert.equal(k in f, false, k);
  const full = await core.call('getFilm', { key: f.key });
  for (const k of ['people', 'scoreParts', 'awards', 'ids']) assert.ok(k in full, k);
});
