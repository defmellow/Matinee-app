// Fixes from the page-source audit: search wait, unreadable pages, review card bounds, renderer deadline, skip guards, parser edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import allmovie from '../../core/providers/allmovie.js';
import imdbpage from '../../core/providers/imdbpage.js';
import mcreviews from '../../core/providers/mcreviews.js';
import tmdb from '../../core/providers/tmdb.js';
import omdb from '../../core/providers/omdb.js';
import { parseLetterboxdFilm } from '../../core/parse/lbpage.js';
import { parseImdbKeywords, parseImdbReviews } from '../../core/parse/imdbpage.js';
import { parseMcCritics } from '../../core/parse/reviews.js';
import { decodeEntities } from '../../core/parse/critics.js';
import { createPageRenderer } from '../../electron/page-renderer.js';

const fx = name => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), 'utf8');
const CHECK = '<html><head><title>Just a moment...</title></head><body></body></html>';

function makeCtx(http, extra = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, progress: (d, t) => rec.progress.push([d, t]), log: m => rec.log.push(m),
    done: (film, data, ids) => rec.done.push({ film, data, ids }), fail: (film, err) => rec.fail.push({ film, err }), ...extra,
  };
  return { ctx, rec };
}
const films = n => Array.from({ length: n }, (_, i) => ({ key: `lid:${i}`, title: 'Paris, Texas', year: 1984, ids: { imdb: 'tt0087884', metacritic: 'movie/paris-texas' } }));

// ---- -2 AllMovie waits ----
test('allmovie: the search page does not wait for .charactList; film pages do', async () => {
  const calls = [];
  const http = { async page(url, opts) { calls.push([url, opts]); return { status: 200, text: url.includes('/search/') ? fx('allmovie-search.html') : fx('allmovie-film.html') }; } };
  const { ctx } = makeCtx(http);
  await allmovie.enrich(films(1), ctx);
  const search = calls.find(c => c[0].includes('/search/'));
  assert.equal(search[1].waitFor, undefined);
  assert.ok(search[1].settleMs <= 1000);
  const film = calls.find(c => c[0].includes('/movie/'));
  if (film) assert.equal(film[1].waitFor, '.charactList');
});

// ---- -3 unreadable pages ----
test('allmovie: a 200 check page counts as a failure, not a miss, and three stop the run', async () => {
  const { ctx, rec } = makeCtx({ async page() { return { status: 200, text: CHECK }; } });
  await allmovie.enrich(films(5), ctx);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 3);
  assert.match(rec.log[0], /stopped asking/);
});

test('allmovie: an unfamiliar 200 search page is a failure; a real search page with no match is a genuine miss', async () => {
  let { ctx, rec } = makeCtx({ async page() { return { status: 200, text: '<html><head><title>Cookies</title></head><body>hi</body></html>' }; } });
  await allmovie.enrich(films(1), ctx);
  assert.equal(rec.fail.length, 1); assert.equal(rec.done.length, 0);
  ({ ctx, rec } = makeCtx({ async page() { return { status: 200, text: '<html><head><title>Search - AllMovie</title></head><body><ul class="results"></ul></body></html>' }; } }));
  await allmovie.enrich(films(1), ctx);
  assert.equal(rec.fail.length, 0); assert.deepEqual(rec.done.map(d => d.data), [null]);
});

test('imdbpage: a 200 page with no data block and nothing readable is a failure; one with a data block is a miss', async () => {
  let { ctx, rec } = makeCtx({ async page() { return { status: 200, text: CHECK }; } });
  await imdbpage.enrich(films(5), ctx);
  assert.equal(rec.done.length, 0); assert.equal(rec.fail.length, 3);
  const empty = '<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></body></html>';
  ({ ctx, rec } = makeCtx({ async page() { return { status: 200, text: empty }; } }));
  await imdbpage.enrich(films(1), ctx);
  assert.equal(rec.fail.length, 0); assert.deepEqual(rec.done.map(d => d.data), [null]);
});

test('mcreviews: a 200 page that is not a Metacritic page is a failure; a real empty list is a miss', async () => {
  let { ctx, rec } = makeCtx({ async text() { return { status: 200, text: CHECK }; } });
  await mcreviews.enrich(films(5), ctx);
  assert.equal(rec.done.length, 0); assert.equal(rec.fail.length, 3);
  ({ ctx, rec } = makeCtx({ async text() { return { status: 200, text: '<html><head><title>Reviews - Metacritic</title></head></html>' }; } }));
  await mcreviews.enrich(films(1), ctx);
  assert.equal(rec.fail.length, 0); assert.deepEqual(rec.done.map(d => d.data), [null]);
});

