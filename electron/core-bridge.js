// The two ends of the channel between Electron's main process and the core, which runs in a utility process.
// No Electron imports, so both ends are unit-tested with an in-memory channel. Protocol: see docs/briefs/core-process.md.
//   Child -> main: hello | ready | fatal | result | event | render | render-abort | cookies | log | problem | closed
//   `problem` = { area, message, detail, level }: something the child could not report itself (a crash handler, an unexpected core error).
//   Main -> child: init | call | render-event | render-result | cookies-result | close
// `cookies` asks main for the cookies of a domain from the shared web session (the utility process cannot reach Electron's session):
//   { type: 'cookies', id, domain } -> { type: 'cookies-result', id, cookies: [{ name, domain, secure, session }] } | { ..., error: { message } }.
import { runCall, createEventForwarder } from './rpc.js';

const FAILED_JSON = JSON.stringify({ error: { message: 'Matinee stopped responding. Try again in a moment.', code: 'ipc' } });
const GENERIC_JSON = JSON.stringify({ error: { message: 'Something went wrong. Try again in a moment.', code: 'error' } });
const aborted = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

// ---------------------------------------------------------------- child side

/**
 * @param {{ post(msg): void, loadCore(): Promise<{createCore: Function}>, makeFetch(): Function, friendlyError(e): string }} deps
 * @returns {{ onMessage(msg): void }}
 */
export function createCoreHost({ post, loadCore, makeFetch, friendlyError }) {
  let core = null;
  let failed = false;
  let renderId = 0;
  const renders = new Map(); // id -> { resolve, reject }
  let cookieId = 0;
  const cookieAsks = new Map(); // id -> { resolve, reject, timer }
  const forwarder = createEventForwarder((event, payload) => post({ type: 'event', event, payload }));
  let markReady;
  const ready = new Promise(r => { markReady = r; });

  const proxyRender = (url, { signal, waitFor, settleMs, priority, failOnChallenge, onCheck } = {}) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(aborted());
    const id = ++renderId;
    const done = fn => v => { renders.delete(id); if (signal) signal.removeEventListener('abort', onAbort); fn(v); };
    const entry = { resolve: done(resolve), reject: done(reject), onCheck };
    function onAbort() { if (renders.has(id)) { post({ type: 'render-abort', id }); entry.reject(aborted()); } }
    renders.set(id, entry);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    post({ type: 'render', id, url, opts: { waitFor, settleMs, priority, failOnChallenge } });
  });

  /** The browser session's cookies for a domain, from main (for Settings → Test fetch; names only are kept by the report). Rejects after 5 s. */
  const askCookies = domain => new Promise((resolve, reject) => {
    const id = ++cookieId;
    const timer = setTimeout(() => { cookieAsks.delete(id); reject(new Error('The cookie check timed out.')); }, 5000);
    if (timer.unref) timer.unref();
    cookieAsks.set(id, { resolve, reject, timer });
    post({ type: 'cookies', id, domain: String(domain) });
  });

  /** Tell main about a problem (it logs it and puts it in the problem list). Never throws. */
  function noteProblem(area, message, error, level = 'error') {
    try {
      const detail = error instanceof Error ? [error.code, error.message, String(error.stack || '').split('\n').map(x => x.trim()).find(x => x.startsWith('at '))].filter(Boolean).join(' · ') : String(error ?? '');
      post({ type: 'problem', area, message, detail: detail.slice(0, 400), level });
    } catch { /* the channel itself is broken: nothing more can be done from here, main sees the process exit */ }
  }

  async function init({ dataDir, logsDir, appDir, browserUserAgent }) {
    let mod;
    try { mod = await loadCore(); } catch (e) {
      failed = true; markReady();
      return post({ type: 'fatal', stage: 'load', message: friendlyError(e), detail: String(e && e.stack || e) });
    }
    try {
      const f = makeFetch();
      core = mod.createCore({ dataDir, logsDir, appDir, fetch: f, browserFetch: f, browserUserAgent, render: proxyRender, cookieProbe: askCookies, onEvent: forwarder.emit });
    } catch (e) {
      failed = true; markReady();
      return post({ type: 'fatal', stage: 'open', message: friendlyError(e), detail: String(e && e.stack || e) });
    }
    post({ type: 'ready' });
    markReady();
  }

  async function call({ id, method, args }) {
    await ready;
    let json;
    if (!core) json = FAILED_JSON;
    else {
      const envelope = await runCall(core, method, args, line => post({ type: 'log', line: String(line) }), (m, e) => noteProblem('App', `Something went wrong inside Matinee (${m}).`, e));
      try { json = JSON.stringify(envelope); } catch (e) {
        noteProblem('App', `Matinee couldn't pass the answer to ${String(method)} to the window.`, e);
        json = GENERIC_JSON;
      }
      if (typeof json !== 'string') json = GENERIC_JSON;
    }
    post({ type: 'result', id, json });
  }

  return {
    onMessage(msg) {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'init': init(msg); break;
        case 'call': call(msg); break;
        case 'render-event': { // the page window told us something while the read is still going (a human check opened)
          const p = renders.get(msg.id);
          if (p && msg.event === 'check' && typeof p.onCheck === 'function') { try { p.onCheck(); } catch (e) { noteProblem('Page reading', 'A website check notice could not be passed on.', e, 'warning'); } }
          break;
        }
        case 'render-result': {
          const p = renders.get(msg.id);
          if (!p) break;
          if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
          else p.resolve(msg.result);
          break;
        }
        case 'cookies-result': {
          const a = cookieAsks.get(msg.id);
          if (!a) break;
          cookieAsks.delete(msg.id); clearTimeout(a.timer);
          if (msg.error) a.reject(new Error(msg.error.message || 'The cookie check failed.')); else a.resolve(Array.isArray(msg.cookies) ? msg.cookies : []);
          break;
        }
        case 'close':
          forwarder.dispose();
          try { if (core) core.close(); } catch (e) { post({ type: 'log', line: `Could not close the library cleanly: ${e && e.stack || e}` }); noteProblem('App', "Matinee couldn't close the library cleanly.", e); }
          post({ type: 'closed' });
          break;
        default: break;
      }
    },
    /** A crash handler of the child process (uncaught exception / unhandled rejection): log it, report it, carry on. */
    noteCrash(kind, e) {
      try { post({ type: 'log', line: `[core] ${kind}: ${e && e.stack || e}` }); } catch { /* channel gone: stderr below still has it */ }
      console.error(`[core] ${kind}:`, e);
      noteProblem('App', 'Matinee hit an unexpected error in its background process.', e);
    },
  };
}

