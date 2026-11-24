import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreHost, createCoreClient } from '../../electron/core-bridge.js';

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const friendly = e => (e && e.message) || 'Something went wrong. Try again in a moment.';

/** A fake core: methods run asynchronously with an optional delay map. */
function fakeCore(opts = {}) {
  const log = { closed: 0, created: null };
  return {
    log,
    module: {
      createCore(o) {
        log.created = o;
        return {
          async call(method, args) {
            if (opts.delays && opts.delays[method]) await tick(opts.delays[method]);
            if (method === 'boom') throw Object.assign(new Error('Nope.'), { code: 'bad' });
            if (method === 'big') return { n: 1n };
            return { method, args };
          },
          close() { log.closed++; },
        };
      },
    },
  };
}

/** Child side + a fake process around it. */
function fakeChild({ core = fakeCore(), loadFails = false, openFails = false } = {}) {
  const toMain = [];
  let mainHandler = null, exitHandler = null;
  const host = createCoreHost({
    post: m => queueMicrotask(() => mainHandler && mainHandler(m)),
    loadCore: async () => { if (loadFails) throw new Error('broken file'); return openFails ? { createCore() { throw new Error('locked'); } } : core.module; },
    makeFetch: () => function fakeFetch() {},
    friendlyError: friendly,
  });
  const proc = {
    pid: 100 + Math.floor(Math.random() * 1000),
    killed: false, received: [],
    postMessage(m) { proc.received.push(m); if (!proc.killed) queueMicrotask(() => host.onMessage(JSON.parse(JSON.stringify(m)))); },
    on(ev, fn) { if (ev === 'message') { mainHandler = fn; queueMicrotask(() => fn({ type: 'hello' })); } else exitHandler = fn; },
    kill() { if (proc.killed) return; proc.killed = true; setTimeout(() => exitHandler && exitHandler(0), 0); },
    crash() { proc.killed = true; exitHandler && exitHandler(9); },
    core, toMain,
  };
  return proc;
}

function setup(opts = {}) {
  const procs = [];
  const events = [], logs = [], fatals = [];
  const client = createCoreClient({
    spawn: () => { const p = fakeChild(typeof opts.child === 'function' ? opts.child(procs.length) : opts.child); procs.push(p); return p; },
    init: { dataDir: '/d', browserUserAgent: 'UA' },
    render: opts.render || (async () => ({ status: 200, url: 'u', text: 't' })),
    ...(opts.cookies ? { cookies: opts.cookies } : {}),
    onEvent: (e, p) => events.push([e, p]),
    log: (...a) => logs.push(a.join(' ')), onFatal: m => fatals.push(m),
    timeouts: opts.timeouts,
    now: opts.now,
  });
  return { client, procs, events, logs, fatals };
}

test('calls resolve with the JSON string of the envelope; the core gets the injected fetch and init data', async () => {
  const { client, procs } = setup();
  await client.start();
  const raw = await client.call('getState', { a: 1 });
  assert.equal(typeof raw, 'string');
  assert.deepEqual(JSON.parse(raw), { result: { method: 'getState', args: { a: 1 } } });
  const o = procs[0].core.log.created;
  assert.equal(o.dataDir, '/d'); assert.equal(o.browserUserAgent, 'UA');
  assert.equal(o.fetch, o.browserFetch);
  assert.equal(typeof o.render, 'function');
});

test('errors become { error }; unserialisable results become a generic error', async () => {
  const { client } = setup();
  await client.start();
  assert.deepEqual(JSON.parse(await client.call('boom')), { error: { message: 'Nope.', code: 'bad' } });
  assert.equal(JSON.parse(await client.call('big')).error.message, 'Something went wrong. Try again in a moment.');
});

