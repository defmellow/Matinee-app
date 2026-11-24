// fetchNow and the Letterboxd score: a film on screen or opened gets its Letterboxd slug (boxd) and then its Letterboxd
// page (lbpage) in the same call, films without a Letterboxd score go first, and an overlapping scroll never drops films.
// Fake fetchers and synthetic films only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import boxd from '../../core/providers/boxd.js';
import lbpage from '../../core/providers/lbpage.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };
const aborted = () => Object.assign(new Error('aborted'), { code: 'aborted' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-fnlb-'));

const PAGE = (avg, count) => `<html><head><title>Synthetic Film (2000) directed by Nobody • Letterboxd</title>
<script type="application/ld+json">{"@type":"Movie","name":"Synthetic Film","aggregateRating":{"ratingValue":${avg},"ratingCount":${count}}}</script>
</head><body><div class="production-synopsis"></div></body></html>`;

test('a film with only a short link: boxd finds the slug, then lbpage stores the Letterboxd score, in one fetchNow', async () => {
  const urls = [];
  const events = [];
  const fetch = async (url, opts) => {
    urls.push(`${opts.method || 'GET'} ${url}`);
    if (url === 'https://boxd.it/AbC') return new Response(null, { status: 301, headers: { location: 'https://letterboxd.com/film/synthetic-film/' } });
    throw new Error('unexpected ' + url);
  };
  const browserFetch = async url => { urls.push('BROWSER ' + url); return new Response(PAGE(3.91, 4200), { status: 200 }); };
  const core = createCore({ dataDir: tmp(), fetch, browserFetch, providers: [boxd, lbpage], onEvent: (e, p) => events.push([e, p]) });
  core.store.films['lid:AbC'] = { key: 'lid:AbC', lid: 'AbC', title: 'Synthetic Film', year: 2000, ids: {}, src: {}, checked: {}, missed: {} };

  core.store.library.films['lid:AbC'] = { watchlist: true };
  assert.deepEqual(await core.call('fetchNow', { keys: ['lid:AbC'], tier: 'quick' }), { queued: 1 });
  await until(() => core.store.films['lid:AbC'].src.lbpage);

  const f = core.store.films['lid:AbC'];
  assert.equal(f.slug, 'synthetic-film');
  assert.deepEqual(urls.filter(u => !u.startsWith('BROWSER')).length, 1);
  assert.ok(urls.indexOf('BROWSER https://letterboxd.com/film/synthetic-film/') > urls.findIndex(u => u.includes('boxd.it')), 'boxd came first');
  assert.deepEqual(f.src.lbpage.ratings.letterboxd, { value: 3.91, votes: 4200 });
  await until(() => events.some(([e, p]) => e === 'library' && p?.keys?.includes('lid:AbC')));
  const { films } = await core.call('getSummaries', { keys: ['lid:AbC'] });
  assert.equal(films[0].ratings.letterboxd.value, 3.91, 'the summary the UI patches in carries the Letterboxd score');
  core.close();
});

/** Fake lbpage that records the order films are read in and waits on a gate per film (or an abort). */
function gated(id, rec) {
  return {
    id, label: id, startsAfter: undefined,
    async enrich(films, ctx) {
      for (const film of films) {
        if (ctx.skip(film)) continue;
        rec.calls.push(film.key);
        await new Promise((res, rej) => {
          rec.gates[film.key] = res;
          if (rec.auto) return res();
          ctx.signal?.addEventListener('abort', () => rej(aborted()));
        });
        ctx.done(film, { ok: 1 });
      }
    },
  };
}
function setup({ auto = false, n = 8 } = {}) {
  const rec = { calls: [], gates: {}, auto };
  const core = createCore({ dataDir: tmp(), providers: [gated('lbpage', rec)] });
  for (let i = 0; i < n; i++) { const k = 'f' + i; core.store.films[k] = { key: k, title: 'Film ' + i, year: 2000, ids: {}, src: {}, checked: {}, missed: {} }; }
  return { core, rec };
}

test('films lacking a Letterboxd score are fetched first, in the order given', async () => {
  const { core, rec } = setup({ auto: true });
  core.store.films.f0.src.rss = { ratings: { letterboxd: { value: 4, votes: 100 } } }; // already has one
  core.store.films.f2.src.rss = { ratings: { letterboxd: { value: 3, votes: 100 } } };
  await core.call('fetchNow', { keys: ['f0', 'f1', 'f2', 'f3'] });
  await until(() => rec.calls.length === 4);
  assert.deepEqual(rec.calls, ['f1', 'f3', 'f0', 'f2']);
  core.close();
});

test('the order given is kept even for watched films that would otherwise go first', async () => {
  const { core, rec } = setup({ auto: true });
  core.store.library.films.f3 = { watched: true, rating: 9 };
  await core.call('fetchNow', { keys: ['f1', 'f2', 'f3'] });
  await until(() => rec.calls.length === 3);
  assert.deepEqual(rec.calls, ['f1', 'f2', 'f3']);
  core.close();
});

test('scrolling a little replaces the visible set without dropping the films both sets share', async () => {
  const { core, rec } = setup();
  await core.call('fetchNow', { keys: ['f0', 'f1', 'f2'] });
  await until(() => rec.calls.includes('f0'));
  // a small scroll: f0 gone, f3 new, f1 and f2 still on screen and never reached by the first run
  assert.deepEqual(await core.call('fetchNow', { keys: ['f1', 'f2', 'f3'] }), { queued: 3 });
  await until(() => rec.calls.includes('f1'));
  for (let i = 0; i < 20; i++) { for (const g of Object.values(rec.gates)) g(); await sleep(5); }
  await until(() => ['f1', 'f2', 'f3'].every(k => core.store.films[k].checked.lbpage));
  core.close();
});

test('opening a film another run had in flight: it is fetched once that run is aborted, not left behind', async () => {
  const { core, rec } = setup();
  await core.call('fetchNow', { keys: ['f0', 'f1'], tier: 'quick', slot: 'visible' }); // holds f0 (gated)
  await until(() => rec.calls.includes('f0'));
  await core.call('fetchNow', { keys: ['f0'], tier: 'full', slot: 'open' });          // skips f0: the visible run has it
  await sleep(20);
  assert.equal(rec.calls.filter(c => c === 'f0').length, 1);
  await core.call('fetchNow', { keys: ['f5'], tier: 'quick', slot: 'visible' });       // scrolled on: the visible run is aborted
  await until(() => rec.calls.filter(c => c === 'f0').length === 2, 3000);             // the open run takes f0 itself
  for (let i = 0; i < 20; i++) { for (const g of Object.values(rec.gates)) g(); await sleep(5); }
  await until(() => core.store.films.f0.checked.lbpage);
  core.close();
});
