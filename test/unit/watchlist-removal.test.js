// Taking films off the watchlist: automatically from the activity feed, by hand, and the monthly re-import reminder.
// All feed markup here is SYNTHETIC (invented member "ada" and films).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { resolveFilm, userFilm, removeFromWatchlist, restoreToWatchlist, resetWatchlistTracking, reimportReminder } from '../../core/library.js';
import { refreshWatchlist } from '../../core/sources/watchlist.js';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';

const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-wlr-')), { debounce: 5 });
const NOW = '2026-11-08T01:00:00.000Z';
const row = (id, at, text) => `<section class="activity-row" data-activity-id="${id}"><div class="activity-summary"><a class="name" href="/ada/">Ada</a> ${text} <small><time datetime="${at}">x</time></small></div></section>`;
const added = (id, at, slug, title = slug) => row(id, at, `added <a href="/film/${slug}/">${title} (2000)</a> to their <a href="/ada/watchlist/">watchlist</a>`);
const other = (id, at) => row(id, at, 'liked <a href="/film/zzz/">Zzz (2000)</a>');
const feed = (...rows) => rows.join('\n');
const http = html => ({
  async browserText(url) { return /activity/.test(url) ? { status: 200, url, text: html } : { status: 404, text: '' }; },
  async page(url) { return { status: /activity/.test(url) ? 200 : 404, url, text: /activity/.test(url) ? html : '' }; },
});
const reports = () => { const list = []; return { list, report: e => { list.push(e); return e; } }; };
const find = (store, slug) => Object.values(store.films).find(f => f.slug === slug);
const user = (store, slug) => store.library.films[find(store, slug).key];

