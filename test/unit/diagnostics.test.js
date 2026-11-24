import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { HttpError } from '../../core/net.js';
import lbpage from '../../core/providers/lbpage.js';
import { runTestFetch, formatReport, hostTable, plainVsWindow } from '../../core/diagnostics/index.js';
import { scrubText, splitUrl, cookieNames, collectSecrets } from '../../core/diagnostics/redact.js';
import { pickFilms, freshClone, ANCHORS } from '../../core/diagnostics/select.js';

// Synthetic fixtures only: made-up films, made-up keys, a fake http. Nothing here touches the network.
const SECRET = 'SECRETKEY123456';
const COOKIE_VALUE = 'COOKIEVALUE98765';
const LB_HTML = fs.readFileSync(new URL('../fixtures/synthetic/lbpage-paris-texas.html', import.meta.url), 'utf8');

const headers = (o = {}) => new Headers(o);
function fakeHttp(handler) {
  const mk = lane => ({
    observe: () => () => {},
    hostStatus: () => [],
    limitsFor: () => ({ concurrency: 1, gap: 0 }),
    withPriority: n => mk(n),
    text: async (url, o) => handler('text', url, o, lane),
    json: async (url, o) => handler('json', url, o, lane),
    browserText: async (url, o) => handler('browserText', url, o, lane),
    page: async (url, o) => handler('page', url, o, lane),
    response: async (url, o) => handler('response', url, o, lane),
  });
  return mk(3);
}
const ok = (text = 'x', status = 200, h = {}) => ({ status, text, headers: headers(h), url: 'u' });

function provider(id, run, over = {}) {
  return {
    id, label: id, needsKey: false, ...over,
    async enrich(films, ctx) {
      for (const f of films) {
        if (ctx.skip?.(f)) continue;
        try { ctx.done(f, await run(f, ctx)); } catch (e) { ctx.fail(f, e); }
      }
    },
  };
}

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-diag-'));
  const store = createStore(dir);
  const mk = (n, title, year, extra = {}) => ({ key: `lid:t${n}`, lid: `t${n}`, slug: `film-${n}`, title, year, ids: { imdb: `tt000000${n}` }, src: { wikidata: { runtime: 100, genres: ['Drama'] }, imdb: { ratings: { imdb: { value: 7, votes: 1000 * n } } } }, checked: { wikidata: '2026-01-01T00:00:00.000Z' }, missed: {}, ...extra });
  const rows = [mk(1, 'Alpha', 1990), mk(2, 'Beta', 2001), mk(3, 'Gamma', 2010), mk(4, 'Delta', 2015), mk(5, 'Epsilon', 2020), mk(6, 'Zeta', 2024), mk(7, 'Eta', 2027, { src: { wikidata: { released: '2099-01-01' } } })];
  for (const f of rows) store.films[f.key] = f;
  store.library.films['lid:t1'] = { watched: true, rating: 9, tags: ['mine'], note: 'private note' };
  store.library.films['lid:t2'] = { watched: true, rating: 6 };
  store.library.films['lid:t3'] = { watchlist: true };
  store.library.films['lid:t4'] = { watched: true, rating: 7 };
  store.library.settings.keys = { tmdb: SECRET };
  store.flush();
  return { store, dir };
}
const snapshot = (store, dir) => JSON.stringify({ f: store.films, l: store.library, c: store.cache, disk: fs.readdirSync(dir).sort().map(n => [n, fs.readFileSync(path.join(dir, n), 'utf8')]) });

test('scrubText cuts query strings, key parameters and known secrets', () => {
  const t = scrubText(`HTTP 401 for https://api.themoviedb.org/3/movie/603?api_key=${SECRET}&language=en and token=abc123 ${SECRET}`, [SECRET]);
  assert.ok(!t.includes(SECRET));
  assert.ok(!t.includes('language=en'));
  assert.ok(t.includes('api.themoviedb.org/3/movie/603'));
  assert.deepEqual(splitUrl('https://letterboxd.com/film/x/?a=1#b'), { host: 'letterboxd.com', path: '/film/x/' });
  assert.deepEqual(collectSecrets({ keys: { tmdb: SECRET, omdb: '' } }), [SECRET]);
});

test('cookieNames keeps names and flags only, never values', () => {
  const out = cookieNames([{ name: 'cf_clearance', domain: '.letterboxd.com', value: COOKIE_VALUE, secure: true, expirationDate: 1 }, { name: 'sess', domain: 'x', value: 'v' }]);
  assert.deepEqual(out, [{ name: 'cf_clearance', domain: '.letterboxd.com', secure: true, session: false }, { name: 'sess', domain: 'x', secure: false, session: true }]);
  assert.ok(!JSON.stringify(out).includes(COOKIE_VALUE));
});

