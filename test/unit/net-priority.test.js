// Network politeness: priority lanes, cancelled jobs, host-wide pauses, the per-host breaker, page() giving up on checks.
// Fake fetch + fake clock only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../../core/util/limiter.js';
import { createHttp, parseRetryAfter } from '../../core/net.js';

const flush = () => new Promise(r => setImmediate(r));
function fakeClock(t0 = Date.UTC(2026, 9, 28, 1, 0, 0)) {
  let t = t0; const timers = [];
  return {
    now: () => t,
    setTimeout(f, ms) { const x = { f, at: t + ms }; timers.push(x); return x; },
    clearTimeout(x) { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        timers.sort((a, b) => a.at - b.at);
        const n = timers[0];
        if (!n || n.at > end) break;
        timers.shift(); t = Math.max(t, n.at); n.f();
      }
      t = end; await flush();
    },
  };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const reply = (status = 200, headers = {}) => ({ status, ok: status < 400, url: '', headers: new Headers(headers), text: async () => 'body', json: async () => ({}) });
const MIN = 60_000;

test('limiter: lower priority runs first, FIFO inside a lane', async () => {
  const clock = fakeClock();
  const run = createLimiter({ concurrency: 1, gap: 0, clock });
  const order = [], hold = deferred();
  const first = run(() => hold.promise);
  const jobs = [['a', 3], ['b', 0], ['c', 3], ['d', 1], ['e', 0]].map(([n, p]) => run(async () => { order.push(n); }, { priority: p }));
  assert.equal(run.pending(), 5);
  hold.resolve(); await first; await Promise.all(jobs);
  assert.deepEqual(order, ['b', 'e', 'd', 'a', 'c']);
});

test('limiter: an aborted queued job is dropped and never uses the gap', async () => {
  const clock = fakeClock();
  const run = createLimiter({ concurrency: 1, gap: 100, clock });
  const starts = {};
  const mark = n => async () => { starts[n] = clock.now(); };
  const t0 = clock.now();
  const a = run(mark('a'));
  await flush();
  const ctl = new AbortController();
  const b = run(mark('b'), { signal: ctl.signal });
  const c = run(mark('c'));
  ctl.abort();
  await assert.rejects(b, { code: 'aborted' });
  await assert.rejects(run(mark('x'), { signal: ctl.signal }), { code: 'aborted' }); // already aborted: refused outright
  await clock.advance(100);
  await Promise.all([a, c]);
  assert.equal(starts.a, t0); assert.equal(starts.c, t0 + 100);
  assert.equal(starts.b, undefined); assert.equal(starts.x, undefined);
  assert.equal(run.pending(), 0);
});

test('limiter: pause holds every queued job until the time is up', async () => {
  const clock = fakeClock();
  const run = createLimiter({ concurrency: 2, gap: 0, clock });
  assert.equal(run.pausedUntil(), 0);
  run.pause(5000);
  assert.equal(run.pausedUntil(), clock.now() + 5000);
  let ran = 0;
  const p = run(async () => { ran++; });
  await clock.advance(4999); assert.equal(ran, 0); assert.equal(run.pending(), 1);
  await clock.advance(1); await p; assert.equal(ran, 1);
  assert.equal(run.pausedUntil(), 0);
});

test('parseRetryAfter: seconds, HTTP dates, junk', () => {
  const now = Date.UTC(2026, 9, 28);
  assert.equal(parseRetryAfter('30', now), 30000);
  assert.equal(parseRetryAfter(new Date(now + 20000).toUTCString(), now), 20000);
  for (const v of [null, '', '0', 'soon', new Date(now - 5000).toUTCString()]) assert.equal(parseRetryAfter(v, now), null);
});

function setup(fetch, extra = {}) {
  const clock = fakeClock();
  const http = createHttp({ fetch, clock, limits: { default: { concurrency: 2, gap: 0 } }, retries: 3, ...extra });
  const events = []; http.observe(n => events.push(n));
  return { clock, http, events };
}

