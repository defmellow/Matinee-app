// Onboarding (23 Nov): restoring a Matinee backup, the friend code that turns Dendy Newtown on, Start over keeping how Matinee is
// set up, and the country (release dates in Upcoming, age ratings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCore } from '../../core/api.js';
import { mapMovie, mapRegionRelease } from '../../core/providers/tmdb.js';
import { upcoming } from '../../core/features/upcoming.js';
import { parseBackup } from '../../core/backup.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-onb-'));
const noFetch = async () => { throw Object.assign(new Error('offline in tests'), { code: 'offline' }); };
const MORNING = Date.parse('2026-10-28T20:30:00Z');

function mk(opts = {}) {
  const events = [];
  const hits = [];
  const fetch = opts.fetch || (async url => { hits.push(String(url)); return new Response('no', { status: 403 }); });
  const core = createCore({ dataDir: opts.dataDir || tmp(), providers: [], fetch, onEvent: (e, p) => events.push([e, p]), clock: { now: () => MORNING } });
  const add = (key, over = {}, user = {}) => {
    core.store.films[key] = { key, lid: key.replace(/^lid:/, ''), slug: null, title: 'Film ' + key, year: 2001, ids: { tmdb: 42 }, src: {}, checked: { tmdb: '2026-11-01T00:00:00Z' }, missed: {}, ...over };
    core.store.library.films[key] = { watched: true, rating: 8, liked: false, watchlist: false, tags: [], ...user };
    return core.store.films[key];
  };
  return { core, events, hits, add };
}
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };

// ---------- backups ----------

test('importBackup: restores films, diary, tags and settings from a backup, keeps this computer\'s keys, starts filling in', async () => {
  const a = mk();
  a.add('lid:aaa', { title: 'Black Swan', year: 2010, ids: { tmdb: 44214, imdb: 'tt0947798' } }, { tags: ['ballet'], note: 'watch again' });
  a.add('lid:bbb', { title: 'Sinners', year: 2025 }, { watched: false, watchlist: true, rating: null });
  a.core.store.library.entries['e:1'] = { id: 'e:1', key: 'lid:aaa', date: '2026-01-02', rating: 8, source: 'export' };
  a.core.store.library.tags.ballet = { createdAt: '2026-01-01' };
  a.core.store.library.settings.theme = 'neutral';
  a.core.store.library.settings.keys = { tmdb: 'secret-key' };
  const { json } = await a.core.call('exportBackup');
  assert.equal(json.includes('secret-key'), false, 'keys never go into a backup');
  const parsed = JSON.parse(json);
  assert.equal(parsed.films['lid:aaa'].title, 'Black Swan');
  assert.equal(parsed.films['lid:aaa'].ids.imdb, 'tt0947798');

  const b = mk();
  b.core.store.library.settings.keys = { omdb: 'here-key' };
  b.core.store.library.settings.keyStatus = { omdb: { state: 'ok' } };
  assert.equal((await b.core.call('getState')).ready, false);
  const r = await b.core.call('importBackup', { json });
  assert.equal(r.films, 2); assert.equal(r.watched, 1); assert.equal(r.watchlist, 1); assert.equal(r.entries, 1);
  const st = await b.core.call('getState');
  assert.equal(st.ready, true);
  assert.equal(st.settings.theme, 'neutral');
  assert.deepEqual(b.core.store.library.settings.keys, { omdb: 'here-key' }, 'the keys on this computer stay');
  assert.equal(b.core.store.library.settings.keyStatus.omdb.state, 'ok');
  assert.equal(b.core.store.films['lid:aaa'].title, 'Black Swan');
  assert.equal(b.core.store.films['lid:aaa'].lid, 'aaa');
  assert.deepEqual(b.core.store.library.films['lid:aaa'].tags, ['ballet']);
  assert.equal(b.core.store.library.films['lid:aaa'].note, 'watch again');
  assert.ok(b.events.some(([e]) => e === 'library'));
  await until(() => b.events.some(([e, p]) => e === 'progress' && p && p.phase === 'done')); // a filling-in run starts and ends, as after an import
  b.core.close(); a.core.close();
});

