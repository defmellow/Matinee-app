// Poster/image cache: the UI asks for remote images through matinee-img:// (app) or /img (dev server);
// this fetches them once, keeps them on disk, and answers from disk afterwards so posters work offline.
// No Electron imports: the fetch implementation is injected, so it is unit-testable with a fake.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { USER_AGENT } from '../core/net.js';

export const ALLOWED_HOSTS = [
  'upload.wikimedia.org',
  'image.tmdb.org',
  'a.ltrbxd.com',
  'resizing.flixster.com',
  'm.media-amazon.com',
  'www.themoviedb.org',
];

const MB = 1024 * 1024;
const HOST_CONCURRENCY = 4;
// Minimum gap between request starts, per host. Wikimedia asks automated clients to go gently.
const HOST_GAP = { 'upload.wikimedia.org': 250 };
const MAX_IMAGE_BYTES = 20 * MB;
const MAX_HOPS = 3;
const MAX_RETRY_WAIT = 10_000;
const NEGATIVE_TTL = 5 * 60_000;

const HEADERS = {
  'cache-control': 'public, max-age=31536000, immutable',
  'access-control-allow-origin': '*',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha1 = s => createHash('sha1').update(s).digest('hex');
const fail = (status, message) => ({ status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }, body: Buffer.from(message) });

/** Retry-After is either seconds or an HTTP date. Returns milliseconds (clamped), or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 0), MAX_RETRY_WAIT);
}

/**
 * @param {{ dir: string, fetch?: typeof fetch, maxBytes?: number, hosts?: string[], userAgent?: string }} opts
 * @returns {{ handle(remoteUrl: string): Promise<{ status: number, headers: object, body: Buffer }>, evict(): Promise<number>, ready: Promise<void> }}
 */