test('a 429 with Retry-After pauses a second request to the same host (not other hosts)', async () => {
  const calls = [];
  let first = true;
  const { clock, http, events } = setup(async url => { calls.push(url); if (first) { first = false; return reply(429, { 'retry-after': '15' }); } return reply(200); });
  const a = http.response('https://a.test/1');
  await flush();
  const b = http.response('https://a.test/2');
  const other = await http.response('https://b.test/1');
  assert.equal(other.status, 200);
  await clock.advance(14_000);
  assert.deepEqual(calls, ['https://a.test/1', 'https://b.test/1'], 'nothing else went to a.test while it was paused');
  assert.equal(http.hostStatus().find(h => h.host === 'a.test').state, 'paused');
  await clock.advance(1000);
  assert.equal((await b).status, 200); assert.equal((await a).status, 200);
  const paused = events.find(e => e.kind === 'paused');
  assert.equal(paused.host, 'a.test'); assert.match(paused.text, /slow down/);
});

test('Retry-After as an HTTP date is honoured', async () => {
  let n = 0; let clockRef;
  const s = setup(async () => (++n === 1 ? reply(429, { 'retry-after': new Date(clockRef.now() + 20_000).toUTCString() }) : reply(200)));
  clockRef = s.clock;
  const p = s.http.response('https://a.test/1');
  await flush();
  const st = s.http.hostStatus()[0];
  assert.equal(st.state, 'paused');
  assert.ok(st.until - s.clock.now() >= 19_000 && st.until - s.clock.now() <= 20_000);
  await s.clock.advance(20_000);
  assert.equal((await p).status, 200);
});

test('a 503 with Retry-After pauses the host too; one without just waits and retries', async () => {
  let n = 0;
  const s = setup(async () => (++n === 1 ? reply(503, { 'retry-after': '10' }) : reply(200)));
  const p = s.http.response('https://a.test/1');
  await flush();
  assert.equal(s.http.hostStatus()[0].state, 'paused');
  await s.clock.advance(10_000);
  assert.equal((await p).status, 200);
  n = 0;
  const s2 = setup(async () => (n++ < 1 ? reply(503) : reply(200)));
  const q = s2.http.response('https://a.test/1');
  await s2.clock.advance(1500);
  assert.equal((await q).status, 200);
  assert.equal(s2.http.hostStatus()[0].state, 'ok');
});

test('asking for more than 10 minutes trips the breaker; later requests fail fast without a fetch', async () => {
  let calls = 0;
  const { http, events } = setup(async () => { calls++; return reply(429, { 'retry-after': '700' }); });
  await assert.rejects(http.response('https://a.test/1'), e => e.status === 429 && e.code !== 'host-paused');
  assert.equal(calls, 1);
  assert.equal(http.hostStatus()[0].state, 'open');
  await assert.rejects(http.response('https://a.test/2'), { code: 'host-paused' });
  await assert.rejects(http.text('https://a.test/3'), { code: 'host-paused' });
  assert.equal(calls, 1);
  assert.ok(events.some(e => e.kind === 'breaker-open' && /leave it alone/.test(e.text)));
  // exactly 10 minutes is still waited out, not a trip
  const s = setup(async () => reply(429, { 'retry-after': '600' }), { retries: 1 });
  await assert.rejects(s.http.response('https://b.test/1'), e => e.status === 429);
  assert.equal(s.http.hostStatus()[0].state, 'paused');
});

async function trip(s, host = 'https://a.test/') {
  for (let i = 0; i < 3; i++) { await assert.rejects(s.http.response(host + i)); await s.clock.advance(2000); }
}

