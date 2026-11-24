// Lists: addresses, the list page parser, following and refreshing (diff, history, gone, renamed), linking after export, CSV, the library filter.
// Pages are SYNTHETIC (shaped like the watchlist fixtures): real Letterboxd list markup has not been checked from the cloud.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { createProblems } from '../../core/problems.js';
import { resolveFilm, userFilm } from '../../core/library.js';
import { parseListPage } from '../../core/parse/list-page.js';
import { applyQuery } from '../../core/analysis/query.js';
import {
  parseListInput, readList, diffKeys, followList, refreshList, refreshDueLists, linkList, unlinkList, unfollowList, listedKeys, listCsv, csvFilename, MAX_PAGES, STALE_MS,
} from '../../core/features/lists.js';

const tmpStore = () => createStore(fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-lists-')), { debounce: 5 });
const T0 = Date.parse('2026-11-02T01:00:00Z');
const DAY = 24 * 3600 * 1000;
const LIST = 'https://letterboxd.com/ada/list/comfort/';

const card = (slug, note) => `<li class="griditem"><div class="react-component" data-item-name="${slug.replace(/-/g, ' ')} (2000)" data-item-slug="${slug}"></div>${note ? `<div class="body-text">${note}</div>` : ''}</li>`;
const page = (slugs, { next = false, name = 'Comfort Movies', desc = 'Films for rainy days.', notes = {} } = {}) =>
  `<html><head><title>${name} • A list by ada</title></head><body><h1 class="title-1">${name}</h1><div class="attribution"><span class="displayname">Ada L</span></div>` +
  `<div class="list-title-intro"><div class="body-text"><p>${desc}</p></div></div><ul class="poster-list -grid">${slugs.map(s => card(s, notes[s])).join('')}</ul>` +
  `${next ? '<div class="pagination"><a class="next" href="x">Older</a></div>' : ''}</body></html>`;

/** Fake http. `sites` maps a url to html | { status, url, text } | Error | function. Records requests. */
function fakeHttp(sites) {
  const calls = [];
  const get = async url => {
    calls.push(url);
    let a = sites[url];
    if (typeof a === 'function') a = a(url);
    if (a instanceof Error) throw a;
    if (a == null) return { status: 404, url, text: 'Page Not Found' };
    if (typeof a === 'string') return { status: 200, url, text: a };
    return { url, ...a };
  };
  return { calls, browserText: get, page: get };
}
const mkProblems = () => createProblems({ now: () => T0 });
const ctxOf = (store, http, extra = {}) => ({ store, http, now: T0, problems: extra.problems || mkProblems(), ...extra });

test('addresses: short links and list addresses in every form', () => {
  assert.deepEqual(parseListInput('https://boxd.it/PISi2'), { kind: 'short', id: 'PISi2', url: 'https://boxd.it/PISi2' });
  assert.equal(parseListInput('boxd.it/PISi2/').url, 'https://boxd.it/PISi2');
  const want = { kind: 'list', user: 'film_fan', slug: 'comfort-movies', url: 'https://letterboxd.com/film_fan/list/comfort-movies/' };
  for (const u of [
    'https://letterboxd.com/film_fan/list/comfort-movies/', 'letterboxd.com/film_fan/list/comfort-movies', 'http://www.letterboxd.com/film_fan/list/comfort-movies/page/3/',
    'https://letterboxd.com/film_fan/list/comfort-movies/detail/', 'https://letterboxd.com/film_fan/list/comfort-movies/detail/page/2/', '  https://letterboxd.com/film_fan/list/comfort-movies/?x=1 ',
  ]) assert.deepEqual(parseListInput(u), want, u);
  for (const u of ['', null, 'hello', 'https://example.com/a/list/b/', 'https://letterboxd.com/film_fan/films/', 'https://letterboxd.com/film/heat/', 'https://boxd.it/a/b']) assert.equal(parseListInput(u), null, String(u));
});

test('parser: name, owner, description, films in order, notes, next page', () => {
  const r = parseListPage(page(['a-film', 'b-film'], { next: true, notes: { 'b-film': 'Cosy & warm' } }), { url: LIST });
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Comfort Movies');
  assert.equal(r.owner, 'ada');
  assert.equal(r.ownerName, 'Ada L');
  assert.equal(r.description, 'Films for rainy days.');
  assert.equal(hasNext(r), true);
  assert.deepEqual(r.items.map(i => [i.slug, i.year, i.note]), [['a-film', 2000, ''], ['b-film', 2000, 'Cosy & warm']]);
});
const hasNext = r => r.hasNext;

test('parser: check page, missing page, private list and an empty list', () => {
  assert.equal(parseListPage('<title>Just a moment...</title>').challenge, true);
  assert.equal(parseListPage('<html><head><title>Page Not Found • Letterboxd</title></head></html>').notFound, true);
  assert.equal(parseListPage('<html><body><p>This list is private.</p></body></html>').private, true);
  const empty = parseListPage('<h1>Empty</h1><ul class="poster-list -grid"></ul>');
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.items, []);
  assert.equal(parseListPage('<html><body>hello</body></html>').ok, false);
});

