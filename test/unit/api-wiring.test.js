// 29 Oct wiring in core/api.js: cinema, test fetch, poster choice, person pages, small hooks. Fake fetch and providers only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import { importExport } from '../../core/import/export.js';
import { zipSync, strToU8 } from 'fflate';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(5); } };
const fx = n => fs.readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-wire-'));
const html = text => new Response(text, { status: 200, headers: { 'content-type': 'text/html' } });
const MORNING = Date.parse('2026-10-28T20:30:00Z'); // 2026-10-29 07:30 in Sydney

function mk(opts = {}) {
  const events = [];
  const core = createCore({ dataDir: tmp(), onEvent: (e, p) => events.push([e, p]), ...opts });
  core.store.library.settings.dendy = true; // the Dendy tests here run as if the friend code was entered (a new install starts with it off)
  const add = (key, over = {}) => { core.store.films[key] = { key, slug: key.replace(/^lid:/, ''), title: key, year: 2000, ids: {}, src: {}, checked: {}, missed: {}, ...over }; core.store.library.films[key] = { watched: false, rating: null, liked: false, watchlist: true, tags: [] }; return core.store.films[key]; };
  return { core, events, add };
}

// ---------- Dendy Newtown ----------

test('cinema: never read -> getCinema null; refreshCinema reads, saves, emits "cinema"; a second call the same day does nothing', async () => {
  const seen = [];
  const fetch = async url => {
    const p = new URL(url).pathname; seen.push(p);
    if (p === '/now-showing/') return html(fx('dendy-now-showing.html'));
    if (p === '/coming-soon/') return html(fx('dendy-coming-soon.html'));
    if (p === '/sitemap.xml') return new Response(fx('dendy-sitemap.xml'), { status: 200, headers: { 'content-type': 'application/xml' } });
    return new Response('nope', { status: 404 });
  };
  const { core, events, add } = mk({ fetch, clock: { now: () => MORNING } });
  add('lid:somefilm');
  assert.equal(await core.call('getCinema'), null);
  core.store.setCached('cinemaHealth', { failedDays: ['2026-10-26', '2026-10-27'] }); // earlier failed days ...
  const r = await core.call('refreshCinema');
  // Dendy's own data is tried first; this fake answers 404 for it, so the plain pages are used and 'graphql' is named in `partial`
  assert.equal(r.ok, true); assert.equal(r.error, null); assert.equal(typeof r.requests, 'number'); assert.deepEqual(r.partial, ['graphql']);
  assert.deepEqual(seen.filter(p => p !== '/graphql').sort(), ['/coming-soon/', '/now-showing/', '/sitemap.xml']);
  assert.deepEqual(events.filter(e => e[0] === 'cinema'), [['cinema', { ok: true, error: null, fetched: 0 }]]);
  const view = await core.call('getCinema');
  assert.ok(view.total > 3);
  assert.equal(view.cinema.name, 'Dendy Newtown');
  assert.equal(view.groups.flatMap(g => g.items).length, view.total);
  assert.ok(core.store.cached('cinema', Infinity).fetchedAt);
  assert.deepEqual(core.store.cached('cinemaHealth', Infinity), { failedDays: [] }, 'a good read wipes the failed-day count');
  const seenBefore = seen.length;
  const again = await core.call('refreshCinema');
  assert.equal(again.ok, true); assert.equal(again.requests, 0);
  assert.equal(seen.length, seenBefore, 'no new requests the same Sydney day');
});

test('cinema: three failed days raise one plain notice, success clears it; autoRefresh starts a read without waiting for it', async () => {
  let day = MORNING;
  const fetch = async () => new Response('blocked', { status: 403 });
  const { core, add } = mk({ fetch, clock: { now: () => day } });
  add('lid:somefilm');
  const notice = () => core.call('getState').then(s => s.trouble.find(t => t.key === 'cinema:dendy'));
  for (let i = 0; i < 2; i++) { const r = await core.call('refreshCinema', { force: true }); assert.equal(r.ok, false); day += 864e5; }
  assert.equal(await notice(), undefined, 'two days is not enough');
  await core.call('refreshCinema', { force: true });
  const n = await notice();
  assert.ok(n); assert.match(n.message, /Dendy Newtown/); assert.equal(n.site, 'Dendy Newtown');
  assert.equal(core.store.cached('cinema', Infinity).fetchedAt, null);
  // the same day twice counts once; a stopped read counts for nothing
  assert.equal(core.store.cached('cinemaHealth', Infinity).failedDays.length, 3);
  await core.call('refreshCinema', { force: true });
  assert.equal(core.store.cached('cinemaHealth', Infinity).failedDays.length, 3);
});

