// OMDb provider tests. All responses are hand-written synthetic fixtures (test/fixtures/synthetic/omdb-*.json),
// shaped from the public API docs: no live calls, no real key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import omdb, { validateKey, mapOmdb } from '../../core/providers/omdb.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';
import { compose } from '../../core/model.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));
const full = load('omdb-full');
const na = load('omdb-na');
const empty = load('omdb-empty');
const metascoreOnly = load('omdb-metascore-only');
const limit = load('omdb-limit');
const invalidKey = load('omdb-invalid-key');
const notFound = load('omdb-not-found');

const KEY = 'ab12cd34'; // made-up 8-character key, the shape OMDb issues
const settings = (extra = {}) => ({ keys: { omdb: KEY }, ...extra });

/** A fake http. Like the real one, text() resolves with { status, text } for any status (OMDb explains errors in the body). */
function fakeHttp(route) {
  const calls = [];
  return {
    calls,
    async text(url, opts = {}) {
      const u = new URL(url);
      const call = { url, host: u.host, q: Object.fromEntries(u.searchParams), signal: opts.signal };
      calls.push(call);
      const r = await route(call);
      if (r instanceof Error) throw r;
      return { status: r.status ?? 200, url, headers: new Headers(), text: typeof r.body === 'string' ? r.body : JSON.stringify(r.body) };
    },
  };
}
const ok = body => ({ status: 200, body });

function makeCtx(http, { settings: s = settings(), signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, settings: s, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: (...a) => rec.log.push(a.join(' ')),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const film = (i, o = {}) => ({ key: `k${i}`, title: 'Harbour Lights', year: 2019, ids: { imdb: `tt${9000000 + i}` }, ...o });
const run = async (films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await omdb.enrich(films, ctx); return rec; };

// ---------- contract ----------

test('provider shape: key provider that needs an IMDb id', () => {
  assert.equal(omdb.id, 'omdb');
  assert.equal(omdb.label, 'OMDb');
  assert.equal(omdb.needsKey, true);
  assert.equal(omdb.refreshDays, 30);
  assert.equal(omdb.keyHelp.url, 'https://www.omdbapi.com/apikey.aspx');
  assert.ok(omdb.keyHelp.steps.length >= 3 && omdb.keyHelp.steps.length <= 4);
  assert.ok(omdb.keyHelp.steps.some(s => /activat/i.test(s)), 'mentions the activation email');
  assert.equal(omdb.requires(film(1)), true);
  assert.equal(omdb.requires({ ids: {} }), false);
  assert.equal(omdb.requires({}), false);
});

test('enabled() needs a key, and ignores blanks', () => {
  assert.equal(omdb.enabled({ keys: { omdb: KEY } }), true);
  assert.equal(omdb.enabled({ keys: { omdb: '  ' } }), false);
  assert.equal(omdb.enabled({ keys: {} }), false);
  assert.equal(omdb.enabled({}), false);
});

test('the default rules skip films without an IMDb id; an opened older film refreshes after 45 days', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(defaultWants(omdb, { ids: {} }, { now }), false);
  assert.equal(defaultWants(omdb, film(1), { now }), true);
  assert.equal(defaultWants(omdb, film(1, { checked: { omdb: '2026-09-10T00:00:00Z' } }), { now, full: true }), false);
  assert.equal(defaultWants(omdb, film(1, { checked: { omdb: '2026-07-20T00:00:00Z' } }), { now, full: true }), true);
});

// ---------- mapping ----------

test('maps every field from a full response', () => {
  assert.deepEqual(mapOmdb(full), {
    ratings: {
      imdb: { value: 7.6, votes: 123456 },
      rt: { critics: 95 },
      metacritic: { critics: 78 },
    },
    runtime: 118,
    certification: 'R',
    poster: { url: 'https://m.media-amazon.com/images/M/SYNTHETIC_POSTER._V1_SX300.jpg' },
    awardsText: 'Won 2 Oscars. 14 wins & 31 nominations total',
    boxOffice: 48500000,
    countries: ['France', 'USA'],
  });
});

test('"N/A" values are treated as missing', () => {
  assert.deepEqual(mapOmdb(na), { ratings: { imdb: { value: 5.2 } } });
  const data = mapOmdb(na);
  assert.equal('runtime' in data, false);
  assert.equal('certification' in data, false);
  assert.equal('poster' in data, false);
  assert.equal('votes' in data.ratings.imdb, false); // imdbVotes was "N/A"
});

test('Metacritic falls back to the Metascore field; Rotten Tomatoes parses the percentage', () => {
  const data = mapOmdb(metascoreOnly);
  assert.deepEqual(data.ratings, { rt: { critics: 61 }, metacritic: { critics: 64 } });
  assert.equal(data.runtime, 152);
  assert.equal(data.certification, 'PG-13');
});

test('IMDb falls back to imdbRating when the Ratings array lacks it', () => {
  assert.deepEqual(mapOmdb({ imdbRating: '8.1', imdbVotes: '1,234', Ratings: [] }).ratings, { imdb: { value: 8.1, votes: 1234 } });
});

test('"Not Rated" and "Unrated" are not stored as a certification', () => {
  assert.equal('certification' in mapOmdb({ Rated: 'Not Rated' }), false);
  assert.equal('certification' in mapOmdb({ Rated: 'UNRATED' }), false);
  assert.equal(mapOmdb({ Rated: 'TV-MA' }).certification, 'TV-MA');
});

test('nonsense values are ignored rather than stored', () => {
  const data = mapOmdb({ Ratings: [{ Source: 'Rotten Tomatoes', Value: 'great' }, { Source: 'Metacritic', Value: '250/100' }], imdbRating: '11.5', Runtime: 'soon' });
  assert.deepEqual(data, {});
});

test('a record with nothing useful maps to an empty object', () => {
  assert.deepEqual(mapOmdb(empty), {});
});

test('the mapped data feeds compose(): ratings arrive under the right sources and OMDb ranks last', () => {
  const f = { key: 'k', title: 'Harbour Lights', year: 2019, ids: {}, src: {
    omdb: mapOmdb(full),
    rt: { ratings: { rt: { critics: 90, audience: 88 } } },
  } };
  const c = compose(f);
  assert.equal(c.ratings.imdb.value, 7.6);
  assert.equal(c.ratings.metacritic.critics, 78);
  assert.equal(c.ratings.rt.critics, 90, "RT's own provider outranks OMDb's copy");
  assert.equal(c.runtime, 118);
  assert.equal(c.certification, 'R');
});

// ---------- running ----------

test('looks films up by IMDb id with the key, and records the mapped data', async () => {
  const http = fakeHttp(() => ok(full));
  const f = film(1);
  const rec = await run([f], http);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].host, 'www.omdbapi.com');
  assert.equal(http.calls[0].q.i, 'tt9000001');
  assert.equal(http.calls[0].q.apikey, KEY);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].film, f);
  assert.equal(rec.done[0].data.ratings.rt.critics, 95);
  assert.deepEqual(rec.progress, [[1, 1]]);
});