test('readList: reads every page, in order, and stops at the cap without claiming it is complete', async () => {
  const http = fakeHttp({ [LIST]: page(['a', 'b'], { next: true }), [`${LIST}page/2/`]: page(['c'], { next: true }), [`${LIST}page/3/`]: page(['d']) });
  const r = await readList(http, LIST);
  assert.equal(r.status, 'ok'); assert.equal(r.pages, 3); assert.equal(r.complete, true);
  assert.deepEqual(r.items.map(i => i.slug), ['a', 'b', 'c', 'd']);
  const endless = fakeHttp({ [LIST]: page(['a'], { next: true }), ...Object.fromEntries([2, 3].map(n => [`${LIST}page/${n}/`, page([`p${n}`], { next: true })])) });
  const cut = await readList(endless, LIST, { maxPages: 3 });
  assert.equal(cut.pages, 3); assert.equal(cut.complete, false);
  assert.equal(MAX_PAGES, 50);
});

test('readList: not found, private, a later page failing, and a rename redirect', async () => {
  assert.equal((await readList(fakeHttp({}), LIST)).status, 'notfound');
  assert.equal((await readList(fakeHttp({ [LIST]: '<html><body>This list is private.</body></html>' }), LIST)).status, 'private');
  const half = await readList(fakeHttp({ [LIST]: page(['a'], { next: true }), [`${LIST}page/2/`]: { status: 500, text: 'oops' } }), LIST);
  assert.equal(half.status, 'unreadable'); assert.equal(half.complete, false);
  const moved = 'https://letterboxd.com/ada/list/comfort-2/';
  const r = await readList(fakeHttp({ [LIST]: { status: 200, url: moved, text: page(['a']) } }), LIST);
  assert.equal(r.finalUrl, moved);
});

test('diffKeys ignores order changes', () => {
  assert.deepEqual(diffKeys(['a', 'b', 'c'], ['c', 'b', 'd']), { added: ['d'], removed: ['a'] });
  assert.deepEqual(diffKeys(['a', 'b'], ['b', 'a']), { added: [], removed: [] });
});

test('follow by short link: both addresses stored, films become library films that are not watched or on the watchlist', async () => {
  const store = tmpStore();
  const http = fakeHttp({ 'https://boxd.it/PISi2': { status: 200, url: LIST, text: page(['a-film']) }, [LIST]: page(['a-film', 'b-film']) });
  const r = await followList(ctxOf(store, http), 'https://boxd.it/PISi2');
  const l = store.library.lists[r.id];
  assert.equal(l.source, 'letterboxd'); assert.equal(l.follow, true);
  assert.equal(l.url, LIST); assert.equal(l.shortUrl, 'https://boxd.it/PISi2');
  assert.equal(l.name, 'Comfort Movies'); assert.equal(l.owner, 'ada'); assert.equal(l.films.length, 2);
  assert.equal(l.status, 'ok'); assert.equal(l.missCount, 0); assert.deepEqual(l.history, []);
  for (const k of l.films) { const u = store.library.films[k]; assert.ok(u); assert.equal(u.watched, false); assert.equal(u.watchlist, false); }
  assert.deepEqual([...listedKeys(store)].sort(), [...l.films].sort());
  // following it again (by either address) does not make a second list
  const again = await followList(ctxOf(store, http), 'letterboxd.com/ada/list/comfort/page/2/');
  assert.equal(again.existing, true);
  assert.equal(Object.keys(store.library.lists).length, 1);
});

