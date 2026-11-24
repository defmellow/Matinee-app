// Image cache tests: fake fetch + temp dir, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createImageCache, parseRetryAfter } from '../../electron/image-cache.js';

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'matinee-imgcache-'));
const PNG = Buffer.from('synthetic-image-bytes');
const ok = (body = PNG, type = 'image/png') => new Response(body, { status: 200, headers: { 'content-type': type } });
const URL1 = 'https://image.tmdb.org/t/p/w342/a.jpg';

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts) => { calls.push(url); return handler(url, calls.length); };
  f.calls = calls;
  return f;
}

test('fetches once, then serves from disk (also after a restart)', async () => {
  const dir = await tmp();
  const f = fakeFetch(() => ok());
  const c = createImageCache({ dir, fetch: f });
  const a = await c.handle(URL1);
  assert.equal(a.status, 200);
  assert.equal(a.headers['content-type'], 'image/png');
  assert.deepEqual(a.body, PNG);
  const b = await c.handle(URL1);
  assert.equal(b.headers['x-matinee-cache'], 'hit');
  const c2 = createImageCache({ dir, fetch: fakeFetch(() => { throw new Error('offline'); }) });
  assert.deepEqual((await c2.handle(URL1)).body, PNG);
  assert.equal(f.calls.length, 1);
});

test('concurrent requests for the same image share one fetch', async () => {
  const f = fakeFetch(() => ok());
  const c = createImageCache({ dir: await tmp(), fetch: f });
  await Promise.all([c.handle(URL1), c.handle(URL1), c.handle(URL1)]);
  assert.equal(f.calls.length, 1);
});

test('rejects hosts outside the allowlist and bad addresses without fetching', async () => {
  const f = fakeFetch(() => ok());
  const c = createImageCache({ dir: await tmp(), fetch: f });
  assert.equal((await c.handle('https://example.com/x.jpg')).status, 403);
  assert.equal((await c.handle('file:///etc/passwd')).status, 400);
  assert.equal((await c.handle('not a url')).status, 400);
  assert.equal((await c.handle(null)).status, 400);
  assert.equal(f.calls.length, 0);
});

test('429 honours retry-after and tries once more; a second 429 becomes 503', async () => {
  const dir = await tmp();
  let n = 0;
  const c = createImageCache({ dir, fetch: fakeFetch(() => (++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : ok())) });
  assert.equal((await c.handle(URL1)).status, 200);
  assert.equal(n, 2);
  const f2 = fakeFetch(() => new Response('', { status: 429, headers: { 'retry-after': '0' } }));
  const c2 = createImageCache({ dir: await tmp(), fetch: f2 });
  assert.equal((await c2.handle(URL1)).status, 503);
  assert.equal(f2.calls.length, 2);
});

test('non-image responses and upstream failures are not cached', async () => {
  const dir = await tmp();
  const c = createImageCache({ dir, fetch: fakeFetch(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) });
  assert.equal((await c.handle(URL1)).status, 415);
  const c2 = createImageCache({ dir, fetch: fakeFetch(() => { throw new Error('boom'); }) });
  assert.equal((await c2.handle(URL1)).status, 502);
  assert.equal((await fs.readdir(dir)).length, 0);
});

test('requests to upload.wikimedia.org start at least 250 ms apart', async () => {
  const starts = [];
  const f = async () => { starts.push(Date.now()); return ok(); };
  const c = createImageCache({ dir: await tmp(), fetch: f });
  await Promise.all([1, 2, 3].map(i => c.handle(`https://upload.wikimedia.org/thumb/${i}/250px-x.jpg`)));
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 240, `gap ${starts[1] - starts[0]}`);
  assert.ok(starts[2] - starts[1] >= 240, `gap ${starts[2] - starts[1]}`);
});

test('no more than 4 requests in flight per host', async () => {
  let active = 0, peak = 0;
  const f = async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; return ok(); };
  const c = createImageCache({ dir: await tmp(), fetch: f });
  await Promise.all(Array.from({ length: 10 }, (_, i) => c.handle(`https://image.tmdb.org/t/p/w342/${i}.jpg`)));
  assert.equal(peak, 4);
});

test('evicts least recently used images when over the size cap', async () => {
  const dir = await tmp();
  const c = createImageCache({ dir, fetch: fakeFetch(() => ok(Buffer.alloc(100, 1))), maxBytes: 350 });
  const urls = [0, 1, 2, 3].map(i => `https://image.tmdb.org/t/p/w342/${i}.jpg`);
  for (const u of urls) { await c.handle(u); await new Promise(r => setTimeout(r, 15)); }
  await c.handle(urls[0]); // touch the oldest so it survives
  await c.evict();
  const left = (await fs.readdir(dir)).filter(n => n.endsWith('.bin')).length;
  assert.ok(left < 4 && left >= 2, `left ${left}`);
  const again = fakeFetch(() => ok(Buffer.alloc(100, 1)));
  const c2 = createImageCache({ dir, fetch: again, maxBytes: 350 });
  await c2.ready;
  assert.equal((await c2.handle(urls[0])).headers['x-matinee-cache'], 'hit');
});

test('eviction also runs when the cache starts up over its cap', async () => {
  const dir = await tmp();
  const big = createImageCache({ dir, fetch: fakeFetch(() => ok(Buffer.alloc(100, 1))) });
  for (let i = 0; i < 5; i++) await big.handle(`https://image.tmdb.org/t/p/w342/${i}.jpg`);
  const small = createImageCache({ dir, fetch: fakeFetch(() => ok()), maxBytes: 200 });
  await small.ready;
  const bytes = (await Promise.all((await fs.readdir(dir)).filter(n => n.endsWith('.bin')).map(n => fs.stat(path.join(dir, n))))).reduce((s, st) => s + st.size, 0);
  assert.ok(bytes <= 200, `bytes ${bytes}`);
});

test('parseRetryAfter reads seconds and dates, and clamps', () => {
  assert.equal(parseRetryAfter('2'), 2000);
  assert.equal(parseRetryAfter('9999'), 10000);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('garbage'), null);
  assert.equal(parseRetryAfter(new Date(5000).toUTCString(), 1000), 4000);
});

test('a TMDB profile photo (w185, the size headshots use) is fetched, cached and served as an image', async () => {
  const dir = await tmp();
  const url = 'https://image.tmdb.org/t/p/w185/abc.jpg';
  const f = fakeFetch(() => ok(PNG, 'image/jpeg'));
  const cache = createImageCache({ dir, fetch: f });
  const r = await cache.handle(url);
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/jpeg');
  assert.equal((await cache.handle(url)).headers['x-matinee-cache'], 'hit');
  assert.deepEqual(f.calls, [url]);
});
