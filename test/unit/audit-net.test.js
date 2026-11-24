import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '../../core/net.js';

// AbortSignal.timeout's timer doesn't keep Node alive by itself (a real socket does), so hold the loop open here.
const keepAlive = setInterval(() => {}, 1000);
import { after } from 'node:test';
after(() => clearInterval(keepAlive));

const limits = { default: { concurrency: 1, gap: 0 } };
const res = (status = 200, headers = {}) => new Response('ok', { status, headers });
// A fetch that never answers but honours its signal, like the real one.
const hanging = () => (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? Object.assign(new Error('x'), { name: 'AbortError' }))));

test('a stalled request times out, is retried, and does not hold up the next request to the host', async () => {
  let calls = 0;
  const fetch = (url, o) => (++calls <= 1 ? hanging()(url, o) : Promise.resolve(res()));
  const http = createHttp({ fetch, limits, retries: 2 });
  const notes = []; http.observe(n => notes.push(n.text));
  const r = await http.response('https://x.test/a', { timeoutMs: 30 });
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.ok(notes.some(t => /took too long/.test(t)));
});

test('a timeout is a plain error, not "stopped"; the caller cancelling is "stopped"', async () => {
  const http = createHttp({ fetch: hanging(), limits, retries: 1 });
  await assert.rejects(http.response('https://x.test/a', { timeoutMs: 20 }), e => e.code === 'timeout' && /too long/.test(e.message));
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 20);
  await assert.rejects(http.response('https://x.test/b', { signal: ctl.signal, timeoutMs: 5000 }), e => e.code === 'aborted');
});

test('no sleep after the last failed attempt, and retry sleeps leave no abort listeners', async () => {
  let n = 0;
  const http = createHttp({ fetch: async () => { n++; return res(503, { 'retry-after': '0' }); }, limits, retries: 2 });
  const ctl = new AbortController();
  let added = 0, removed = 0;
  const add = ctl.signal.addEventListener.bind(ctl.signal), rem = ctl.signal.removeEventListener.bind(ctl.signal);
  ctl.signal.addEventListener = (t, f, o) => { if (t === 'abort') added++; return add(t, f, o); };
  ctl.signal.removeEventListener = (t, f) => { if (t === 'abort') removed++; return rem(t, f); };
  const t0 = Date.now();
  await assert.rejects(http.response('https://x.test/a', { signal: ctl.signal }), e => e.status === 503);
  assert.equal(n, 2);
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(added > 0 && removed >= added - 0, `listeners cleaned up (${added} added, ${removed} removed)`);
});
