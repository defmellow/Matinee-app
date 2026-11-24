import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cleanUserAgent, createPageRenderer, looksLikeChallenge } from '../../electron/page-renderer.js';

test('looksLikeChallenge: titles and markup', () => {
  assert.equal(looksLikeChallenge({ title: 'Just a moment...', html: '' }), true);
  assert.equal(looksLikeChallenge({ title: 'Attention Required! | Cloudflare', html: '' }), true);
  assert.equal(looksLikeChallenge({ title: 'Paris, Texas', html: '<html></html>' }), false);
  assert.equal(looksLikeChallenge({ title: '', html: '<script src="/cdn-cgi/challenge-platform/x"></script>' }), true);
  assert.equal(looksLikeChallenge({ title: '', html: 'challenge-platform', hasContent: true }), false);
  assert.equal(looksLikeChallenge({ title: 'Film', html: '<script src="/cdn-cgi/challenge-platform/x"></script>' + 'x'.repeat(30000) }), false);
  assert.equal(looksLikeChallenge({ title: 'Film', html: '<div id="cf-chl-widget">' + 'x'.repeat(30000) }), false);
  assert.equal(looksLikeChallenge({}), false);
});

test('cleanUserAgent drops Electron and app tokens', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) matinee/0.1.0 Chrome/141.0.0.0 Electron/38.0.0 Safari/537.36';
  assert.equal(cleanUserAgent(ua), 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
  assert.equal(cleanUserAgent(''), '');
});

// Synthetic stand-in for Electron's BrowserWindow: `pages` maps url -> { title, html, code, hang, challengeFor }.
function fakeElectron(pages, log = []) {
  class FakeWin {
    constructor() {
      this.destroyed = false; this.visible = false; this.handlers = {};
      const wc = this.webContents = new EventEmitter();
      let current = null; let polls = 0;
      wc.userAgent = 'Mozilla/5.0 Chrome/141 Electron/38.0.0';
      wc.setWindowOpenHandler = () => {};
      wc.stop = () => log.push('stop');
      wc.getURL = () => current?.url || '';
      wc.loadURL = async url => {
        log.push('load ' + url);
        const p = pages[url]; current = { url, p }; polls = 0;
        if (!p || p.hang) return;
        setImmediate(() => { wc.emit('did-navigate', {}, url, p.code ?? 200); wc.emit('did-finish-load'); });
      };
      wc.executeJavaScript = async code => {
        const p = current?.p || {};
        if (code.includes('outerHTML')) {
          polls++;
          const challenged = p.challengeFor && polls <= p.challengeFor;
          return challenged ? { title: 'Just a moment...', html: '<p>cf-challenge</p>' } : { title: p.title || '', html: p.html || '' };
        }
        return (p.selectors || []).some(s => code.includes(s));
      };
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    show() { this.visible = true; log.push('show'); }
    hide() { this.visible = false; log.push('hide'); }
    destroy() { this.destroyed = true; log.push('destroy'); }
    on() {}
  }
  const ses = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} });
  return { BrowserWindow: FakeWin, session: { fromPartition: () => ses }, log };
}
const fast = { loadMs: 80, waitForMs: 60, pollMs: 5, challengePollMs: 5, challengeMs: 100 };