test('pickFilms: a mix from the library; falls back to anchors when it is small', () => {
  const { store } = tmpStore();
  const picked = pickFilms(store, { count: 6, now: Date.parse('2026-10-29') });
  assert.equal(picked.length, 6);
  assert.equal(new Set(picked.map(p => p.film.key)).size, 6);
  assert.equal(picked.find(p => p.role === 'recent').film.key, 'lid:t7'); // the upcoming one
  assert.equal(picked.find(p => p.role === 'obscure').film.key, 'lid:t1'); // fewest IMDb votes
  assert.ok(picked.some(p => p.role === 'watched') && picked.some(p => p.role === 'watchlist'));
  const tiny = pickFilms({ films: {}, library: { films: {} } }, { count: 4 });
  assert.equal(tiny.length, 4);
  assert.deepEqual(tiny.map(p => p.film.title), ANCHORS.slice(0, 4).map(a => a[0]));
  assert.ok(tiny.every(p => p.role === 'anchor'));
});

test('freshClone is a deep copy that looks never fetched', () => {
  const { store } = tmpStore();
  const orig = store.films['lid:t1'];
  const before = JSON.stringify(orig);
  const c = freshClone(orig);
  c.src.x = 1; c.ids.imdb = 'changed';
  assert.equal(JSON.stringify(orig), before);
  assert.deepEqual(c.checked, {});
  assert.deepEqual(Object.keys(freshClone(orig).src), []);
});

test('runTestFetch records requests, leaves the library and disk untouched, and keeps secrets out', async () => {
  const { store, dir } = tmpStore();
  let touched = 0, flushed = 0;
  const t = store.touch.bind(store), fl = store.flush.bind(store);
  store.touch = w => { touched++; return t(w); };
  store.flush = () => { flushed++; return fl(); };
  const before = snapshot(store, dir);
  const calls = [];
  const http = fakeHttp(async (via, url, o, lane) => {
    calls.push({ via, url, lane });
    if (url.includes('/boom')) throw new HttpError(401, `https://api.themoviedb.org/3/movie/1?api_key=${SECRET}`);
    return ok('<html>hello</html>', 200, { server: 'cloudflare', 'cf-ray': 'abc', 'content-type': 'text/html; charset=utf-8' });
  });
  const providers = [
    provider('rt', async (f, ctx) => { const r = await ctx.http.text(`https://example.test/a/${f.slug}?token=${SECRET}`); return { synopsis: 'A synopsis.', poster: 'p.jpg', ratings: { imdb: { value: 7 } }, status: r.status }; }),
    provider('beta', async (f, ctx) => { await ctx.http.page(`https://example.test/b/${f.slug}`); return { runtime: 99, people: { cast: [{ name: 'X' }] } }; }),
    provider('boom', async (f, ctx) => { await ctx.http.text('https://example.test/boom'); }),
    provider('keyed', async () => ({}), { needsKey: true, enabled: s => !!s.keys?.omdb }),
    provider('bulkish', async () => ({}), { bulk: { cacheKey: 'x', minFilms: 1, minGapMs: 1 } }),
  ];
  const steps = [];
  let probeCalls = 0;
  const report = await runTestFetch({
    store, providers, http, count: 4, feel: false, probes: 0, onStep: s => steps.push(s),
    cookieProbe: async d => { probeCalls++; return [{ name: 'cf_clearance', domain: d, value: COOKIE_VALUE, secure: true }]; },
  });
  // the library is exactly as it was, and nothing was saved or even marked for saving
  assert.equal(snapshot(store, dir), before);
  assert.equal(touched, 0); assert.equal(flushed, 0);
  assert.equal(report.films.length, 4);
  assert.deepEqual(report.providers.map(p => [p.id, p.state]), [['rt', 'ran'], ['beta', 'ran'], ['boom', 'ran'], ['keyed', 'skipped'], ['bulkish', 'skipped']]);
  assert.equal(report.providers.find(p => p.id === 'keyed').reason, 'no key');
  assert.match(report.providers.find(p => p.id === 'bulkish').reason, /bulk/);
  const a = report.providers.find(p => p.id === 'rt');
  assert.equal(a.filmsOk, 4);
  assert.deepEqual(a.perFilm[0].fields.sort(), ['poster', 'ratings', 'synopsis']);
  assert.equal(report.providers.find(p => p.id === 'boom').filmsFailed, 4);
  // requests: path only, method kinds, lane 0, headers
  const reqRt = report.requests.filter(r => r.provider === 'rt');
  assert.equal(reqRt.length, 4);
  assert.ok(reqRt.every(r => r.host === 'example.test' && r.path.startsWith('/a/') && !r.path.includes('?') && r.status === 200 && r.method === 'plain' && r.lane === 0));
  assert.equal(reqRt[0].headers.server, 'cloudflare'); assert.equal(reqRt[0].headers.cfRay, true); assert.equal(reqRt[0].headers.contentType, 'text/html');
  assert.ok(reqRt.every(r => r.film && /^F\d$/.test(r.film)));
  assert.ok(report.requests.filter(r => r.provider === 'beta').every(r => r.method === 'window'));
  assert.ok(calls.every(c => c.lane === 0));
  // coverage and backups
  assert.deepEqual(report.redundancy.poster.sources, { rt: 4 });
  assert.equal(report.redundancy.poster.fastest, 'rt');
  assert.deepEqual(report.redundancy.cast.sources, { beta: 4 });
  assert.equal(report.hosts[0].host, 'example.test');
  // cookies: names before and after, never values
  assert.equal(probeCalls, 9);
  assert.equal(report.cookies['letterboxd.com'].start[0].name, 'cf_clearance');
  assert.ok(report.cookies['letterboxd.com'].end);
  // steps streamed
  assert.ok(steps.some(s => s.provider === 'rt' && s.state === 'start'));
  assert.ok(steps.some(s => s.provider === 'rt' && s.state === 'done' && s.film));
  assert.equal(steps.at(-1).state, 'finished');
  // secrets: not in the data and not in the text
  const text = formatReport(report);
  for (const blob of [JSON.stringify(report), text]) {
    assert.ok(!blob.includes(SECRET), 'key leaked');
    assert.ok(!blob.includes(COOKIE_VALUE), 'cookie value leaked');
    assert.ok(!/[?&]token=/.test(blob) && !/api_key=(?!\[redacted\])/.test(blob), 'query leaked');
  }
  assert.ok(text.includes('cf_clearance'));
  assert.deepEqual(report.options.keysPresent, { tmdb: true });
});

