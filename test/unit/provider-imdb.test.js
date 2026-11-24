// IMDb provider tests. The ratings file is a small synthetic TSV (test/fixtures/synthetic/imdb-ratings-sample.tsv),
// gzipped here and served as a web stream, so the real streaming path runs. No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import imdb, { readRatings, RATINGS_URL } from '../../core/providers/imdb.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';
import { compose } from '../../core/model.js';

const TSV = readFileSync(new URL('../fixtures/synthetic/imdb-ratings-sample.tsv', import.meta.url), 'utf8');

/** A web ReadableStream that yields `bytes` in pieces of `size` (small pieces exercise chunk boundaries). */
function streamOf(bytes, size = 64, { failAfter = null } = {}) {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (failAfter != null && at >= failAfter) { controller.error(new TypeError('terminated')); return; }
      if (at >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.subarray(at, at + size));
      at += size;
    },
  });
}

const gz = text => gzipSync(Buffer.from(text, 'utf8'));

/** A fake http with only response(), like core/net.js: resolves with a raw fetch Response for any status. */
function fakeHttp(route) {
  const calls = [];
  return {
    calls,
    async response(url, opts = {}) {
      calls.push({ url, signal: opts.signal });
      const r = await route(calls.length);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const serve = (bytes, { size = 64, headers = {}, status = 200, failAfter = null } = {}) =>
  new Response(streamOf(bytes, size, { failAfter }), { status, headers: { 'content-length': String(bytes.length), ...headers } });
const serveTsv = (text = TSV, opts) => fakeHttp(() => serve(gz(text), opts));

function makeCtx(http, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, settings: {}, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: (...a) => rec.log.push(a.join(' ')),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const film = (i, o = {}) => ({ key: `k${i}`, title: 'Harbour Lights', year: 2019, ids: { imdb: `tt${9000000 + i}` }, ...o });
const run = async (films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await imdb.enrich(films, ctx); return rec; };
const byKey = rec => Object.fromEntries(rec.done.map(d => [d.film.key, d.data]));

// ---------- contract ----------

test('provider shape: key-less, needs an IMDb id', () => {
  assert.equal(imdb.id, 'imdb');
  assert.equal(imdb.label, 'IMDb');
  assert.deepEqual(imdb.gives, ['IMDb ratings']);
  assert.equal(imdb.needsKey, false);
  assert.equal(imdb.refreshDays, 7);
  assert.equal(imdb.retryMissDays, 30);
  assert.equal(imdb.enabled, undefined);
  assert.equal(imdb.requires(film(1)), true);
  assert.equal(imdb.requires({ ids: {} }), false);
  assert.equal(imdb.requires({}), false);
});

test('the default rules: weekly refresh, and a film that was not in the file is retried monthly', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  assert.equal(defaultWants(imdb, { ids: {} }, { now }), false);
  assert.equal(defaultWants(imdb, film(1), { now }), true);
  assert.equal(defaultWants(imdb, film(1, { checked: { imdb: '2026-10-18T00:00:00Z' } }), { now, full: true }), false);
  assert.equal(defaultWants(imdb, film(1, { checked: { imdb: '2026-10-10T00:00:00Z' } }), { now, full: true }), true);
  assert.equal(defaultWants(imdb, film(1, { checked: { imdb: '2026-10-10T00:00:00Z' }, missed: { imdb: 'x' } }), { now }), false); // 11 days: too soon (retryMissDays 30; it was 7 before the audit)
  assert.equal(defaultWants(imdb, film(1, { checked: { imdb: '2026-09-10T00:00:00Z' }, missed: { imdb: 'x' } }), { now }), true);
  assert.equal(defaultWants(imdb, film(1, { checked: { imdb: '2026-10-18T00:00:00Z' }, missed: { imdb: 'x' } }), { now }), false);
});

// ---------- reading the file ----------

test('readRatings keeps only the wanted rows, as numbers', async () => {
  const found = await readRatings([TSV], new Set(['tt9000002', 'tt9000005', 'tt9000099']));
  assert.deepEqual([...found.keys()].sort(), ['tt9000002', 'tt9000005']);
  assert.deepEqual(found.get('tt9000002'), { value: 5.2, votes: 987 });
  assert.deepEqual(found.get('tt9000005'), { value: 10, votes: 6 });
});

test('readRatings copes with lines split across chunks, CRLF line endings and a missing final newline', async () => {
  const text = 'tconst\taverageRating\tnumVotes\r\ntt9000001\t7.6\t123456\r\ntt9000002\t5.2\t987';
  const chunks = text.match(/[\s\S]{1,5}/g);
  const found = await readRatings(chunks, new Set(['tt9000001', 'tt9000002']));
  assert.deepEqual(found.get('tt9000001'), { value: 7.6, votes: 123456 });
  assert.deepEqual(found.get('tt9000002'), { value: 5.2, votes: 987 });
});

test('readRatings skips malformed or impossible rows rather than inventing ratings', async () => {
  const text = ['tconst\taverageRating\tnumVotes', 'tt1\t\\N\t5', 'tt2\t7.5\t\\N', 'tt3\t11.5\t10', 'tt4\t6.0', 'tt5\t-1\t10', 'tt6\t6.5\t-3', 'tt7\t7.1\t42', ''].join('\n');
  const found = await readRatings([text], new Set(['tt1', 'tt2', 'tt3', 'tt4', 'tt5', 'tt6', 'tt7']));
  assert.deepEqual([...found.keys()], ['tt7']);
});

test('readRatings refuses a file that is not a ratings table, so no film is wrongly called "not found"', async () => {
  await assert.rejects(() => readRatings(['<html>Access denied</html>\n'], new Set(['tt1'])), /wasn't in the format/);
  await assert.rejects(() => readRatings(['tconst\tgenre\tyear\ntt1\tx\t1\n'], new Set(['tt1'])), /wasn't in the format/);
  await assert.rejects(() => readRatings(['tconst\taverageRating\tnumVotes\n'], new Set(['tt1'])), /wasn't in the format/);
  await assert.rejects(() => readRatings([], new Set(['tt1'])), /wasn't in the format/);
});

// ---------- running ----------

test('downloads the dataset once for many films and records the matching rows only', async () => {
  const http = serveTsv();
  const films = [film(1), film(2), film(3), film(4)];
  const rec = await run(films, http);
  assert.equal(http.calls.length, 1, 'one download per run');
  assert.equal(http.calls[0].url, 'https://datasets.imdbws.com/title.ratings.tsv.gz');
  assert.equal(http.calls[0].url, RATINGS_URL);
  assert.equal(rec.done.length, 4);
  assert.equal(rec.fail.length, 0);
  assert.deepEqual(byKey(rec).k1, { ratings: { imdb: { value: 7.6, votes: 123456 } } });
  assert.deepEqual(byKey(rec).k2, { ratings: { imdb: { value: 5.2, votes: 987 } } });
  assert.deepEqual(byKey(rec).k3, { ratings: { imdb: { value: 8.9, votes: 2403117 } } });
  assert.deepEqual(byKey(rec).k4, { ratings: { imdb: { value: 3.1, votes: 55 } } });
  assert.equal(typeof byKey(rec).k1.ratings.imdb.value, 'number');
  assert.equal(typeof byKey(rec).k1.ratings.imdb.votes, 'number');
});

test('works however the compressed bytes are chunked', async () => {
  for (const size of [1, 7, 4096]) {
    const rec = await run([film(1), film(3)], serveTsv(TSV, { size }));
    assert.equal(byKey(rec).k1.ratings.imdb.votes, 123456, `chunk size ${size}`);
    assert.equal(byKey(rec).k3.ratings.imdb.value, 8.9, `chunk size ${size}`);
  }
});

test('a film that is not in the file is recorded as "found nothing"', async () => {
  const rec = await run([film(1), film(9), film(11)], serveTsv());
  assert.equal(rec.done.length, 3);
  assert.notEqual(byKey(rec).k1, null);
  assert.equal(byKey(rec).k9, null); // tt9000009: not in the sample
  assert.equal(byKey(rec).k11, null); // tt9000011: not in the sample
  assert.equal(rec.fail.length, 0);
});

test('the header row is not a film, and a rating of exactly 10.0 is kept', async () => {
  const rec = await run([{ key: 'h', ids: { imdb: 'tconst' } }, film(5)], serveTsv());
  assert.equal(byKey(rec).h, null);
  assert.deepEqual(byKey(rec).k5, { ratings: { imdb: { value: 10, votes: 6 } } });
});

test('films sharing an IMDb id each get the rating', async () => {
  const a = film(1), b = film(1, { key: 'dup' });
  const rec = await run([a, b], serveTsv());
  assert.equal(rec.done.length, 2);
  assert.deepEqual(byKey(rec).k1, byKey(rec).dup);
  assert.match(rec.log.at(-1), /2 of 2 films/);
});

test('a body the fetch layer already unzipped (Content-Encoding: gzip) is read as plain text', async () => {
  const bytes = Buffer.from(TSV, 'utf8');
  const http = fakeHttp(() => serve(bytes, { headers: { 'content-encoding': 'gzip' } }));
  const rec = await run([film(1)], http);
  assert.equal(byKey(rec).k1.ratings.imdb.value, 7.6);
});

test('a large file is streamed: matches are found among many thousands of other rows', async () => {
  const rows = ['tconst\taverageRating\tnumVotes'];
  for (let i = 1; i <= 60000; i++) rows.push(`tt${String(i).padStart(7, '0')}\t${(1 + (i % 90) / 10).toFixed(1)}\t${i * 3}`);
  const http = serveTsv(rows.join('\n') + '\n', { size: 1024 });
  const rec = await run([{ key: 'a', ids: { imdb: 'tt0000042' } }, { key: 'b', ids: { imdb: 'tt0059999' } }, { key: 'c', ids: { imdb: 'tt0099999' } }], http);
  assert.deepEqual(byKey(rec).a, { ratings: { imdb: { value: 5.2, votes: 126 } } });
  assert.deepEqual(byKey(rec).b.ratings.imdb.votes, 179997);
  assert.equal(byKey(rec).c, null);
});

test('progress: reports the download as it goes, never reaching "all done" before the rows are read, and ends on N of N', async () => {
  const rows = ['tconst\taverageRating\tnumVotes'];
  for (let i = 1; i <= 20000; i++) rows.push(`tt${String(i).padStart(7, '0')}\t${(1 + (i % 90) / 10).toFixed(1)}\t${i}`);
  const films = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, ids: { imdb: `tt${String(i + 1).padStart(7, '0')}` } }));
  const rec = await run(films, serveTsv(rows.join('\n'), { size: 512 }));
  assert.ok(rec.progress.length >= 2);
  assert.deepEqual(rec.progress.at(-1), [10, 10]);
  assert.ok(rec.progress.slice(0, -1).every(([d, t]) => d < 10 && t === 10), JSON.stringify(rec.progress));
  const doneCounts = rec.progress.map(p => p[0]);
  assert.deepEqual(doneCounts, [...doneCounts].sort((a, b) => a - b), 'never goes backwards');
});

test('progress without a Content-Length still ends on N of N', async () => {
  const bytes = gz(TSV);
  const http = fakeHttp(() => new Response(streamOf(bytes), { status: 200 }));
  const rec = await run([film(1), film(2)], http);
  assert.deepEqual(rec.progress, [[2, 2]]);
});

test('logs the download: what is happening and how it went', async () => {
  const rec = await run([film(1), film(2), film(9)], serveTsv());
  assert.equal(rec.log.length, 2);
  assert.match(rec.log[0], /Downloading IMDb/);
  assert.match(rec.log[0], /3 films/);
  assert.match(rec.log[1], /Downloaded IMDb's ratings file \(\d+\.\d MB\)/);
  assert.match(rec.log[1], /2 of 3 films/);
});

test('the matched data feeds compose(): ratings.imdb is { value, votes }', async () => {
  const rec = await run([film(3)], serveTsv());
  const f = { key: 'k', title: 'Harbour Lights', year: 2019, ids: {}, src: { imdb: byKey(rec).k3, omdb: { ratings: { imdb: { value: 1, votes: 1 } } } } };
  assert.deepEqual(compose(f).ratings.imdb, { value: 8.9, votes: 2403117 });
});

// ---------- failures: nothing is recorded, so every film is retried next time ----------

test('a network failure throws, and no film is marked as checked', async () => {
  const http = fakeHttp(() => new TypeError('fetch failed'));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1), film(2)], ctx), /Couldn't download IMDb's ratings file/);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0);
});