test('importBackup: an old backup without film cards rebuilds films from their keys', async () => {
  const b = mk();
  const json = JSON.stringify({ app: 'Matinee', version: 1, library: { schema: 2, films: { 'lid:x1': { watched: true, rating: 6, tags: [] }, 'slug:paris-texas': { watched: true, tags: [] }, 'ty:the thing|1982': { watchlist: true, tags: [] } }, entries: {}, settings: { theme: 'dark' } } });
  await b.core.call('importBackup', { json });
  assert.equal(b.core.store.films['lid:x1'].lid, 'x1');
  assert.equal(b.core.store.films['slug:paris-texas'].slug, 'paris-texas');
  assert.equal(b.core.store.films['slug:paris-texas'].title, 'Paris Texas');
  assert.equal(b.core.store.films['ty:the thing|1982'].year, 1982);
  b.core.close();
});

test('importBackup: friendly errors for files that are not backups, and nothing changes', async () => {
  const b = mk();
  b.add('lid:keep');
  const tries = ['', 'not json', JSON.stringify({ app: 'Other' }), JSON.stringify({ app: 'Matinee', version: 9, library: { films: { a: {} } } }), JSON.stringify({ app: 'Matinee', version: 1, library: { films: {} } }), JSON.stringify({ app: 'Matinee', version: 1, library: { schema: 1, films: { a: {} } } })];
  for (const json of tries) {
    await assert.rejects(b.core.call('importBackup', { json }), e => e.code === 'bad-request' && /backup|version/i.test(e.message));
  }
  await assert.rejects(b.core.call('importBackup', {}), e => e.code === 'bad-request');
  assert.ok(b.core.store.films['lid:keep'], 'the library is untouched');
  assert.throws(() => parseBackup('{"app":"Matinee","version":1}'), /isn't a Matinee backup/);
  b.core.close();
});

// ---------- friend code and Dendy ----------

test('friend code: 123 turns Dendy on, a wrong one changes nothing, an empty one turns it off', async () => {
  const { core } = mk();
  assert.equal((await core.call('getState')).settings.dendy, false, 'a new install starts without Dendy');
  assert.deepEqual(await core.call('setSettings', { friendCode: '132' }), { ok: false, message: 'Invalid code! :c' });
  assert.equal(core.store.library.settings.dendy, false);
  assert.equal(core.store.library.settings.friendCode, undefined);
  assert.deepEqual(await core.call('setSettings', { friendCode: '  123 ' }), { ok: true, dendy: true });
  let st = await core.call('getState');
  assert.equal(st.settings.dendy, true); assert.equal(st.settings.friendCode, '123');
  assert.deepEqual(await core.call('setSettings', { friendCode: 'nope' }), { ok: false, message: 'Invalid code! :c' });
  assert.equal(core.store.library.settings.dendy, true, 'a wrong code later does not take Dendy away');
  assert.deepEqual(await core.call('setSettings', { friendCode: '' }), { ok: true, dendy: false });
  st = await core.call('getState');
  assert.equal(st.settings.dendy, false); assert.equal(st.settings.friendCode, '');
  core.close();
});

test('Dendy migration: an install that already had a library keeps Dendy on; a new one starts off; a saved choice stays', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ schema: 2, films: { 'lid:a': { watched: true, tags: [] } }, entries: {}, settings: { keys: {}, region: 'AU' } }));
  const old = createCore({ dataDir: dir, providers: [], fetch: noFetch });
  assert.equal((await old.call('getState')).settings.dendy, true);
  old.close();
  const fresh = createCore({ dataDir: tmp(), providers: [], fetch: noFetch });
  assert.equal((await fresh.call('getState')).settings.dendy, false);
  fresh.close();
  const dir2 = tmp();
  fs.writeFileSync(path.join(dir2, 'library.json'), JSON.stringify({ schema: 2, films: { 'lid:a': { watched: true, tags: [] } }, entries: {}, settings: { keys: {}, region: 'AU', dendy: false } }));
  const off = createCore({ dataDir: dir2, providers: [], fetch: noFetch });
  assert.equal((await off.call('getState')).settings.dendy, false, 'removed once, it stays removed');
  off.close();
});