test('cinema: autoRefresh kicks one read off, does not wait for it, and starts no second while one is running', async () => {
  const hits = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const { core, events, add } = mk({ fetch: async url => { if (new URL(url).host === 'newtown.dendy.com.au') hits.push(new URL(url).pathname); await gate; return new Response('x', { status: 403 }); }, clock: { now: () => MORNING } });
  add('lid:a');
  await core.call('autoRefresh'); // resolves while Dendy has not answered yet
  await until(() => hits.length > 0);
  assert.equal(events.filter(e => e[0] === 'cinema').length, 0, 'still waiting for Dendy');
  await core.call('autoRefresh');
  release();
  await until(() => events.some(e => e[0] === 'cinema'));
  assert.equal(hits.length, 1, 'one request only: a blocked answer stops the read, and the second autoRefresh joined the first');
  assert.equal(core.store.cached('cinema', Infinity).fetchedAt, null, 'the failed try is saved so the next one waits');
});

// ---------- Test fetch ----------

const fakeProvider = (id, over = {}) => ({ id, label: id, needsKey: false, async enrich(films, ctx) { for (const f of films) { if (ctx.skip?.(f)) continue; ctx.done(f, { runtime: 90 }); } }, ...over });

test('test fetch: returns { report, text }, never changes the library, pauses the crawl, fires steps, remembers only the latest', async () => {
  const gate = { release: null };
  const slow = fakeProvider('slow', { async enrich(films, ctx) { await new Promise(r => { gate.release = r; }); for (const f of films) { if (ctx.skip?.(f)) continue; ctx.done(f, { runtime: 91 }); } } });
  const cookies = [];
  const { core, events, add } = mk({ providers: [fakeProvider('one'), slow], fetch: async () => new Response('x', { status: 404 }), cookieProbe: async d => { cookies.push(d); return [{ name: 'cf_clearance', domain: d, secure: true, session: false }]; } });
  for (let i = 0; i < 5; i++) add(`lid:t${i}`);
  const snapshot = JSON.stringify([core.store.films, core.store.library.films]);
  assert.equal(await core.call('getLastTestReport'), null);
  assert.deepEqual((await core.call('getState')).testFetch, { running: false, step: null });
  const run = core.call('runTestFetch', { count: 3 });
  await until(() => gate.release);
  const st = await core.call('getState');
  assert.equal(st.testFetch.running, true); assert.ok(st.testFetch.step);
  assert.deepEqual(await core.call('refresh'), { started: false, running: 'test' }, 'no crawl starts while the test runs');
  assert.deepEqual(await core.call('fetchNow', { keys: ['lid:t0'] }), { queued: 0 });
  await assert.rejects(core.call('runTestFetch'), /already running/);
  gate.release();
  const { report, text } = await run;
  assert.equal(report.films.length, 3);
  assert.equal(report.options.hasWindow, false, 'no page renderer was injected');
  assert.equal(report.options.cookieCheck, true);
  assert.ok(cookies.includes('letterboxd.com'));
  assert.match(text, /Matinee test fetch report/);
  assert.equal(JSON.stringify([core.store.films, core.store.library.films]), snapshot, 'the library is untouched');
  assert.ok(events.some(e => e[0] === 'testFetchStep' && e[1].phase === 'providers'));
  assert.ok(events.some(e => e[0] === 'testFetchStep' && e[1].phase === 'done'));
  const last = await core.call('getLastTestReport');
  assert.equal(last.text, text); assert.equal(typeof last.startedAt, 'string');
  assert.equal((await core.call('getState')).testFetch.running, false);
});

