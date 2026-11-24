// End-to-end through core/api.js: import a synthetic export, then call every method the UI uses.
// The network is faked (every request 404s), so providers find nothing — this checks the plumbing, not the data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createCore } from '../../core/api.js';

const csv = rows => rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';

function syntheticExport() {
  return zipSync({
    'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'testuser', 'Tess', '', '', '', '', '', '', 'https://boxd.it/aaa']])),
    'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa'], ['2024-02-02', 'Beta Film', '2005', 'https://boxd.it/bbb']])),
    'ratings.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa', '4.5']])),
    'watchlist.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-03-01', 'Gamma Film', '2010', 'https://boxd.it/ccc']])),
    'diary.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/1aaaaB', '4.5', '', 'cosy', '2024-02-01'], ['2024-02-03', 'Beta Film', '2005', 'https://boxd.it/1bbbbB', '3', 'Yes', '', '2024-02-02']])),
    'reviews.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Review', 'Tags', 'Watched Date'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/1aaaaB', '4.5', '', 'Loved it, truly.', '', '2024-02-01']])),
  });
}

const fake404 = async url => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });

test('import and every UI method work end to end without network data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-api-'));
  const events = [];
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: (e, p) => events.push([e, p]) });
  try {
    let s = await core.call('getState');
    assert.equal(s.ready, false);

    const summary = await core.call('importExport', { bytes: syntheticExport() });
    assert.ok(summary.entries >= 2, 'diary entries imported');

    s = await core.call('getState');
    assert.equal(s.ready, true);
    assert.equal(s.user.username, 'testuser');
    assert.equal(s.counts.watchlist, 1);

    const lib = await core.call('getLibrary');
    assert.equal(lib.films.length, 3);
    const alpha = lib.films.find(f => f.title === 'Alpha Film');
    assert.equal(alpha.user.rating, 9);
    assert.ok(alpha.user.tags.includes('cosy'));

    const film = await core.call('getFilm', { key: alpha.key });
    assert.equal(film.entries.length, 1);
    assert.equal(film.entries[0].review, 'Loved it, truly.');
    assert.ok(Array.isArray(film.related));
    assert.ok(film.links.letterboxd);

    const diary = await core.call('getDiary');
    assert.equal(diary.entries.length, 2);
    assert.ok(diary.entries[0].date >= diary.entries[1].date, 'newest first');

    const ins = await core.call('getInsights');
    assert.equal(ins.totals.films, 2);

    const map = await core.call('getMap');
    assert.ok(Array.isArray(map.nodes) && Array.isArray(map.links) && Array.isArray(map.loose) && map.total === map.nodes.length);
    assert.equal(map.lens, 'feel');
    assert.ok(map.feel && typeof map.feel === 'object' && map.labels && typeof map.labels === 'object', 'what each film has, for lighting up a feeling');
    for (const list of Object.values(map.feel)) for (const [id, score] of list) { assert.equal(typeof id, 'string'); assert.ok(score >= 0.15 && score <= 1.5); assert.ok(Array.isArray(map.labels[id]) && map.labels[id].length === 2); }
    for (const lens of ['feel', 'about']) { const m = await core.call('getMap', { lens }); assert.equal(m.lens, lens); assert.equal(m.nodes.length, map.nodes.length); assert.deepEqual(m.nodes.map(n => n.key), map.nodes.map(n => n.key), 'every lens lists the films in the same order'); }
    await assert.rejects(core.call('getMap', { lens: 'sideways' }), { code: 'bad-request' });

    const tonight = await core.call('getTonight', {});
    assert.equal(tonight.poolSize, 1);

    // Tags and notes are only editable on watchlist films (Letterboxd can't tag those); watched films are read-only.
    const gamma = lib.films.find(f => f.title === 'Gamma Film');
    await assert.rejects(core.call('setUserFilm', { key: alpha.key, tags: ['nope'] }), { code: 'read-only' });
    await core.call('setUserFilm', { key: gamma.key, tags: ['cosy', 'with mum'], note: 'Mum recommended it' });
    assert.ok((await core.call('getLibrary')).tags.some(t => t.name === 'with mum'));
    await core.call('renameTag', { from: 'with mum', to: 'family night' });
    const g = (await core.call('getLibrary')).films.find(f => f.key === gamma.key);
    assert.ok(g.user.tags.includes('family night'));
    assert.equal(g.user.note, 'Mum recommended it');
    // 'cosy' came from Letterboxd's diary: it can't be renamed or deleted here.
    await assert.rejects(core.call('renameTag', { from: 'cosy', to: 'warm' }), { code: 'read-only' });
    await assert.rejects(core.call('deleteTag', { name: 'cosy' }), { code: 'read-only' });

    const v = await core.call('saveView', { name: 'Comfort', query: { tags: ['cosy'] } });
    assert.ok((await core.call('getLibrary')).views.some(x => x.id === v.id));

    const backup = await core.call('exportBackup');
    assert.match(backup.filename, /^matinee-backup-/);
    assert.ok(JSON.parse(backup.json).library.films);

    await assert.rejects(core.call('getFilm', { key: 'lid:nope' }), /no longer in your library/);
    await assert.rejects(core.call('noSuchMethod'), /Unknown method/);
  } finally {
    await core.call('cancel');
    core.close();
  }
});
