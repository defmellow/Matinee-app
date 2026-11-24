import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { resolveFilm, userFilm } from '../../core/library.js';
import { parseActivity } from '../../core/parse/activity-page.js';
import { parseWatchlistPage } from '../../core/parse/watchlist-page.js';
import { refreshWatchlist } from '../../core/sources/watchlist.js';
import { refreshFromRss } from '../../core/sources/rss.js';

const PAGE = fs.readFileSync(new URL('../fixtures/synthetic/watchlist-page.html', import.meta.url), 'utf8');
const NOW = '2026-11-08T01:00:00.000Z';
const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-wl-')), { debounce: 5 });
const U = p => `https://letterboxd.com/ada/watchlist/by/added/${p > 1 ? `page/${p}/` : ''}`;

/** Fake http: `pages` maps watchlist page number → html (or a function); `activity` is the activity feed html (default: not available).
 *  calls.plain / calls.window count watchlist-page requests only; calls.activity counts activity requests. */
function fakeHttp(pages, { plainFails = false, activity = null } = {}) {
  const calls = { plain: [], window: [], activity: [] };
  const num = url => Number(/page\/(\d+)/.exec(url)?.[1] || 1);
  const answer = url => {
    if (/activity/.test(url)) { calls.activity.push(url); return { status: activity ? 200 : 404, url, text: activity || '' }; }
    const a = typeof pages === 'function' ? pages(num(url)) : pages[num(url)];
    if (a instanceof Error) throw a;
    return { status: a ? 200 : 404, url, text: a || '' };
  };
  const isList = url => !/activity/.test(url);
  return {
    calls,
    async browserText(url) { if (isList(url)) calls.plain.push(url); if (plainFails && isList(url)) return { status: 403, text: '' }; return answer(url); },
    async page(url) { if (isList(url)) calls.window.push(url); return answer(url); },
  };
}
const grid = (...slugs) => `<ul class="poster-list">${slugs.map(s => `<li class="griditem"><div class="react-component" data-item-name="${s} (2000)" data-item-slug="${s}"></div></li>`).join('')}</ul><div class="pagination"><a class="next" href="x">Older</a></div>`;
const last = (...slugs) => grid(...slugs).replace(/<div class="pagination">.*$/, '');
const addWatchlisted = (store, slug) => { const f = resolveFilm(store, { slug, title: slug, year: 2000 }); userFilm(store, f.key).watchlist = true; return f; };

test('the parser reads slugs, titles, years and film ids in page order', () => {
  const r = parseWatchlistPage(PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.hasNext, true);
  assert.deepEqual(r.items.map(i => i.slug), ['example-harbour', 'rock-roll-lamps', 'quiet-lighthouse', 'old-tram-stories']);
  assert.deepEqual(r.items[1], { slug: 'rock-roll-lamps', title: 'Rock & Roll Lamps', year: 1999, filmId: 1002 });
});

test('the parser refuses a check page and an unrelated page, but accepts an empty watchlist', () => {
  assert.equal(parseWatchlistPage('<html><head><title>Just a moment...</title></head></html>').challenge, true);
  assert.equal(parseWatchlistPage('<html><body>hello</body></html>').ok, false);
  assert.deepEqual(parseWatchlistPage('<div data-num-entries="0"><ul class="poster-list -grid"></ul></div>'), { ok: true, items: [], hasNext: false });
});

test('new films are added to the watchlist with today\'s date, and old ones are marked', async () => {
  const store = tmpStore();
  const known = resolveFilm(store, { slug: 'quiet-lighthouse', title: 'Quiet Lighthouse', year: 2023 });
  const http = fakeHttp({ 1: PAGE, 2: last('older-one') });
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(r.added, 4); // three new films on page 1 plus one on page 2
  assert.equal(r.marked, 1);
  assert.equal(userFilm(store, known.key).watchlist, true);
  const f = Object.values(store.films).find(x => x.slug === 'example-harbour');
  assert.equal(store.library.films[f.key].watchlist, true);
  assert.equal(store.library.films[f.key].watchlistAddedAt, '2026-11-08');
  assert.equal(store.library.films[f.key].watched, false);
});

test('it goes to page 2 only while every film is new, and stops at the first film already on the watchlist', async () => {
  const store = tmpStore();
  addWatchlisted(store, 'b2');
  const http = fakeHttp({ 1: grid('a1', 'a2'), 2: grid('b1', 'b2', 'b3'), 3: grid('c1') });
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(http.calls.plain.length, 2);
  assert.equal(r.pages, 2);
  assert.equal(r.added, 3); // a1, a2, b1; b3 is older than b2 so it is not read
  assert.ok(!Object.values(store.films).some(f => f.slug === 'b3'));
});

test('page 1 with a known film stops there (one request)', async () => {
  const store = tmpStore();
  addWatchlisted(store, 'a2');
  const http = fakeHttp({ 1: grid('a1', 'a2'), 2: grid('b1') });
  await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(http.calls.plain.length, 1);
  assert.equal(http.calls.window.length, 0);
});