test('test fetch: hasWindow follows the injected renderer; count is clamped; cancelTestFetch stops it', async () => {
  const { core, add } = mk({ providers: [fakeProvider('one')], render: async () => ({ status: 200, text: '' }), fetch: async () => new Response('x', { status: 404 }) });
  for (let i = 0; i < 50; i++) add(`lid:t${i}`);
  const a = await core.call('runTestFetch', { count: 500 });
  assert.equal(a.report.films.length, 40);
  assert.equal(a.report.options.hasWindow, true);
  assert.equal(a.report.options.cookieCheck, false, 'no cookie probe given');
  const b = await core.call('runTestFetch', { count: 0 });
  assert.equal(b.report.films.length, 24);
  assert.deepEqual(await core.call('cancelTestFetch'), { ok: true }); // nothing running: harmless
});

test('test fetch: a background job running when it starts is stopped and started again afterwards', async () => {
  let runs = 0;
  const p = fakeProvider('one', { async enrich(films, ctx) { runs++; for (const f of films) { if (ctx.signal?.aborted) return; if (ctx.skip?.(f)) continue; await sleep(30); ctx.done(f, { runtime: 90 }); } } });
  const { core, add } = mk({ providers: [p], fetch: async () => new Response('x', { status: 404 }) });
  for (let i = 0; i < 6; i++) add(`lid:t${i}`);
  await core.call('refresh');
  await until(() => runs >= 1);
  await core.call('runTestFetch', { count: 2 });
  await until(() => core.store.films['lid:t5'].checked?.one, 6000);
  assert.ok(runs >= 2, 'the refresh was resumed after the test');
});

// ---------- Poster choice ----------

test('poster choice: automatic order, pick, fall back, back to automatic; survives re-import; rejects strangers', async () => {
  const { core, events, add } = mk();
  add('lid:p', { src: { tmdb: { poster: { url: 'https://t/p.jpg', thumb: 'https://t/p-s.jpg' } }, lbpage: { poster: 'https://lb/p.jpg' }, wikipedia: { poster: { url: 'https://w/p.jpg' } }, omdb: { poster: { url: 'https://o/p.jpg' } }, rss: { poster: { url: 'https://r/p.jpg' } } } });
  const opts = await core.call('getPosterOptions', { key: 'lid:p' });
  assert.deepEqual(opts.options.map(o => o.source), ['tmdb', 'lbpage', 'wikipedia', 'omdb', 'rss']);
  assert.deepEqual(opts.options.map(o => o.label), ['TMDB', 'Letterboxd', 'Wikipedia', 'OMDb', 'Letterboxd diary']);
  assert.equal(opts.auto, 'tmdb'); assert.equal(opts.chosen, null);
  assert.deepEqual(opts.options[1], { source: 'lbpage', label: 'Letterboxd', url: 'https://lb/p.jpg', thumb: 'https://lb/p.jpg' });
  const posterOf = async () => (await core.call('getLibrary')).films.find(f => f.key === 'lid:p').poster;
  assert.deepEqual(await posterOf(), { thumb: 'https://t/p-s.jpg' });
  events.length = 0;
  const after = await core.call('setPoster', { key: 'lid:p', source: 'wikipedia' });
  assert.equal(after.chosen, 'wikipedia');
  assert.deepEqual(events.filter(e => e[0] === 'library'), [['library', { keys: ['lid:p'] }]]);
  assert.deepEqual(await posterOf(), { thumb: 'https://w/p.jpg' });
  assert.equal((await core.call('getFilm', { key: 'lid:p' })).poster.url, 'https://w/p.jpg', 'the film page uses the pick too');
  assert.equal((await core.call('getSummaries', { keys: ['lid:p'] })).films[0].poster.thumb, 'https://w/p.jpg');
  // a pick whose source later loses its poster falls back to the automatic one
  delete core.store.films['lid:p'].src.wikipedia;
  core.call('getState'); await core.call('setSettings', { theme: 'dark' }); // any keyless edit clears the summary caches
  assert.equal((await core.call('getPosterOptions', { key: 'lid:p' })).chosen, null);
  assert.equal((await core.call('getFilm', { key: 'lid:p' })).poster.url, 'https://t/p.jpg');
  await core.call('setPoster', { key: 'lid:p', source: 'lbpage' });
  assert.equal((await core.call('setPoster', { key: 'lid:p', source: null })).chosen, null);
  assert.equal(core.store.library.films['lid:p'].posterPick, undefined);
  await assert.rejects(core.call('setPoster', { key: 'lid:p', source: 'wikidata' }), { code: 'bad-request' });
  await assert.rejects(core.call('setPoster', { key: 'lid:nope', source: 'tmdb' }), { code: 'bad-request' });
  add('lid:other', { src: { tmdb: { poster: { url: 'x' } } } });
  delete core.store.library.films['lid:other'];
  await assert.rejects(core.call('setPoster', { key: 'lid:other', source: 'tmdb' }), { code: 'bad-request' });
  assert.equal(core.store.library.films['lid:other'], undefined, 'no library record is made for a film outside the library');
});

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
test('poster choice survives a re-import of the export, like personal tags', () => {
  const { core } = mk();
  const zip = () => zipSync({
    'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'tester', 'T', '', '', '', '', '', '', '']])),
    'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa']])),
  });
  importExport(core.store, zip());
  const key = Object.keys(core.store.library.films)[0];
  core.store.library.films[key].posterPick = 'wikipedia';
  importExport(core.store, zip());
  assert.equal(core.store.library.films[key].posterPick, 'wikipedia');
});