test('real lbpage over a fake plain request: recorded as plain, and counted as usable', async () => {
  const { store } = tmpStore();
  const http = fakeHttp(async (via, url) => (via === 'browserText' ? ok(LB_HTML) : ok('<html></html>')));
  const report = await runTestFetch({ store, providers: [lbpage], http, count: 3, feel: false, probes: 0 });
  const row = report.providers[0];
  assert.equal(row.state, 'ran');
  assert.ok(row.filmsOk >= 1, JSON.stringify(row.perFilm));
  assert.ok(report.requests.every(r => r.method === 'plain-browser' && r.host === 'letterboxd.com'));
  const pw = report.plainVsWindow.find(x => x.provider === 'lbpage');
  assert.equal(pw.plain.tried, report.requests.length);
  assert.equal(pw.plain.usable, pw.plain.tried);
  assert.equal(pw.window.tried, 0);
  assert.ok(row.perFilm[0].fields.includes('feel text') || row.perFilm[0].keys.length > 0);
});

test('plain checks: imdbpage and allmovie are tried with a plain request and judged by what comes back', async () => {
  const { store } = tmpStore();
  const imdb = provider('imdbpage', async () => null);
  const allmovie = provider('allmovie', async () => null);
  const http = fakeHttp(async (via, url) => {
    if (via === 'browserText' && url.includes('imdb.com')) return ok('<html><title>Just a moment...</title></html>', 403, { 'cf-mitigated': 'challenge' });
    if (via === 'browserText') return ok('<html><title>Search - AllMovie</title></html>', 200);
    return ok('<html></html>');
  });
  const report = await runTestFetch({ store, providers: [imdb, allmovie], http, count: 4, feel: false, probes: 2 });
  const imdbChecks = report.plainChecks.filter(p => p.provider === 'imdbpage');
  assert.equal(imdbChecks.length, 1); // stopped after the first refusal
  assert.equal(imdbChecks[0].verdict, 'blocked');
  assert.equal(imdbChecks[0].headers.cfMitigated, 'challenge');
  assert.ok(report.plainChecks.filter(p => p.provider === 'allmovie').every(p => p.step === 'search' && p.verdict === 'unreadable'));
  assert.ok(report.requests.some(r => r.role === 'probe'));
  const pw = report.plainVsWindow.find(x => x.provider === 'imdbpage');
  assert.equal(pw.plain.blocked, 1); assert.equal(pw.plain.usable, 0);
});