test('it never reads more than 5 pages', async () => {
  const store = tmpStore();
  const http = fakeHttp(n => grid(`p${n}a`, `p${n}b`));
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(http.calls.plain.length, 5);
  assert.equal(r.added, 10);
});

test('a watched film is left alone', async () => {
  const store = tmpStore();
  const w = resolveFilm(store, { slug: 'a1', title: 'a1', year: 2000 });
  Object.assign(userFilm(store, w.key), { watched: true, rating: 4 });
  const http = fakeHttp({ 1: last('a1', 'a2') });
  await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.deepEqual({ ...userFilm(store, w.key) }, { watched: true, rating: 4, liked: false, watchlist: false, tags: [] });
  assert.equal(http.calls.plain.length, 1); // a watched film counts as "not all new": no page 2
});

test('a refused plain request falls back to the page window', async () => {
  const store = tmpStore();
  const http = fakeHttp({ 1: last('a1') }, { plainFails: true });
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(http.calls.window.length, 1);
  assert.equal(r.added, 1);
});

test('a block or an error leaves the library unchanged', async () => {
  const store = tmpStore();
  const before = JSON.stringify([store.films, store.library.films]);
  const blocked = fakeHttp({ 1: '<title>Just a moment...</title>' });
  assert.ok((await refreshWatchlist(store, blocked, 'ada', { now: NOW })).error);
  const broken = fakeHttp(() => new Error('offline'));
  assert.ok((await refreshWatchlist(store, broken, 'ada', { now: NOW })).error);
  // page 1 fine, page 2 fails: nothing from page 1 is kept either
  const half = fakeHttp(n => n === 1 ? grid('a1') : new Error('offline'));
  assert.ok((await refreshWatchlist(store, half, 'ada', { now: NOW })).error);
  assert.equal(JSON.stringify([store.films, store.library.films]), before);
});

test('the RSS refresh is independent of the watchlist step', async () => {
  const store = tmpStore();
  const http = { async text(url) { return { status: 200, url, text: '<rss version="2.0"><channel><title>x</title></channel></rss>' }; } };
  assert.deepEqual(await refreshFromRss(store, http, 'ada', { now: NOW }), { added: 0, updated: 0 });
});

// ---------- activity feed ----------
const ACT = fs.readFileSync(new URL('../fixtures/synthetic/activity-rows.html', import.meta.url), 'utf8');

test('the activity parser picks out watchlist additions only, newest first', () => {
  const r = parseActivity(ACT);
  assert.equal(r.ok, true);
  assert.equal(r.rows, 5);
  assert.deepEqual(r.items.map(i => [i.id, i.slug, i.title, i.year, i.at]), [
    ['9005', 'quiet-lighthouse', 'Quiet Lighthouse', 2023, '2026-11-07T09:00:00Z'],
    ['9003', 'old-tram-stories', 'Old Tram Stories', 1962, '2026-11-05T09:00:00Z'],
  ]);
  assert.equal(r.newest, '2026-11-07T09:00:00Z');
  assert.equal(r.oldest, '2026-11-01T09:00:00Z');
  assert.equal(parseActivity('<title>Just a moment...</title>').challenge, true);
});

test('the activity feed adds new watchlist films, remembers where it got to, and reads nothing else', async () => {
  const store = tmpStore();
  const http = fakeHttp({}, { activity: ACT });
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(r.via, 'activity');
  assert.equal(r.added, 2);
  assert.equal(http.calls.plain.length + http.calls.window.length, 0); // first time: page 1 of the feed is enough, no watchlist page
  assert.equal(store.library.sync.watchlistSeenAt, '2026-11-07T09:00:00Z');
  const f = Object.values(store.films).find(x => x.slug === 'quiet-lighthouse');
  assert.equal(store.library.films[f.key].watchlist, true);
  assert.equal(store.library.films[f.key].watchlistAddedAt, '2026-11-08');
  // the liked/rated rows were not turned into anything
  assert.equal(Object.values(store.films).length, 2);
});

test('a second look only applies rows from the last check onwards', async () => {
  const store = tmpStore();
  store.library.sync.watchlistSeenAt = '2026-11-06T00:00:00Z';
  const r = await refreshWatchlist(store, fakeHttp({}, { activity: ACT }), 'ada', { now: NOW });
  assert.equal(r.added, 1); // only Quiet Lighthouse is newer than the check
});

test('when the feed does not reach back to the last check, the watchlist page fills the gap', async () => {
  const store = tmpStore();
  store.library.sync.watchlistSeenAt = '2026-10-01T00:00:00Z';
  const http = fakeHttp({ 1: last('x1') }, { activity: ACT });
  const r = await refreshWatchlist(store, http, 'ada', { now: NOW });
  assert.equal(r.via, 'activity+watchlist');
  assert.equal(r.added, 3);
  assert.equal(http.calls.plain.length, 1);
});

test('an activity feed that can\'t be read falls back to the watchlist page; the check does not move', async () => {
  const store = tmpStore();
  const r = await refreshWatchlist(store, fakeHttp({ 1: last('a1') }), 'ada', { now: NOW });
  assert.equal(r.via, 'watchlist');
  assert.equal(r.added, 1);
  assert.equal(store.library.sync.watchlistSeenAt, undefined);
});
