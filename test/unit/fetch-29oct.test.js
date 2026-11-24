// 29 Oct fetching decisions (core side): sparing re-reads with upcoming films first, refresh never blanks data, deferred (not failed)
// when a site is left alone, per-film outcomes and the film events, the time-left estimate, and the check notice.
// Fake providers, fake clocks and synthetic films only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import { enrich, defaultWants, wantsFor, releasePhase, rereadDays, keepRicher, classifyFailure, createTrouble, REREAD } from '../../core/enrich.js';
import { computeProgress, etaMs } from '../../core/progress.js';

const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 29, 12);
const iso = ms => new Date(ms).toISOString();
const ago = d => iso(NOW - d * DAY);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };

/** A minimal store enrich() can run on. */
function memStore(films, lib = {}) {
  const map = Object.fromEntries(films.map(f => [f.key, f]));
  return { films: map, library: { settings: {}, films: lib }, touch() {}, flush() {}, cached() { return undefined; }, setCached() {} };
}
const lbSoon = (days) => ({ lbpage: { ausRelease: { date: new Date(NOW + days * DAY).toISOString().slice(0, 10), type: 'Theatrical' } } });

// ---------- re-read policy ----------
test('release phase: in cinemas or opening within ~6 months is hot; out within a year is recent; the rest settled', () => {
  assert.equal(releasePhase({ key: 'a', src: lbSoon(20) }, NOW), 'hot');
  assert.equal(releasePhase({ key: 'a2', src: lbSoon(-58) }, NOW), 'hot');
  assert.equal(releasePhase({ key: 'a3', src: lbSoon(180) }, NOW), 'hot');
  assert.equal(releasePhase({ key: 'b', src: lbSoon(-90) }, NOW), 'recent');
  assert.equal(releasePhase({ key: 'c', src: { tmdb: { released: '2024-01-01' } } }, NOW), 'settled');
  assert.equal(releasePhase({ key: 'd', src: lbSoon(400) }, NOW), 'settled', 'far away is not hot yet');
  assert.equal(releasePhase({ key: 'e', year: 2026, src: {} }, NOW), 'recent', 'no date but a new film');
  assert.equal(releasePhase({ key: 'f', year: 1990, src: {} }, NOW), 'settled');
  // the Australian date wins for "hot" even when the world date is old (a re-release)
  assert.equal(releasePhase({ key: 'g', src: { tmdb: { released: '1999-03-31' }, ...lbSoon(10) } }, NOW), 'hot');
});

test('re-read days: ratings sources move fast for hot films and slowly for old ones; others rarely', () => {
  const rt = { id: 'rt', refreshDays: 14 }, wp = { id: 'wikipedia', refreshDays: 90 };
  const hot = { key: 'h', src: lbSoon(5) }, old = { key: 'o', src: { tmdb: { released: '2010-01-01' } } }, mid = { key: 'm', src: lbSoon(-120) };
  assert.equal(rereadDays(rt, hot, NOW), REREAD.days.hot.ratings);
  assert.ok(REREAD.days.hot.ratings >= 3 && REREAD.days.hot.ratings <= 7);
  assert.equal(rereadDays(rt, old, NOW), 90);
  assert.equal(rereadDays(rt, mid, NOW), 30);
  assert.equal(rereadDays(wp, hot, NOW), 14);
  assert.equal(rereadDays(wp, old, NOW), 365);
});

test('quiet re-reads (reread) follow the table; an opened film (full) follows the same table, sooner', () => {
  const rt = { id: 'rt', refreshDays: 14 };
  const settled = age => ({ key: 's', src: { tmdb: { released: '2010-01-01' } }, checked: { rt: ago(age) } });
  assert.equal(defaultWants(rt, settled(60), { now: NOW, reread: true }), false);
  assert.equal(defaultWants(rt, settled(100), { now: NOW, reread: true }), true);
  assert.equal(defaultWants(rt, settled(20), { now: NOW, full: true }), false, 'an old film is not re-read after a fortnight just because it was opened');
  assert.equal(defaultWants(rt, settled(50), { now: NOW, full: true }), true, 'half the quiet interval (90 days) when it is opened');
  assert.equal(defaultWants(rt, settled(20), { now: NOW }), false);
  const hot = age => ({ key: 'h', src: { ...lbSoon(5) }, checked: { rt: ago(age) } });
  assert.equal(defaultWants(rt, hot(3), { now: NOW, reread: true }), false);
  assert.equal(defaultWants(rt, hot(5), { now: NOW, reread: true }), true);
});