test('breaker: opens after three blocks in two minutes, one probe after 15 minutes, success closes and resets', async () => {
  let mode = 429, calls = 0;
  const s = setup(async () => { calls++; return reply(mode); }, { retries: 1 });
  await assert.rejects(s.http.response('https://a.test/0')); await s.clock.advance(2000);
  await assert.rejects(s.http.response('https://a.test/1')); await s.clock.advance(2000);
  assert.equal(s.http.hostStatus()[0].state, 'ok');
  assert.equal(s.http.hostStatus()[0].blocks, 2);
  await assert.rejects(s.http.response('https://a.test/2'));
  const st = s.http.hostStatus()[0];
  assert.equal(st.state, 'open'); assert.equal(st.until - s.clock.now(), 15 * MIN);
  const before = calls;
  await assert.rejects(s.http.response('https://a.test/3'), { code: 'host-paused' });
  assert.equal(calls, before);
  await s.clock.advance(15 * MIN);
  mode = 200;
  const probe = s.http.response('https://a.test/p');
  const other = s.http.response('https://a.test/q');
  await assert.rejects(other, { code: 'host-paused' }); // only one probe at a time
  assert.equal((await probe).status, 200);
  assert.equal(s.http.hostStatus()[0].state, 'ok');
  assert.ok(s.events.some(e => e.kind === 'breaker-closed' && /answering again/.test(e.text)));
  assert.equal((await s.http.response('https://a.test/r')).status, 200);
  mode = 429; await trip(s);
  assert.equal(s.http.hostStatus()[0].state, 'open');
  assert.ok(s.http.hostStatus()[0].until - s.clock.now() > 14 * MIN - 5000 && s.http.hostStatus()[0].until - s.clock.now() <= 15 * MIN, 'escalation reset to 15 min');
});

test('breaker: a failed probe reopens for 1 hour, then 6 hours', async () => {
  const s = setup(async () => reply(429), { retries: 1 });
  await trip(s);
  const left = () => s.http.hostStatus()[0].until - s.clock.now();
  assert.ok(left() <= 15 * MIN);
  await s.clock.advance(15 * MIN);
  await assert.rejects(s.http.response('https://a.test/p1'), e => e.status === 429 && e.code !== 'host-paused');
  assert.equal(s.http.hostStatus()[0].state, 'open'); assert.equal(left(), 60 * MIN);
  await s.clock.advance(60 * MIN);
  await assert.rejects(s.http.response('https://a.test/p2'), e => e.code !== 'host-paused');
  assert.equal(left(), 6 * 60 * MIN);
  await s.clock.advance(6 * 60 * MIN);
  await assert.rejects(s.http.response('https://a.test/p3'), e => e.code !== 'host-paused');
  assert.equal(left(), 6 * 60 * MIN, 'stays at six hours');
});

test('breaker: blocks older than two minutes do not add up', async () => {
  const s = setup(async () => reply(403), { retries: 1 });
  for (let i = 0; i < 4; i++) { await assert.rejects(s.http.response('https://a.test/' + i).then(r => { if (r.status === 403) throw new Error('blocked'); })); await s.clock.advance(61_000); }
  assert.equal(s.http.hostStatus()[0].state, 'ok');
});

test('cf-mitigated: challenge trips the breaker at once, even on a 200', async () => {
  let calls = 0;
  const s = setup(async () => { calls++; return reply(200, { 'cf-mitigated': 'challenge' }); }, { retries: 1 });
  await s.http.response('https://a.test/1');
  assert.equal(s.http.hostStatus()[0].state, 'open');
  await assert.rejects(s.http.response('https://a.test/2'), { code: 'host-paused' });
  assert.equal(calls, 1);
});

test('a request cancelled while queued never reaches fetch', async () => {
  const hold = deferred(); const urls = [];
  const s = setup(async url => { urls.push(url); if (url.endsWith('/hold')) await hold.promise; return reply(200); }, { limits: { default: { concurrency: 1, gap: 0 } } });
  const first = s.http.response('https://a.test/hold');
  await flush();
  const ctl = new AbortController();
  const queued = s.http.response('https://a.test/queued', { signal: ctl.signal });
  ctl.abort();
  await assert.rejects(queued, { code: 'aborted' });
  hold.resolve(); await first;
  assert.deepEqual(urls, ['https://a.test/hold']);
});

test('priority: opened work jumps ahead of background work; withPriority sets the default', async () => {
  const hold = deferred(); const urls = [];
  const s = setup(async url => { urls.push(url); if (url.endsWith('/hold')) await hold.promise; return reply(200); }, { limits: { default: { concurrency: 1, gap: 0 } } });
  const first = s.http.response('https://a.test/hold');
  await flush();
  const jobs = [
    s.http.text('https://a.test/normal'),
    s.http.withPriority(5).text('https://a.test/background'),
    s.http.withPriority(0).text('https://a.test/opened'),
    s.http.withPriority(5).text('https://a.test/boost', { priority: 1 }),
    s.http.json('https://a.test/json').catch(() => {}),
  ];
  hold.resolve(); await first; await Promise.all(jobs);
  assert.deepEqual(urls.slice(1), ['https://a.test/opened', 'https://a.test/boost', 'https://a.test/normal', 'https://a.test/json', 'https://a.test/background']);
  assert.equal(typeof s.http.withPriority(2).hostStatus, 'function');
  assert.equal(s.http.withPriority(2).limitsFor('x.test').gap, 0);
});