// ---------- People ----------

function withPeople(core, add) {
  add('lid:h', { slug: 'example-harbour', title: 'Example Harbour', year: 2001, src: { wikidata: { people: { director: [{ name: 'Ada Fictional', id: 'wd:Q42' }] } }, lbpage: { people: { director: [{ name: 'Ada Fictional', slug: 'ada-fictional' }] } } } });
}

test('getPerson: resolves by Matinee id, source id, Letterboxd id and name; an unknown name with no films is empty, not "not found"', async () => {
  const { core, add } = mk();
  withPeople(core, add);
  for (const args of [{ id: 'p:ada-fictional', name: 'p:ada-fictional' }, { id: 'wd:Q42', name: 'wd:Q42' }, { id: 'p:ada-fictional' }, { id: 'wd:Q42' }, { name: 'Ada Fictional' }, { id: 'wd:Q42', name: 'Ada Fictional' }, { id: 'lb:ada-fictional' }]) {
    const p = await core.call('getPerson', args);
    assert.equal(p.name, 'Ada Fictional', JSON.stringify(args));
    assert.equal(p.films.length, 1); assert.equal(p.films[0].film.key, 'lid:h'); assert.deepEqual(p.films[0].roles, ['director']);
    assert.equal(p.stats.inLibrary, 1);
  }
  const nobody = await core.call('getPerson', { name: 'Someone New' });
  assert.equal(nobody.name, 'Someone New'); assert.deepEqual(nobody.films, []); assert.equal(nobody.stats.inLibrary, 0);
  await assert.rejects(core.call('getPerson', { id: 'p:unknown' }), { code: 'not-found' });
});

test('getPersonFilms: loading at once with library films, then the Letterboxd list and an event', async () => {
  const fetch = async url => (new URL(url).pathname === '/director/ada-fictional/' ? html(fx('lbperson-p2.html')) : new Response('nope', { status: 404 }));
  const { core, events, add } = mk({ fetch });
  withPeople(core, add);
  const first = await core.call('getPersonFilms', { id: 'wd:Q42', name: 'Ada Fictional' });
  assert.equal(first.status, 'loading'); assert.equal(first.films.length, 1);
  await until(() => events.some(e => e[0] === 'personFilms'));
  assert.deepEqual(events.find(e => e[0] === 'personFilms')[1], { id: 'wd:Q42', name: 'Ada Fictional', status: 'ok' });
  const r = await core.call('getPersonFilms', { id: 'wd:Q42' });
  assert.equal(r.status, 'ok'); assert.equal(r.source, 'letterboxd');
  assert.deepEqual(r.films.map(f => [f.slug, f.key]), [['old-style-film', null], ['example-harbour', 'lid:h']]);
});