test('a re-read that found nothing new is remembered (film.reread) so it is not asked for again on every pass', () => {
  const rt = { id: 'rt', refreshDays: 14, since: '2026-10-22' };
  const f = { key: 'x', src: { rt: { a: 1 } }, checked: { rt: '2026-10-01T00:00:00Z' } };
  assert.equal(defaultWants(rt, f, { now: NOW }), true, 'since: checked before the source started storing more');
  f.reread = { rt: iso(NOW - DAY) };
  assert.equal(defaultWants(rt, f, { now: NOW }), false);
  assert.equal(defaultWants(rt, f, { now: NOW, reread: true }), false);
});

test('the quiet queue reads films in cinemas or opening soon first', async () => {
  const mk = (key, src) => ({ key, title: key, src: { rt: { v: 1 }, ...src }, checked: { rt: ago(400) } });
  const films = [mk('old1', {}), mk('old2', {}), mk('hot', lbSoon(10))];
  const store = memStore(films, { old1: { watched: true, rating: 5 }, old2: { watched: true, rating: 4 } });
  const order = [];
  const p = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const f of fs) { order.push(f.key); ctx.done(f, { v: 2 }); } } };
  // the real clock is used inside enrich, so make the hot film hot relative to the real now
  const real = Date.now();
  films[2].src.lbpage = { ausRelease: { date: new Date(real + 10 * DAY).toISOString().slice(0, 10) } };
  films.forEach(f => { f.checked.rt = iso(real - 400 * DAY); });
  await enrich({ store, providers: [p], http: {} });
  assert.deepEqual(order, ['hot', 'old1', 'old2']);
});

// ---------- refresh never blanks data ----------
test('keepRicher: missing or empty values keep the old ones, real new values replace them', () => {
  assert.deepEqual(keepRicher({ a: 0, list: [1], text: 'x', extra: 5, o: { k: 1 } }, { a: 1, list: [], text: '', o: {}, n: null }), { a: 1, list: [1], text: 'x', extra: 5, o: { k: 1 } });
  assert.deepEqual(keepRicher(undefined, { a: 1 }), { a: 1 });
  assert.deepEqual(keepRicher({ list: [1] }, { list: [2, 3] }), { list: [2, 3] });
});

function dueFilm() { return { key: 'f', title: 'Film', src: { rt: { synopsis: 'Kept', ratings: { rt: { value: 90 } } } }, ids: {}, checked: { rt: ago(400) }, missed: {} }; }

test('a quiet re-read that finds nothing keeps stored data and the old date; the film is not asked again straight away', async () => {
  const f = dueFilm(); const before = JSON.stringify(f.src); const checked = f.checked.rt;
  const store = memStore([f]);
  let calls = 0;
  const p = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const x of fs) { calls++; ctx.done(x, null); } } };
  await enrich({ store, providers: [p], http: {} });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(f.src), before); assert.equal(f.checked.rt, checked); assert.equal(f.missed.rt, undefined);
  assert.ok(f.reread.rt);
  await enrich({ store, providers: [p], http: {} });
  assert.equal(calls, 1, 'not asked again');
});

test('a quiet re-read that fails keeps stored data, dates and the checked mark', async () => {
  const f = dueFilm(); const before = JSON.stringify(f.src); const checked = f.checked.rt;
  const store = memStore([f]);
  const p = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const x of fs) ctx.fail(x, Object.assign(new Error('boom'), { status: 500 })); } };
  await enrich({ store, providers: [p], http: {} });
  assert.equal(JSON.stringify(f.src), before); assert.equal(f.checked.rt, checked);
  assert.equal(f.failed.rt.n, 1);
});

test('a thinner re-read result does not blank fields the old one had', async () => {
  const f = dueFilm();
  const store = memStore([f]);
  const p = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const x of fs) ctx.done(x, { synopsis: '', ratings: { rt: { value: 91 } }, reviews: [] }); } };
  await enrich({ store, providers: [p], http: {} });
  assert.equal(f.src.rt.synopsis, 'Kept'); assert.equal(f.src.rt.ratings.rt.value, 91);
  assert.notEqual(f.checked.rt, ago(400));
});