test('a film OMDb does not know is recorded as "found nothing"', async () => {
  const http = fakeHttp(() => ok(notFound));
  const rec = await run([film(1)], http);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
  assert.equal(rec.fail.length, 0);
});

test('a film where everything is N/A is recorded as "found nothing" too', async () => {
  const http = fakeHttp(() => ok(empty));
  const rec = await run([film(1)], http);
  assert.equal(rec.done[0].data, null);
});

test('progress is reported after each film', async () => {
  const http = fakeHttp(() => ok(full));
  const rec = await run([film(1), film(2), film(3)], http);
  assert.equal(rec.done.length, 3);
  assert.deepEqual(rec.progress.map(p => p[0]).sort(), [1, 2, 3]);
  assert.ok(rec.progress.every(p => p[1] === 3));
});

test('"Request limit reached!": stops politely, records nothing more, raises no error, logs why', async () => {
  let n = 0;
  const http = fakeHttp(() => ok(++n <= 3 ? full : limit));
  const films = Array.from({ length: 20 }, (_, i) => film(i + 1));
  const { ctx, rec } = makeCtx(http);
  await omdb.enrich(films, ctx); // resolves: no throw
  assert.equal(rec.done.length, 3, 'only the films answered before the limit are recorded');
  assert.equal(rec.fail.length, 0);
  assert.ok(http.calls.length < films.length, 'it stops asking once the limit is hit');
  assert.equal(rec.done.every(d => d.data !== null), true);
  assert.equal(rec.log.length, 1);
  assert.match(rec.log[0], /limit/i);
  assert.match(rec.log[0], /next time/i);
});

test('limit reached on the very first film: nothing recorded at all', async () => {
  const http = fakeHttp(() => ok(limit));
  const rec = await run([film(1), film(2), film(3)], http);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.log.length, 1);
});

