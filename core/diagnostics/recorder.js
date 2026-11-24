// A recording stand-in for the http object from core/net.js. It forwards every call to the real one and writes down what
// happened (host, path without query, status, time, size, a few headers). Nothing about the call changes.
// net.js has no per-request hook (http.observe only reports waits, pauses and breaker changes), so the wrap is done here.
import { splitUrl, scrubText } from './redact.js';

const CHECK_TITLE = /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i;

/** Header value from a Headers object or a plain object; null when missing. Never throws. */
export function headerOf(headers, name) {
  try {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    const k = Object.keys(headers).find(x => x.toLowerCase() === name);
    return k ? String(headers[k]) : null;
  } catch { return null; }
}

/** The headers worth keeping. cf-ray is recorded only as present or not. */
export function notableHeaders(headers) {
  const out = {};
  const mit = headerOf(headers, 'cf-mitigated'); if (mit) out.cfMitigated = String(mit).slice(0, 40);
  const ra = headerOf(headers, 'retry-after'); if (ra) out.retryAfter = String(ra).slice(0, 40);
  const server = headerOf(headers, 'server'); if (server) out.server = String(server).slice(0, 40);
  const ct = headerOf(headers, 'content-type'); if (ct) out.contentType = String(ct).split(';')[0].trim().slice(0, 40);
  if (headerOf(headers, 'cf-ray')) out.cfRay = true;
  return out;
}

export function looksLikeCheckPage(text, headers, flagged = false) {
  return !!flagged || /challenge/i.test(headerOf(headers, 'cf-mitigated') || '') || CHECK_TITLE.test(String(text || '').slice(0, 2000));
}

/**
 * @param {object} o
 * @param {Function} [o.now]      clock, ms
 * @param {string[]} [o.secrets]  values to blank out of error messages
 * @param {number} [o.t0]         test start, so requests carry a time since the start
 * @param {number} [o.max]        most requests kept (the rest are only counted)
 */
export function createRecorder({ now = Date.now, secrets = [], t0 = now(), max = 400 } = {}) {
  const requests = [];
  let seq = 0, dropped = 0;
  const push = r => { if (requests.length < max) requests.push(r); else dropped++; };

  /**
   * A wrapper around `base` (an http object) that tags each request with who made it.
   * @param {object} base  http from createHttp (or its withPriority result)
   * @param {{ provider: string, role?: 'provider'|'probe', lane?: number|null, hasWindow?: boolean, page?: object, film?: () => string|null }} tag
   */
  function wrap(base, tag) {
    const hasWindow = tag.hasWindow !== false;
    const record = async (via, url, run, read) => {
      const { host, path } = splitUrl(url);
      const started = now();
      const entry = { n: ++seq, provider: tag.provider, role: tag.role || 'provider', via,
        method: via === 'page' ? (hasWindow ? 'window' : 'page-plain') : via === 'browserText' ? 'plain-browser' : 'plain',
        lane: tag.lane ?? null, host, path, atMs: started - t0, ms: 0, status: null, bytes: null, headers: {}, challenge: false, error: null, film: null };
      try {
        const res = await run();
        entry.ms = now() - started;
        read(entry, res);
        return res;
      } catch (e) {
        entry.ms = now() - started;
        // A request that net.js refused to start (site paused or breaker open) never reached the site: no status.
        const held = e?.code === 'host-paused';
        entry.status = held ? null : e?.status ?? null;
        entry.error = { code: e?.code || e?.name || 'error', status: held ? null : e?.status ?? null, message: scrubText(e?.message || '', secrets, 160), ...(held ? { held: true } : {}) };
        throw e;
      } finally {
        entry.film = tag.film ? tag.film() : null;
        push(entry);
      }
    };
    const readText = (entry, res) => {
      entry.status = res.status ?? null;
      entry.headers = notableHeaders(res.headers);
      const text = typeof res.text === 'string' ? res.text : '';
      entry.bytes = Buffer.byteLength(text);
      entry.challenge = looksLikeCheckPage(text, res.headers, res.challenge);
    };
    const out = {
      observe: fn => (base.observe ? base.observe(fn) : () => {}),
      limitsFor: h => (base.limitsFor ? base.limitsFor(h) : null),
      hostStatus: () => (base.hostStatus ? base.hostStatus() : []),
      withPriority: n => wrap(base.withPriority ? base.withPriority(n) : base, { ...tag, lane: n }),
      text: (url, opts) => record('text', url, () => base.text(url, opts), readText),
      browserText: (url, opts) => record('browserText', url, () => base.browserText(url, opts), readText),
      page: (url, opts) => record('page', url, () => base.page(url, { ...(tag.page || {}), ...opts }), readText),
      json: (url, opts) => record('json', url, () => base.json(url, opts), (entry, res) => {
        entry.status = 200;
        try { entry.bytes = Buffer.byteLength(JSON.stringify(res)); } catch { /* not serialisable */ }
      }),
      response: (url, opts) => record('response', url, () => base.response(url, opts), (entry, res) => {
        entry.status = res.status ?? null;
        entry.headers = notableHeaders(res.headers);
        const len = Number(headerOf(res.headers, 'content-length'));
        entry.bytes = Number.isFinite(len) ? len : null;
        entry.challenge = looksLikeCheckPage('', res.headers);
      }),
    };
    // Providers test for these with typeof, so only offer what the real object offers.
    for (const m of ['browserText', 'page', 'json', 'response', 'text']) if (typeof base[m] !== 'function') delete out[m];
    return out;
  }
  return { wrap, requests, droppedCount: () => dropped, t0 };
}
