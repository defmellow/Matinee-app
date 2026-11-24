// IMDb keywords and reviews: parsers and provider. Fixtures are SYNTHETIC (IMDb blocked the build container).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImdbKeywords, parseImdbReviews } from '../../core/parse/imdbpage.js';
import imdbpage from '../../core/providers/imdbpage.js';
import { defaultWants } from '../../core/enrich.js';

const html = name => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), 'utf8');

test('keywords: lowercased, de-duplicated, vote-count junk dropped', () => {
  assert.deepEqual(parseImdbKeywords(html('imdbpage-keywords.html')), ['road trip', 'amnesia', 'father son relationship']);
  assert.deepEqual(parseImdbKeywords(html('imdbpage-keywords-plain.html')), ['desert', 'mute']);
  assert.deepEqual(parseImdbKeywords(''), []);
  assert.deepEqual(parseImdbKeywords(null), []);
});

test('keywords: at most 40', () => {
  const edges = Array.from({ length: 60 }, (_, i) => ({ node: { keyword: { text: { text: `kw ${i}` } } } }));
  const page = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { contentData: { data: { title: { keywords: { edges } } } } } } })}</script>`;
  assert.equal(parseImdbKeywords(page).length, 40);
});

test('reviews: spoilers and non-English skipped, out-of-range rating dropped, no handles', () => {
  const r = parseImdbReviews(html('imdbpage-reviews.html'));
  assert.deepEqual(r, [
    { text: 'A quiet, devastating film. Stanton says almost nothing and still breaks your heart. The ending is unforgettable.', rating: 9 },
    { text: 'Slow but gorgeous & worth it.' },
    { text: 'Rating out of range is dropped.' },
  ]);
  assert.ok(!/cinemafan99|spoilerguy|hola42|2020/.test(JSON.stringify(r)));
});

test('reviews: long text clipped to 320, max 8, junk input gives []', () => {
  const mk = t => ({ review: { spoiler: false, reviewText: t } });
  const reviews = Array.from({ length: 12 }, (_, i) => mk(`Review number ${i} is the best film that I have seen and it is good. ` + 'word '.repeat(100)));
  const page = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { contentData: { reviews } } } })}</script>`;
  const r = parseImdbReviews(page);
  assert.equal(r.length, 8);
  assert.ok(r.every(x => x.text.length <= 320));
  assert.deepEqual(parseImdbReviews(''), []);
  assert.deepEqual(parseImdbReviews('<html></html>'), []);
});

// ---------- provider ----------

function makeCtx(handler, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [], urls: [] };
  const http = { async page(url, opts) { rec.urls.push([url, opts]); return handler(url); } };
  const ctx = {
    http, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: m => rec.log.push(m),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const ok = text => ({ status: 200, text });
const film = (n = 1) => ({ key: `lid:${n}`, title: 'Paris, Texas', year: 1984, ids: { imdb: 'tt0087884' } });
const pages = url => ok(html(url.includes('/keywords/') ? 'imdbpage-keywords.html' : 'imdbpage-reviews.html'));

test('provider shape and wants: only films with an IMDb id', () => {
  assert.equal(imdbpage.id, 'imdbpage');
  assert.equal(imdbpage.label, 'IMDb keywords and reviews');
  assert.equal(imdbpage.needsKey, false);
  assert.equal(imdbpage.refreshDays, 180);
  assert.equal(imdbpage.retryMissDays, 45);
  assert.equal(defaultWants(imdbpage, { key: 'a', ids: {} }), false);
  assert.equal(defaultWants(imdbpage, film()), true);
});

test('provider: keywords then reviews, in order, stored together', async () => {
  const { ctx, rec } = makeCtx(pages);
  await imdbpage.enrich([film()], ctx);
  assert.deepEqual(rec.urls.map(u => u[0]), ['https://www.imdb.com/title/tt0087884/keywords/', 'https://www.imdb.com/title/tt0087884/reviews/']);
  assert.equal(rec.done[0].data.keywords.length, 3);
  assert.equal(rec.done[0].data.reviews.length, 3);
  assert.deepEqual(rec.progress.at(-1), [1, 1]);
});

test('provider: nothing on either page records a miss; one list is enough', async () => {
  let { ctx, rec } = makeCtx(() => ({ status: 404, text: '' }));
  await imdbpage.enrich([film()], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  ({ ctx, rec } = makeCtx(url => (url.includes('/keywords/') ? ok(html('imdbpage-keywords.html')) : ok('<html><script id="__NEXT_DATA__" type="application/json">{}</script></html>'))));
  await imdbpage.enrich([film()], ctx);
  assert.deepEqual(rec.done[0].data.reviews, []);
  assert.equal(rec.done[0].data.keywords.length, 3);
});

test('provider: three blocked films in a row stop the run, nothing recorded as a miss', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 403, text: '' }));
  await imdbpage.enrich([1, 2, 3, 4, 5].map(film), ctx);
  assert.equal(rec.fail.length, 3);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.urls.length, 3);
  assert.match(rec.log[0], /stopped asking/);
});

test('provider: a challenge page (HTTP 202) counts as blocked; a good film resets the streak', async () => {
  let n = 0;
  const { ctx, rec } = makeCtx(url => (url.includes('tt0087884') && ++n <= 2 ? { status: 202, text: '' } : pages(url)));
  await imdbpage.enrich([film(1), film(2), film(3)], ctx);
  assert.equal(rec.fail.length, 2);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.log.length, 0);
});

test('provider: a network error fails that film only; abort stops straight away', async () => {
  let { ctx, rec } = makeCtx(() => { throw new Error('offline'); });
  await imdbpage.enrich([film(1), film(2)], ctx);
  assert.equal(rec.fail.length, 2);
  const ac = new AbortController(); ac.abort();
  ({ ctx, rec } = makeCtx(pages, { signal: ac.signal }));
  await assert.rejects(imdbpage.enrich([film()], ctx), { code: 'aborted' });
  assert.equal(rec.urls.length, 0);
});