// ---------- small hooks ----------

test('a job starts with total 1, not a 0 of 0 bar', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const held = { id: 'held', label: 'Held', async enrich(films, ctx) { await gate; for (const f of films) ctx.done(f, { runtime: 90 }); } };
  const { core, add } = mk({ providers: [held] });
  add('lid:a');
  await core.call('refresh');
  const s = await core.call('getState');
  assert.ok(s.job, 'the job is still running');
  assert.equal(s.job.total, 1); assert.equal(s.job.done, 0);
  release();
  await until(() => core.store.films['lid:a'].checked?.held);
});

test('getFilm: fetchStatus lists every source with its label, and fetchFilmAll fires a "film" event per source', async () => {
  const { core, events, add } = mk({ providers: [fakeProvider('alpha', { label: 'Alpha Source' }), fakeProvider('beta', { label: 'Beta Source' })] });
  add('lid:f');
  const f = await core.call('getFilm', { key: 'lid:f' });
  assert.deepEqual(f.fetchStatus.outcomes.map(o => [o.provider, o.label]), [['alpha', 'Alpha Source'], ['beta', 'Beta Source']]);
  const st = await core.call('fetchFilmAll', { key: 'lid:f' });
  assert.deepEqual(st.outcomes.map(o => [o.provider, o.label, o.status]), [['alpha', 'Alpha Source', 'ok'], ['beta', 'Beta Source', 'ok']]);
  const film = events.filter(e => e[0] === 'film').map(e => e[1]);
  assert.deepEqual(film.filter(e => e.provider).map(e => e.provider).sort(), ['alpha', 'beta']);
  assert.equal(film.at(-1).done, true);
  const again = await core.call('getFilm', { key: 'lid:f' });
  assert.equal(again.fetchStatus.outcomes.every(o => o.status === 'ok'), true);
});

const tinyZip = () => zipSync({
  'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'tester', 'T', '', '', '', '', '', '', '']])),
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa']])),
});

// A test fetch held open by a provider that waits for the gate (first call only), so the test can act while it runs.
// `order` records every enrich call; push 'done' yourself when the test fetch has returned: later entries came from a real job.
function heldTest() {
  const gate = { release: null }, order = [];
  let held = false;
  const slow = fakeProvider('slow', { async enrich(films, ctx) { if (!held) { held = true; await new Promise(r => { gate.release = r; }); } for (const f of films) { if (ctx.skip?.(f)) continue; ctx.done(f, { runtime: 91 }); } } });
  const counting = fakeProvider('count', { async enrich(films, ctx) { order.push('enrich'); for (const f of films) { if (ctx.skip?.(f)) continue; ctx.done(f, { runtime: 90 }); } } });
  const m = mk({ providers: [slow, counting], fetch: async () => new Response('x', { status: 404 }) });
  for (let i = 0; i < 5; i++) m.add(`lid:t${i}`);
  return { ...m, gate, order };
}

test('test fetch: an import during the test starts the refresh afterwards', async () => {
  const { core, gate, order } = heldTest();
  const run = core.call('runTestFetch', { count: 3 });
  await until(() => gate.release);
  await core.call('importExport', { bytes: tinyZip() }); // refused to start while the test runs: remembered
  gate.release();
  await run; order.push('done');
  assert.equal((await core.call('getState')).progress.running, true, 'the refresh for the import started once the test ended');
  core.close();
});

test('test fetch: a core closed during the test does not start a job afterwards', async () => {
  const { core, gate } = heldTest();
  await core.call('importExport', { bytes: tinyZip() }); // a job to resume, ...
  const run = core.call('runTestFetch', { count: 3 }); // ... which the test stops
  await until(() => gate.release);
  assert.equal((await core.call('getState')).testFetch.running, true);
  core.close();
  gate.release();
  await run.catch(() => {});
  await sleep(50);
  assert.equal((await core.call('getState')).progress.running, false, 'nothing restarted after close');
});
