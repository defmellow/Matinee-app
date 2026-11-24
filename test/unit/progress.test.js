import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatEta, createRateTracker, etaMs, categoryProgress, computeProgress } from '../../core/progress.js';

const MIN = 6e4;

test('formatEta wording', () => {
  assert.equal(formatEta(null), null);
  assert.equal(formatEta(30e3), 'less than a minute');
  assert.equal(formatEta(3 * MIN), 'a few minutes');
  assert.equal(formatEta(19 * MIN), 'about 20 minutes');
  assert.equal(formatEta(3 * 60 * MIN), 'about 3 hours');
  assert.equal(formatEta(100 * 60 * MIN), 'more than 2 days');
});

test('rate tracker: empty, few samples, steady, stalled', () => {
  let t = 0;
  const r = createRateTracker({ now: () => t });
  assert.equal(r.rate('a'), null);
  for (let i = 0; i < 3; i++) { t += 10e3; r.note('a'); }
  assert.equal(r.rate('a'), null, 'too few samples');
  for (let i = 0; i < 7; i++) { t += 10e3; r.note('a'); }
  assert.ok(Math.abs(r.rate('a') * 1e3 - 10 / 90) < 0.05, 'about 1 film per 9-10 s');
  t += 6 * MIN; // nothing finished for longer than the window
  assert.equal(r.rate('a'), null, 'stalled');
});

test('etaMs is the slowest source that has a rate; null only when none has one', () => {
  const rates = { a: 1 / 1000, b: 1 / 500 };
  assert.equal(etaMs({ a: 100, b: 100 }, id => rates[id]), 100000);
  assert.equal(etaMs({ a: 100, c: 5 }, id => rates[id] ?? null), 100000); // c is stuck: ignored
  assert.equal(etaMs({ c: 5 }, () => null), null);
  assert.equal(etaMs({ a: 0 }, () => null), 0);
  assert.equal(etaMs({}, () => null), 0);
});

test('categoryProgress groups sources and skips empty groups', () => {
  const r = categoryProgress([
    { id: 'wikipedia', total: 10, pending: 5 }, { id: 'wikidata', total: 10, pending: 0 }, { id: 'boxd', total: 10, pending: 10 },
    { id: 'imdb', total: 0, pending: 0 },
  ]);
  const by = Object.fromEntries(r.categories.map(c => [c.id, c.percent]));
  assert.deepEqual(by, { covers: 50, details: 50 });
  assert.equal(r.complete, false);
  assert.equal(categoryProgress([]).complete, true);
  assert.equal(categoryProgress([{ id: 'imdb', total: 4, pending: 0 }]).percent, 100);
});

test('computeProgress: pending films, running ETA, complete', () => {
  const store = { library: { settings: {} }, films: {
    a: { key: 'a', checked: { wikipedia: '2026-01-01T00:00:00Z' } }, b: { key: 'b' },
  } };
  const providers = [{ id: 'wikipedia', label: 'W' }];
  const tracker = { rate: () => null };
  const idle = computeProgress({ store, providers, tracker, running: false });
  assert.equal(idle.percent, 50);
  assert.equal(idle.etaText, null);
  const busy = computeProgress({ store, providers, tracker, running: true });
  // 29 Oct (deliberate change): with no measured rate yet a rough per-site guess is used, so an estimate shows from the start
  assert.equal(busy.etaText, 'less than a minute');
  const fast = computeProgress({ store, providers, tracker: { rate: () => 1 / 6e3 }, running: true });
  assert.equal(fast.etaText, 'less than a minute');
  store.films.b.checked = { wikipedia: '2026-01-01T00:00:00Z' };
  const done = computeProgress({ store, providers, tracker, running: true });
  assert.equal(done.complete, true);
  assert.equal(done.etaText, null);
});

test('computeProgress: films a source keeps failing on do not hold the bar below 100%', () => {
  const NOW = Date.UTC(2026, 10, 8);
  const longAgo = new Date(NOW - 30 * 864e5).toISOString(); // the backoff has long run out, but nothing has retried yet
  const checked = { wikipedia: '2026-11-01T00:00:00Z' };
  const films = [
    { key: 'a', checked },
    { key: 'b', failed: { wikipedia: { at: new Date(NOW - 1000).toISOString(), n: 2 } } }, // backing off
    { key: 'c', failed: { wikipedia: { at: longAgo, n: 4 } } },                              // backoff expired
    { key: 'd', checked, missed: { wikipedia: '2026-11-01T00:00:00Z' } },                   // confirmed miss
  ];
  const store = { library: { settings: {} }, films: Object.fromEntries(films.map(f => [f.key, f])) };
  const r = computeProgress({ store, providers: [{ id: 'wikipedia', label: 'Wikipedia' }], tracker: { rate: () => null }, running: true, now: NOW });
  assert.equal(r.percent, 100);
  assert.equal(r.complete, true);
  assert.equal(r.waiting, 2);
});