// ------------------------------------------------------------------ main side

/**
 * @param {{
 *   spawn(): { postMessage(m): void, on(ev: 'message'|'exit', fn): void, kill(): void, pid?: number },
 *   init: { dataDir: string, browserUserAgent?: string },
 *   render(url, opts): Promise<{status, url, text}>,
 *   cookies?(domain): Promise<Array<{name, domain, secure, session}>>   // the web session's cookies (optional; without it the check is skipped)
 *   onEvent(event, payload): void, log(...a): void, onFatal(message: string): void,
 *   now?: () => number, timeouts?: { callWait?: number, closeWait?: number, restartWindow?: number, maxRestarts?: number },
 * }} deps
 */
export function createCoreClient({ spawn, init, render, cookies = null, onEvent, log = () => {}, report = () => {}, onFatal = () => {}, now = Date.now, timeouts = {} }) {
  const T = { callWait: 30_000, closeWait: 5_000, restartWindow: 120_000, maxRestarts: 3, ...timeouts };
  let child = null;
  let state = 'down'; // down | starting | ready
  let closing = false, closeP = null;
  let nextId = 0;
  const pending = new Map(); // call id -> resolve
  const renders = new Map(); // render id -> AbortController
  const waiters = new Set(); // functions to run on next ready
  const restarts = [];
  let startHandlers = null; // { resolve, reject } while the first start is in flight
  let closedResolve = null;

  // Never throws: a problem in reporting is only logged.
  const note = (area, message, error, level = 'error') => {
    try { log(message, error); report({ area, message, error, level }); } catch { /* logging must never break the app */ }
  };
  let exitNote = null; // an unexpected exit, reported once the replacement process is up (the problem list lives in the core)

  const failAll = () => {
    for (const resolve of pending.values()) resolve(FAILED_JSON);
    pending.clear();
    for (const ac of renders.values()) ac.abort();
    renders.clear();
  };

  function launch() {
    state = 'starting';
    const me = spawn();
    child = me;
    let exited = false;
    me.on('message', msg => {
      if (child !== me || !msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'hello': me.postMessage({ type: 'init', ...init }); break;
        case 'ready': {
          const wasRestart = !startHandlers;
          state = 'ready';
          for (const w of [...waiters]) w();
          waiters.clear();
          if (startHandlers) { startHandlers.resolve(); startHandlers = null; }
          if (wasRestart) {
            onEvent('state', undefined); onEvent('library', undefined);
            if (exitNote) { const n = exitNote; exitNote = null; note('App', 'Matinee’s background process stopped and was restarted.', n.detail, n.level); }
          }
          break;
        }
        case 'fatal': {
          note('App', 'Matinee could not start its library.', `${msg.stage}: ${msg.detail || msg.message}`);
          const err = Object.assign(new Error(msg.message), { stage: msg.stage });
          try { me.kill(); } catch (e) { log('Could not stop the core process (already gone):', e); }
          if (startHandlers) { startHandlers.reject(err); startHandlers = null; } else onFatal(msg.message);
          break;
        }
        case 'result': { const r = pending.get(msg.id); if (r) { pending.delete(msg.id); r(msg.json); } break; }
        case 'event': onEvent(msg.event, msg.payload); break;
        case 'log': log(msg.line); break;
        case 'problem': note(String(msg.area || 'App'), String(msg.message || 'Something went wrong.'), msg.detail, msg.level === 'warning' ? 'warning' : 'error'); break;
        case 'closed': if (closedResolve) closedResolve(); break;
        case 'render': {
          const ac = new AbortController();
          renders.set(msg.id, ac);
          const onCheck = () => { if (child === me && !exited) me.postMessage({ type: 'render-event', id: msg.id, event: 'check' }); };
          Promise.resolve().then(() => render(msg.url, { ...msg.opts, signal: ac.signal, onCheck })).then(
            r => ({ result: { status: r.status, url: r.url, text: r.text, ...(r.challenge ? { challenge: true } : {}), ...(r.shown ? { shown: true } : {}) } }),
            e => {
              if (!e || e.code !== 'aborted') note('Page reading', "Matinee couldn't open a page in its built-in browser.", e, 'warning');
              return { error: { message: (e && e.message) || 'Could not load the page.', code: e && e.code } };
            },
          ).then(out => {
            renders.delete(msg.id);
            if (child === me && !exited) me.postMessage({ type: 'render-result', id: msg.id, ...out });
          });
          break;
        }
        case 'render-abort': { const ac = renders.get(msg.id); if (ac) ac.abort(); break; }
        case 'cookies': {
          const reply = out => { if (child === me && !exited) me.postMessage({ type: 'cookies-result', id: msg.id, ...out }); };
          if (typeof cookies !== 'function') { reply({ error: { message: 'No cookie access.' } }); break; }
          Promise.resolve().then(() => cookies(msg.domain)).then(
            list => reply({ cookies: (Array.isArray(list) ? list : []).map(c => ({ name: String(c.name), domain: String(c.domain || ''), secure: !!c.secure, session: !!c.session })) }),
            e => { log('The cookie check failed:', e); reply({ error: { message: (e && e.message) || 'The cookie check failed.' } }); },
          );
          break;
        }
        default: break;
      }
    });
    me.on('exit', code => {
      exited = true;
      if (child !== me) return;
      child = null; state = 'down';
      if (closedResolve) closedResolve();
      if (closing) return;
      log('The core process stopped unexpectedly, exit code', code);
      failAll();
      const detail = `exit code ${code}`;
      if (startHandlers) { startHandlers.reject(new Error('The core process stopped while starting.')); startHandlers = null; return; } // main logs and shows the start failure
      exitNote = { detail, level: code === 0 ? 'warning' : 'error' };
      const t = now();
      while (restarts.length && t - restarts[0] > T.restartWindow) restarts.shift();
      restarts.push(t);
      if (restarts.length > T.maxRestarts) { exitNote = null; log('The core process kept stopping; giving up after', restarts.length, 'exits.'); return onFatal('Matinee hit a problem and has to close. Your library is safe.'); }
      launch(); // only now that the old process has exited: never two writers of the library
    });
  }

  return {
    get pid() { return child && child.pid; },
    start() {
      return new Promise((resolve, reject) => { startHandlers = { resolve, reject }; launch(); });
    },
    /** Resolves the JSON string of { result } or { error }; never rejects. */
    call(method, args) {
      return new Promise(resolve => {
        if (closing) return resolve(FAILED_JSON);
        const send = () => {
          const id = ++nextId;
          pending.set(id, resolve);
          child.postMessage({ type: 'call', id, method, args });
        };
        if (state === 'ready' && child) return send();
        const w = () => { clearTimeout(timer); send(); };
        const timer = setTimeout(() => { waiters.delete(w); note('App', 'A request waited too long for Matinee’s background process and was given up.', String(method), 'warning'); resolve(FAILED_JSON); }, T.callWait);
        waiters.add(w);
      });
    },
    /** Ask the core to save and stop, then make sure the process is gone. Safe to call twice. */
    close() {
      if (closeP) return closeP;
      closing = true;
      const me = child;
      if (!me) { failAll(); return (closeP = Promise.resolve()); }
      closeP = new Promise(resolve => {
        const timer = setTimeout(done, T.closeWait);
        function done() {
          clearTimeout(timer);
          if (child === me) { try { me.kill(); } catch (e) { log('Could not stop the core process (already gone):', e); } }
          failAll();
          resolve();
        }
        closedResolve = done;
        try { me.postMessage({ type: 'close' }); } catch (e) { log('Could not ask the core to close; stopping it instead:', e); done(); }
      });
      return closeP;
    },
  };
}
