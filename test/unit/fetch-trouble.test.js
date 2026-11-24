// Trouble notices and the pasteable fetch log. Fake clock and providers; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTrouble } from '../../core/enrich.js';
import { createCore } from '../../core/api.js';

const MIN = 6e4, H = 60 * MIN;
const imdb = { id: 'imdbpage', label: 'IMDb pages' };
const mk = (extra = {}) => {
  const clock = { t: Date.parse('2026-10-28T05:00:00Z') };
  const events = [];
  const tr = createTrouble({ now: () => clock.t, emit: (e, p) => events.push([e, p]), ...extra });
  return { tr, clock, events };
};
const failN = (tr, p, n, err = { status: 503 }) => { for (let i = 0; i < n; i++) tr.fail(p, 'Film ' + i, err); };

test('20 failures in a row raise one notice and one event; a success clears it', () => {
  const { tr, events } = mk();
  failN(tr, imdb, 19);
  assert.deepEqual(tr.list(), []);
  failN(tr, imdb, 1);
  const [n] = tr.list();
  assert.equal(n.key, 'provider:imdbpage');
  assert.equal(n.site, 'IMDb');
  assert.match(n.message, /^IMDb pages haven't loaded for the last 20 films\. Matinee keeps trying quietly\. Turn on Debug mode in Settings → Debug for a log you can copy\.$/);
  failN(tr, imdb, 5);
  assert.equal(events.length, 1, 'emitted once');
  assert.equal(events[0][0], 'trouble');
  tr.ok(imdb, 'Film');
  assert.deepEqual(tr.list(), []);
});

test('a success in the middle resets the streak; aborted and paused failures do not count', () => {
  const { tr } = mk();
  failN(tr, imdb, 15); tr.ok(imdb); failN(tr, imdb, 15);
  failN(tr, imdb, 30, { code: 'aborted' });
  failN(tr, imdb, 30, { code: 'host-paused' });
  assert.deepEqual(tr.list(), []);
});

test('the event repeats at most once per 6 hours per source', () => {
  const { tr, clock, events } = mk();
  failN(tr, imdb, 20);
  tr.ok(imdb); clock.t += 2 * H;
  failN(tr, imdb, 20);
  assert.equal(events.length, 1, 'back again within 6 h: notice shows but no second event');
  assert.equal(tr.list().length, 1);
  tr.ok(imdb); clock.t += 5 * H;
  failN(tr, imdb, 20);
  assert.equal(events.length, 2);
});

test('an open breaker raises a notice at once, and closing it clears the notice', () => {
  const { tr, clock, events } = mk();
  const until = clock.t + 40 * MIN;
  tr.observe({ host: 'letterboxd.com', kind: 'breaker-open', until, text: 'x' });
  const [n] = tr.list();
  assert.equal(n.site, 'Letterboxd');
  assert.match(n.message, /^Letterboxd isn't answering at the moment\. It will try again around \d{1,2}:\d\d (am|pm)\.$/);
  assert.equal(events.length, 1);
  tr.observe({ host: 'letterboxd.com', kind: 'breaker-closed' });
  assert.deepEqual(tr.list(), []);
});

test('a site paused for more than 30 minutes raises a notice; recovery clears it', () => {
  let status = [{ host: 'letterboxd.com', state: 'paused', until: 0 }];
  const { tr, clock, events } = mk({ hostStatus: () => status });
  tr.observe({ host: 'letterboxd.com', kind: 'paused', until: clock.t + 20 * MIN, text: 'slow down' });
  clock.t += 29 * MIN;
  assert.deepEqual(tr.list(), []);
  status = [{ host: 'letterboxd.com', state: 'paused', until: clock.t + 10 * MIN }];
  clock.t += 2 * MIN;
  const [n] = tr.list();
  assert.match(n.message, /^Letterboxd has asked Matinee to slow down\. It will try again around \d{1,2}:\d\d (am|pm)\.$/);
  assert.equal(events.length, 1);
  status = [{ host: 'letterboxd.com', state: 'ok', until: 0 }];
  assert.deepEqual(tr.list(), []);
});

test('a short pause that ends never shows a notice', () => {
  let status = [{ host: 'letterboxd.com', state: 'paused' }];
  const { tr, clock } = mk({ hostStatus: () => status });
  tr.observe({ host: 'letterboxd.com', kind: 'paused', until: clock.t + 5 * MIN });
  status = [{ host: 'letterboxd.com', state: 'ok' }];
  clock.t += 2 * H;
  assert.deepEqual(tr.list(), []);
});

test('the log text lists events oldest first, keeps only the last 300, and has no addresses', () => {
  const { tr, clock } = mk();
  assert.match(tr.text(), /Nothing has been fetched yet/);
  tr.ok({ id: 'wikidata', label: 'Wikidata' }, 'Alien');
  clock.t += 1000;
  tr.fail(imdb, 'Heat', { status: 429 });
  tr.observe({ host: 'letterboxd.com', kind: 'paused', text: 'slow down', until: 0 });
  const lines = tr.text().split('\n');
  assert.match(lines[0], /^Matinee fetch log/);
  assert.match(lines[1], /^2026-10-28 05:00:00  Wikidata \/ wikidata  ok  Alien$/);
  assert.match(lines[2], /^2026-10-28 05:00:01  IMDb \/ imdbpage  failed  Heat  \(HTTP 429\)$/);
  assert.match(lines[3], /Letterboxd {2}paused {2}\(slow down\)$/);
  for (let i = 0; i < 400; i++) tr.ok(imdb, 'F' + i);
  const all = tr.text().split('\n');
  assert.equal(all.length, 301);
  assert.match(all[300], /F399/);
});

test('core: getState carries trouble, getFetchLog carries text, and the trouble event fires', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-trouble-'));
  const events = [];
  const p = { id: 'imdbpage', label: 'IMDb pages', async enrich(films, ctx) { for (const f of films) ctx.fail(f, new Error('down')); } };
  const core = createCore({ dataDir: dir, providers: [p], onEvent: e => events.push(e) });
  for (let i = 0; i < 25; i++) core.store.films['f' + i] = { key: 'f' + i, title: 'Film ' + i, year: 2000 };
  assert.deepEqual((await core.call('getState')).trouble, []);
  await core.call('refresh');
  const t = Date.now();
  while ((await core.call('getState')).job && Date.now() - t < 4000) await new Promise(r => setTimeout(r, 10));
  const st = await core.call('getState');
  assert.equal(st.trouble.length, 1);
  assert.match(st.trouble[0].message, /IMDb pages haven't loaded/);
  assert.ok(events.includes('trouble'));
  const log = await core.call('getFetchLog');
  assert.match(log.text, /imdbpage {2}failed {2}Film 0/);
  assert.ok(Array.isArray(log.entries), 'the existing entries field is kept');
  // a failed film now backs off, so nothing is pending and autoRefresh has nothing to chase
  assert.equal(core.store.films.f0.failed.imdbpage.n, 1);
  core.close();
});
