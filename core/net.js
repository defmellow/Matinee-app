// HTTP for providers: per-host politeness (concurrency + gap), priority lanes, retries on 429/5xx, a per-host pause when a
// site says "slow down", a per-host breaker when a site keeps turning us away, friendly errors.
// The fetch implementation is injected so Electron can use Chromium's network stack and tests can fake it.
import { createLimiter } from './util/limiter.js';
import { siteForHost } from './fetchlog.js';

export const USER_AGENT = 'Matinee/1.0 (personal film library app; https://github.com/defmellow/matinee-app)';
// Some sites only serve normal pages to browsers.
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const HOST_LIMITS = {
  // 29 Oct, : speed above all. A Test fetch showed every site answering fine (0 blocked, 0 errors in 161 requests) while one-at-a-time
  // pacing made Metacritic (35 requests x ~3 s) and the single page window the bottleneck, so every host gets parallelism. The per-host breaker
  // (3 blocks in 2 min) and the 429 Retry-After pause still protect each site.
  'query.wikidata.org': { concurrency: 3, gap: 500 },
  'www.wikidata.org': { concurrency: 3, gap: 250 },
  'en.wikipedia.org': { concurrency: 4, gap: 80 },
  'www.rottentomatoes.com': { concurrency: 3, gap: 500 },
  'www.metacritic.com': { concurrency: 4, gap: 400 },
  'api.themoviedb.org': { concurrency: 6, gap: 40 },
  'www.omdbapi.com': { concurrency: 4, gap: 100 },
  'datasets.imdbws.com': { concurrency: 1, gap: 0 },
  'letterboxd.com': { concurrency: 3, gap: 700 },
  'boxd.it': { concurrency: 6, gap: 80 },
  'www.imdb.com': { concurrency: 3, gap: 800 },
  'www.allmovie.com': { concurrency: 4, gap: 500 },
  'newtown.dendy.com.au': { concurrency: 1, gap: 1800 }, // Dendy Newtown listings: plain pages, a few a day (core/sources/dendy.js)
  default: { concurrency: 3, gap: 200 },
};

const isTimeout = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');

export class HttpError extends Error {
  constructor(status, url, message) { super(message || `HTTP ${status} for ${url}`); this.status = status; this.url = url; }
}

const stopped = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PRIORITY = 3;
const MAX_WAIT_MS = 10 * 60_000;                 // longer than this and we leave the site alone instead of waiting
const BLOCK_WINDOW_MS = 2 * 60_000, BLOCKS_TO_OPEN = 3;
const OPEN_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]; // 15 min, then 1 h, then 6 h on repeats
// 29 Oct: a host pause longer than this is never waited out (the read is deferred and the film carries on with other sources);
// shorter ones are still waited for. This is not a pacing number: requests are spaced exactly as before.
const SHORT_PAUSE_MS = 20_000;
// 29 Oct: after a "check you're human" window was shown for a host and not completed, background reads of that host fail soft
// (no window) for this long, so the user is asked once, not repeatedly.
const CHECK_COOLDOWN_MS = 10 * 60_000;
const MISSED_RECENT_MS = 60_000;

const header = (res, name) => { try { return res && res.headers && res.headers.get ? res.headers.get(name) : null; } catch { return null; } };
const isChallengeHeader = res => /challenge/i.test(header(res, 'cf-mitigated') || '');
const prettyHost = host => String(host).replace(/^www\./, '');
const minutes = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? `${Math.round(m / 60)} hour${m >= 90 ? 's' : ''}` : `${m} minute${m === 1 ? '' : 's'}`; };

/** Retry-After as milliseconds: whole seconds or an HTTP date. null when missing, zero, past or unreadable. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  let ms;
  if (/^\d+$/.test(v)) ms = Number(v) * 1000;
  else { const t = Date.parse(v); ms = Number.isFinite(t) ? t - now : NaN; }
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}
const attemptSignal = (signal, ms) => { const t = AbortSignal.timeout(ms); return signal ? AbortSignal.any([signal, t]) : t; };

/**
 * @param {{ fetch?: typeof fetch, browserFetch?: typeof fetch, browserUserAgent?: string, render?: (url, opts) => Promise<{status,url,text,challenge?}>, userAgent?: string, limits?: object, retries?: number, clock?: object }} opts
 *   `browserFetch` is a plain GET through the browser's own network stack and cookie jar (Electron: the same session as the page window,
 *   so any check the user has completed there counts). Without it browserText() uses `fetch`.
 *   `render` loads a page the way a browser does (scripts run). Electron injects a hidden Chromium window, dev can inject Playwright.
 *   `clock` ({ now, setTimeout, clearTimeout }) is for tests.
 * Every request method takes `priority` (lower runs first, default 3); `withPriority(n)` returns the same methods defaulting to n.
 * @returns {{ text, json, response, page, browserText, observe, limitsFor, hostStatus, withPriority }}
 */