test('render returns html and status; user agent is cleaned', async () => {
  const f = fakeElectron({ 'https://x.test/a': { title: 'A', html: '<title>A</title>', code: 200 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const out = await r.render('https://x.test/a', { settleMs: 1 });
  assert.deepEqual(out, { status: 200, url: 'https://x.test/a', text: '<title>A</title>' });
  r.dispose();
});

test('render reports the real HTTP status', async () => {
  const f = fakeElectron({ 'https://x.test/gone': { title: 'Not found', html: '<p>no</p>', code: 404 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  assert.equal((await r.render('https://x.test/gone', { settleMs: 1 })).status, 404);
});

test('a page that never finishes loading gives status 0', async () => {
  const f = fakeElectron({ 'https://x.test/hang': { hang: true } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const out = await r.render('https://x.test/hang', { settleMs: 1 });
  assert.equal(out.status, 0); assert.equal(out.text, '');
});

test('waitFor gives up after the limit but still returns the page', async () => {
  const f = fakeElectron({ 'https://x.test/w': { title: 'W', html: '<p>w</p>', selectors: [] } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const t = Date.now();
  const out = await r.render('https://x.test/w', { waitFor: '.never' });
  assert.equal(out.status, 200); assert.ok(Date.now() - t >= 50);
});

test('requests run one at a time, in order', async () => {
  const f = fakeElectron({ 'https://x.test/1': { html: '1' }, 'https://x.test/2': { html: '2' } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const [a, b] = await Promise.all([r.render('https://x.test/1', { settleMs: 10 }), r.render('https://x.test/2', { settleMs: 1 })]);
  assert.equal(a.text, '1'); assert.equal(b.text, '2');
  assert.deepEqual(f.log.filter(l => l.startsWith('load')), ['load https://x.test/1', 'load https://x.test/2']);
});

test('abort stops loading and throws code aborted', async () => {
  const f = fakeElectron({ 'https://x.test/hang': { hang: true } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, loadMs: 5000 } });
  const ac = new AbortController();
  const p = r.render('https://x.test/hang', { signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, { code: 'aborted' });
  assert.ok(f.log.includes('stop'));
  await assert.rejects(r.render('https://x.test/hang', { signal: ac.signal }), { code: 'aborted' });
});

test('a challenge reveals the window, then hides it once cleared', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'Real', html: '<p>real</p>', code: 403, challengeFor: 3 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const out = await r.render('https://x.test/c', { settleMs: 1 });
  assert.equal(out.text, '<p>real</p>'); assert.equal(out.status, 200);
  assert.deepEqual(f.log.filter(l => l === 'show' || l === 'hide'), ['show', 'hide']);
});

test('an unsolved challenge gives up with 403 and empty text', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const out = await r.render('https://x.test/c', { settleMs: 1 });
  assert.equal(out.status, 403); assert.equal(out.text, '');
  assert.equal(f.log.filter(l => l === 'show').length, 1);
});

test('dispose destroys the window and refuses new work', async () => {
  const f = fakeElectron({ 'https://x.test/a': { html: 'a' } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  await r.render('https://x.test/a', { settleMs: 1 });
  r.dispose();
  assert.ok(f.log.includes('destroy'));
  await assert.rejects(r.render('https://x.test/a'));
});

test('queued renders run in priority order (opened first), FIFO inside a lane', async () => {
  const f = fakeElectron({ 'https://x.test/busy': { html: 'b' }, 'https://x.test/bg1': { html: '1' }, 'https://x.test/bg2': { html: '2' }, 'https://x.test/opened': { html: 'o' } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const jobs = [r.render('https://x.test/busy', { settleMs: 20 })];
  jobs.push(r.render('https://x.test/bg1', { settleMs: 1, priority: 5 }));
  jobs.push(r.render('https://x.test/bg2', { settleMs: 1, priority: 5 }));
  jobs.push(r.render('https://x.test/opened', { settleMs: 1, priority: 0 }));
  await Promise.all(jobs);
  assert.deepEqual(f.log.filter(l => l.startsWith('load')).map(l => l.slice(5)), ['https://x.test/busy', 'https://x.test/opened', 'https://x.test/bg1', 'https://x.test/bg2']);
  r.dispose();
});

test('a queued render that is cancelled is never loaded', async () => {
  const f = fakeElectron({ 'https://x.test/busy': { html: 'b' }, 'https://x.test/skip': { html: 's' } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  const ac = new AbortController();
  const a = r.render('https://x.test/busy', { settleMs: 20 });
  const b = r.render('https://x.test/skip', { settleMs: 1, signal: ac.signal });
  ac.abort();
  await assert.rejects(b, { code: 'aborted' });
  await a;
  assert.ok(!f.log.includes('load https://x.test/skip'));
  r.dispose();
});

test('failOnChallenge returns quickly with challenge: true and never shows the window', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, challengeMs: 5000 } });
  const t = Date.now();
  const out = await r.render('https://x.test/c', { settleMs: 1, failOnChallenge: true });
  assert.deepEqual(out, { status: 403, url: 'https://x.test/c', text: '', challenge: true });
  assert.ok(Date.now() - t < 1000);
  assert.ok(!f.log.includes('show'));
  r.dispose();
});

test('an unsolved visible challenge is flagged challenge: true', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  assert.equal((await r.render('https://x.test/c', { settleMs: 1 })).challenge, true);
  r.dispose();
});

test('the hidden window is disposed when idle and recreated on demand', async () => {
  const f = fakeElectron({ 'https://x.test/a': { html: 'a' } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, idleMs: 20 } });
  await r.render('https://x.test/a', { settleMs: 1 });
  assert.ok(!f.log.includes('destroy'));
  await new Promise(res => setTimeout(res, 60));
  assert.equal(f.log.filter(l => l === 'destroy').length, 1);
  const out = await r.render('https://x.test/a', { settleMs: 1 });
  assert.equal(out.status, 200);
  r.dispose();
});

// ---------- 29 Oct: the check window is shown to the user, outside the queue, and dismissal is noticed ----------
test('a check opens its own visible window, calls onCheck, and reports shown: true when the user completes it', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'Real', html: '<p>real</p>', challengeFor: 3 } });
  const r = createPageRenderer({ ...f, timeouts: fast });
  let told = 0;
  const out = await r.render('https://x.test/c', { settleMs: 1, onCheck: () => { told++; } });
  assert.equal(told, 1); assert.equal(out.shown, true); assert.equal(out.status, 200); assert.equal(out.text, '<p>real</p>');
  assert.equal(f.log.filter(l => l === 'show').length, 1);
  r.dispose();
});

test('a check the user closes is reported as challenge + shown, quickly (not after the full wait)', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, challengeMs: 5000 }, showChallenge: w => { w.show(); setTimeout(() => w.hide(), 30); } });
  const t = Date.now();
  const out = await r.render('https://x.test/c', { settleMs: 1 });
  assert.equal(out.challenge, true); assert.equal(out.shown, true); assert.equal(out.status, 403);
  assert.ok(Date.now() - t < 1500);
  r.dispose();
});

test('while the user decides about a check, reads of other sites carry on', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 }, 'https://y.test/ok': { html: 'fine' } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, challengeMs: 400 } });
  const check = r.render('https://x.test/c', { settleMs: 1 });
  await new Promise(res => setTimeout(res, 30));
  const t = Date.now();
  const other = await r.render('https://y.test/ok', { settleMs: 1 });
  assert.equal(other.text, 'fine');
  assert.ok(Date.now() - t < 300, 'did not wait for the check');
  assert.equal((await check).challenge, true);
  r.dispose();
});

