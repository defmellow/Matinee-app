import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createElectronFetch } from '../../electron/net-adapter.js';

// Fake of Electron's ClientRequest: tests drive it by emitting events.
function fakeRequest() {
  const made = [];
  const request = opts => {
    const req = new EventEmitter();
    req.opts = opts; req.headers = {}; req.aborted = false; req.written = [];
    req.setHeader = (k, v) => { req.headers[k] = v; };
    req.write = c => req.written.push(c);
    req.end = () => { req.ended = true; };
    req.abort = () => { req.aborted = true; };
    made.push(req);
    return req;
  };
  return { request, made };
}

test('anything but redirect:manual goes straight to fetch', async () => {
  const calls = [];
  const f = createElectronFetch({ fetch: async (u, o) => { calls.push([u, o]); return new Response('hi'); }, request: () => { throw new Error('no'); } });
  await f('https://a.test/', { redirect: 'follow' });
  await f('https://a.test/');
  assert.equal(calls.length, 2);
});

test('manual: a redirect resolves with status and location, then aborts the request', async () => {
  const { request, made } = fakeRequest();
  const f = createElectronFetch({ fetch: () => { throw new Error('no'); }, request });
  const p = f('https://boxd.it/abc', { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': 'X', 'accept-language': 'en' } });
  const req = made[0];
  assert.deepEqual(req.opts, { url: 'https://boxd.it/abc', method: 'HEAD', redirect: 'manual' });
  assert.equal(req.headers['user-agent'], 'X');
  assert.ok(req.ended);
  req.emit('redirect', 301, 'GET', 'https://letterboxd.com/film/x/', { 'set-cookie': ['a=1', 'b=2'] });
  const res = await p;
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://letterboxd.com/film/x/');
  assert.equal(res.url, 'https://boxd.it/abc');
  assert.ok(req.aborted);
});

test('manual: a plain response (HEAD 404) resolves with its status', async () => {
  const { request, made } = fakeRequest();
  const p = createElectronFetch({ fetch() {}, request })('https://boxd.it/x', { method: 'HEAD', redirect: 'manual' });
  const res = new EventEmitter(); res.statusCode = 404; res.headers = { 'content-type': ['text/plain'] };
  made[0].emit('response', res);
  const out = await p;
  assert.equal(out.status, 404);
  assert.equal(out.headers.get('content-type'), 'text/plain');
});

test('manual: a GET response carries its body', async () => {
  const { request, made } = fakeRequest();
  const p = createElectronFetch({ fetch() {}, request })('https://x.test/', { redirect: 'manual' });
  const res = new EventEmitter(); res.statusCode = 200; res.headers = {};
  made[0].emit('response', res);
  res.emit('data', Buffer.from('hel')); res.emit('data', Buffer.from('lo')); res.emit('end');
  assert.equal(await (await p).text(), 'hello');
});

test('manual: errors become TypeError', async () => {
  const { request, made } = fakeRequest();
  const p = createElectronFetch({ fetch() {}, request })('https://x.test/', { redirect: 'manual' });
  made[0].emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'));
  await assert.rejects(p, e => e instanceof TypeError && /ERR_NAME_NOT_RESOLVED/.test(e.message));
});

test('manual: abort signal aborts the request and rejects with AbortError', async () => {
  const { request, made } = fakeRequest();
  const ac = new AbortController();
  const p = createElectronFetch({ fetch() {}, request })('https://x.test/', { redirect: 'manual', signal: ac.signal });
  ac.abort();
  await assert.rejects(p, e => e.name === 'AbortError');
  assert.ok(made[0].aborted);
});

test('manual: an already-aborted signal never starts a request', async () => {
  const { request, made } = fakeRequest();
  const ac = new AbortController(); ac.abort();
  await assert.rejects(createElectronFetch({ fetch() {}, request })('https://x.test/', { redirect: 'manual', signal: ac.signal }), e => e.name === 'AbortError');
  assert.equal(made.length, 0);
});