test('follow: bad links and unreadable lists say so in plain English', async () => {
  const store = tmpStore();
  await assert.rejects(followList(ctxOf(store, fakeHttp({})), 'https://example.com/x'), { code: 'bad-link' });
  await assert.rejects(followList(ctxOf(store, fakeHttp({})), LIST), { code: 'notfound', message: /couldn't find that list/ });
  await assert.rejects(followList(ctxOf(store, fakeHttp({ 'https://boxd.it/zz': { status: 200, url: 'https://letterboxd.com/film/heat/', text: '' } })), 'boxd.it/zz'), { code: 'bad-link' });
  assert.deepEqual(store.library.lists, {});
});

async function followed(slugs = ['a-film', 'b-film', 'c-film'], shortUrl = true) {
  const store = tmpStore();
  const sites = { 'https://boxd.it/PISi2': { status: 200, url: LIST, text: '' }, [LIST]: page(slugs) };
  const http = fakeHttp(sites);
  const r = await followList(ctxOf(store, http), shortUrl ? 'https://boxd.it/PISi2' : LIST);
  return { store, http, sites, id: r.id, list: store.library.lists[r.id] };
}

test('refresh: added and removed films go to the history, removed films stay in the library, nothing is a problem', async () => {
  const { store, sites, http, id, list } = await followed();
  const before = [...list.films];
  sites[LIST] = page(['b-film', 'c-film', 'd-film']);
  const problems = mkProblems();
  const r = await refreshList(ctxOf(store, http, { problems, now: T0 + 3 * DAY }), id);
  assert.deepEqual(r, { status: 'ok', added: 1, removed: 1 });
  assert.equal(list.history.length, 1);
  assert.equal(list.history[0].added.length, 1); assert.equal(list.history[0].removed[0], before[0]);
  assert.equal(list.history[0].at, new Date(T0 + 3 * DAY).toISOString());
  assert.ok(store.films[before[0]] && store.library.films[before[0]], 'the film that left the list is still in the library');
  assert.equal(problems.list().length, 0);
  // no change: no new history line
  await refreshList(ctxOf(store, http, { problems, now: T0 + 4 * DAY }), id);
  assert.equal(list.history.length, 1);
});

test('history keeps the last 20 changes', async () => {
  const { store, sites, http, id, list } = await followed(['a']);
  for (let i = 1; i <= 25; i++) { sites[LIST] = page([`film-${i}`]); await refreshList(ctxOf(store, http, { now: T0 + i * DAY }), id); }
  assert.equal(list.history.length, 20);
});

test('gone: a first 404 is a warning, the second marks it gone with an error, and nothing is deleted', async () => {
  const { store, sites, http, id, list } = await followed();
  const films = [...list.films];
  delete sites[LIST]; delete sites['https://boxd.it/PISi2'];
  const problems = mkProblems();
  const r1 = await refreshList(ctxOf(store, http, { problems, now: T0 + DAY }), id);
  assert.equal(r1.status, 'ok'); assert.equal(list.missCount, 1);
  assert.deepEqual(problems.list().map(p => p.level), ['warning']);
  const r2 = await refreshList(ctxOf(store, http, { problems, now: T0 + 2 * DAY }), id);
  assert.equal(r2.status, 'gone'); assert.equal(list.status, 'gone'); assert.equal(list.missCount, 2);
  const errs = problems.list().filter(p => p.level === 'error');
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /The list "Comfort Movies" by ada is no longer on Letterboxd/);
  assert.deepEqual(list.films, films);
  assert.equal(store.library.lists[id], list);
  // staying gone is not reported again
  await refreshList(ctxOf(store, http, { problems, now: T0 + 3 * DAY }), id);
  assert.equal(problems.list().filter(p => p.level === 'error').length, 1);
  // coming back says so in the history
  sites[LIST] = page(['a-film']);
  await refreshList(ctxOf(store, http, { problems, now: T0 + 4 * DAY }), id);
  assert.equal(list.status, 'ok'); assert.equal(list.missCount, 0);
  assert.equal(list.history.at(-1).back, true);
});

test('a renamed list is found again through its short link and the address updates', async () => {
  const { store, sites, http, id, list } = await followed();
  const moved = 'https://letterboxd.com/ada/list/comfort-movies-2/';
  delete sites[LIST];
  sites['https://boxd.it/PISi2'] = { status: 200, url: moved, text: '' };
  sites[moved] = page(['a-film', 'b-film', 'c-film'], { name: 'Comfort Movies 2' });
  const r = await refreshList(ctxOf(store, http, { now: T0 + DAY }), id);
  assert.equal(r.status, 'ok');
  assert.equal(list.url, moved); assert.equal(list.name, 'Comfort Movies 2'); assert.equal(list.missCount, 0);
});

test('private and unreadable lists keep their last copy and report an error', async () => {
  const { store, sites, http, id, list } = await followed();
  const problems = mkProblems();
  sites[LIST] = '<html><body>This list is private.</body></html>';
  await refreshList(ctxOf(store, http, { problems, now: T0 + DAY }), id);
  assert.equal(list.status, 'private');
  assert.match(problems.list()[0].message, /is private now/); assert.equal(problems.list()[0].level, 'error');
  sites[LIST] = { status: 500, text: 'boom' };
  await refreshList(ctxOf(store, http, { problems, now: T0 + 2 * DAY }), id);
  assert.equal(list.status, 'unreadable');
  assert.equal(problems.list()[0].level, 'error');
  assert.equal(list.films.length, 3);
});

test('refreshDueLists only reads lists older than a day', async () => {
  const { store, http, list } = await followed();
  assert.deepEqual(await refreshDueLists(ctxOf(store, http, { now: T0 + STALE_MS / 2 })), { checked: 0, added: 0, removed: 0 });
  const r = await refreshDueLists(ctxOf(store, http, { now: T0 + STALE_MS + 1000 }));
  assert.equal(r.checked, 1);
  assert.equal(list.fetchedAt, new Date(T0 + STALE_MS + 1000).toISOString());
  assert.equal((await refreshDueLists(ctxOf(store, http, { now: T0 + STALE_MS + 2000 }))).checked, 0);
  assert.equal((await refreshDueLists(ctxOf(store, http, { now: T0 + STALE_MS + 2000 }), { force: true })).checked, 1);
});

test('csv: columns, quoting, unicode, notes and no byte-order mark', () => {
  const csv = listCsv([
    { slug: 'amelie', tmdb: 194, imdb: 'tt0211915', title: 'Amélie', year: 2001, directors: ['Jean-Pierre Jeunet'], note: 'Cosy' },
    { slug: null, tmdb: null, imdb: null, title: 'Fast, "Loud"', year: null, directors: ['A B', 'C D'], note: 'Line one\nline two' },
    { title: '東京物語', year: 1953 },
  ]);
  assert.equal(csv.charCodeAt(0), 'L'.charCodeAt(0));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'LetterboxdURI,tmdbID,imdbID,Title,Year,Directors,Review');
  assert.equal(lines[1], 'https://letterboxd.com/film/amelie/,194,tt0211915,Amélie,2001,Jean-Pierre Jeunet,Cosy');
  assert.ok(csv.includes(',,,"Fast, ""Loud""",,"A B, C D","Line one\nline two"\r\n'));
  assert.ok(csv.includes(',,,東京物語,1953,,\r\n'));
  assert.equal(csv.endsWith('\r\n'), true);
});