test('the real service sends the limit message with HTTP 401: still the polite stop, not a "key stopped working"', async () => {
  const http = fakeHttp(() => ({ status: 401, body: limit }));
  const rec = await run([film(1), film(2)], http); // must not reject
  assert.equal(rec.done.length, 0);
  assert.match(rec.log[0], /limit/i);
});

test('an invalid key stops the whole provider with a message saying the key stopped working', async () => {
  const http = fakeHttp(() => ({ status: 401, body: invalidKey }));
  const films = Array.from({ length: 10 }, (_, i) => film(i + 1));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => omdb.enrich(films, ctx), err => {
    assert.match(err.message, /OMDb key stopped working/);
    assert.match(err.message, /Settings/);
    return true;
  });
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0);
  assert.ok(http.calls.length < films.length);
});

test('an unexpected OMDb error on one film is a failure for that film only', async () => {
  const http = fakeHttp(call => (call.q.i === 'tt9000002' ? ok({ Response: 'False', Error: 'Something went wrong.' }) : ok(full)));
  const rec = await run([film(1), film(2), film(3)], http);
  assert.deepEqual(rec.done.map(d => d.film.key).sort(), ['k1', 'k3']);
  assert.equal(rec.fail.length, 1);
  assert.equal(rec.fail[0].film.key, 'k2');
  assert.match(rec.fail[0].err.message, /Something went wrong/);
});

test('a network error on one film is a failure for that film only', async () => {
  const http = fakeHttp(call => (call.q.i === 'tt9000002' ? new TypeError('fetch failed') : ok(full)));
  const rec = await run([film(1), film(2), film(3)], http);
  assert.equal(rec.done.length, 2);
  assert.equal(rec.fail.length, 1);
});

test('a reply that is not JSON is a failure for that film, and the key stays out of the message', async () => {
  const http = fakeHttp(() => ({ status: 200, body: '<html>Bad gateway</html>' }));
  const rec = await run([film(1)], http);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 1);
  assert.ok(!rec.fail[0].err.message.includes(KEY));
  assert.ok(!String(rec.fail[0].err.url).includes(KEY));
});

test('errors from the network layer have the key scrubbed from their message', async () => {
  const http = fakeHttp(call => new HttpError(503, call.url)); // net.js puts the URL, key included, in the message
  const rec = await run([film(1)], http);
  assert.equal(rec.fail.length, 1);
  assert.ok(!rec.fail[0].err.message.includes(KEY), rec.fail[0].err.message);
});

test('an already-aborted signal stops straight away with code "aborted"', async () => {
  const http = fakeHttp(() => ok(full));
  const ac = new AbortController(); ac.abort();
  const { ctx } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(() => omdb.enrich([film(1)], ctx), err => err.code === 'aborted');
  assert.equal(http.calls.length, 0);
});

test('no key: does nothing', async () => {
  const http = fakeHttp(() => ok(full));
  const rec = await run([film(1)], http, { settings: { keys: {} } });
  assert.equal(http.calls.length, 0);
  assert.equal(rec.done.length, 0);
});

// ---------- validateKey ----------

test('validateKey: a working key', async () => {
  const http = fakeHttp(() => ok(full));
  assert.deepEqual(await validateKey(KEY, http), { ok: true, message: 'That key works.' });
  assert.equal(http.calls[0].q.apikey, KEY);
  assert.match(http.calls[0].q.i, /^tt\d+$/);
});

test('validateKey: a key OMDb rejects, with a hint about the activation email', async () => {
  const http = fakeHttp(() => ({ status: 401, body: invalidKey }));
  const r = await validateKey(KEY, http);
  assert.equal(r.ok, false);
  assert.match(r.message, /didn't accept that key/);
  assert.match(r.message, /activation/);
});

test('validateKey: a valid key that has used up its day still works', async () => {
  const http = fakeHttp(() => ({ status: 401, body: limit }));
  const r = await validateKey(KEY, http);
  assert.equal(r.ok, true);
  assert.match(r.message, /limit/i);
});

test('validateKey: no connection', async () => {
  const http = fakeHttp(() => new TypeError('fetch failed'));
  assert.deepEqual(await validateKey(KEY, http), { ok: false, message: "Couldn't reach OMDb — check your internet connection." });
});

test('validateKey: OMDb having a bad day is not blamed on the key', async () => {
  const http = fakeHttp(call => new HttpError(503, call.url));
  const r = await validateKey(KEY, http);
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.message, /copied/);
});

test('validateKey: empty key asks for one without calling OMDb', async () => {
  const http = fakeHttp(() => ok(full));
  const r = await validateKey('  ', http);
  assert.equal(r.ok, false);
  assert.equal(http.calls.length, 0);
});

