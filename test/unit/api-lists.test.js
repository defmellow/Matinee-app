// Lists through core/api.js: imported lists are read-only, your own lists can be made, changed, copied and deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';

const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const exportZip = () => zipSync({
  'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'testuser', 'Tess', '', '', '', '', '', '', '']])),
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa'], ['2024-02-02', 'Beta Film', '2005', 'https://boxd.it/bbb']])),
  'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
  'lists/favs.csv': strToU8('Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2024-01-01,Favs,,https://boxd.it/zzz,Imported list\n\nPosition,Name,Year,URL,Description\n1,Alpha Film,1999,https://boxd.it/aaa,\n2,Beta Film,2005,https://boxd.it/bbb,\n'),
});
const fake404 = async () => new Response('not found', { status: 404 });

test('own lists: create, add, remove, reorder, copy, delete; imported lists are read-only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-lists-'));
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
  try {
    await core.call('importExport', { bytes: exportZip() });
    const films = (await core.call('getLibrary')).films;
    const key = t => films.find(f => f.title === t).key;

    let lists = await core.call('getLists');
    const imported = lists.find(l => l.source === 'export');
    assert.ok(imported, 'imported list is listed');
    assert.equal(imported.count, 2);
    await assert.rejects(core.call('saveList', { id: imported.id, name: 'x' }), { code: 'read-only' });
    await assert.rejects(core.call('setInList', { id: imported.id, key: key('Gamma Film'), on: true }), { code: 'read-only' });
    await assert.rejects(core.call('deleteList', { id: imported.id }), { code: 'read-only' });

    const made = await core.call('saveList', { name: '  Rainy day  ', films: [key('Beta Film'), key('Alpha Film'), 'nope', key('Beta Film')] });
    assert.equal(made.name, 'Rainy day');
    assert.equal(made.count, 2, 'unknown keys and duplicates dropped');
    let one = await core.call('getList', { id: made.id });
    assert.deepEqual(one.films.map(f => f.title), ['Beta Film', 'Alpha Film'], 'order kept');
    assert.equal(one.editable, true);

    await core.call('setInList', { id: made.id, key: key('Gamma Film'), on: true });
    await core.call('setInList', { id: made.id, key: key('Gamma Film'), on: true });
    await core.call('setInList', { id: made.id, key: key('Beta Film'), on: false });
    one = await core.call('getList', { id: made.id });
    assert.deepEqual(one.films.map(f => f.title), ['Alpha Film', 'Gamma Film']);

    await core.call('saveList', { id: made.id, name: 'Rainy days', description: 'Cosy ones', films: one.films.map(f => f.key).reverse() });
    one = await core.call('getList', { id: made.id });
    assert.equal(one.name, 'Rainy days');
    assert.equal(one.description, 'Cosy ones');
    assert.deepEqual(one.films.map(f => f.title), ['Gamma Film', 'Alpha Film']);

    const copy = await core.call('copyList', { id: imported.id });
    assert.equal(copy.count, 2);
    assert.equal((await core.call('getList', { id: copy.id })).editable, true);

    lists = await core.call('getLists');
    assert.equal(lists[0].source, 'matinee', 'own lists come first');
    assert.equal(lists.filter(l => l.source === 'matinee').length, 2);

    assert.deepEqual(await core.call('deleteList', { id: made.id }), { ok: true });
    await assert.rejects(core.call('getList', { id: made.id }), { code: 'not-found' });

    // Own lists survive a re-import; imported ones are rebuilt.
    await core.call('importExport', { bytes: exportZip() });
    lists = await core.call('getLists');
    assert.equal(lists.filter(l => l.source === 'matinee').length, 1);
    assert.equal(lists.filter(l => l.source === 'export').length, 1);
  } finally { core.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tagFilms: bulk tags on watchlist films only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-tagfilms-'));
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
  try {
    await core.call('importExport', { bytes: exportZip() });
    const films = (await core.call('getLibrary')).films;
    const gamma = films.find(f => f.title === 'Gamma Film').key, alpha = films.find(f => f.title === 'Alpha Film').key;
    assert.deepEqual(await core.call('tagFilms', { keys: [gamma, alpha], add: ['rainy day', ' rainy day '] }), { changed: 1, skipped: 1 });
    let lib = await core.call('getLibrary');
    assert.deepEqual(lib.films.find(f => f.key === gamma).user.tags, ['rainy day']);
    assert.ok(!lib.films.find(f => f.key === alpha).user.tags.includes('rainy day'));
    assert.deepEqual(await core.call('tagFilms', { keys: [gamma], remove: ['rainy day'] }), { changed: 1, skipped: 0 });
    lib = await core.call('getLibrary');
    assert.deepEqual(lib.films.find(f => f.key === gamma).user.tags, []);
  } finally { core.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('addToList: adds several films to your own list, skips duplicates, refuses imported lists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-addtolist-'));
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
  try {
    await core.call('importExport', { bytes: exportZip() });
    const films = (await core.call('getLibrary')).films;
    const k = t => films.find(f => f.title === t).key;
    const mine = await core.call('saveList', { name: 'Mine', films: [k('Alpha Film')] });
    assert.deepEqual(await core.call('addToList', { id: mine.id, keys: [k('Alpha Film'), k('Gamma Film'), 'lid:nope'] }), { added: 1, count: 2 });
    const imported = (await core.call('getLists')).find(l => l.source === 'export');
    await assert.rejects(core.call('addToList', { id: imported.id, keys: [k('Gamma Film')] }), { code: 'read-only' });
  } finally { core.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