test('csv filenames are safe on Windows', () => {
  assert.equal(csvFilename('Best of: 2024?'), 'Best of 2024.csv');
  assert.equal(csvFilename('  a/b\\c*  '), 'abc.csv');
  assert.equal(csvFilename(''), 'List.csv');
  assert.equal(csvFilename('Ends with dots...'), 'Ends with dots.csv');
});

test('export, then link: the list keeps its id, becomes followed, and films that did not make it are recorded', async () => {
  const store = tmpStore();
  const mk = (slug, title) => resolveFilm(store, { slug, title, year: 2000 }).key;
  const [a, b, c] = [mk('a-film', 'A Film'), mk('b-film', 'B Film'), mk('c-film', 'C Film')];
  store.library.lists.m1 = { id: 'm1', source: 'matinee', name: 'My rainy list', description: '', films: [a, b, c], notes: { [a]: 'Mine', [c]: 'Also mine' }, created: '2026-11-01' };
  const http = fakeHttp({ [LIST]: page(['a-film', 'c-film', 'z-film'], { name: 'My rainy list' }) });
  await assert.rejects(linkList(ctxOf(store, http), 'm1', 'nonsense'), { code: 'bad-link' });
  const r = await linkList(ctxOf(store, http), 'm1', 'letterboxd.com/ada/list/comfort/');
  const l = store.library.lists.m1;
  assert.equal(l.id, 'm1'); assert.equal(l.source, 'letterboxd'); assert.equal(l.follow, true); assert.equal(l.url, LIST);
  assert.equal(r.missing, 1);
  assert.deepEqual(l.history[0].removed, [b]); assert.equal(l.history[0].linked, true);
  assert.equal(l.films.length, 3);
  assert.equal(l.notes[a], 'Mine');
  // editing is closed; unlinking returns it to an own list with its films
  const films = [...l.films];
  const u = unlinkList({ store }, 'm1');
  assert.equal(u.id, 'm1');
  assert.equal(store.library.lists.m1.source, 'matinee'); assert.equal(store.library.lists.m1.follow, undefined); assert.deepEqual(store.library.lists.m1.films, films);
  await assert.rejects(() => linkList(ctxOf(store, http), 'nope', LIST), { code: 'not-found' });
});