export function createHttp({ fetch: fetchImpl = globalThis.fetch, browserFetch = null, browserUserAgent = BROWSER_UA, render = null, userAgent = USER_AGENT, limits = {}, retries = 3, clock = null } = {}) {
  const clk = clock || { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };
  const now = () => clk.now();
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(stopped());
    const onAbort = () => { clk.clearTimeout(t); reject(stopped()); };
    const t = clk.setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  const table = { ...HOST_LIMITS, ...limits };
  const limiters = new Map();
  const breakers = new Map();
  const watchers = new Set();
  const missedAt = new Map(); // host -> when the user last dismissed/missed a check window (a film the user opens waits a minute before asking again)
  const checks = new Map(); // host -> time until which background reads must not ask for a human check again
  const emit = n => { for (const w of watchers) { try { w(n); } catch { /* a listener must never break a fetch */ } } };
  const note = (host, text) => emit({ host, kind: 'wait', text });
  const limiterFor = host => {
    if (!limiters.has(host)) limiters.set(host, createLimiter({ ...(table[host] || table.default), clock: clk }));
    return limiters.get(host);
  };
  const breakerFor = host => {
    if (!breakers.has(host)) breakers.set(host, { blocks: [], level: 0, openUntil: 0, opened: false, probing: false, override: false, reason: '' });
    return breakers.get(host);
  };

  const hostPaused = (host, url, until) => Object.assign(
    new HttpError(429, url, `${prettyHost(host)} is being left alone for a while.`), { code: 'host-paused', until });

  function openBreaker(host, reason, escalate = true) {
    const b = breakerFor(host);
    // A film the user opened is allowed one probe through an open breaker; if that is turned away too, the wait is restarted at the same level.
    const ms = OPEN_MS[Math.min(escalate ? b.level : Math.max(0, b.level - 1), OPEN_MS.length - 1)];
    if (escalate) b.level++;
    b.opened = true; b.probing = false; b.override = false; b.blocks = []; b.reason = reason;
    b.openUntil = now() + ms;
    emit({ host, kind: 'breaker-open', until: b.openUntil, text: `${prettyHost(host)} keeps turning requests away, so Matinee will leave it alone for ${minutes(ms)}.` });
  }

  /**
   * Before a request starts: throws while the breaker is open; returns true when this request is the one probe after it.
   * Priority 0 (a film the user opened) may take the probe early, because the user may just have completed a check.
   */
  function gate(host, url, priority = DEFAULT_PRIORITY) {
    const b = breakerFor(host);
    if (b.openUntil > now()) {
      if (priority === 0 && !b.probing) { b.probing = true; b.override = true; return true; }
      throw hostPaused(host, url, b.openUntil);
    }
    if (!b.opened) return false;
    if (b.probing) throw hostPaused(host, url, b.openUntil);
    b.probing = true;
    return true;
  }

  /** Learn from an answer: count blocks, trip or close the breaker. `status` 0 means "no answer" (probe is released). */
  function judge(host, { status, challenge = false }, probe) {
    const b = breakerFor(host);
    const hard = !!challenge;
    const blocked = status === 429 || status === 403 || hard;
    if (blocked) {
      const t = now();
      b.blocks = b.blocks.filter(x => t - x < BLOCK_WINDOW_MS); b.blocks.push(t);
      if (probe || hard || b.blocks.length >= BLOCKS_TO_OPEN) openBreaker(host, hard ? 'challenge' : status === 429 ? 'too-many-requests' : 'blocked', !(probe && b.override));
      return;
    }
    if (probe) {
      if (status > 0 && status < 500) closeBreaker(host);
      else { b.probing = false; b.override = false; }
    }
  }

  function closeBreaker(host) {
    const b = breakerFor(host);
    const was = b.opened;
    b.opened = false; b.probing = false; b.override = false; b.level = 0; b.openUntil = 0; b.blocks = []; b.reason = '';
    if (was) emit({ host, kind: 'breaker-closed', until: 0, text: `${prettyHost(host)} is answering again.` });
  }

  /** The site said "slow down": nobody starts a request to this host until the wait is over. */
  function pauseHost(host, ms) {
    const run = limiterFor(host);
    run.pause(ms);
    const until = run.pausedUntil() || now() + ms;
    emit({ host, kind: 'paused', until, text: `${prettyHost(host)} asked Matinee to slow down, waiting ${ms >= 90_000 ? minutes(ms) : `${Math.ceil(ms / 1000)}s`} before trying again.` });
    // A long pause must not hold a queue of reads (and the films behind them): defer them, other sources carry on.
    if (ms > SHORT_PAUSE_MS) run.drop(() => hostPaused(host, `https://${host}/`, until));
  }

  async function response(url, { headers = {}, method = 'GET', body, signal, browser = false, via, accept, retry429 = true, redirect = 'follow', timeoutMs = DEFAULT_TIMEOUT_MS, priority = DEFAULT_PRIORITY } = {}) {
    const host = new URL(url).host;
    const run = limiterFor(host);
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (signal && signal.aborted) throw stopped();
      let wait = 0, pausing = false, tooLong = false;
      try {
        gate0(host, url, priority);
        const res = await run(async () => {
          const probe = gate(host, url, priority);
          let res;
          try {
            res = await (via || fetchImpl)(url, {
              // Each attempt gets its own time limit (started when it really begins, not while queued), so a dead connection
              // can't hold the host's slot or the whole refresh for ever.
              method, body, signal: attemptSignal(signal, timeoutMs), redirect,
              headers: { 'user-agent': browser ? browserUserAgent : userAgent, 'accept-language': 'en-AU,en;q=0.9', ...(accept ? { accept } : {}), ...headers },
            });
          } catch (e) { if (probe) { const b = breakerFor(host); b.probing = false; b.override = false; } throw e; }
          judge(host, { status: res.status, challenge: isChallengeHeader(res) }, probe);
          if (res.status === 429 || res.status >= 500) {
            const ra = parseRetryAfter(header(res, 'retry-after'), now());
            if (ra != null && ra > MAX_WAIT_MS) { tooLong = true; if (breakerFor(host).openUntil <= now()) openBreaker(host, 'asked-to-wait'); }
            else if (res.status === 429 || ra != null) { wait = ra ?? Math.min(15000, 1500 * 2 ** attempt); pausing = true; pauseHost(host, wait); }
            else wait = Math.min(15000, 1500 * 2 ** attempt);
          }
          return res;
        }, { priority, signal });
        if (tooLong) throw new HttpError(res.status, url);
        if (res.status === 429 && !retry429) throw new HttpError(429, url); // caller has another route
        if (res.status === 429 || res.status >= 500) {
          lastErr = new HttpError(res.status, url);
          if (attempt === retries - 1) break;
          if (pausing) note(host, `the site is busy, waiting ${Math.ceil(wait / 1000)}s before trying again`); // the host pause does the waiting
          else { note(host, `the site is busy, waiting ${Math.ceil(wait / 1000)}s before trying again`); await sleep(wait, signal); }
          continue;
        }
        return res;
      } catch (e) {
        // Only the caller pressing Cancel counts as stopped; our own time limit is an ordinary, retryable network error.
        if (signal && signal.aborted) throw stopped();
        if (e.code === 'aborted') throw stopped();
        if (e instanceof HttpError) throw e;
        lastErr = isTimeout(e) ? Object.assign(new Error('The site took too long to answer.'), { code: 'timeout' }) : e;
        if (attempt === retries - 1) break;
        note(host, isTimeout(e) ? 'the site took too long, trying again shortly' : 'connection hiccup, trying again shortly');
        await sleep(1000 * 2 ** attempt, signal);
      }
    }
    throw lastErr;
  }

  // Quick refusal before queueing, so a paused host costs nothing: an open breaker (except the one probe a film the user opened may
  // take) or a long "slow down" pause refuses straight away instead of making the read wait.
  function gate0(host, url, priority = DEFAULT_PRIORITY) {
    const b = breakerFor(host);
    if (b.openUntil > now() && !(priority === 0 && !b.probing)) throw hostPaused(host, url, b.openUntil);
    const lim = limiters.get(host), until = lim ? lim.pausedUntil() : 0;
    if (until && until - now() > SHORT_PAUSE_MS) throw hostPaused(host, url, until);
  }

  async function page(url, { signal, waitFor, settleMs, priority = DEFAULT_PRIORITY, failOnChallenge = false } = {}) {
    if (!render) { const r = await response(url, { signal, browser: true, priority }); return { status: r.status, url: r.url || url, text: await r.text(), headers: r.headers }; }
    if (signal && signal.aborted) throw stopped();
    const host = new URL(url).host;
    gate0(host, url, priority);
    const run = limiterFor(host);
    const site = siteForHost(host);
    const res = await run(async () => {
      const probe = gate(host, url, priority);
      // A check window was shown for this host lately and not completed: background reads must not ask again yet (they fail soft
      // if they meet the check). A film the user opened (priority 0) still asks, but not within a minute of the user's dismissing a window.
      const cooling = (checks.get(host) || 0) > now() && (priority > 0 || now() - (missedAt.get(host) || 0) < MISSED_RECENT_MS);
      let out;
      try {
        out = await render(url, {
          signal, waitFor, settleMs, priority, failOnChallenge: failOnChallenge || cooling,
          onCheck: () => emit({ host, kind: 'check', until: 0, text: `${site} is asking you to check you're human. A window has opened so you can do that.` }),
        });
      } catch (e) { if (probe) { const b = breakerFor(host); b.probing = false; b.override = false; } throw e; }
      const status = out.status || 0;
      // A check page we declined to show counts as a block (not an instant trip: it may just need the user's attention later).
      judge(host, { status: out.challenge && !status ? 403 : status }, probe);
      if (out.shown && out.challenge) {
        // The user was shown the window and did not complete it (closed it, or ran out of time): leave the user's alone for a while.
        checks.set(host, now() + CHECK_COOLDOWN_MS);
        missedAt.set(host, now());
        emit({ host, kind: 'check-missed', until: checks.get(host), text: `${site} still needs a check that Matinee can't do for you. It will leave ${site} alone for a few minutes. Opening a film will ask again.` });
      } else if (out.shown) {
        // The user completed the check: that host is open again straight away.
        checks.delete(host);
        missedAt.delete(host);
        closeBreaker(host);
        emit({ host, kind: 'check-cleared', until: 0, text: `${site} accepted the check.` });
      }
      if (status === 429) pauseHost(host, Math.min(15000, 1500));
      return out;
    }, { priority, signal });
    return { status: res.status, url: res.url || url, text: res.text, headers: res.headers, ...(res.challenge ? { challenge: true } : {}) };
  }

  function build(defPriority) {
    const p = opts => ({ ...opts, priority: opts?.priority ?? defPriority });
    return {
      /** Listen for notices ({ host, kind: 'wait'|'paused'|'breaker-open'|'breaker-closed', until?, text }); returns a function that stops listening. */
      observe(fn) { watchers.add(fn); return () => watchers.delete(fn); },
      /** The pacing rule for a host, e.g. { concurrency: 1, gap: 2500 }. */
      limitsFor(host) { return table[host] || table.default; },
      /** Where each host stands: [{ host, state: 'ok'|'paused'|'open', until, reason, blocks, checkUntil }] (checkUntil: a human check was shown and not completed). */
      hostStatus() {
        const t = now();
        const hosts = new Set([...limiters.keys(), ...breakers.keys(), ...checks.keys()]);
        return [...hosts].map(host => ({ ...stateOf(host, t), checkUntil: (checks.get(host) || 0) > t ? checks.get(host) : 0 }));
        function stateOf(host, t) {
          const b = breakers.get(host);
          const pausedTo = limiters.has(host) ? limiters.get(host).pausedUntil() : 0;
          if (b && b.openUntil > t) return { host, state: 'open', until: b.openUntil, reason: b.reason, blocks: b.blocks.length };
          if (pausedTo) return { host, state: 'paused', until: pausedTo, reason: 'slow-down', blocks: b ? b.blocks.length : 0 };
          return { host, state: 'ok', until: 0, reason: '', blocks: b ? b.blocks.filter(x => t - x < BLOCK_WINDOW_MS).length : 0 };
        }
      },
      withPriority: n => build(n),
      response: (url, opts) => response(url, p(opts)),
      async text(url, opts) {
        const res = await response(url, p(opts));
        const text = await res.text();
        return { status: res.status, url: res.url || url, text, headers: res.headers };
      },
      /**
       * A page as a browser sees it (scripts run, so pages that build themselves in the browser work too).
       * Same result shape as text(). Without an injected renderer it falls back to a plain browser-style request.
       * Paced per host like every other request. `failOnChallenge`: when the page is a "check you're human" page, give up quickly
       * ({ status: 403, challenge: true }) instead of showing the user the window. By default every lane may show the window so the user can
       * complete the check (29 Oct); after a window was shown and not completed, background reads of that
       * host fail soft for 10 minutes instead of asking again. Matinee never completes a check itself.
       */
      page: (url, opts) => page(url, p(opts)),
      /**
       * A page fetched with a plain browser-style GET (no scripts), through the browser's network stack when one is injected.
       * Paced per host like every other request. A 429 comes back as an HttpError straight away (no retry): the caller decides
       * whether to switch to the page window instead. Same result shape as text().
       */
      async browserText(url, opts = {}) {
        const res = await response(url, { signal: opts.signal, browser: true, via: browserFetch || undefined, retry429: false, priority: opts.priority ?? defPriority });
        return { status: res.status, url: res.url || url, text: await res.text(), headers: res.headers };
      },
      async json(url, opts = {}) {
        const res = await response(url, { accept: 'application/json', ...p(opts) });
        if (!res.ok) throw new HttpError(res.status, url);
        return res.json();
      },
    };
  }

  return build(DEFAULT_PRIORITY);
}