test('replies can arrive out of order', async () => {
  const { client } = setup({ child: { core: fakeCore({ delays: { slow: 40 } }) } });
  await client.start();
  const order = [];
  const a = client.call('slow').then(r => { order.push('slow'); return r; });
  const b = client.call('fast').then(r => { order.push('fast'); return r; });
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepEqual(order, ['fast', 'slow']);
  assert.equal(JSON.parse(ra).result.method, 'slow');
  assert.equal(JSON.parse(rb).result.method, 'fast');
});

test('a call made before the core is ready waits and is answered', async () => {
  const { client } = setup();
  const early = client.call('early'); // before start()
  await client.start();
  assert.equal(JSON.parse(await early).result.method, 'early');
});

test('host: calls arriving before init wait for ready', async () => {
  const sent = [];
  const host = createCoreHost({ post: m => sent.push(m), loadCore: async () => fakeCore().module, makeFetch: () => () => {}, friendlyError: friendly });
  host.onMessage({ type: 'call', id: 1, method: 'x', args: {} });
  await tick();
  assert.equal(sent.length, 0);
  host.onMessage({ type: 'init', dataDir: '/d' });
  await tick();
  assert.deepEqual(sent.map(m => m.type), ['ready', 'result']);
});

test('events are forwarded to onEvent', async () => {
  const core = fakeCore();
  const { client, events } = setup({ child: { core } });
  await client.start();
  core.log.created.onEvent('film', { id: 1 });
  await tick();
  assert.deepEqual(events, [['film', { id: 1 }]]);
});

test('render requests are proxied to main and results come back; render errors keep their code', async () => {
  const seen = [];
  const { client, procs } = setup({ render: async (url, opts) => { seen.push([url, opts.waitFor, opts.settleMs, opts.signal instanceof AbortSignal]); if (url.includes('bad')) throw Object.assign(new Error('Stopped.'), { code: 'aborted' }); return { status: 200, url, text: 'T' }; } });
  await client.start();
  const render = procs[0].core.log.created.render;
  assert.deepEqual(await render('https://x/ok', { waitFor: '#a', settleMs: 5 }), { status: 200, url: 'https://x/ok', text: 'T' });
  await assert.rejects(render('https://x/bad'), e => e.code === 'aborted' && e.message === 'Stopped.');
  assert.deepEqual(seen[0], ['https://x/ok', '#a', 5, true]);
});

test('aborting a render in the child aborts it in main', async () => {
  let sig;
  const { client, procs } = setup({ render: (url, o) => new Promise((_, rej) => { sig = o.signal; o.signal.addEventListener('abort', () => rej(Object.assign(new Error('Stopped.'), { code: 'aborted' }))); }) });
  await client.start();
  const ac = new AbortController();
  const p = procs[0].core.log.created.render('https://x/', { signal: ac.signal });
  await tick();
  assert.equal(sig.aborted, false);
  ac.abort();
  await assert.rejects(p, e => e.code === 'aborted');
  await tick();
  assert.equal(sig.aborted, true);
});

test('fatal on load and on open reject start() with the stage', async () => {
  for (const [opt, stage] of [[{ loadFails: true }, 'load'], [{ openFails: true }, 'open']]) {
    const { client, procs } = setup({ child: opt });
    await assert.rejects(client.start(), e => e.stage === stage && /broken file|locked/.test(e.message));
    await tick(10);
    assert.ok(procs[0].killed);
  }
});

test('a crash resolves pending calls with the failed envelope, aborts renders, and restarts only after exit', async () => {
  let sig;
  const { client, procs, events } = setup({
    child: { core: fakeCore({ delays: { hang: 500 } }) },
    render: (url, o) => new Promise(() => { sig = o.signal; }),
  });
  await client.start();
  procs[0].core.log.created.render('https://x/');
  const hung = client.call('hang');
  await tick();
  assert.equal(procs.length, 1);
  procs[0].crash();
  const raw = await hung;
  assert.equal(JSON.parse(raw).error.code, 'ipc');
  assert.equal(sig.aborted, true);
  await tick(20);
  assert.equal(procs.length, 2);
  assert.deepEqual(events.slice(-2).map(e => e[0]), ['state', 'library']);
  assert.equal(JSON.parse(await client.call('again')).result.method, 'again');
});

