// Letterboxd film page: parser and provider. The fixture is a trimmed, synthetic copy of the markup of a real page
// (Paris, Texas, rendered 22 Oct 2026) with made-up usernames. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLetterboxdFilm } from '../../core/parse/lbpage.js';
import lbpage, { toData } from '../../core/providers/lbpage.js';
import { defaultWants } from '../../core/enrich.js';

const html = readFileSync(new URL('../fixtures/synthetic/lbpage-paris-texas.html', import.meta.url), 'utf8');

test('parser: themes, mini-themes, genres, tagline, rating', () => {
  const r = parseLetterboxdFilm(html);
  assert.deepEqual(r.genres, ['Drama']);
  assert.deepEqual(r.themes, ['Moving relationship stories']);
  assert.equal(r.miniThemes.length, 2); // duplicate dropped
  assert.deepEqual(r.miniThemes[0], ['family', 'moving', 'heartbreaking', 'sadness', 'sad']);
  assert.equal(r.tagline, 'A place for dreams. A place for heartbreak. A place to pick up the pieces.');
  assert.equal(r.average, 4.36);
  assert.equal(r.ratingCount, 812520);
});

test('parser: reviews skip spoilers, non-English and duplicates; ratings 0–10; clipped', () => {
  const { reviews } = parseLetterboxdFilm(html);
  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews[0], { text: reviews[0].text, rating: 10 });
  assert.equal(reviews[1].rating, 7);
  assert.ok(reviews[1].text.length <= 320 && reviews[1].text.endsWith('…') && !/\bmore\b/.test(reviews[1].text.replace('anymore', '')));
  assert.deepEqual(reviews[2], { text: 'sad yeehaw', rating: 7 });
  assert.ok(reviews.every(x => !/spoilers|devastating/.test(x.text)));
});

test('parser: no usernames or handles anywhere in the output', () => {
  const out = JSON.stringify(parseLetterboxdFilm(html));
  for (const u of ['fixture_user_one', 'fixture_user_two', 'fixture_user_three', 'fixture_user_four', 'fixture_user_five']) assert.ok(!out.includes(u));
  assert.ok(!/href|\/film\/paris-texas/.test(out));
});

test('parser: null for non-film or empty pages', () => {
  assert.equal(parseLetterboxdFilm(''), null);
  assert.equal(parseLetterboxdFilm(null), null);
  assert.equal(parseLetterboxdFilm('<html><head><title>Hello</title></head></html>'), null);
  assert.equal(parseLetterboxdFilm('<html><head><title>Home • Letterboxd</title></head><body>nothing</body></html>'), null);
});

test('toData drops empty fields; null when nothing', () => {
  assert.deepEqual(toData({ themes: [], miniThemes: [], genres: ['Drama'], reviews: [] }), { genres: ['Drama'] });
  assert.equal(toData({ themes: [], miniThemes: [], genres: [], reviews: [] }), null);
  assert.equal(toData(null), null);
});

// ---------- provider ----------
function makeCtx(handler, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [], urls: [] };
  const http = { async page(url, opts) { rec.urls.push([url, opts]); return handler(url); } };
  const ctx = {
    http, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: m => rec.log.push(m),
    done: (film, data) => rec.done.push({ film, data }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const film = n => ({ key: `lid:${n}`, title: 'Paris, Texas', slug: 'paris-texas' });

test('provider shape and requires', () => {
  assert.equal(lbpage.id, 'lbpage');
  assert.equal(lbpage.needsKey, false);
  assert.equal(lbpage.refreshDays, 120);
  assert.equal(lbpage.retryMissDays, 45);
  assert.equal(defaultWants(lbpage, { key: 'a', ids: {} }), false);
  assert.equal(defaultWants(lbpage, film(1)), true);
  assert.equal(lbpage.requires({ ids: { letterboxd: 'x' } }), true);
});

test('provider: ok stores the parsed page; asks for the film URL with a review wait', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 200, text: html }));
  await lbpage.enrich([film(1)], ctx);
  assert.equal(rec.urls[0][0], 'https://letterboxd.com/film/paris-texas/');
  assert.equal(rec.urls[0][1].waitFor, '.js-review-body');
  assert.equal(rec.done[0].data.miniThemes.length, 2);
  assert.deepEqual(rec.progress.at(-1), [1, 1]);
});

test('provider: 404 records a miss; unreadable page fails without a miss', async () => {
  let { ctx, rec } = makeCtx(() => ({ status: 404, text: '' }));
  await lbpage.enrich([film(1)], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  ({ ctx, rec } = makeCtx(() => ({ status: 200, text: '<html><title>Oops</title></html>' })));
  await lbpage.enrich([film(1)], ctx);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 1);
});

test('provider: three blocked in a row (403, challenge page) stop the run, no misses', async () => {
  const replies = [{ status: 403, text: '' }, { status: 403, text: '' }, { status: 200, text: '<html><title>Just a moment...</title></html>' }];
  let i = 0;
  const { ctx, rec } = makeCtx(() => replies[i++]);
  await lbpage.enrich([1, 2, 3, 4, 5].map(film), ctx);
  assert.equal(rec.fail.length, 3);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.urls.length, 3);
  assert.match(rec.log[0], /stopped/);
});

test('provider: a good page resets the blocked streak', async () => {
  const replies = [{ status: 403, text: '' }, { status: 403, text: '' }, { status: 200, text: html }, { status: 403, text: '' }, { status: 403, text: '' }];
  let i = 0;
  const { ctx, rec } = makeCtx(() => replies[i++]);
  await lbpage.enrich([1, 2, 3, 4, 5].map(film), ctx);
  assert.equal(rec.urls.length, 5);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.log.length, 0);
});

test('provider: an aborted signal stops straight away', async () => {
  const ac = new AbortController(); ac.abort();
  const { ctx, rec } = makeCtx(() => ({ status: 200, text: html }), { signal: ac.signal });
  await assert.rejects(lbpage.enrich([film(1)], ctx), { code: 'aborted' });
  assert.equal(rec.urls.length, 0);
});