function coreWith(providers, films, { clockNow = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-29-'));
  const events = [];
  const core = createCore({ dataDir: dir, providers, onEvent: (e, p) => events.push([e, p]), ...(clockNow ? { clock: { now: clockNow } } : {}) });
  for (const f of films) core.store.films[f.key] = f;
  return { core, events, dir };
}

test('Refresh now: ignores failure backoff, re-reads due films quietly, and never blanks stored data when the source finds nothing', async () => {
  const f = dueFilm(); f.failed = { rt: { at: iso(Date.now() - 1000), n: 2 } };
  const before = JSON.stringify(f.src); const checked = f.checked.rt;
  let calls = 0;
  const p = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const x of fs) { calls++; ctx.done(x, null); } } };
  const { core, events } = coreWith([p], [f]);
  await core.call('refresh');
  await until(() => calls > 0);
  await sleep(20);
  assert.equal(JSON.stringify(f.src), before);
  assert.equal(f.failed.rt, undefined, 'worked this time, so the failure mark is cleared');
  assert.ok(f.reread.rt, 'the look is remembered, the stored result and its date are not touched');
  assert.equal(f.checked.rt, checked);
  assert.ok(!events.some(([e, pl]) => e === 'progress' && pl && pl.phase === 'provider'), 'a quiet re-read shows no progress');
  core.close();
});

// ---------- deferred, not failed ----------
test('a site being left alone defers the film: no backoff, no failure streak, other sources carry on', async () => {
  const films = ['a', 'b', 'c'].map(k => ({ key: k, title: k }));
  const store = memStore(films);
  const trouble = createTrouble();
  const outcomes = [];
  const paused = { id: 'wikidata', label: 'Wikidata', async enrich(fs, ctx) { for (const x of fs) ctx.fail(x, Object.assign(new Error('left alone'), { code: 'host-paused', status: 429 })); } };
  const fine = { id: 'rt', label: 'RT', async enrich(fs, ctx) { for (const x of fs) ctx.done(x, { v: 1 }); } };
  await enrich({ store, providers: [paused, fine], http: {}, trouble, only: ['a', 'b', 'c'], onOutcome: (f, p, o) => outcomes.push([f.key, p.id, o.status]) });
  assert.ok(films.every(f => f.src.rt && !f.failed), 'rt filled every film and nothing is backing off');
  assert.equal(outcomes.filter(o => o[1] === 'wikidata' && o[2] === 'deferred').length, 3);
  assert.equal(outcomes.filter(o => o[1] === 'rt' && o[2] === 'ok').length, 3);
});