test('Dendy gating: without the code autoRefresh and refreshCinema never reach Dendy and getCinema is null; with it, they do', async () => {
  const { core, hits, add } = mk();
  add('lid:a');
  core.store.library.settings.dendy = false;
  await core.call('autoRefresh');
  const r = await core.call('refreshCinema', { force: true });
  assert.equal(r.ok, false); assert.equal(r.error, 'off');
  assert.equal(await core.call('getCinema'), null);
  await new Promise(res => setTimeout(res, 30));
  assert.equal(hits.filter(u => /dendy/.test(u)).length, 0, 'not one request to Dendy');
  await core.call('setSettings', { friendCode: '123' });
  await until(() => hits.some(u => /dendy/.test(u)));
  core.close();
});

// ---------- Start over ----------

test('Start over keeps look, country, username, friend code and keys; everything else goes', async () => {
  const { core, add } = mk();
  add('lid:a', {}, { tags: ['mine'], note: 'x' });
  core.store.library.entries['e:1'] = { id: 'e:1', key: 'lid:a', date: '2026-01-02' };
  core.store.library.views.v = { id: 'v', name: 'Saved', query: {} };
  core.store.library.user = { username: 'film_fan', name: 'Sam', bio: 'hi', favourites: ['lid:a'] };
  Object.assign(core.store.library.settings, { theme: 'neutral-light', motion: 'less', feelColours: 'off', region: 'GB', regionChosen: true, friendCode: '123', dendy: true, keys: { tmdb: 'k1', omdb: 'k2' }, keyStatus: { tmdb: { state: 'ok' } }, debug: true });
  await core.call('resetAll');
  const s = core.store.library.settings;
  assert.equal(Object.keys(core.store.films).length, 0);
  assert.deepEqual(core.store.library.films, {});
  assert.deepEqual(core.store.library.entries, {});
  assert.deepEqual(core.store.library.views, {});
  assert.deepEqual(core.store.library.user, { username: 'film_fan' }, 'only the username stays of the profile');
  assert.equal(s.theme, 'neutral-light'); assert.equal(s.motion, 'less'); assert.equal(s.feelColours, 'off');
  assert.equal(s.region, 'GB'); assert.equal(s.regionChosen, true);
  assert.equal(s.friendCode, '123'); assert.equal(s.dendy, true);
  assert.deepEqual(s.keys, { tmdb: 'k1', omdb: 'k2' }); assert.equal(s.keyStatus.tmdb.state, 'ok');
  assert.equal(s.debug, undefined, 'Debug mode is not part of it');
  const st = await core.call('getState');
  assert.equal(st.ready, false);
  assert.equal(st.settings.theme, 'neutral-light');
  core.close();
});

// ---------- country ----------

test('country: age rating follows the chosen country, then the US', () => {
  const rd = (certification, type, date = '2019-01-01T00:00:00.000Z') => ({ certification, type, release_date: date });
  const results = [{ iso_3166_1: 'US', release_dates: [rd('R', 3)] }, { iso_3166_1: 'AU', release_dates: [rd('MA15+', 3)] }, { iso_3166_1: 'GB', release_dates: [rd('15', 3)] }];
  const cert = region => mapMovie({ id: 1, release_dates: { results } }, { region }).data.certification;
  assert.equal(cert('AU'), 'MA15+');
  assert.equal(cert('GB'), '15');
  assert.equal(cert('gb'), '15');
  assert.equal(cert('NZ'), 'R', 'no rating for the country: the US one');
  assert.equal(cert('US'), 'R');
});