export function createImageCache({ dir, fetch: fetchImpl = globalThis.fetch, maxBytes = 400 * MB, hosts = ALLOWED_HOSTS, userAgent = USER_AGENT, log = () => {}, report = () => {} } = {}) {
  // Nothing here is silent: log() has every failure; report() (the app's problem list) gets the ones that matter, and it
  // de-duplicates, so a grid of 200 posters from one broken host is one entry.
  const note = (...a) => { try { log(...a); } catch { /* logging must never break the cache */ } };
  const fail_ = (message, error, level = 'error') => { note(message, error); try { report({ area: 'Pictures', message, error, level }); } catch { /* same */ } };
  const warned = new Set();
  const noteOnce = (key, ...a) => { if (!warned.has(key)) { warned.add(key); note(...a); } };
  const allowed = new Set(hosts.map(h => h.toLowerCase()));
  const inflight = new Map();   // url -> Promise (several grid cells ask for the same poster at once)
  const missing = new Map();    // url -> expiry (short memory of 404s so a grid doesn't hammer the source)
  const hostState = new Map();  // host -> { active, queue, last }
  let total = 0;                // bytes on disk, kept roughly up to date
  let evicting = null;

  const files = key => ({ bin: path.join(dir, key + '.bin'), meta: path.join(dir, key + '.json') });

  // ---------- per-host politeness ----------
  function hostGate(host) {
    let s = hostState.get(host);
    if (!s) hostState.set(host, s = { active: 0, queue: [], last: 0 });
    return s;
  }
  function withHost(host, fn) {
    const s = hostGate(host);
    return new Promise((resolve, reject) => {
      s.queue.push({ fn, resolve, reject });
      pump(host);
    });
  }
  function pump(host) {
    const s = hostGate(host);
    while (s.active < HOST_CONCURRENCY && s.queue.length) {
      const job = s.queue.shift();
      s.active++;
      // Reserve the start time synchronously so concurrent jobs queue up behind each other.
      const gap = HOST_GAP[host] || 0;
      const startAt = Math.max(Date.now(), s.last + gap);
      s.last = startAt;
      (async () => {
        const wait = startAt - Date.now();
        if (wait > 0) await sleep(wait);
        try { job.resolve(await job.fn()); } catch (e) { job.reject(e); } finally { s.active--; pump(host); }
      })();
    }
  }

  // ---------- disk ----------
  async function readCached(key) {
    const f = files(key);
    try {
      const [meta, body] = await Promise.all([fs.readFile(f.meta, 'utf8'), fs.readFile(f.bin)]);
      const { type } = JSON.parse(meta);
      const now = new Date();
      fs.utimes(f.bin, now, now).catch(e => noteOnce('utimes', 'Could not mark a cached picture as used (logged once):', e && e.message));   // atime is what eviction goes by; Windows doesn't always keep it
      return { type: type || 'application/octet-stream', body };
    } catch (e) {
      if (e && e.code !== 'ENOENT') fail_("Matinee couldn't read a picture it had saved, so it will fetch it again.", e, 'warning'); // ENOENT = simply not cached yet
      return null;
    }
  }

  async function writeCached(key, url, type, body) {
    const f = files(key);
    const tmp = f.bin + '.' + process.pid + '.tmp';
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, f.bin);
      await fs.writeFile(f.meta, JSON.stringify({ type, url }));
      total += body.length;
      if (total > maxBytes) evict().catch(e => fail_("Matinee couldn't tidy its picture cache.", e));
    } catch (e) {
      // A full disk shouldn't break posters: the picture is still shown, it just isn't kept.
      fail_("Matinee couldn't save a picture to its cache.", e);
      fs.rm(tmp, { force: true }).catch(x => note('Could not remove a half-written picture:', x && x.message));
    }
  }

  /** Delete least-recently-used images until the cache is under 90% of its cap. Returns bytes freed. */
  function evict() {
    if (evicting) return evicting;
    evicting = (async () => {
      let names;
      try { names = await fs.readdir(dir); } catch (e) {
        total = 0;
        if (e && e.code !== 'ENOENT') fail_("Matinee couldn't look through its picture cache.", e); // ENOENT = no cache folder yet
        return 0;
      }
      const entries = new Map(); // key -> { size, atime, files: [] }
      for (const name of names) {
        const full = path.join(dir, name);
        if (name.endsWith('.tmp')) { await fs.rm(full, { force: true }); continue; }
        const key = name.replace(/\.(bin|json)$/, '');
        let st; try { st = await fs.stat(full); } catch { continue; /* expected: the file was removed while we were listing the folder */ }
        const e = entries.get(key) || { size: 0, atime: 0, files: [] };
        e.size += st.size; e.files.push(full);
        if (name.endsWith('.bin')) e.atime = Math.max(st.atimeMs, st.mtimeMs);
        entries.set(key, e);
      }
      let sum = 0;
      for (const e of entries.values()) sum += e.size;
      let freed = 0;
      if (sum > maxBytes) {
        const target = maxBytes * 0.9;
        const oldestFirst = [...entries.values()].sort((a, b) => a.atime - b.atime);
        for (const e of oldestFirst) {
          if (sum - freed <= target) break;
          await Promise.all(e.files.map(f => fs.rm(f, { force: true })));
          freed += e.size;
        }
      }
      total = sum - freed;
      return freed;
    })().finally(() => { evicting = null; });
    return evicting;
  }

  // ---------- network ----------
  // One attempt: fetch and read the body inside the host's slot, so "in flight" really means in flight.
  // Redirects are followed by hand, up to MAX_HOPS, and every Location must be on the allowlist too.
  const attempt = (url, host) => withHost(host, async () => {
    let res;
    let target = url;
    for (let hop = 0; ; hop++) {
      res = await fetchImpl(target, { redirect: 'manual', headers: { 'user-agent': userAgent, accept: 'image/*,*/*;q=0.5' } });
      if (res.status < 300 || res.status >= 400 || res.status === 304) break;
      if (res.body) res.body.cancel().catch(() => { /* expected: the redirect's body was already closed */ });
      const loc = res.headers.get('location');
      let next;
      try { next = new URL(loc, target); } catch (e) { next = null; note('A picture redirect had no usable address:', host, String(loc).slice(0, 200), e && e.message); }
      if (!next || hop >= MAX_HOPS || (next.protocol !== 'https:' && next.protocol !== 'http:') || !allowed.has(next.hostname.toLowerCase())) { note('A picture redirect was refused:', host, next ? next.hostname : '(bad address)'); return { status: 502, type: '' }; }
      target = next.href;
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !type.startsWith('image/')) { if (res.body) res.body.cancel().catch(() => { /* expected: not an image, so we drop the body */ }); return { status: res.status, type, retryAfter: res.headers.get('retry-after') }; }
    return { status: res.status, type, body: Buffer.from(await res.arrayBuffer()) };
  });

  async function download(url, host) {
    for (let tries = 1; tries <= 2; tries++) {
      let r;
      try { r = await attempt(url, host); } catch (e) { fail_(`Matinee couldn't download a picture from ${host}.`, e, 'warning'); return fail(502, 'Could not reach the image server.'); }
      if (r.status === 429) {
        if (tries === 2) { note('The picture server kept saying it was busy:', host); return fail(503, 'The image server is busy. Try again shortly.'); }
        await sleep(parseRetryAfter(r.retryAfter) ?? 1000);
        continue;
      }
      if (r.status === 404 || r.status === 410) { missing.set(url, Date.now() + NEGATIVE_TTL); return fail(404, 'No such image.'); }
      if (r.status < 200 || r.status >= 300) { note('A picture could not be fetched:', host, 'HTTP', r.status); return fail(r.status >= 500 ? 502 : r.status, 'The image server could not supply this image.'); }
      if (!r.body) return fail(415, 'Not an image.');
      if (!r.body.length) return fail(502, 'Empty image.');
      if (r.body.length > MAX_IMAGE_BYTES) return fail(413, 'Image too large.');
      return { type: r.type, body: r.body };
    }
    return fail(503, 'The image server is busy. Try again shortly.');
  }

  async function load(url, host) {
    const key = sha1(url);
    const hit = await readCached(key);
    if (hit) return { status: 200, headers: { ...HEADERS, 'content-type': hit.type, 'content-length': String(hit.body.length), 'x-matinee-cache': 'hit' }, body: hit.body };
    const exp = missing.get(url);
    if (exp && exp > Date.now()) return fail(404, 'No such image.');
    const got = await download(url, host);
    if (!got.type) return got; // an error response
    await writeCached(key, url, got.type, got.body);
    return { status: 200, headers: { ...HEADERS, 'content-type': got.type, 'content-length': String(got.body.length), 'x-matinee-cache': 'miss' }, body: got.body };
  }

  /** Serve one remote image URL. Never throws: failures come back as a status + short text body. */
  async function handle(remoteUrl) {
    let u;
    try { u = new URL(String(remoteUrl || '')); } catch { note('A picture was asked for with a bad address:', String(remoteUrl || '').slice(0, 200)); return fail(400, 'Bad image address.'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail(400, 'Bad image address.');
    if (!allowed.has(u.hostname.toLowerCase())) { note('A picture from a site that is not allowed was refused:', u.hostname); return fail(403, 'That image source is not allowed.'); }
    const url = u.href;
    let p = inflight.get(url);
    if (!p) {
      p = load(url, u.hostname.toLowerCase()).catch(e => { fail_("Matinee couldn't load a picture.", e); return fail(500, 'Image cache error.'); }).finally(() => inflight.delete(url));
      inflight.set(url, p);
    }
    const r = await p;
    return { ...r, body: Buffer.from(r.body) }; // callers get their own copy
  }

  const ready = evict().then(() => {}, e => { fail_("Matinee couldn't tidy its picture cache.", e); });
  return { handle, evict, ready, get totalBytes() { return total; } };
}