// ---- -5 last card bounded ----
test('lbpage: the last review is kept even though the page ends in the log-a-film form', () => {
  const rev = (t) => `<article class="production-viewing -viewing"><div class="body-text js-review-body"><p>${t}</p></div><div class="viewing-actions"></div></article>`;
  const form = '<form class="js-reviewfields -is-not-spoilersvisible"><input name="frm-spoilers"></form>';
  const html = `<html><head><title>Paris, Texas • Letterboxd</title></head><body><div class="js-popular-reviews">${rev('A patient, quietly devastating film with real warmth in it.')}${rev('The last one: a lovely and strange picture that stays with you.')}</div>${form}</body></html>`;
  const r = parseLetterboxdFilm(html).reviews;
  assert.equal(r.length, 2);
  assert.match(r[1].text, /^The last one/);
});

test('imdb and metacritic review parsers: tail markup after the last card is not read as part of it', () => {
  const tail = '<footer><a>Spoilers</a> <div title="Metascore 12 out of 100"></div></footer>';
  const mc = `<div data-testid="review-card"><div title="Metascore 80 out of 100"></div><div data-testid="review-quote-text">A fine and moving picture, quietly made.</div></div>${tail}`;
  assert.deepEqual(parseMcCritics(mc), [{ text: 'A fine and moving picture, quietly made.', score: 80 }]);
  const im = `<ul><li><div class="ipc-list-card--border-speech"><div class="ipc-html-content-inner-div">A fine and moving picture, quietly made.</div></div></li></ul><div class="review-spoiler">filter</div>`;
  assert.deepEqual(parseImdbReviews(im).map(x => x.text), ['A fine and moving picture, quietly made.']);
});

// ---- -7 renderer deadline ----
function hangingElectron() {
  class FakeWin {
    constructor() {
      this.destroyed = false; const wc = this.webContents = new EventEmitter();
      wc.userAgent = ''; wc.setWindowOpenHandler = () => {}; wc.stop = () => {}; wc.getURL = () => 'https://x.test/';
      wc.loadURL = async () => { setImmediate(() => wc.emit('did-finish-load')); };
      wc.executeJavaScript = () => new Promise(() => {}); // never settles
    }
    isDestroyed() { return this.destroyed; } isVisible() { return false; } show() {} hide() {} destroy() { this.destroyed = true; } on() {}
  }
  const ses = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} });
  return { BrowserWindow: FakeWin, session: { fromPartition: () => ses } };
}

test('page renderer: a script call that never resolves is cut off and later renders still run', async () => {
  const r = createPageRenderer({ ...hangingElectron(), timeouts: { loadMs: 80, waitForMs: 60, pollMs: 5, evalMs: 20, challengeMs: 50, challengePollMs: 5 } });
  const t0 = Date.now();
  const a = await r.render('https://x.test/a', { waitFor: '.x' });
  const b = await r.render('https://x.test/b', { settleMs: 1 });
  assert.ok(Date.now() - t0 < 3000);
  assert.ok(a && b);
  r.dispose();
});

test('page renderer: the overall deadline gives up with status 0 and drops the window', async () => {
  const r = createPageRenderer({ ...hangingElectron(), timeouts: { loadMs: 50, waitForMs: 5000, pollMs: 5, evalMs: 5000, deadlineMs: 80 } });
  const res = await r.render('https://x.test/a', { waitFor: '.x' });
  assert.equal(res.status, 0);
  assert.equal(res.text, '');
  r.dispose();
});

// ---- -9 skip guards ----
test('mcreviews, tmdb and omdb skip films the run no longer needs', async () => {
  const skipAll = () => true;
  for (const [p, settings] of [[mcreviews, {}], [tmdb, { tmdbKey: 'k', apiKeys: { tmdb: 'k' } }], [omdb, { omdbKey: 'k', apiKeys: { omdb: 'k' } }]]) {
    let called = 0;
    const http = new Proxy({}, { get: () => async () => { called++; return { status: 200, text: '', json: {} }; } });
    const { ctx, rec } = makeCtx(http, { skip: skipAll, settings });
    await p.enrich(films(2), ctx).catch(() => {});
    assert.equal(called, 0, p.id);
    assert.equal(rec.done.length + rec.fail.length, 0, p.id);
  }
});

// ---- -10 parser edges ----
test('imdb keywords: object nodes never become "[object object]"', () => {
  const data = { props: { pageProps: { contentData: { data: { title: { keywords: { edges: [
    { node: { keyword: { text: 'road movie' } } }, { node: { keyword: { id: 1 } } }, { node: { text: 'desert' } },
  ] } } } } } } };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
  assert.deepEqual(parseImdbKeywords(html), ['road movie', 'desert']);
});

test('decodeEntities: out-of-range numeric references are left as they were', () => {
  assert.equal(decodeEntities('a &#99999999; b'), 'a &#99999999; b');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
  assert.equal(decodeEntities('&#65;&#x42;&amp;'), 'AB&');
});