test('page(): failOnChallenge is passed to the renderer, a declined check comes back as challenge and counts as a block', async () => {
  const seen = [];
  const render = async (url, opts) => { seen.push(opts); return { status: 403, url, text: '', challenge: true }; };
  const s = setup(null, { render });
  const r = await s.http.withPriority(4).page('https://a.test/film', { failOnChallenge: true });
  assert.equal(r.challenge, true); assert.equal(r.status, 403);
  assert.equal(seen[0].failOnChallenge, true); assert.equal(seen[0].priority, 4);
  assert.equal(s.http.hostStatus()[0].blocks, 1);
  // 29 Oct: the default is now to let the renderer show the window (the cooldown handles repeats)
  await s.http.page('https://a.test/film2');
  assert.equal(seen[1].failOnChallenge, false); assert.equal(seen[1].priority, 3);
  await s.http.page('https://a.test/film3');
  assert.equal(s.http.hostStatus()[0].state, 'open');
  await assert.rejects(s.http.page('https://a.test/film4'), { code: 'host-paused' });
  assert.equal(seen.length, 3);
});

test('page(): a normal render passes through untouched', async () => {
  const s = setup(null, { render: async url => ({ status: 200, url, text: '<p>hi</p>' }) });
  assert.deepEqual(await s.http.page('https://a.test/x'), { status: 200, url: 'https://a.test/x', text: '<p>hi</p>', headers: undefined });
});

test('every lane may show the check window unless failOnChallenge is asked for', async () => {
  const seen = [];
  const http = createHttp({ render: async (url, o) => { seen.push([o.priority, o.failOnChallenge]); return { status: 200, url, text: 'x' }; } });
  await http.withPriority(3).page('https://example.test/a');
  await http.withPriority(0).page('https://example.test/b');
  await http.withPriority(0).page('https://example.test/c', { failOnChallenge: true });
  assert.deepEqual(seen, [[3, false], [0, false], [0, true]]); // 29 Oct: background reads may show the window too (with a cooldown)
});

// ---------- 29 Oct: check window, cooldown, long pauses, opened-film probe ----------
test('a long Retry-After defers queued and new reads at once instead of making them wait', async () => {
  let first = true;
  const s = setup(async () => { if (first) { first = false; return reply(429, { 'retry-after': '120' }); } return reply(200); }, { retries: 1 });
  const a = s.http.response('https://a.test/1').catch(e => e);
  await flush();
  const e1 = await a;
  assert.equal(e1.status, 429);
  const late = await s.http.response('https://a.test/2').catch(e => e);
  assert.equal(late.code, 'host-paused');            // refused straight away
  assert.equal((await s.http.response('https://b.test/1')).status, 200); // other hosts carry on
});

test('queued reads are rejected when a long pause starts', async () => {
  const hold = deferred();
  let n = 0;
  const s = setup(async () => { n++; if (n === 1) { await hold.promise; return reply(429, { 'retry-after': '300' }); } return reply(200); }, { retries: 1, limits: { default: { concurrency: 1, gap: 0 } } });
  const first = s.http.response('https://a.test/1').catch(e => e);
  await flush();
  const queued = s.http.response('https://a.test/2').catch(e => e);
  hold.resolve();
  assert.equal((await queued).code, 'host-paused');
  assert.equal((await first).status, 429);
  assert.equal(n, 1);
});