// ---------- extras, daily allowance, slow-down ----------

test('awards, box office and countries are mapped from a full response', () => {
  const d = mapOmdb(full);
  assert.equal(d.awardsText, 'Won 2 Oscars. 14 wins & 31 nominations total');
  assert.equal(d.boxOffice, 48500000);
  assert.deepEqual(d.countries, ['France', 'USA']);
});

test('N/A awards, box office and country are left out', () => {
  const d = mapOmdb({ ...full, Awards: 'N/A', BoxOffice: 'N/A', Country: 'N/A' });
  assert.equal('awardsText' in d, false);
  assert.equal('boxOffice' in d, false);
  assert.equal('countries' in d, false);
});

test('the request asks for one film by IMDb id, JSON, and no retired parameters', async () => {
  const http = fakeHttp(() => ok(full));
  await run([film(1)], http);
  assert.deepEqual(Object.keys(http.calls[0].q).sort(), ['apikey', 'i', 'r']);
});

test('daily cap: stops by itself at 900 lookups, logs "paused until tomorrow", records no failures', async () => {
  const http = fakeHttp(() => ok(full));
  const s = settings({ omdbUsage: { day: new Date().toISOString().slice(0, 10), n: 898 } });
  const films = Array.from({ length: 10 }, (_, i) => film(i + 1));
  const { ctx, rec } = makeCtx(http, { settings: s });
  await omdb.enrich(films, ctx);
  assert.equal(http.calls.length, 2);
  assert.equal(rec.done.length, 2);
  assert.equal(rec.fail.length, 0);
  assert.equal(s.omdbUsage.n, 900);
  assert.match(rec.log[0], /until tomorrow/i);
});

test('yesterday\'s count is ignored: a new day starts from zero', async () => {
  const http = fakeHttp(() => ok(full));
  const s = settings({ omdbUsage: { day: '2000-01-01', n: 999 } });
  const rec = await run([film(1)], http, { settings: s });
  assert.equal(rec.done.length, 1);
  assert.equal(s.omdbUsage.n, 1);
});

test('the quiet background re-read keeps well back from the daily allowance (500)', async () => {
  const http = fakeHttp(() => ok(full));
  const s = settings({ omdbUsage: { day: new Date().toISOString().slice(0, 10), n: 499 } });
  const { ctx, rec } = makeCtx(http, { settings: s });
  ctx.silent = true;
  await omdb.enrich([film(1), film(2), film(3)], ctx);
  assert.equal(rec.done.length, 1);
});

test('hitting OMDb\'s own limit marks the day as used up, so the next run asks nothing', async () => {
  const s = settings();
  await run([film(1), film(2)], fakeHttp(() => ok(limit)), { settings: s });
  const http = fakeHttp(() => ok(full));
  const rec = await run([film(3)], http, { settings: s });
  assert.equal(http.calls.length, 0);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0);
});

test('a ctx.quota supplied by the app is used instead of settings', async () => {
  let n = 899;
  const { ctx, rec } = makeCtx(fakeHttp(() => ok(full)));
  ctx.quota = { get: () => n, add: k => { n += k; } };
  await omdb.enrich([film(1), film(2)], ctx);
  assert.equal(rec.done.length, 1);
  assert.equal(n, 900);
});

test('429: stops asking, the site pause is not blamed on the film, no throw', async () => {
  const http = fakeHttp(call => Object.assign(new HttpError(429, call.url), { code: 'host-paused' }));
  const films = Array.from({ length: 10 }, (_, i) => film(i + 1));
  const { ctx, rec } = makeCtx(http);
  await omdb.enrich(films, ctx);
  assert.ok(http.calls.length <= 2);
  assert.equal(rec.done.length, 0);
  assert.match(rec.log[0], /slow down/i);
});

test('"Error getting data." is a miss for an untitled or not-yet-released film, a failure for an ordinary one', async () => {
  const http = () => fakeHttp(() => ok({ Response: 'False', Error: 'Error getting data.' }));
  let rec = await run([film(1, { title: 'Untitled Stagtown Film', year: 2019 })], http());
  assert.equal(rec.fail.length, 0); assert.equal(rec.done[0].data, null);
  rec = await run([film(2, { year: new Date().getFullYear() + 1 })], http());
  assert.equal(rec.fail.length, 0); assert.equal(rec.done[0].data, null);
  rec = await run([film(3)], http());
  assert.equal(rec.fail.length, 1); assert.equal(rec.done.length, 0);
});