test('a stopped test returns what it has and says so', async () => {
  const { store } = tmpStore();
  const ctl = new AbortController(); ctl.abort();
  const report = await runTestFetch({ store, providers: [provider('rt', async () => ({ poster: 'p' }))], http: fakeHttp(async () => ok()), count: 3, signal: ctl.signal, feel: false });
  assert.equal(report.aborted, true);
  assert.match(formatReport(report), /STOPPED EARLY/);
});

test('hostTable and plainVsWindow summarise requests', () => {
  const rq = [
    { host: 'a.test', atMs: 0, ms: 100, status: 200, challenge: false, bytes: 10 },
    { host: 'a.test', atMs: 1000, ms: 200, status: 429, challenge: false, bytes: 0 },
    { host: 'a.test', atMs: 3000, ms: 100, status: 200, challenge: false, bytes: 10, error: null },
  ];
  const [h] = hostTable(rq);
  assert.equal(h.requests, 3); assert.equal(h.ok, 2); assert.equal(h.blocked, 1);
  assert.equal(h.avgGapMs, Math.round((1100 + 1900) / 2));
  assert.deepEqual(plainVsWindow([], []), []);
});

test('formatReport copes with an empty or partial report', () => {
  assert.match(formatReport({}), /Matinee test fetch report/);
  assert.match(formatReport(null), /Matinee test fetch report/);
});

test('with the feel step on, the real library is still untouched and the step reports its time', async () => {
  const { store, dir } = tmpStore();
  let touched = 0;
  store.touch = () => { touched++; };
  const before = snapshot(store, dir);
  const http = fakeHttp(async () => ok());
  const report = await runTestFetch({ store, providers: [provider('rt', async () => ({ consensus: 'A gentle, moving film.', synopsis: 's' }))], http, count: 4, probes: 0, feel: true });
  assert.equal(snapshot(store, dir), before);
  assert.equal(touched, 0);
  assert.equal(report.feelImpact.films, 4);
  assert.equal(report.feelImpact.library, 7);
  assert.ok(report.feelImpact.groups.find(g => g.id === 'rt.consensus').films === 4);
  assert.match(formatReport(report), /worked out in \d+\.\ds/);
});

test('the Letterboxd plain check runs before the cookie check that follows plain requests', async () => {
  const { store } = tmpStore();
  const order = [];
  const http = fakeHttp(async (via, url) => { order.push((via === 'browserText' ? 'plain:' : 'other:') + new URL(url).host); return via === 'browserText' && url.includes('letterboxd.com') ? ok(LB_HTML) : ok('<html></html>'); });
  const report = await runTestFetch({
    store, providers: [lbpage], http, count: 3, probes: 1, feel: false,
    cookieProbe: async d => { order.push('cookies:' + d); return []; },
  });
  const check = report.plainChecks.find(p => p.provider === 'lbpage');
  assert.equal(check.verdict, 'usable');
  assert.ok(check.usable);
  const firstLb = order.indexOf('plain:letterboxd.com');
  const afterPlain = order.indexOf('cookies:letterboxd.com', order.indexOf('cookies:allmovie.com') + 1); // second round of cookie checks
  assert.ok(firstLb >= 0 && afterPlain > firstLb, order.join(' '));
});

test('a stopped feel step returns what it has', async () => {
  const { feelSourceImpact } = await import('../../core/diagnostics/feel-impact.js');
  const ctl = new AbortController(); ctl.abort();
  const res = await feelSourceImpact({ films: [{ key: 'k', title: 'K', year: 2000, ids: {}, src: { rt: { consensus: 'Moving.' } } }], store: { films: {} }, signal: ctl.signal });
  assert.equal(res.stopped, true);
  assert.equal(res.groups.length, 0);
});

test('a failure recorded on the copy still counts even if the trouble hook is not told', async () => {
  const { store } = tmpStore();
  const quiet = { id: 'quiet', label: 'quiet', needsKey: false, async enrich(films, ctx) { for (const f of films) { f.failed = { ...(f.failed || {}), quiet: { at: new Date().toISOString(), n: 1 } }; ctx.progress?.(1, films.length); } } };
  const report = await runTestFetch({ store, providers: [quiet], http: fakeHttp(async () => ok()), count: 2, probes: 0, feel: false });
  assert.equal(report.providers[0].filmsFailed, 2);
});