test('check window: shown to the user, cleared check closes the breaker, missed check starts a cooldown for background reads', async () => {
  const seen = []; let mode = 'miss';
  const render = async (url, o) => {
    seen.push({ url, failOnChallenge: o.failOnChallenge, priority: o.priority });
    if (o.failOnChallenge) return { status: 403, url, text: '', challenge: true };
    if (typeof o.onCheck === 'function') o.onCheck();
    return mode === 'miss' ? { status: 403, url, text: '', challenge: true, shown: true } : { status: 200, url, text: 'ok', shown: true };
  };
  const s = setup(null, { render });
  const asked = [];
  s.http.observe(n => { if (/^check/.test(n.kind)) asked.push(n.kind); });
  await s.http.withPriority(3).page('https://a.test/x');            // window shown, not completed
  assert.deepEqual(asked, ['check', 'check-missed']);
  assert.ok(s.http.hostStatus()[0].checkUntil > s.clock.now());
  await s.http.withPriority(3).page('https://a.test/y').catch(() => {}); // cooldown: asked not to show
  assert.equal(seen[1].failOnChallenge, true);
  await s.clock.advance(11 * 60_000);
  mode = 'ok';
  const r = await s.http.withPriority(3).page('https://a.test/z').catch(e => e); // cooldown over; (breaker may be open by now)
  assert.ok(r.status === 200 || r.code === 'host-paused');
  mode = 'ok';
  // a film the user opened is let through an open breaker as the one probe, and a completed check closes it
  const o = await s.http.withPriority(0).page('https://a.test/opened');
  assert.equal(o.status, 200);
  assert.equal(s.http.hostStatus()[0].state, 'ok');
  assert.ok(asked.includes('check-cleared'));
  assert.equal(s.http.hostStatus()[0].checkUntil, 0);
});

test('an opened film (priority 0) gets one probe through an open breaker; others are refused; a failed probe does not escalate', async () => {
  let n = 0;
  const s = setup(async () => { n++; return reply(403); }, { retries: 1, limits: { default: { concurrency: 1, gap: 0 } } });
  for (let i = 0; i < 3; i++) await s.http.response('https://a.test/' + i).catch(() => {});
  assert.equal(s.http.hostStatus()[0].state, 'open');
  const before = n;
  await assert.rejects(s.http.withPriority(3).response('https://a.test/bg'), { code: 'host-paused' });
  assert.equal(n, before);
  const until1 = s.http.hostStatus()[0].until;
  await s.http.withPriority(0).response('https://a.test/opened').catch(() => {});
  assert.equal(n, before + 1, 'the probe went through');
  const st = s.http.hostStatus()[0];
  assert.equal(st.state, 'open');
  assert.ok(st.until - s.clock.now() <= 15 * 60_000 + 1, 'same 15 minute level, not 1 hour');
  assert.ok(st.until >= until1);
});

test('a failed override probe (network error) does not leave the override flag set for the next ordinary probe', async () => {
  let mode = '403';
  const s = setup(async () => { if (mode === 'throw') throw new Error('connection reset'); return reply(403); }, { retries: 1, limits: { default: { concurrency: 1, gap: 0 } } });
  for (let i = 0; i < 3; i++) await s.http.response('https://a.test/' + i).catch(() => {});
  assert.equal(s.http.hostStatus()[0].state, 'open');
  mode = 'throw';
  await s.http.withPriority(0).response('https://a.test/opened').catch(() => {});
  mode = '403';
  await s.clock.advance(16 * 60_000);                               // the first 15 minute wait is over: an ordinary probe is next
  await s.http.withPriority(3).response('https://a.test/probe').catch(() => {});
  const st = s.http.hostStatus()[0];
  assert.equal(st.state, 'open');
  assert.ok(st.until - s.clock.now() > 30 * 60_000, 'the blocked ordinary probe escalated to the 1 hour level');
});

test('a film the user opens (priority 0) does not open a second check window straight after the user missed one', async () => {
  let windows = 0;
  const render = async (url, o) => {
    if (o.failOnChallenge) return { status: 403, url, text: '', challenge: true };
    windows++;
    return { status: 403, url, text: '', challenge: true, shown: true };
  };
  const s = setup(null, { render });
  for (let i = 0; i < 6; i++) await s.http.withPriority(0).page('https://a.test/o' + i).catch(() => {});
  assert.equal(windows, 1);
  await s.clock.advance(61_000); // a minute on, an opened film asks again
  await s.http.withPriority(0).page('https://a.test/later').catch(() => {});
  assert.equal(windows, 2);
});
