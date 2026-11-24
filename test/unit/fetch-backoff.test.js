// Failure backoff for films a source keeps failing on. Synthetic stores and providers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich, hasPendingWork, hasFirstTimeWork, backoffMs, isBackingOff } from '../../core/enrich.js';

const H = 36e5, D = 24 * H;
const mkStore = films => ({ library: { settings: {}, films: {} }, films, touch() {}, flush() {} });
const film = (key, extra = {}) => ({ key, title: key, year: 1990, ...extra });
const failer = (err = new Error('down')) => ({ id: 'a', label: 'A', async enrich(fs, ctx) { for (const f of fs) ctx.fail(f, err); } });
const ago = ms => new Date(Date.now() - ms).toISOString();

test('backoff schedule: 1 h, 6 h, 1 day, then 3 days', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [H, 6 * H, D, 3 * D, 3 * D, 3 * D]);
  const f = n => film('x', { failed: { a: { at: ago(0.9 * backoffMs(n)), n } } });
  for (const n of [1, 2, 3, 4]) {
    assert.equal(isBackingOff(f(n), 'a'), true, 'n=' + n + ' still waiting');
    assert.equal(isBackingOff(film('x', { failed: { a: { at: ago(1.1 * backoffMs(n)), n } } }), 'a'), false, 'n=' + n + ' due again');
  }
  assert.equal(isBackingOff(film('x'), 'a'), false);
});

test('a failure is stored with a count that grows, and kept out of checked/missed', async () => {
  const store = mkStore({ n: film('n') });
  await enrich({ store, providers: [failer()], http: {} });
  assert.equal(store.films.n.failed.a.n, 1);
  assert.ok(Date.now() - Date.parse(store.films.n.failed.a.at) < 2000);
  assert.equal(store.films.n.checked, undefined);
  // once its wait is over it is tried again and the count goes up
  store.films.n.failed.a.at = ago(2 * H);
  await enrich({ store, providers: [failer()], http: {} });
  assert.equal(store.films.n.failed.a.n, 2);
});

test('a backing-off film is left alone by the background pass; an opened film ignores backoff', async () => {
  const seen = [];
  const p = { id: 'a', label: 'A', async enrich(fs, ctx) { for (const f of fs) { seen.push(f.key); ctx.done(f, { v: 1 }); } } };
  const store = mkStore({ n: film('n', { failed: { a: { at: ago(0.5 * H), n: 1 } } }), m: film('m') });
  await enrich({ store, providers: [p], http: {} });
  assert.deepEqual(seen, ['m']);
  await enrich({ store, providers: [p], http: {}, only: ['n'], ignoreBackoff: true });
  assert.deepEqual(seen, ['m', 'n']);
  assert.equal(store.films.n.failed.a, undefined, 'success clears the failure');
});

test('aborted and host-paused failures do not count against the film', async () => {
  for (const code of ['aborted', 'host-paused']) {
    const store = mkStore({ n: film('n') });
    await enrich({ store, providers: [failer(Object.assign(new Error('x'), { code }))], http: {} });
    assert.equal(store.films.n.failed, undefined, code);
  }
});

test('hasPendingWork and hasFirstTimeWork ignore films that are backing off', () => {
  const p = { id: 'a', label: 'A' };
  const backing = mkStore({ n: film('n', { failed: { a: { at: ago(0.5 * H), n: 1 } } }) });
  assert.equal(hasPendingWork({ store: backing, providers: [p] }), false);
  assert.equal(hasFirstTimeWork({ store: backing, providers: [p] }), false);
  const due = mkStore({ n: film('n', { failed: { a: { at: ago(2 * H), n: 1 } } }) });
  assert.equal(hasPendingWork({ store: due, providers: [p] }), true);
  assert.equal(hasFirstTimeWork({ store: due, providers: [p] }), true);
  // providers with their own wants() are covered too
  const own = { id: 'a', label: 'A', wants: () => true };
  assert.equal(hasPendingWork({ store: backing, providers: [own] }), false);
});

test('with the only first-time film backing off, the quiet re-read pass runs', async () => {
  const seen = [];
  const p = { id: 'a', label: 'A', refreshDays: 1, async enrich(fs, ctx) { for (const f of fs) { seen.push(f.key); ctx.done(f, { v: 1 }); } } };
  const store = mkStore({ n: film('n', { failed: { a: { at: ago(0.5 * H), n: 1 } } }), o: film('o', { checked: { a: '2020-01-01T00:00:00.000Z' }, src: { a: { keep: 1 } } }) });
  await enrich({ store, providers: [p], http: {}, full: true });
  assert.deepEqual(seen, ['o']);
});
