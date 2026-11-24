import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich } from '../../core/enrich.js';
import lbpage from '../../core/providers/lbpage.js';

// Synthetic stores and providers (clearly fake): checks scheduling, silence and that old data survives.
const OLD = '2020-01-01T00:00:00.000Z';
const mkStore = films => ({ library: { settings: {}, films: {} }, films, touch() {}, flush() {} });
const film = (key, extra = {}) => ({ key, title: key, year: 1990, ...extra });
const old = (id, key) => film(key, { checked: { [id]: OLD }, src: { [id]: { keep: 'me' } } });
const aged = { refreshDays: 1 };
const collect = () => { const ev = []; return { ev, emit: (e, p) => ev.push([e, p]) }; };

test('refresh waits while a first-time film is still pending', async () => {
  const seen = [];
  // 'a' never resolves the new film (its site is paused, which does not count against the film), so first-time work remains and the old film must not be re-read.
  const p = { id: 'a', label: 'A', ...aged, async enrich(fs, ctx) { for (const f of fs) { seen.push(f.key); ctx.fail(f, Object.assign(new Error('down'), { code: 'host-paused' })); } } };
  const store = mkStore({ n: film('n'), o: old('a', 'o') });
  await enrich({ store, providers: [p], http: {}, full: true });
  assert.deepEqual(seen, ['n']);
  assert.equal(store.films.o.checked.a, OLD);
});

test('once first-time work is done, the refresh runs silently', async () => {
  const seen = [], { ev, emit } = collect(), logged = [];
  const p = { id: 'a', label: 'A', ...aged, async enrich(fs, ctx) { seen.push(fs.map(f => f.key)); ctx.progress(1, 1); ctx.log('hello'); for (const f of fs) ctx.done(f, { v: f.key }); } };
  const store = mkStore({ n: film('n'), o: old('a', 'o') });
  const log = { add: x => logged.push(x) };
  await enrich({ store, providers: [p], http: {}, full: true, emit, log });
  assert.deepEqual(seen, [['n'], ['o']]);
  const beforeRefresh = ev.findIndex(([e, pl]) => e === 'library' && pl.keys.includes('n'));
  assert.ok(beforeRefresh >= 0);
  // everything mentioning the old film: only a library event, no progress or log
  assert.equal(ev.filter(([e]) => e === 'progress').length, 3); // announce, start, one update: all from the first-time pass
  assert.equal(ev.filter(([e]) => e === 'log').length, 1);
  assert.ok(ev.some(([e, pl]) => e === 'library' && pl.keys.includes('o')));
  assert.ok(logged.every(x => x.title !== 'o'));
  assert.equal(store.films.o.src.a.v, 'o');
});

test('a re-read that finds nothing keeps the old data and date', async () => {
  const p = { id: 'a', label: 'A', ...aged, async enrich(fs, ctx) { for (const f of fs) ctx.done(f, null); } };
  const store = mkStore({ o: old('a', 'o') });
  await enrich({ store, providers: [p], http: {}, full: true });
  assert.deepEqual(store.films.o.src.a, { keep: 'me' });
  assert.equal(store.films.o.checked.a, OLD);
  assert.ok(!store.films.o.missed?.a);
});

test('a failed refresh adds no problems and keeps the data', async () => {
  const p = { id: 'a', label: 'A', ...aged, async enrich(fs, ctx) { for (const f of fs) ctx.fail(f, new Error('down')); } };
  const store = mkStore({ o: old('a', 'o') });
  const r = await enrich({ store, providers: [p], http: {}, full: true });
  assert.equal(r.problems.length, 0);
  assert.deepEqual(store.films.o.src.a, { keep: 'me' });
});

test('first-time "nothing found" still records a miss', async () => {
  const p = { id: 'a', label: 'A', async enrich(fs, ctx) { for (const f of fs) ctx.done(f, null); } };
  const store = mkStore({ n: film('n') });
  await enrich({ store, providers: [p], http: {} });
  assert.ok(store.films.n.missed.a);
});

test('lbpage refresh never opens the page window; a challenge stops it quietly', async () => {
  let pages = 0, plain = 0;
  const http = {
    browserText: async () => { plain++; return { status: 403, text: '' }; },
    page: async () => { pages++; return { status: 200, text: '' }; },
  };
  const f = k => film(k, { slug: k, checked: { lbpage: OLD }, src: { lbpage: { keep: 'me' } } });
  const store = mkStore({ a: f('a'), b: f('b'), c: f('c') });
  const { ev, emit } = collect();
  const r = await enrich({ store, providers: [lbpage], http, full: true, emit });
  assert.equal(pages, 0);
  assert.equal(plain, 1); // stopped at the first challenge
  assert.equal(r.problems.length, 0);
  assert.ok(!ev.some(([e]) => e === 'progress' || e === 'log'));
  assert.deepEqual(store.films.a.src.lbpage, { keep: 'me' });
  assert.equal(store.films.a.checked.lbpage, OLD);
});

test('lbpage weekly recent-film check runs as quiet refresh work', async () => {
  const year = new Date().getUTCFullYear();
  const f = film('r', { year, slug: 'r', checked: { lbpage: OLD }, src: { lbpage: { keep: 'me' } } });
  assert.equal(lbpage.wants(f, { now: Date.now() }), true);
  const seen = [];
  const spy = { ...lbpage, enrich: async (fs, ctx) => { seen.push(ctx.silent); } };
  await enrich({ store: mkStore({ r: f }), providers: [spy], http: {} });
  assert.deepEqual(seen, [true]);
});