test('the connection dropping part-way through throws, and no film is marked as checked', async () => {
  const bytes = gz(TSV);
  const http = fakeHttp(() => serve(bytes, { size: 16, failAfter: 32 }));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1), film(2)], ctx), /Couldn't download/);
  assert.equal(rec.done.length, 0);
});

test('a cut-off download (truncated gzip) throws, and no film is marked as checked', async () => {
  const bytes = gz(TSV);
  const http = fakeHttp(() => serve(bytes.subarray(0, bytes.length - 12)));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1), film(2)], ctx));
  assert.equal(rec.done.length, 0);
});

test('an HTTP error page throws with a friendly message, and no film is marked as checked', async () => {
  for (const status of [403, 404, 503]) {
    const http = fakeHttp(() => new Response('<html>nope</html>', { status }));
    const { ctx, rec } = makeCtx(http);
    await assert.rejects(() => imdb.enrich([film(1)], ctx), err => {
      assert.match(err.message, /isn't available right now/);
      assert.ok(err.message.includes(String(status)));
      return true;
    });
    assert.equal(rec.done.length, 0);
  }
});

test('an error raised by the network layer after its retries is passed on as a download failure', async () => {
  const http = fakeHttp(() => new HttpError(503, RATINGS_URL));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1)], ctx), /isn't available right now \(error 503\)/);
  assert.equal(rec.done.length, 0);
});

