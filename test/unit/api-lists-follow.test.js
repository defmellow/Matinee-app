// Followed and own lists through core/api.js: follow by link, "listed" on films, export CSV, link after export, Tonight's list pool.
// Pages are SYNTHETIC; the cloud cannot reach Letterboxd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';

const LIST = 'https://letterboxd.com/ada/list/comfort/';
const card = s => `<li class="griditem"><div class="react-component" data-item-name="${s} (2000)" data-item-slug="${s}"></div></li>`;
const page = slugs => `<html><body><h1>Comfort</h1><ul class="poster-list -grid">${slugs.map(card).join('')}</ul></body></html>`;
let served = page(['alpha', 'beta']);
const fakeFetch = async (url) => {
  if (String(url).startsWith(LIST)) { const r = new Response(served, { status: 200, headers: { 'content-type': 'text/html' } }); return r; }
  return new Response('not found', { status: 404 });
};

test('follow, list flags, export, link, unlink and unfollow through the API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-lists-api-'));
  const core = createCore({ dataDir: dir, fetch: fakeFetch, onEvent: () => {} });
  try {
    const r = await core.call('followList', { url: LIST });
    assert.equal(r.count, 2);
    const lists = await core.call('getLists');
    assert.equal(lists.length, 1);
    assert.deepEqual([lists[0].source, lists[0].owner, lists[0].status, lists[0].count], ['letterboxd', 'ada', 'ok', 2]);
    const lib = await core.call('getLibrary');
    assert.equal(lib.films.length, 2);
    assert.ok(lib.films.every(f => f.user.listed && !f.user.watchlist && !f.user.watched));
    await assert.rejects(core.call('setInList', { id: lists[0].id, key: lib.films[0].key, on: false }), { code: 'read-only', message: /follows Letterboxd/ });
    await assert.rejects(core.call('deleteList', { id: lists[0].id }), { code: 'read-only' });

    // an own list: add films, a note, export
    const mine = await core.call('saveList', { name: 'Rainy: "best"', films: lib.films.map(f => f.key) });
    await core.call('setListNote', { id: mine.id, key: lib.films[0].key, text: 'Lovely, really' });
    const ex = await core.call('exportList', { id: mine.id });
    assert.equal(ex.filename, 'Rainy best.csv');
    assert.equal(ex.count, 2);
    const lines = ex.csv.trim().split('\r\n');
    assert.equal(lines[0], 'LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Review');
    assert.ok(lines.some(l => l.includes('https://letterboxd.com/film/') && l.includes('"Lovely, really"')));
    const one = await core.call('getList', { id: mine.id });
    assert.equal(one.editable, true);
    assert.equal(Object.values(one.notes)[0], 'Lovely, really');
    assert.deepEqual((await core.call('getFilm', { key: lib.films[0].key })).lists.map(l => l.source).sort(), ['letterboxd', 'matinee']);

    // the exported list is imported on Letterboxd; pasting its link makes this list follow it
    served = page(['alpha']);
    await assert.rejects(core.call('linkList', { id: mine.id, url: LIST }), { code: 'already' });
    await core.call('unfollowList', { id: lists[0].id });
    assert.equal((await core.call('getLists')).length, 1);
    const linked = await core.call('linkList', { id: mine.id, url: LIST });
    assert.equal(linked.missing, 1);
    const after = await core.call('getList', { id: mine.id });
    assert.equal(after.source, 'letterboxd'); assert.equal(after.editable, false); assert.equal(after.history[0].removed.length, 1);
    await core.call('unlinkList', { id: mine.id });
    assert.equal((await core.call('getList', { id: mine.id })).editable, true);
    // all of this left the films in the library
    assert.equal((await core.call('getLibrary')).films.length, 2);
  } finally { core.close?.(); }
});

test('Tonight draws on lists by default only when the watchlist is thin, and an explicit choice wins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-lists-tonight-'));
  served = page(['alpha', 'beta']);
  const core = createCore({ dataDir: dir, fetch: fakeFetch, onEvent: () => {} });
  try {
    await core.call('followList', { url: LIST });
    const on = await core.call('getPicks', {});
    assert.equal(on.listsPool.on, true); assert.equal(on.listsPool.extra, 2);
    assert.equal(on.lists, true);
    const off = await core.call('getPicks', { dials: { includeLists: false } });
    assert.equal(off.listsPool.on, false); assert.equal(off.listsPool.chosen, true);
    assert.equal(off.empty?.why, 'watchlist');
  } finally { core.close?.(); }
});
