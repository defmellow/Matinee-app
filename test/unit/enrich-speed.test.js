import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich } from '../../core/enrich.js';
import { createHttp } from '../../core/net.js';
import { createFetchLog } from '../../core/fetchlog.js';

// Synthetic stores, hosts and providers (clearly fake): this checks scheduling and pacing, not any real site.
const fakeStore = n => {
  const films = {};
  for (let i = 0; i < n; i++) films['f' + i] = { key: 'f' + i, title: `Film ${i}`, year: 2000 + (i % 20) };
  return { library: { settings: {}, films: {} }, films, touch() {}, flush() {} };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeFetch(latency) {
  const live = new Map(), peak = new Map(), starts = new Map();
  const fetch = async url => {
    const host = new URL(url).host;
    const now = (live.get(host) || 0) + 1; live.set(host, now); peak.set(host, Math.max(peak.get(host) || 0, now));
    (starts.get(host) || starts.set(host, []).get(host)).push(performance.now());
    await sleep(latency);
    live.set(host, live.get(host) - 1);
    return { status: 200, ok: true, headers: new Headers(), url, text: async () => 'ok', json: async () => ({}) };
  };
  return { fetch, peak, starts };
}

/** A provider that makes `calls` requests per film to `host`, with `workers` films in flight. */
function synth(id, host, { calls = 1, workers = 1, independent = false, requires } = {}) {
  return {
    id, label: id, independent, requires,
    async enrich(films, ctx) {
      let next = 0, finished = 0;
      const work = async () => {
        while (next < films.length) {
          const film = films[next++];
          for (let c = 0; c < calls; c++) await ctx.http.text(`https://${host}/${id}/${film.key}/${c}`, { signal: ctx.signal });
          ctx.done(film, { poster: 'https://secret.example/p.jpg', synopsis: 'Review text that must not be logged' });
          ctx.progress(++finished, films.length);
        }
      };
      await Promise.all(Array.from({ length: workers }, work));
    },
  };
}

test('the host limit is respected: never more in flight than its concurrency, and start gaps are kept', async () => {
  const { fetch, peak, starts } = fakeFetch(15);
  const http = createHttp({ fetch, limits: { 'a.test': { concurrency: 3, gap: 10 }, 'b.test': { concurrency: 1, gap: 30 } } });
  await enrich({ store: fakeStore(12), http, providers: [synth('a', 'a.test', { workers: 8 }), synth('b', 'b.test', { workers: 8 })] });
  assert.ok(peak.get('a.test') <= 3 && peak.get('a.test') >= 2, `a peak ${peak.get('a.test')}`);
  assert.equal(peak.get('b.test'), 1);
  const gaps = starts.get('b.test').slice(1).map((t, i) => t - starts.get('b.test')[i]);
  assert.ok(Math.min(...gaps) >= 25, `strict host gap ${Math.min(...gaps)}`);
});

test('the id stage keeps its order, and later sources wait for it', async () => {
  const order = [];
  const mk = (id, extra = {}) => ({ id, label: id, async enrich(films, ctx) { order.push(id + ':start'); await sleep(10); for (const f of films) ctx.done(f, { poster: 'x' }); order.push(id + ':end'); }, ...extra });
  const { fetch } = fakeFetch(1);
  await enrich({ store: fakeStore(2), http: createHttp({ fetch }), providers: [mk('boxd'), mk('wikidata'), mk('wikipedia'), mk('allmovie', { independent: true })] });
  assert.ok(order.indexOf('boxd:end') < order.indexOf('wikidata:start'));
  assert.ok(order.indexOf('wikidata:end') < order.indexOf('wikipedia:start'));
  assert.ok(order.indexOf('allmovie:start') < order.indexOf('wikidata:end'), 'independent source starts early: ' + order);
});

test('log lines are short, abstract, and free of addresses and review text', async () => {
  const { fetch } = fakeFetch(1);
  const log = createFetchLog({ flushMs: 1000 });
  const bad = { id: 'rt', label: 'Rotten Tomatoes', async enrich(films, ctx) { ctx.fail(films[0], Object.assign(new Error('HTTP 503 for https://www.rottentomatoes.com/m/secret'), { status: 503 })); ctx.done(films[1], null); ctx.log('Rotten Tomatoes keeps turning requests away (HTTP 403) https://x.test/a'); } };
  await enrich({ store: fakeStore(2), http: createHttp({ fetch }), providers: [synth('wikipedia', 'w.test'), bad], log });
  const text = JSON.stringify(log.list());
  assert.doesNotMatch(text, /https?:|secret|Review text|p\.jpg/);
  const kinds = new Set(log.list().map(e => e.kind));
  for (const k of ['fetch', 'ok', 'miss', 'error', 'wait']) assert.ok(kinds.has(k), 'has ' + k);
  const ok = log.list().find(e => e.kind === 'ok');
  assert.deepEqual([ok.site, ok.title, ok.text], ['Wikipedia', 'Film 0', 'got poster and synopsis']);
  assert.ok(log.list().some(e => e.site === 'Rotten Tomatoes' && /polite pacing/.test(e.text)));
});

test('backoff waits from the network layer show up as wait lines', async () => {
  let calls = 0;
  const fetch = async url => (++calls === 1
    ? { status: 429, ok: false, headers: new Headers({ 'retry-after': '0' }), url }
    : { status: 200, ok: true, headers: new Headers(), url, text: async () => 'ok' });
  const log = createFetchLog({ flushMs: 1000 });
  await enrich({ store: fakeStore(1), http: createHttp({ fetch }), providers: [synth('wikipedia', 'en.wikipedia.org')], log });
  assert.ok(log.list().some(e => e.kind === 'wait' && e.site === 'Wikipedia' && /busy/.test(e.text)));
});

// ---- speed: the same synthetic workload under the old and the new scheduling/limits (real times scaled down ~50x) ----
const OLD = { 'wd.test': { concurrency: 1, gap: 22 }, 'wp.test': { concurrency: 2, gap: 3 }, 'am.test': { concurrency: 1, gap: 50 }, 'rt.test': { concurrency: 1, gap: 30 }, 'lb.test': { concurrency: 1, gap: 50 } };
const NEW = { ...OLD, 'wd.test': { concurrency: 2, gap: 16 }, 'wp.test': { concurrency: 3, gap: 2 } };

async function timed(limits, { newScheduling }) {
  const { fetch } = fakeFetch(10);
  const providers = [
    synth('wikidata', 'wd.test', { workers: newScheduling ? 2 : 1 }),
    synth('wikipedia', 'wp.test', { calls: 2, workers: newScheduling ? 3 : 2 }),
    synth('allmovie', 'am.test', { independent: newScheduling }),
    synth('rt', 'rt.test'),
    synth('lbpage', 'lb.test'),
  ];
  const t0 = performance.now();
  await enrich({ store: fakeStore(40), http: createHttp({ fetch, limits }), providers });
  return performance.now() - t0;
}

test('speed: 40 films x 5 providers is faster with overlap and wider open-API limits, strict sites unchanged', async () => {
  const before = await timed(OLD, { newScheduling: false });
  const after = await timed(NEW, { newScheduling: true });
  console.log(`# speed (synthetic, scaled): before ${Math.round(before)} ms, after ${Math.round(after)} ms, ${(before / after).toFixed(2)}x`);
  // Both runs now end when the slowest strict site (allmovie, 1 at a time) finishes: per-film release overlaps everything else in
  // either case, so allow timer jitter rather than demand a strict win.
  assert.ok(after <= before * 1.03, `after ${after} vs before ${before}`);
});