/** A library where `slug` came onto the watchlist from the feed row `id` at `at`. */
async function withActivityFilm(slug = 'a1', id = '100', at = '2026-11-02T09:00:00Z') {
  const store = tmpStore();
  await refreshWatchlist(store, http(feed(added(id, at, slug), other('1', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  return store;
}

test('a film added from the activity feed remembers its row', async () => {
  const store = await withActivityFilm();
  const u = user(store, 'a1');
  assert.equal(u.watchlist, true);
  assert.equal(u.watchlistVia, 'activity');
  assert.equal(u.watchlistActivityId, '100');
  assert.equal(u.watchlistActivityAt, '2026-11-02T09:00:00Z');
});

test('removed when a later read reaches back past the row and the row is gone', async () => {
  const store = await withActivityFilm();
  const f = find(store, 'a1');
  userFilm(store, f.key).tags = ['with mum']; userFilm(store, f.key).note = 'keep'; userFilm(store, f.key).mine = ['with mum'];
  const log = [];
  const r = await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW, log: e => log.push(e) });
  const u = user(store, 'a1');
  assert.equal(r.removed, 1);
  assert.equal(u.watchlist, false);
  assert.equal(u.watchlistRemovedVia, 'activity');
  assert.equal(u.watchlistRemovedAt, NOW);
  assert.deepEqual(u.tags, ['with mum']); assert.equal(u.note, 'keep'); assert.deepEqual(u.mine, ['with mum']);
  assert.equal(log.length, 1);
  assert.match(log[0].text, /Taken off your watchlist/);
});

test('not removed when the row is still in the feed', async () => {
  const store = await withActivityFilm();
  const r = await refreshWatchlist(store, http(feed(added('100', '2026-11-02T09:00:00Z', 'a1'), other('2', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(r.removed, undefined);
  assert.equal(user(store, 'a1').watchlist, true);
});

test('not removed when the feed does not reach back to the row', async () => {
  const store = await withActivityFilm();
  const r = await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-05T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(r.removed, undefined);
  assert.equal(user(store, 'a1').watchlist, true);
});

test('a feed that ends in the very same second does not count as reaching back', async () => {
  const store = await withActivityFilm();
  await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-02T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(user(store, 'a1').watchlist, true);
});

test('not removed when the film is watched', async () => {
  const store = await withActivityFilm();
  user(store, 'a1').watched = true;
  await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(user(store, 'a1').watchlist, true);
});

test('films from the export or the watchlist page are never removed automatically', async () => {
  const store = tmpStore();
  const f = resolveFilm(store, { slug: 'e1', title: 'E1', year: 2000 });
  Object.assign(userFilm(store, f.key), { watchlist: true, watchlistVia: 'export' });
  await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(userFilm(store, f.key).watchlist, true);
});

test('more than 5 removals in one read: none are made and a warning is reported', async () => {
  const store = tmpStore();
  const slugs = ['a', 'b', 'c', 'd', 'e', 'f'];
  await refreshWatchlist(store, http(feed(...slugs.map((s, i) => added(String(100 + i), `2026-11-0${2 + (i % 3)}T09:00:00Z`, s)), other('1', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  assert.ok(slugs.every(s => user(store, s).watchlist));
  const p = reports();
  const r = await refreshWatchlist(store, http(feed(other('9', '2026-11-07T09:00:00Z'), other('2', '2026-10-30T09:00:00Z'))), 'ada', { now: NOW, problems: p });
  assert.equal(r.heldOff, 6);
  assert.equal(r.removed, undefined);
  assert.ok(slugs.every(s => user(store, s).watchlist));
  const w = p.list.find(x => x.level === 'warning');
  assert.match(w.message, /held off removing 6 films from your watchlist because the activity page looked unusual/);
});

test('exactly 5 removals go ahead', async () => {
  const store = tmpStore();
  const slugs = ['a', 'b', 'c', 'd', 'e'];
  await refreshWatchlist(store, http(feed(...slugs.map((s, i) => added(String(100 + i), '2026-11-03T09:00:00Z', s)), other('1', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  const r = await refreshWatchlist(store, http(feed(other('9', '2026-11-07T09:00:00Z'), other('2', '2026-10-30T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(r.removed, 5);
});

test('removed then put back on Letterboxd later: a newer row puts it back', async () => {
  const store = await withActivityFilm();
  await refreshWatchlist(store, http(feed(other('3', '2026-11-07T09:00:00Z'), other('2', '2026-11-01T09:00:00Z'))), 'ada', { now: NOW });
  assert.equal(user(store, 'a1').watchlist, false);
  await refreshWatchlist(store, http(feed(added('200', '2026-11-09T09:00:00Z', 'a1'), other('3', '2026-11-07T09:00:00Z'))), 'ada', { now: '2026-11-09T10:00:00Z' });
  const u = user(store, 'a1');
  assert.equal(u.watchlist, true);
  assert.equal(u.watchlistActivityId, '200');
  assert.equal(u.watchlistRemovedAt, undefined);
});

test('manual remove keeps tags and notes; an older row does not put it back; a newer one does; undo restores', async () => {
  const store = await withActivityFilm();
  const f = find(store, 'a1');
  userFilm(store, f.key).tags = ['cinema only'];
  assert.equal(removeFromWatchlist(store, f.key, { via: 'manual', now: '2026-11-08T02:00:00Z' }), true);
  assert.equal(removeFromWatchlist(store, f.key), false, 'already off');
  let u = userFilm(store, f.key);
  assert.equal(u.watchlist, false);
  assert.equal(u.watchlistRemovedVia, 'manual');
  assert.deepEqual(u.tags, ['cinema only']);
  // The row from before the removal is read again: stays off.
  await refreshWatchlist(store, http(feed(added('100', '2026-11-02T09:00:00Z', 'a1'), other('1', '2026-11-01T09:00:00Z'))), 'ada', { now: '2026-11-08T03:00:00Z' });
  assert.equal(userFilm(store, f.key).watchlist, false);
  // A row after the removal: back on.
  await refreshWatchlist(store, http(feed(added('300', '2026-11-08T05:00:00Z', 'a1'), other('1', '2026-11-01T09:00:00Z'))), 'ada', { now: '2026-11-08T06:00:00Z' });
  u = userFilm(store, f.key);
  assert.equal(u.watchlist, true);
  assert.equal(u.watchlistRemovedAt, undefined);
  // Undo
  removeFromWatchlist(store, f.key, { now: '2026-11-08T07:00:00Z' });
  assert.equal(restoreToWatchlist(store, f.key), true);
  assert.equal(userFilm(store, f.key).watchlist, true);
  assert.equal(restoreToWatchlist(store, f.key), false, 'nothing to undo');
});

test('the watchlist page (no dates) never puts back a film the user removed by hand', async () => {
  const store = tmpStore();
  const f = resolveFilm(store, { slug: 'p1', title: 'P1', year: 2000 });
  Object.assign(userFilm(store, f.key), { watchlist: true, watchlistVia: 'export' });
  removeFromWatchlist(store, f.key, { now: NOW });
  const page = '<ul class="poster-list"><li class="griditem"><div class="react-component" data-item-name="P1 (2000)" data-item-slug="p1"></div></li></ul>';
  const h = { async browserText(url) { return /activity/.test(url) ? { status: 404, text: '' } : { status: 200, text: page }; }, async page() { return { status: 404, text: '' }; } };
  await refreshWatchlist(store, h, 'ada', { now: NOW });
  assert.equal(userFilm(store, f.key).watchlist, false);
});

test('an import is the truth: it resets tracking for films on the watchlist', () => {
  const store = tmpStore();
  const f = resolveFilm(store, { slug: 'i1', title: 'I1', year: 2000 });
  Object.assign(userFilm(store, f.key), { watchlist: true, watchlistVia: 'activity', watchlistActivityId: '5', watchlistActivityAt: NOW, watchlistRemovedAt: NOW, watchlistRemovedVia: 'manual' });
  resetWatchlistTracking(store);
  const u = userFilm(store, f.key);
  assert.equal(u.watchlistVia, 'export');
  assert.equal(u.watchlistActivityId, undefined);
  assert.equal(u.watchlistRemovedAt, undefined);
});

// ---------- the reminder ----------
const lib = (lastImport, extra = {}) => ({ user: { username: 'ada' }, sync: { lastImport }, settings: { ...extra } });
const days = (now, n) => new Date(now - n * 86400000).toISOString();

test('reminder: due after more than 30 days, not before, not without a user or an import', () => {
  const now = Date.parse(NOW);
  assert.equal(reimportReminder(lib(days(now, 29)), now).due, false);
  assert.equal(reimportReminder(lib(days(now, 30)), now).due, false);
  assert.equal(reimportReminder(lib(days(now, 31)), now).due, true);
  assert.equal(reimportReminder({ ...lib(days(now, 90)), user: null }, now).due, false);
  assert.equal(reimportReminder(lib(null), now).due, false);
});

test('reminder: snooze, off, and an expired snooze', () => {
  const now = Date.parse(NOW);
  const old = days(now, 60);
  assert.equal(reimportReminder(lib(old, { reimportReminder: { snoozeUntil: new Date(now + 86400000).toISOString() } }), now).due, false);
  assert.equal(reimportReminder(lib(old, { reimportReminder: { snoozeUntil: new Date(now - 1000).toISOString() } }), now).due, true);
  assert.equal(reimportReminder(lib(old, { reimportReminder: { off: true } }), now).due, false);
});

test('through the API: reminder snooze/off, import restarts the clock, manual remove and undo, debug fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-wlr-api-'));
  const clock = { now: () => Date.parse(NOW) };
  const core = createCore({ dataDir: dir, fetch: async () => new Response('no', { status: 404 }), onEvent: () => {}, clock });
  const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
  const zip = zipSync({
    'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'testuser', 'Tess', '', '', '', '', '', '', '']])),
    'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa']])),
    'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
  });
  try {
    let r = await core.call('setReimportReminder', { snooze: true });
    assert.equal(r.snoozeUntil, new Date(Date.parse(NOW) + 90 * 86400000).toISOString());
    r = await core.call('setReimportReminder', { off: true });
    assert.equal(r.off, true);
    r = await core.call('setReimportReminder', { off: false });
    assert.equal(r.off, false);
    assert.equal(r.snoozeUntil, null);
    await core.call('setReimportReminder', { snooze: true });
    await core.call('importExport', { bytes: zip });
    const s = await core.call('getState');
    assert.equal(s.settings.reimportReminder.snoozeUntil, null, 'an import clears the snooze');
    assert.equal(s.settings.reimportReminder.due, false);
    assert.equal(s.settings.reimportReminder.days, 0);

    const lib = await core.call('getLibrary');
    const gamma = lib.films.find(f => f.title === 'Gamma Film');
    await core.call('setUserFilm', { key: gamma.key, tags: ['with mum'] });
    await core.call('removeFromWatchlist', { key: gamma.key });
    await assert.rejects(() => core.call('removeFromWatchlist', { key: gamma.key }), /isn't on your watchlist/);
    let dbg = await core.call('getFilmDebug', { key: gamma.key });
    assert.equal(dbg.watchlist.on, false);
    assert.equal(dbg.watchlist.removedVia, 'manual');
    assert.equal(dbg.watchlist.via, 'export');
    assert.equal((await core.call('getFilm', { key: gamma.key })).user.tags[0], 'with mum');
    await core.call('restoreToWatchlist', { key: gamma.key });
    dbg = await core.call('getFilmDebug', { key: gamma.key });
    assert.equal(dbg.watchlist.on, true);
    // A re-import re-adds what the export says, even after a removal.
    await core.call('removeFromWatchlist', { key: gamma.key });
    await core.call('importExport', { bytes: zip });
    assert.equal((await core.call('getFilmDebug', { key: gamma.key })).watchlist.on, true);
    await assert.rejects(() => core.call('removeFromWatchlist', { key: 'nope' }), /couldn't find that film/);
  } finally { await core.close?.(); }
});