test('a reply that is not a gzip file throws, and no film is marked as checked', async () => {
  const http = fakeHttp(() => serve(Buffer.from('<html>Access denied</html>')));
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1)], ctx));
  assert.equal(rec.done.length, 0);
});

test('a gzip file that is not a ratings table throws instead of marking every film "not found"', async () => {
  const http = serveTsv('<html>Service unavailable</html>\n');
  const { ctx, rec } = makeCtx(http);
  await assert.rejects(() => imdb.enrich([film(1)], ctx), /wasn't in the format/);
  assert.equal(rec.done.length, 0);
});

test('an already-aborted signal stops straight away with code "aborted"', async () => {
  const http = serveTsv();
  const ac = new AbortController(); ac.abort();
  const { ctx } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(() => imdb.enrich([film(1)], ctx), err => err.code === 'aborted');
  assert.equal(http.calls.length, 0);
});

test('aborting during the download stops with code "aborted" and records nothing', async () => {
  const ac = new AbortController();
  const bytes = gz(TSV);
  const http = fakeHttp(() => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(bytes.subarray(0, 10)); ac.abort(); },
  }), { status: 200 }));
  const { ctx, rec } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(() => imdb.enrich([film(1)], ctx), err => err.code === 'aborted');
  assert.equal(rec.done.length, 0);
});