test('country: TMDB cinema date for the country, theatrical before limited, earliest first', () => {
  const results = [{ iso_3166_1: 'GB', release_dates: [{ type: 2, release_date: '2026-12-01T00:00:00.000Z' }, { type: 3, release_date: '2027-01-09T00:00:00.000Z' }, { type: 3, release_date: '2027-01-05T00:00:00.000Z' }, { type: 4, release_date: '2026-11-01T00:00:00.000Z' }] }];
  assert.deepEqual(mapRegionRelease({ results }, 'GB'), { date: '2027-01-05', type: 'Theatrical', region: 'GB' });
  assert.equal(mapRegionRelease({ results }, 'FR'), null);
  assert.deepEqual(mapRegionRelease({ results: [{ iso_3166_1: 'GB', release_dates: [{ type: 2, release_date: '2026-12-01T00:00:00.000Z' }] }] }, 'GB'), { date: '2026-12-01', type: 'Theatrical (limited)', region: 'GB' });
  assert.deepEqual(mapMovie({ id: 1, release_dates: { results } }, { region: 'GB' }).data.regionRelease, { date: '2027-01-05', type: 'Theatrical', region: 'GB' });
});

test('country: Upcoming reads the Letterboxd date in Australia, TMDB\'s date for the chosen country elsewhere', () => {
  const s = (key, over) => ({ key, title: key, user: { watched: false, watchlist: true }, ...over });
  const summaries = [
    s('aus-only', { ausRelease: { date: '2026-12-01', type: 'Theatrical' } }),
    s('gb-tmdb', { regionRelease: { date: '2026-12-02', type: 'Theatrical', region: 'GB' } }),
    s('au-tmdb', { regionRelease: { date: '2026-12-03', type: 'Theatrical', region: 'AU' } }),
  ];
  const keys = region => upcoming({ summaries, today: '2026-11-23', region }).groups.flatMap(g => g.items.map(i => i.film.key));
  assert.deepEqual(keys('AU'), ['aus-only', 'au-tmdb']);
  assert.deepEqual(keys('GB'), ['gb-tmdb']);
  assert.deepEqual(keys('NZ'), []);
  assert.deepEqual(upcoming({ summaries, today: '2026-11-23' }).groups.flatMap(g => g.items.map(i => i.film.key)), ['aus-only', 'au-tmdb'], 'Australia when no country is given');
});

test('country: changing it asks TMDB again for every film (nothing blanked); the system guess never beats their own choice', async () => {
  const { core, add } = mk();
  const f = add('lid:a', { src: { tmdb: { certification: 'M', title: 'A' } } });
  await core.call('setSettings', { region: 'gb', regionFromSystem: true });
  assert.equal(core.store.library.settings.region, 'GB');
  assert.equal(core.store.library.settings.regionChosen, undefined);
  assert.equal(f.checked.tmdb, undefined, 'TMDB reads the film again');
  assert.equal(f.src.tmdb.certification, 'M', 'what is showing stays until then');
  await core.call('setSettings', { region: 'NZ' });
  assert.equal(core.store.library.settings.regionChosen, true);
  f.checked.tmdb = '2026-11-20T00:00:00Z';
  await core.call('setSettings', { region: 'US', regionFromSystem: true });
  assert.equal(core.store.library.settings.region, 'NZ', 'an explicit choice stays');
  assert.equal(f.checked.tmdb, '2026-11-20T00:00:00Z');
  await core.call('setSettings', { region: 'NZ' });
  assert.equal(f.checked.tmdb, '2026-11-20T00:00:00Z', 'the same country again changes nothing');
  await assert.rejects(core.call('setSettings', { region: 'Australia' }), e => e.code === 'bad-request');
  core.close();
});