test('a call made while the child is down waits for the replacement', async () => {
  const { client, procs } = setup({ child: { core: fakeCore() } });
  await client.start();
  procs[0].crash();
  const p = client.call('later');
  assert.equal(JSON.parse(await p).result.method, 'later');
});

test('a call that waits too long gets the failed envelope', async () => {
  const { client } = setup({ timeouts: { callWait: 20 } });
  const raw = await client.call('never'); // start() never called
  assert.equal(JSON.parse(raw).error.code, 'ipc');
});

test('more than 3 restarts within the window gives up and reports fatal', async () => {
  let t = 1000;
  const { client, procs, fatals } = setup({ now: () => t });
  await client.start();
  for (let i = 0; i < 3; i++) { procs[i].crash(); await tick(20); t += 1000; }
  assert.equal(procs.length, 4);
  assert.equal(fatals.length, 0);
  procs[3].crash(); await tick(20);
  assert.equal(procs.length, 4);
  assert.deepEqual(fatals, ['Matinee hit a problem and has to close. Your library is safe.']);
});

test('old crashes outside the window do not count', async () => {
  let t = 0;
  const { client, procs, fatals } = setup({ now: () => t });
  await client.start();
  for (let i = 0; i < 5; i++) { procs[i].crash(); await tick(20); t += 200_000; }
  assert.equal(procs.length, 6);
  assert.equal(fatals.length, 0);
});

test('close() asks the core to save, kills the process, does not restart, and is safe twice', async () => {
  const { client, procs } = setup();
  await client.start();
  await Promise.all([client.close(), client.close()]);
  await tick(20);
  assert.equal(procs[0].core.log.closed, 1);
  assert.ok(procs[0].killed);
  assert.equal(procs.length, 1);
  assert.equal(JSON.parse(await client.call('x')).error.code, 'ipc');
});

test('close() gives up waiting after the timeout and kills a stuck child', async () => {
  const { client, procs } = setup({ timeouts: { closeWait: 30 } });
  await client.start();
  procs[0].postMessage = () => {}; // child never answers
  await client.close();
  assert.ok(procs[0].killed);
});

test('29 Oct: a check opening in main reaches the core as onCheck, and challenge/shown flags come back', async () => {
  const { client, procs } = setup({ render: async (url, opts) => { opts.onCheck(); return { status: 403, url, text: '', challenge: true, shown: true }; } });
  await client.start();
  let told = 0;
  const r = await procs[0].core.log.created.render('https://x/c', { onCheck: () => { told++; } });
  assert.equal(told, 1);
  assert.deepEqual(r, { status: 403, url: 'https://x/c', text: '', challenge: true, shown: true });
});

test('29 Oct: cookie checks go to main and come back as plain objects; without a handler the core gets an error', async () => {
  const asked = [];
  const { client, procs } = setup({ cookies: async d => { asked.push(d); return [{ name: 'cf_clearance', domain: '.letterboxd.com', secure: true, session: false, value: 'SECRET' }]; } });
  await client.start();
  const probe = procs[0].core.log.created.cookieProbe;
  assert.equal(typeof probe, 'function');
  const list = await probe('letterboxd.com');
  assert.deepEqual(asked, ['letterboxd.com']);
  assert.deepEqual(list, [{ name: 'cf_clearance', domain: '.letterboxd.com', secure: true, session: false }]); // values never cross
  const bare = setup();
  await bare.client.start();
  await assert.rejects(bare.procs[0].core.log.created.cookieProbe('imdb.com'), /No cookie access/);
  const failing = setup({ cookies: async () => { throw new Error('no session'); } });
  await failing.client.start();
  await assert.rejects(failing.procs[0].core.log.created.cookieProbe('imdb.com'), /no session/);
});