test('a list that is already followed cannot be linked a second time', async () => {
  const { store, http } = await followed(['a-film'], false);
  store.library.lists.m1 = { id: 'm1', source: 'matinee', name: 'Mine', films: [], notes: {} };
  await assert.rejects(linkList(ctxOf(store, http), 'm1', LIST), { code: 'already' });
});

test('unfollow removes the list but keeps its films', async () => {
  const { store, id, list } = await followed();
  const films = [...list.films];
  unfollowList({ store }, id);
  assert.equal(store.library.lists[id], undefined);
  for (const k of films) assert.ok(store.films[k]);
});

test('rekey (a film gets its Letterboxd id) keeps list order, notes and history pointing at it', () => {
  const store = tmpStore();
  const f = resolveFilm(store, { slug: 'a-film', title: 'A Film', year: 2000 });
  const from = f.key;
  store.library.lists.x = { id: 'x', source: 'letterboxd', films: ['other', from], notes: { [from]: 'n' }, history: [{ at: 't', added: [from], removed: [] }] };
  resolveFilm(store, { lid: 'abc12', slug: 'a-film', title: 'A Film', year: 2000 });
  const to = Object.keys(store.films).find(k => k !== 'other');
  assert.notEqual(to, from);
  const l = store.library.lists.x;
  assert.deepEqual(l.films, ['other', to]); assert.equal(l.notes[to], 'n'); assert.equal(l.notes[from], undefined); assert.deepEqual(l.history[0].added, [to]);
});

test('library filter: status "listed" keeps films on any list, watched or not', () => {
  const films = [{ key: 'a', title: 'A', user: { listed: true, watched: true } }, { key: 'b', title: 'B', user: { listed: true } }, { key: 'c', title: 'C', user: { watchlist: true } }];
  assert.deepEqual(applyQuery(films, { status: 'listed' }).map(f => f.key).sort(), ['a', 'b']);
});

test('a list longer than the page cap only adds, never removes, and says so', async () => {
  const { store, sites, http, id, list } = await followed(['old-a', 'old-b']);
  const oldKeys = [...list.films];
  sites[LIST] = page(['new-1'], { next: true });
  for (let n = 2; n <= MAX_PAGES; n++) sites[`${LIST}page/${n}/`] = page([`new-${n}`], { next: true });
  const problems = mkProblems();
  await refreshList(ctxOf(store, http, { problems, now: T0 + DAY }), id);
  assert.equal(list.truncated, true);
  assert.equal(list.films.length, 2 + MAX_PAGES);
  for (const k of oldKeys) assert.ok(list.films.includes(k));
  assert.equal(list.history.at(-1).removed.length, 0);
  assert.deepEqual(problems.list().map(p => p.level), ['warning']);
});
