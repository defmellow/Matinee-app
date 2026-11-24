// Letterboxd film page: plain GET first, window on any challenge; enrich ordering; library-event coalescing. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import lbpage from '../../core/providers/lbpage.js';
import { enrich } from '../../core/enrich.js';
import { createHttp } from '../../core/net.js';
import { createCore } from '../../core/api.js';

const html = readFileSync(new URL('../fixtures/synthetic/lbpage-paris-texas.html', import.meta.url), 'utf8');
const film = n => ({ key: `lid:${n}`, title: 'Paris, Texas', slug: 'paris-texas' });
const challenge = { status: 200, text: '<html><head><title>Just a moment...</title></head></html>' };

function makeCtx(get, win) {
  const rec = { done: [], fail: [], log: [], get: 0, win: 0 };
  const http = {
    async browserText() { rec.get++; return get(rec.get); },
    async page() { rec.win++; return win(rec.win); },
  };
  return { rec, ctx: { http, progress() {}, log: m => rec.log.push(m), done: (f, d) => rec.done.push(d), fail: (f, e) => rec.fail.push(e) } };
}

test('GET 200 parses the page without opening the window; average is stored as a rating', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 200, text: html }), () => assert.fail('window used'));
  await lbpage.enrich([film(1), film(2)], ctx);
  assert.equal(rec.get, 2); assert.equal(rec.win, 0);
  assert.equal(rec.done.length, 2);
  assert.equal(rec.done[0].ratings.letterboxd.value, 4.36);
  assert.equal(rec.done[0].miniThemes.length, 2);
});

test('a challenge page switches to the window for the rest of the run; the plain GET is not tried again', async () => {
  const { ctx, rec } = makeCtx(() => challenge, () => ({ status: 200, text: html }));
  await lbpage.enrich([film(1), film(2), film(3)], ctx);
  assert.equal(rec.get, 1);
  assert.equal(rec.win, 3);
  assert.equal(rec.done.length, 3);
  assert.equal(rec.log.length, 1);
});

test('403 (thrown or returned) also switches to the window; a page that is not a film page does too', async () => {
  for (const first of [{ status: 403, text: '' }, { status: 200, text: '<html><title>Oops</title></html>' }]) {
    const { ctx, rec } = makeCtx(() => first, () => ({ status: 200, text: html }));
    await lbpage.enrich([film(1), film(2)], ctx);
    assert.deepEqual([rec.get, rec.win, rec.done.length], [1, 2, 2]);
  }
  const { ctx, rec } = makeCtx(() => { throw Object.assign(new Error('x'), { status: 403 }); }, () => ({ status: 200, text: html }));
  await lbpage.enrich([film(1)], ctx);
  assert.deepEqual([rec.get, rec.win, rec.done.length], [1, 1, 1]);
});

test('GET 404 is a miss and does not switch to the window', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 404, text: '' }), () => assert.fail('window used'));
  await lbpage.enrich([film(1), film(2)], ctx);
  assert.deepEqual(rec.done, [null, null]);
  assert.equal(rec.win, 0);
});

test('window path still stops after three blocks in a row', async () => {
  const { ctx, rec } = makeCtx(() => challenge, () => ({ status: 403, text: '' }));
  await lbpage.enrich([1, 2, 3, 4, 5].map(film), ctx);
  assert.equal(rec.win, 3);
  assert.equal(rec.fail.length, 3);
  assert.equal(rec.done.length, 0);
});

test('net.browserText uses the injected browser fetch and user agent, and paces like other letterboxd.com requests', async () => {
  const seen = [];
  const bf = async (url, opts) => { seen.push(opts.headers['user-agent']); return { status: 200, ok: true, headers: new Headers(), url, text: async () => 'hi' }; };
  const http = createHttp({ fetch: async () => assert.fail('default fetch used'), browserFetch: bf, browserUserAgent: 'UA-TEST' });
  const r = await http.browserText('https://letterboxd.com/film/x/');
  assert.equal(r.text, 'hi'); assert.deepEqual(seen, ['UA-TEST']);
  assert.deepEqual(http.limitsFor('letterboxd.com'), { concurrency: 3, gap: 700 });
  // 429 is not retried here: the caller switches route
  const http2 = createHttp({ fetch: async url => ({ status: 429, ok: false, headers: new Headers(), url }) });
  await assert.rejects(http2.browserText('https://letterboxd.com/film/x/'), { status: 429 });
});

test('enrich: lbpage starts as soon as boxd is done, while wikidata is still running', async () => {
  const order = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mk = (id, extra = {}) => ({ id, label: id, async enrich(films, ctx) { order.push(id + ':start'); await sleep(id === 'wikidata' ? 40 : 5); for (const f of films) ctx.done(f, { poster: 'x' }); order.push(id + ':end'); }, ...extra });
  const store = { library: { settings: {}, films: {} }, films: { a: { key: 'a', title: 'A' } }, touch() {}, flush() {} };
  await enrich({ store, http: createHttp({ fetch: async () => ({}) }), providers: [mk('boxd'), mk('wikidata'), mk('wikipedia'), { ...mk('lbpage'), startsAfter: 'boxd' }] });
  assert.ok(order.indexOf('boxd:end') < order.indexOf('lbpage:start'), order.join());
  assert.ok(order.indexOf('lbpage:end') < order.indexOf('wikidata:end'), order.join());
  assert.ok(order.indexOf('wikidata:end') < order.indexOf('wikipedia:start'), order.join());
});

test('api: library events from enrichment go out at most once a second; the last one always goes out', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-coalesce-'));
  let t = 0; const timers = [];
  const clock = { now: () => t, setTimeout: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h; }, clearTimeout: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); } };
  const events = [];
  let finish;
  const finished = new Promise(r => { finish = r; });
  // 100 saves = 5 "library" requests from enrich.js, all at the same fake instant, then one more after a second has passed.
  const fake = { id: 'fake', label: 'Fake', async enrich(films, ctx) {
    events.push(['mark', 'burst-start']);
    for (let i = 0; i < 100; i++) ctx.done(films[0], { poster: 'x' });
    events.push(['mark', 'burst-end']);
    t = 1500;
    for (let i = 0; i < 20; i++) ctx.done(films[0], { poster: 'y' });
  } };
  const core = createCore({ dataDir: dir, fetch: async () => new Response('', { status: 404 }), clock, providers: [fake],
    onEvent: (e, p) => { events.push([e, p]); if (e === 'progress' && p?.phase === 'done') finish(); } });
  try {
    const csv = 'Date,Name,Year,Letterboxd URI\n2024-02-01,Alpha Film,1999,https://boxd.it/aaa\n';
    const bytes = zipSync({ 'watched.csv': strToU8(csv) });
    await core.call('importExport', { bytes });
    await finished;
    const names = events.map(e => e[0]);
    const burst = names.lastIndexOf('mark');
    assert.equal(names.slice(names.indexOf('mark'), burst).filter(n => n === 'library').length, 1, 'one library event for the whole burst');
    assert.equal(names.slice(burst).filter(n => n === 'library').length >= 1, true);
    assert.equal(timers.length, 0, 'no timer left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