test('only one check window is ever open: a second host meeting a check fails soft without a window', async () => {
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 }, 'https://y.test/c': { title: 'y', html: 'y', challengeFor: 1e9 } });
  let open = 0, peak = 0;
  const r = createPageRenderer({ ...f, timeouts: { ...fast, challengeMs: 300 }, showChallenge: w => { open++; peak = Math.max(peak, open); w.show(); const d = w.destroy.bind(w); w.destroy = () => { open--; d(); }; } });
  const [a, b] = await Promise.all([r.render('https://x.test/c', { settleMs: 1 }), r.render('https://y.test/c', { settleMs: 1 })]);
  assert.equal(peak, 1);
  assert.equal(f.log.filter(l => l === 'show').length, 1);
  assert.equal(a.shown, true); assert.equal(a.challenge, true);
  assert.equal(b.challenge, true); assert.equal(b.shown, undefined);
  r.dispose();
});

test('after a check is cleared the renderer waits for the real content before returning', async () => {
  // The first snapshot after the check looks like an ordinary (half-loaded) page; the wanted element only appears a little later.
  const f = fakeElectron({ 'https://x.test/c': { title: 'Real', html: '<p>real</p>', challengeFor: 2, selectors: [] } });
  const r = createPageRenderer({ ...f, timeouts: { ...fast, waitForMs: 40 } });
  const t = Date.now();
  const out = await r.render('https://x.test/c', { waitFor: '.film', onCheck: () => {} });
  assert.equal(out.shown, true);
  assert.ok(Date.now() - t >= 40, 'polled for the selector up to waitForMs');
  assert.equal(out.status, 200); assert.equal(out.text, '<p>real</p>');
  r.dispose();
});

test('after a check is cleared, a page that still looks like a check is reported as challenged', async () => {
  // snapshot is clean once during the wait loop, then a check page again on the final look
  const f = fakeElectron({ 'https://x.test/c': { title: 'x', html: 'x', challengeFor: 1e9 } });
  const orig = f.BrowserWindow;
  let n = 0;
  class W extends orig { constructor() { super(); const ex = this.webContents.executeJavaScript; this.webContents.executeJavaScript = async code => { if (code.includes('outerHTML') && ++n === 4) return { title: 'Real', html: '<p>r</p>' }; return ex(code); }; } }
  const r = createPageRenderer({ ...f, BrowserWindow: W, timeouts: { ...fast, challengeMs: 400 } });
  const out = await r.render('https://x.test/c', { settleMs: 1 });
  assert.equal(out.challenge, true); assert.equal(out.status, 403); assert.equal(out.text, '');
  r.dispose();
});
