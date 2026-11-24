// Loads a page in a hidden, real Chromium window so pages that build themselves in the browser work.
// Injected into core as `render` (see core/net.js http.page). Polite by design: one page at a time, nothing cached here,
// no tricks. If a website shows a "check you're human" page we show the window so a person can complete it, then carry on.
import { createLimiter } from '../core/util/limiter.js';

const CHALLENGE_TITLE = /just a moment|attention required|are you a robot|verify you are human/i;
// Real pages often carry Cloudflare bits too (a background script, a hidden Turnstile widget), so the markup only counts
// on a small page. The title is the reliable signal for the full-page "Just a moment" check.
const CHALLENGE_MARKUP = /cf-challenge|cf-chl-|challenge-running|challenge-form|challenge-platform/i;
const SMALL_PAGE = 20000;

/** True when the page is a bot check / interstitial rather than the page we asked for. */
export function looksLikeChallenge({ title = '', html = '', hasContent = false } = {}) {
  if (CHALLENGE_TITLE.test(title || '')) return true;
  if (hasContent) return false; // the page we waited for is there
  return (html || '').length < SMALL_PAGE && CHALLENGE_MARKUP.test(html || '');
}

/** Electron's default user agent without the "Electron/x.y.z" and app ("matinee/x.y.z") tokens. */
export function cleanUserAgent(ua = '') {
  return String(ua).replace(/\s+Electron\/\S+/gi, '').replace(/\s+matinee\/\S+/gi, '').replace(/\s{2,}/g, ' ').trim();
}