test('outcomes: ok, miss, failed (with plain reasons), deferred for 429s, and films a source never reached', async () => {
  const f = { key: 'f', title: 'Film' };
  const store = memStore([f]);
  const got = {};
  const mk = (id, fn) => ({ id, label: id.toUpperCase(), async enrich(fs, ctx) { for (const x of fs) fn(x, ctx); } });
  const providers = [
    mk('okp', (x, c) => c.done(x, { v: 1 })), mk('missp', (x, c) => c.done(x, null)),
    mk('slow', (x, c) => c.fail(x, Object.assign(new Error('x'), { status: 429 }))),
    mk('late', (x, c) => c.fail(x, Object.assign(new Error('The site took too long to answer.'), { code: 'timeout' }))),
    mk('err', (x, c) => c.fail(x, Object.assign(new Error('x'), { status: 500 }))),
    { id: 'idle', label: 'IDLE', async enrich() { /* never records anything */ } },
  ];
  await enrich({ store, providers, http: {}, only: ['f'], onOutcome: (_f, p, o) => { got[p.id] = o; } });
  assert.equal(got.okp.status, 'ok'); assert.equal(got.missp.status, 'miss');
  assert.equal(got.slow.status, 'deferred'); assert.match(got.slow.reason, /asked Matinee to slow down/);
  assert.equal(got.late.status, 'failed'); assert.equal(got.late.reason, 'timed out');
  assert.equal(got.err.status, 'failed'); assert.match(got.err.reason, /isn't working right now/);
  assert.equal(got.idle.status, 'deferred');
  assert.ok(got.okp.at);
  assert.equal(f.failed.late.n, 1); assert.equal(f.failed.err.n, 1); assert.equal(f.failed.slow, undefined);
});

test('classifyFailure uses what the host is doing: a check page, a breaker, a pause', () => {
  const p = { id: 'lbpage', label: 'Letterboxd' };
  const http = state => ({ hostStatus: () => [{ host: 'letterboxd.com', state, checkUntil: 0 }] });
  assert.match(classifyFailure(p, new Error('x'), http('paused')).reason, /asked Matinee to slow down/);
  assert.match(classifyFailure(p, new Error('x'), http('open')).reason, /leaving it alone|being left alone/);
  assert.equal(classifyFailure(p, new Error('x'), { hostStatus: () => [{ host: 'letterboxd.com', state: 'ok', checkUntil: Date.now() + 1000 }] }).reason, 'Letterboxd is showing a check page');
  assert.equal(classifyFailure(p, Object.assign(new Error('q'), { code: 'quiet' })).deferred, true);
  assert.equal(classifyFailure(p, new Error('nope')).deferred, false);
});

// ---------- per-film fetch: events and API ----------
function filmProviders(state) {
  const ok = { id: 'good', label: 'Good', async enrich(fs, ctx) { for (const x of fs) { if (ctx.skip(x)) continue; ctx.done(x, { v: 1 }); } } };
  const flaky = { id: 'flaky', label: 'Flaky', async enrich(fs, ctx) { for (const x of fs) { if (ctx.skip(x)) continue; state.flakyCalls++; if (state.flakyWorks) ctx.done(x, { w: 1 }); else ctx.fail(x, Object.assign(new Error('x'), { status: 500 })); } } };
  const paused = { id: 'paused', label: 'Paused', async enrich(fs, ctx) { for (const x of fs) { if (ctx.skip(x)) continue; ctx.fail(x, Object.assign(new Error('x'), { code: 'host-paused', status: 429 })); } } };
  const keyed = { id: 'keyed', label: 'Keyed', needsKey: true, enabled: s => !!s.keys?.keyed, async enrich() { throw new Error('must not run'); } };
  return [ok, flaky, paused, keyed];
}

test('fetchFilmAll reads every source, reports each outcome live, and getFilm carries the last outcomes', async () => {
  const state = { flakyCalls: 0, flakyWorks: false };
  const { core, events } = coreWith(filmProviders(state), [{ key: 'k1', title: 'One', year: 2001 }]);
  const res = await core.call('fetchFilmAll', { key: 'k1' });
  const by = Object.fromEntries(res.outcomes.map(o => [o.provider, o]));
  assert.equal(by.good.status, 'ok'); assert.equal(by.flaky.status, 'failed'); assert.equal(by.paused.status, 'deferred');
  assert.equal(by.keyed.status, 'skipped'); assert.equal(by.keyed.reason, 'needs a key');
  assert.equal(res.failed, 1); assert.equal(res.deferred, 1);
  const filmEvents = events.filter(([e]) => e === 'film').map(([, p]) => p);
  assert.ok(filmEvents.filter(p => p.provider).length >= 3, 'one event per source as it lands');
  assert.ok(filmEvents.every(p => p.keys && p.keys[0] === 'k1'));
  assert.equal(filmEvents.at(-1).done, true);
  const film = await core.call('getFilm', { key: 'k1' });
  assert.equal(film.fetchStatus.failed, 1);
  assert.equal(film.fetchStatus.outcomes.length, 4);
  assert.equal((await core.call('getFetchStatus', { key: 'k1' })).failed, 1);
  core.close();
});

test('retryFilmSources reads just those sources, whatever their freshness, and updates the outcomes', async () => {
  const state = { flakyCalls: 0, flakyWorks: false };
  const { core } = coreWith(filmProviders(state), [{ key: 'k1', title: 'One', year: 2001 }]);
  await core.call('fetchFilmAll', { key: 'k1' });
  assert.equal(state.flakyCalls, 1);
  state.flakyWorks = true;
  const res = await core.call('retryFilmSources', { key: 'k1', providerIds: ['flaky'] });
  assert.equal(state.flakyCalls, 2);
  assert.equal(res.outcomes.find(o => o.provider === 'flaky').status, 'ok');
  assert.equal(res.failed, 0);
  // a source that is fresh is read again when asked for by name
  await sleep(5);
  await core.call('retryFilmSources', { key: 'k1', providerIds: ['flaky'] });
  assert.equal(state.flakyCalls, 3);
  await assert.rejects(core.call('retryFilmSources', { key: 'k1', providerIds: [] }));
  core.close();
});

test('fetchFilmAll ignores failure backoff, and a fresh source is reported up to date without being read again', async () => {
  const state = { flakyCalls: 0, flakyWorks: true };
  const f = { key: 'k2', title: 'Two', year: 2001, failed: { flaky: { at: iso(Date.now()), n: 3 } } };
  const { core } = coreWith(filmProviders(state), [f]);
  await core.call('fetchFilmAll', { key: 'k2' });
  assert.equal(state.flakyCalls, 1, 'backoff ignored for an opened film');
  const again = await core.call('fetchFilmAll', { key: 'k2' });
  assert.equal(state.flakyCalls, 1, 'not read twice');
  assert.equal(again.outcomes.find(o => o.provider === 'good').status, 'ok');
  core.close();
});

test('after a restart the page still lists sources that failed last time (from film.failed)', async () => {
  const f = { key: 'k3', title: 'Three', failed: { flaky: { at: iso(Date.now()), n: 1 } } };
  const { core } = coreWith(filmProviders({ flakyCalls: 0 }), [f]);
  const st = await core.call('getFetchStatus', { key: 'k3' });
  assert.equal(st.outcomes.find(o => o.provider === 'flaky').status, 'failed');
  core.close();
});

test('outcome-only film events do not throw away the library-wide caches', async () => {
  // a source that fails records nothing, so only outcome events (no 'library' event) happen
  const bad = { id: 'flaky', label: 'Flaky', async enrich(fs, ctx) { for (const x of fs) ctx.fail(x, Object.assign(new Error('x'), { status: 500 })); } };
  const { core, events } = coreWith([bad], [{ key: 'k4', title: 'Four', year: 2000 }]);
  core.store.library.films.k4 = { watchlist: true, tags: [] };
  const before = (await core.call('getLibrary')).films;
  const res = await core.call('fetchFilmAll', { key: 'k4' });
  assert.equal(res.failed, 1);
  assert.ok(events.some(([e, p]) => e === 'film' && p.provider === 'flaky'));
  assert.ok(!events.some(([e]) => e === 'library'));
  assert.equal((await core.call('getLibrary')).films, before, 'same list object: nothing was rebuilt');
  assert.equal((await core.call('getFilm', { key: 'k4' })).fetchStatus.failed, 1);
  core.close();
});

// ---------- a site being left alone does not hold the quiet re-reads ----------
test('a blocked site with first-time work does not stop the quiet re-read of other sources', async () => {
  const films = [{ key: 'a', title: 'A', src: { rt: { v: 1 } }, checked: { rt: ago(400) } }, { key: 'b', title: 'B', src: { rt: { v: 1 } }, checked: { rt: ago(400) } }];
  const store = memStore(films);
  const rereads = [];
  const lb = { id: 'lbpage', label: 'Letterboxd', async enrich(fs, ctx) { for (const x of fs) ctx.fail(x, Object.assign(new Error('left alone'), { code: 'host-paused', status: 429 })); } };
  const rt = { id: 'rt', label: 'RT', refreshDays: 14, async enrich(fs, ctx) { for (const x of fs) { rereads.push(x.key); ctx.done(x, { v: 2 }); } } };
  const http = { hostStatus: () => [{ host: 'letterboxd.com', state: 'open', checkUntil: 0 }] };
  await enrich({ store, providers: [lb, rt], http });
  assert.deepEqual(rereads.sort(), ['a', 'b']);
});

test('the check notice goes away by itself once it is old, and a different site\'s success does not clear it', () => {
  let t = 1_000_000;
  const tr = createTrouble({ now: () => t });
  tr.observe({ host: 'letterboxd.com', kind: 'check', text: 'check please' });
  tr.ok({ id: 'boxd', label: 'Letterboxd (short links)' }, 'x'); // same site name as lbpage's, but a success is not proof the check is done
  assert.equal(tr.hasCheck('Letterboxd'), true);
  t += 6 * 60_000;
  assert.deepEqual(tr.list(), []); assert.equal(tr.hasCheck('Letterboxd'), false);
});

// ---------- time left ----------
test('time left: an estimate shows from the start and a measured one follows, because the core nudges state during a run', async () => {
  let t = Date.UTC(2026, 9, 29);
  const N = 24;
  const films = Array.from({ length: N }, (_, i) => ({ key: 'e' + i, title: 'E' + i, year: 2000 }));
  const p = {
    id: 'lbpage', label: 'Letterboxd',
    async enrich(fs, ctx) { let n = 0; for (const x of fs) { t += 2500; ctx.done(x, { v: 1 }); ctx.progress(++n, fs.length); await sleep(1); } },
  };
  const { core, events } = coreWith([p], films, { clockNow: () => t });
  const seen = [];
  const origCall = core.call;
  // sample getState each time the core says the state changed (this is what the UI does)
  const sample = () => { const pr = origCall.call(core, 'getState'); return pr.then(s => seen.push({ text: s.progress.etaText, ms: s.progress.etaMs, running: s.progress.running })); };
  const tick = setInterval(() => { if (events.filter(([e]) => e === 'state').length > seen.length) sample(); }, 1);
  await core.call('refresh');
  await until(() => core.store.films.e23.src?.lbpage);
  await sleep(30); clearInterval(tick);
  const running = seen.filter(s => s.running && s.ms > 0);
  assert.ok(events.filter(([e]) => e === 'state').length >= 3, 'state is nudged during the run');
  assert.ok(running.length >= 2);
  assert.ok(running.every(s => s.text && s.text !== 'working it out…'), 'always an estimate: ' + JSON.stringify(running.map(s => s.text)));
  const measured = running.at(-1).ms;
  assert.ok(measured > 0 && measured < N * 2500, 'the later estimate is for the films still waiting: ' + measured);
  core.close();
});

test('time left leaves out films that are waiting (backing off, or their site is paused)', () => {
  const films = [{ key: 'a' }, { key: 'b', failed: { wikipedia: { at: iso(NOW - 1000), n: 1 } } }, { key: 'c' }];
  const store = { library: { settings: {} }, films: Object.fromEntries(films.map(f => [f.key, f])) };
  const providers = [{ id: 'wikipedia', label: 'Wikipedia' }];
  const tracker = { rate: () => 1 / 10e3 }; // one film per 10 s
  const r = computeProgress({ store, providers, tracker, running: true, now: NOW });
  assert.equal(r.waiting, 1);
  assert.equal(r.etaMs, 20e3, 'two films to do, the backing-off one is not counted');
  assert.equal(r.percent, 33, 'a failed film is parked and counts as done (10 Nov), so it cannot hold the bar down for good');
  const paused = computeProgress({ store, providers, tracker, running: true, now: NOW, hostStatus: [{ host: 'en.wikipedia.org', state: 'paused', checkUntil: 0 }] });
  assert.equal(paused.waiting, 3); assert.equal(paused.etaText, null);
  assert.match(paused.waitingText, /3 films are waiting/);
});

test('time left counts first-time work only, so quiet re-reads and source upgrades do not keep it going', () => {
  const store = { library: { settings: {} }, films: { a: { key: 'a', checked: { lbpage: '2026-01-01T00:00:00Z' } } } };
  const lb = { id: 'lbpage', label: 'Letterboxd', since: '2026-10-28' }; // a re-read is due, but it is not first-time work
  const r = computeProgress({ store, providers: [lb], tracker: { rate: () => null }, running: true, now: NOW });
  assert.equal(r.complete, true); assert.equal(r.etaText, null);
});

test('etaMs adds up the id-finding sources (they run in turn) and uses guesses only where nothing is measured', () => {
  const guess = id => ({ boxd: 1000, wikidata: 1000, lbpage: 3000 })[id] ?? null;
  assert.equal(etaMs({ boxd: 10, wikidata: 10, lbpage: 5 }, () => null, guess), 20000);
  assert.equal(etaMs({ lbpage: 5 }, id => (id === 'lbpage' ? 1 / 100 : null), guess), 500);
  assert.equal(etaMs({ nobody: 5 }, () => null, guess), null);
});

// ---------- check notice ----------
test('a human-check window shows up as a plain notice and clears when the user completes it', () => {
  const t = createTrouble();
  t.observe({ host: 'letterboxd.com', kind: 'check', text: "Letterboxd is asking you to check you're human. A window has opened so you can do that." });
  assert.equal(t.list().length, 1); assert.match(t.list()[0].message, /check you're human/); assert.equal(t.hasCheck('Letterboxd'), true);
  t.observe({ host: 'letterboxd.com', kind: 'check-cleared', text: 'accepted' });
  assert.deepEqual(t.list(), []); assert.equal(t.hasCheck('Letterboxd'), false);
});

test('quiet re-reads that may not open the window are not counted as failures', () => {
  const t = createTrouble();
  const p = { id: 'lbpage', label: 'Letterboxd' };
  for (let i = 0; i < 30; i++) t.fail(p, 'x', Object.assign(new Error('no window'), { code: 'quiet' }));
  assert.deepEqual(t.list(), []);
});