const aborted = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const hostOf = url => { try { return new URL(url).hostname; } catch { return 'a website'; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEFAULTS = { loadMs: 30000, waitForMs: 8000, pollMs: 250, challengePollMs: 1500, challengeMs: 3 * 60 * 1000, evalMs: 8000, idleMs: 2 * 60 * 1000 };

export function createPageRenderer({ BrowserWindow, session, showChallenge, partition = 'persist:matinee-web', timeouts = {}, log = () => {}, report = () => {} } = {}) {
  const T = { ...DEFAULTS, ...timeouts };
  // Nothing here is silent: every failure is logged; the ones that matter also go to the app's problem list (de-duplicated there).
  const note = (...a) => { try { log(...a); } catch { /* logging must never break page reading */ } };
  const fail = (message, error, level = 'warning') => { note(message, error); try { report({ area: 'Page reading', message, error, level }); } catch { /* same */ } };
  let lastSnapError = '';
  let win = null;
  const statuses = new WeakMap(); // window -> last main-frame HTTP status (each window keeps its own)
  const checkWins = new Set();    // windows shown to the user for a human check (kept apart from the worker window)
  let disposed = false;
  // One page at a time; lower priority number first (0 = a film the user opened), FIFO inside a lane, cancelled jobs dropped while queued.
  const queue = createLimiter({ concurrency: 1, gap: 0 });
  let idleTimer = null;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (queue.pending() === 0 && !rendering && win && !win.isDestroyed()) { win.destroy(); win = null; }
    }, T.idleMs);
    if (idleTimer.unref) idleTimer.unref();
  };
  let rendering = 0;

  // `images: false` keeps the worker window light; the window the user is asked to use for a check shows images, since some checks need them.
  function makeWindow({ images = false, checking = false } = {}) {
    const w = new BrowserWindow({
      show: false, width: 1100, height: 800, title: 'Matinee — a website wants you to check you’re human', autoHideMenuBar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition, images },
    });
    const wc = w.webContents;
    const ses = session ? session.fromPartition(partition) : wc.session;
    ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', e => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.userAgent = cleanUserAgent(wc.userAgent);
    wc.on('did-navigate', (_e, _url, code) => { if (code) statuses.set(w, code); });
    wc.on('render-process-gone', (_e, d) => fail('The built-in browser window stopped unexpectedly.', `${d && d.reason} (exit code ${d && d.exitCode})`, d && (d.reason === 'clean-exit' || d.reason === 'killed') ? 'warning' : 'error'));
    wc.on('unresponsive', () => fail('The built-in browser window stopped responding.', 'unresponsive'));
    // Closing the worker window while it is visible must not break the app: just hide it. Closing a check window means the user
    // dismissed the check, so it really closes (the wait loop sees it is gone).
    if (!checking) w.on('close', e => { if (!disposed && !w.isDestroyed() && w.isVisible()) { e.preventDefault(); w.hide(); } });
    return w;
  }
  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = makeWindow();
    return win;
  }

  // A script call that never settles (the page navigated mid-call) must not hold up every later render.
  const evalPage = (wc, code) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The page did not answer.')), T.evalMs);
    Promise.resolve(wc.executeJavaScript(code, true)).then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
  const snapshot = async wc => {
    try { return await evalPage(wc, '({ title: document.title, html: document.documentElement.outerHTML, hasContent: false })'); }
    catch (e) {
      // The page navigated or was closed mid-read: treated as an empty page. Logged when the reason changes, so a 1.5 s poll can't flood the log.
      if (lastSnapError !== String(e && e.message)) { lastSnapError = String(e && e.message); note('Could not read the page in the built-in browser:', e); }
      return { title: '', html: '', hasContent: false };
    }
  };

  // Polls for the element the caller needs (or just settles when none was named). True when the element showed up.
  async function waitForContent(wc, { signal, waitFor, settleMs }) {
    if (waitFor) {
      const sel = JSON.stringify(String(waitFor));
      const end = Date.now() + T.waitForMs;
      while (Date.now() < end) {
        if (signal?.aborted) throw aborted();
        if (await evalPage(wc, `!!document.querySelector(${sel})`).catch(() => false /* expected: the page is still loading or navigating; we poll again */)) return true;
        await sleep(T.pollMs);
      }
      return false;
    }
    await sleep(settleMs ?? 600);
    return false;
  }

  async function load(wc, url, signal) {
    await new Promise((resolve, reject) => {
      let timer;
      const done = (fn, v) => { clearTimeout(timer); wc.removeListener('did-finish-load', onOk); wc.removeListener('did-fail-load', onFail); signal?.removeEventListener('abort', onAbort); fn(v); };
      const onOk = () => done(resolve);
      const onFail = (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) done(reject, Object.assign(new Error(desc || 'Could not load the page.'), { code: 'load-failed' })); };
      const onAbort = () => { try { wc.stop(); } catch (e) { note('Could not stop a page load (window gone):', e); } done(reject, aborted()); };
      wc.on('did-finish-load', onOk);
      wc.on('did-fail-load', onFail);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { try { wc.stop(); } catch (e) { note('Could not stop a slow page load (window gone):', e); } done(reject, Object.assign(new Error('The page took too long to load.'), { code: 'timeout' })); }, T.loadMs);
      Promise.resolve(wc.loadURL(url)).catch(e => note('The built-in browser could not start loading a page (did-fail-load decides the outcome):', e && e.message));
    });
  }

  // The user is asked to complete a check themselves: a separate, visible window loads the page and we wait (outside the render queue, so
  // reads of other sites carry on) until the page is real, the user closes the window, or the time is up. Nothing is ever done for the user.
  async function runCheck(url, { signal, onCheck, waitFor, settleMs }) {
    const cw = makeWindow({ images: true, checking: true });
    checkWins.add(cw);
    const wc = cw.webContents;
    let cleared = false, html = '', finalUrl = url;
    try {
      try { showChallenge ? showChallenge(cw) : cw.show(); } catch (e) { fail("Matinee couldn't show the website's check window.", e, 'error'); }
      try { if (onCheck) onCheck(); } catch (e) { note('A website check notice could not be passed on:', e); }
      try { await load(wc, url, signal); } catch (e) { if (e.code === 'aborted') throw e; note('The website check page did not finish loading (waiting for the user to deal with it):', e && e.message); }
      const end = Date.now() + T.challengeMs;
      while (Date.now() < end) {
        if (signal?.aborted) throw aborted();
        if (cw.isDestroyed() || !cw.isVisible()) break; // the user closed it
        const snap = await snapshot(wc);
        if (snap.html && !looksLikeChallenge(snap)) { cleared = true; break; }
        await sleep(T.challengePollMs);
      }
      if (cleared) {
        // The first non-check snapshot may be a half-loaded document: wait for the content the caller needs, then look again.
        let hasContent = false;
        try { hasContent = await waitForContent(wc, { signal, waitFor, settleMs: Math.min(settleMs ?? 600, 2000) }); }
        catch (e) { if (e.code === 'aborted') throw e; note('Could not wait for the page after the website check:', e && e.message); }
        const snap = await snapshot(wc);
        if (looksLikeChallenge({ ...snap, hasContent })) cleared = false;
        else { html = snap.html; try { finalUrl = wc.getURL() || url; } catch (e) { note('Could not read the page address after the check:', e); } }
      }
    } finally {
      checkWins.delete(cw);
      if (!cw.isDestroyed()) { try { cw.hide(); } catch (e) { note('Could not hide the website check window:', e); } cw.destroy(); }
    }
    if (!cleared) return { status: 403, url, text: '', challenge: true, shown: true };
    return { status: 200, url: finalUrl, text: html, shown: true };
  }

  async function renderOne(url, { signal, outerSignal, waitFor, settleMs, failOnChallenge = false, onCheck = null } = {}) {
    if (signal?.aborted) throw aborted();
    const w = ensureWindow();
    const wc = w.webContents;
    statuses.set(w, 0);
    try { await load(wc, url, signal); }
    catch (e) {
      if (e.code === 'aborted') throw e;
      fail(`Matinee couldn't open a page from ${hostOf(url)} in its built-in browser.`, `${e.code || ''} ${e.message || ''} ${url}`);
      return { status: 0, url, text: '' };
    }

    let hasContent = await waitForContent(wc, { signal, waitFor, settleMs });

    const snap = await snapshot(wc);
    if (looksLikeChallenge({ ...snap, hasContent })) {
      // Declined on request (a cooldown is running, or the caller asked): report the check and move on.
      if (failOnChallenge) return { status: 403, url, text: '', challenge: true };
      // Only one check window may exist at a time: another host's read fails soft instead of stacking a second window.
      if (checkWins.size > 0) return { status: 403, url, text: '', challenge: true };
      // Otherwise show the user a window to complete the check themselves. The queue is freed while they decide (see render()).
      return { pendingCheck: runCheck(url, { signal: outerSignal || signal, onCheck, waitFor, settleMs }) };
    }
    let finalUrl = url;
    try { finalUrl = wc.getURL() || url; } catch (e) { note('Could not read the page address:', e); }
    return { status: statuses.get(w) || 200, url: finalUrl, text: snap.html };
  }

  // Overall deadline: if anything inside still hangs, drop the window (a fresh one is made next time) and report a failed load.
  async function renderWithDeadline(url, opts) {
    const inner = new AbortController();
    const onOuter = () => inner.abort();
    if (opts.signal?.aborted) throw aborted();
    opts.signal?.addEventListener('abort', onOuter, { once: true });
    let timer, expired = false;
    const deadline = new Promise(resolve => {
      timer = setTimeout(() => { expired = true; inner.abort(); resolve({ status: 0, url, text: '' }); }, T.deadlineMs ?? T.loadMs + 2 * T.waitForMs + T.challengeMs + 60000);
    });
    const work = renderOne(url, { ...opts, signal: inner.signal, outerSignal: opts.signal });
    work.catch(e => { if (expired && (!e || e.code !== 'aborted')) note('Abandoned page read ended with an error:', e); }); // after a deadline the abandoned work may still reject
    try { return await Promise.race([work, deadline]); }
    catch (e) { if (expired) return { status: 0, url, text: '' }; throw e; } // an expired read was reported in `finally`
    finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuter);
      if (expired) fail(`A page from ${hostOf(url)} took too long, so Matinee gave up on it.`, url);
    if (expired && win && !win.isDestroyed()) { win.destroy(); win = null; }
    }
  }

  return {
    /**
     * Loads `url` and returns { status, url, text }. One at a time, in priority order (`opts.priority`, lower first, default 3).
     * `opts.failOnChallenge`: if the page is a bot check, return { status: 403, challenge: true } straight away instead of showing it.
     * Otherwise a check is shown to the user in its own window (`opts.onCheck()` is called when it opens); the result then has `shown: true`
     * and either the real page (the user completed it) or `challenge: true` (the user closed it or time ran out).
     */
    render(url, opts = {}) {
      if (disposed) return Promise.reject(new Error('Closed.'));
      return queue(async () => {
        if (disposed) throw new Error('Closed.');
        rendering++;
        try { return await renderWithDeadline(url, opts); }
        finally { rendering--; armIdle(); }
      }, { priority: opts.priority ?? 3, signal: opts.signal }).then(out => (out && out.pendingCheck ? out.pendingCheck : out));
    },
    dispose() {
      disposed = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      for (const cw of [...checkWins]) { try { if (!cw.isDestroyed()) cw.destroy(); } catch (e) { note('Could not close a website check window:', e); } }
      checkWins.clear();
    },
  };
}
