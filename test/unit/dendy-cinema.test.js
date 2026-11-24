import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normTitle, matchToLibrary, buildCinemaView, needsRefresh, mergeCache, listingsFromCache, refreshCinema, sydneyParts, lastSydneyHour, defaultDirectorsOf } from '../../core/features/cinema.js';
import { createDendySource, isAllowedPath, HOST_RECOMMENDED } from '../../core/sources/dendy.js';
import { parseFilmPage, parseListing } from '../../core/parse/dendy.js';

const fx = n => readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8');
// Library summaries (invented films). `dir` -> directors as [{id,name}] like the real summaries.
const sum = (key, title, year, { runtime, watched = false, watchlist = false, dir, originalTitle } = {}) =>
  ({ key, title, year, runtime, originalTitle, directors: (dir || []).map((name, i) => ({ id: 'p' + i, name })), user: { watched, watchlist } });
const sess = (...dt) => dt.map(x => ({ date: x.slice(0, 10), time: x.slice(11) }));
const H = 3600e3;
// 2026-10-29 07:30 in Sydney (+11) = 2026-10-28T20:30Z
const MORNING = Date.parse('2026-10-28T20:30:00Z');

test('title normalisation uses the real title shapes', () => {
  assert.equal(normTitle('Nightmare Ship - Directors Cut'), 'nightmare ship');
  assert.equal(normTitle('The Godfather Example (4K Re-release)'), 'godfather example');
  assert.equal(normTitle('House (Hausu Example) '), 'house');
  assert.equal(normTitle('Café Lumière - Director’s Cut'), 'cafe lumiere');
  assert.equal(normTitle('Rock & Roll'), 'rock and roll');
  assert.equal(normTitle("Schindler’s List"), normTitle("Schindlers List"));
  assert.equal(normTitle('The The'), 'the');
  assert.equal(normTitle(undefined), '');
});

test('Sydney clock helpers', () => {
  assert.equal(sydneyParts(MORNING).now, '2026-10-29T07:30');
  assert.equal(lastSydneyHour(MORNING, 7), MORNING - 30 * 60000);
  assert.equal(lastSydneyHour(MORNING - 3 * H, 7), MORNING - 30 * 60000 - 24 * H); // 04:30 Sydney: 07:00 yesterday
});

test('default directors reader accepts directors, people.director or director', () => {
  assert.deepEqual(defaultDirectorsOf({ directors: [{ name: 'A B' }, 'C D'] }), ['A B', 'C D']);
  assert.deepEqual(defaultDirectorsOf({ people: { director: [{ name: 'E F' }] } }), ['E F']);
  assert.deepEqual(defaultDirectorsOf({ director: 'G H' }), ['G H']);
  assert.deepEqual(defaultDirectorsOf({}), []);
});

test('matching: two steps (title candidate, then director / runtime confirmation)', () => {
  const lib = [
    sum('ship', 'Nightmare Ship', 1979, { runtime: 117, dir: ['Rolf Example'] }),
    sum('haus', 'House', 1977, { runtime: 88, dir: ['Nobu Example'], originalTitle: 'Hausu Example' }),
    sum('s95', 'Twin Tale', 1995, { runtime: 136, dir: ['Anne Example'] }),
    sum('s26', 'Twin Tale', 2026, { runtime: 122, dir: ['Bo Sample'] }),
    sum('fresh', 'Fresh Release', 2026, { runtime: 100, dir: ['Cy Example'] }),
  ];
  const t = (listing, opts) => matchToLibrary([listing], lib, opts)[0];
  // no page read yet: an old film is only a candidate
  const c = t({ title: 'Nightmare Ship', titleRaw: 'Nightmare Ship - Directors Cut', slug: 'nightmare-ship---directors-cut' });
  assert.equal(c.filmKey, null);
  assert.deepEqual(c.candidates, ['ship']);
  // confirmed by director surname, runtime, or both
  assert.deepEqual(['filmKey', 'matchedBy'].map(k => t({ title: 'Nightmare Ship', directors: ['R. Example'] })[k]), ['ship', 'title+director']);
  assert.equal(t({ title: 'Nightmare Ship', runtimeMin: 122 }).matchedBy, 'title+runtime'); // +/-10
  assert.equal(t({ title: 'Nightmare Ship', runtimeMin: 128 }).filmKey, null);
  assert.equal(t({ title: 'Nightmare Ship', runtimeMin: 128, directors: ['Rolf Example'] }).matchedBy, 'title+director'); // a longer cut is fine with the director
  assert.equal(t({ title: 'Nightmare Ship', runtimeMin: 117, directors: ['Rolf Example'] }).matchedBy, 'title+director+runtime');
  // a different director rejects, even when the runtime fits
  assert.equal(t({ title: 'Nightmare Ship', runtimeMin: 117, directors: ['Someone Else'] }).filmKey, null);
  // the other name in brackets, and the library's original title
  assert.equal(t({ title: 'House', titleRaw: 'House (Hausu Example) ', directors: ['Nobu Example'] }).filmKey, 'haus');
  assert.equal(t({ title: 'Hausu Example', directors: ['Nobu Example'] }).filmKey, 'haus');
  // same-name remake: director / runtime separates them, a bare title does not
  assert.equal(t({ title: 'Twin Tale', directors: ['Bo Sample'] }).filmKey, 's26');
  assert.equal(t({ title: 'Twin Tale', runtimeMin: 134 }).filmKey, 's95');
  assert.equal(t({ title: 'Twin Tale' }).filmKey, 's26'); // only the recent one may match on title alone
  assert.equal(t({ title: 'Twin Tale', runtimeMin: 90 }).filmKey, null);
  // a recent library film matches on the title alone (page not read yet)
  assert.equal(t({ title: 'Fresh Release' }).matchedBy, 'title');
  assert.equal(t({ title: 'Fresh Release' }, { todayYear: 2029 }).filmKey, null);
  // year (if a listing ever gives one)
  assert.equal(t({ title: 'Twin Tale', year: 1995 }).matchedBy, 'title+year');
  assert.equal(t({ title: 'Twin Tale', year: 2010 }).filmKey, null);
  // custom directors reader
  const d = matchToLibrary([{ title: 'Nightmare Ship', directors: ['Rolf Example'] }], [{ key: 'z', title: 'Nightmare Ship', year: 1979, crew: 'Rolf Example' }], { directorsOf: s => [s.crew] });
  assert.equal(d[0].filmKey, 'z');
  assert.equal(t({ title: 'Unknown Film' }).candidates.length, 0);
});

test('events are never matched to library films', () => {
  const lib = [sum('trivia', 'Movie Trivia at The Den', 2026), sum('play', 'Example Play', 2026, { runtime: 165 })];
  const m = matchToLibrary([
    { title: 'Movie Trivia at The Den', kind: 'event' },
    { title: 'Example Play', kind: 'event', runtimeMin: 165 },
  ], lib);
  assert.deepEqual(m.map(x => [x.filmKey, x.candidates.length]), [[null, 0], [null, 0]]);
});

const listings = [
  { title: 'Today Film', slug: 'today-film', label: null, firstDate: '2026-10-01', sessions: sess('2026-10-28T10:00', '2026-10-29T18:00', '2026-10-30T18:00') },
  { title: 'Soon Film', slug: 'soon-film', label: "Director's Cut", sessions: sess('2026-11-20T19:00') },
  { title: 'Later Film', slug: 'later-film', label: null, sessions: sess('2027-02-01T19:00') },
  { title: 'Gone Film', slug: 'gone-film', label: null, sessions: sess('2026-10-20T19:00') },
  { title: 'Edge Week', slug: 'edge-week', sessions: sess('2026-11-05T19:00') },
  { title: 'Edge Eight', slug: 'edge-eight', sessions: sess('2026-12-24T19:00', '2026-12-24T20:00', '2026-12-25T20:00', '2026-12-26T20:00', '2026-12-27T20:00', '2026-12-28T20:00', '2026-12-29T20:00') },
];
const lib = [sum('today', 'Today Film', 2026, { watchlist: true }), sum('soon', 'Soon Film', 1979, { watched: true, runtime: 100, dir: ['Pat Example'] })];

test('view groups by the injected today, flags library films and drops past sessions', () => {
  const l = listings.map(x => x.slug === 'soon-film' ? { ...x, runtimeMin: 104, directors: ['Pat Example'] } : x);
  const v = buildCinemaView({ listings: l, summaries: lib, today: '2026-10-29', fetchedAt: 123 });
  assert.equal(v.cinema.id, 'dendy-newtown');
  assert.equal(v.fetchedAt, 123);
  assert.deepEqual(v.groups.map(g => g.id), ['now', 'soon', 'later']);
  assert.deepEqual(v.groups.map(g => g.label), ['Showing this week', 'Booking soon', 'Further ahead']);
  assert.deepEqual(v.groups[0].items.map(i => i.title), ['Today Film']);
  assert.deepEqual(v.groups[1].items.map(i => i.title), ['Edge Week', 'Soon Film', 'Edge Eight']); // 7 days is already "soon", 56 days (8 weeks) still is
  assert.deepEqual(v.groups[2].items.map(i => i.title), ['Later Film']);
  assert.equal(v.total, 5); // Gone Film: every session is past, so it is dropped
  assert.equal(v.matchedCount, 2);
  const t = v.groups[0].items[0];
  assert.equal(t.next, '2026-10-29');
  assert.equal(t.kind, 'film');
  assert.equal(t.hasSessions, true);
  assert.equal(t.sessions.length, 2); // the 28th is dropped
  assert.equal(t.onWatchlist, true);
  assert.equal(t.film.key, 'today');
  assert.equal(t.matchedBy, 'title'); // recent library film, page not read
  assert.equal(t.url, 'https://newtown.dendy.com.au/movie/today-film/');
  const s = v.groups[1].items.find(i => i.title === 'Soon Film');
  assert.equal(s.watched, true); // watched films stay, flagged
  assert.equal(s.matchedBy, 'title+director+runtime');
  assert.equal(s.label, "Director's Cut");
  assert.equal(v.groups[2].items[0].film, null);
  assert.equal(v.groups[2].items[0].filmKey, null);
});

test('view keeps films with no sessions: "From <date>", unmatched ones too, grouped by first date', () => {
  const l = [
    { title: 'Dune Example: Part Three', slug: 'dune-example-part-three', firstDate: '2026-12-16', rating: 'CTC', directors: ['Dena Vilas'], runtimeMin: 150, sessions: [] },
    { title: 'Next Week Film', slug: 'next-week-film', firstDate: '2026-11-10', sessions: [] },
    { title: 'Spring Show', slug: 'spring-show', firstDate: '2027-05-15', sessions: [] },
    { title: 'Old Run', slug: 'old-run', firstDate: '2023-06-09', sessions: [] },
    { title: 'Undated', slug: 'undated', sessions: [] },
    { title: 'Tonight Only', slug: 'tonight-only', firstDate: '2026-10-31', sessions: sess('2026-10-31T20:10') },
    { title: 'Trivia Night', slug: 'trivia-night', kind: 'event', firstDate: '2026-11-12', sessions: [] },
  ];
  const library = [sum('dune', 'Dune Example: Part Three', 2026, { watchlist: true, dir: ['Dena Vilas'], runtime: 152 })];
  const v = buildCinemaView({ listings: l, summaries: library, today: '2026-10-29' });
  assert.deepEqual(v.groups.map(g => g.id), ['now', 'soon', 'later', 'listed']);
  assert.deepEqual(v.groups[0].items.map(i => i.title), ['Tonight Only']);
  assert.deepEqual(v.groups[1].items.map(i => i.title), ['Next Week Film', 'Trivia Night', 'Dune Example: Part Three']);
  assert.deepEqual(v.groups[2].items.map(i => i.title), ['Spring Show']);
  assert.deepEqual(v.groups[3].items.map(i => i.title), ['Undated']);
  const dune = v.groups[1].items[2];
  assert.equal(dune.next, '2026-12-16'); // next = first live session, else the first date
  assert.equal(dune.firstDate, '2026-12-16');
  assert.equal(dune.hasSessions, false);
  assert.deepEqual(dune.sessions, []);
  assert.equal(dune.sessionCount, 0);
  assert.equal(dune.filmKey, 'dune');
  assert.equal(dune.matchedBy, 'title+director+runtime');
  assert.equal(dune.onWatchlist, true);
  assert.equal(dune.url, 'https://newtown.dendy.com.au/movie/dune-example-part-three/');
  assert.equal(v.groups[1].items[1].kind, 'event');
  assert.equal(v.total, 6);
  assert.equal(v.matchedCount, 1);
});

test('view: up to 6 sessions, and `now` / the Sydney clock drop sessions already started', () => {
  const v = buildCinemaView({ listings: listings.slice(5), summaries: [], today: '2026-12-24' });
  assert.equal(v.groups[0].items[0].sessions.length, 6);
  assert.equal(v.groups[0].items[0].sessionCount, 7);
  const w = buildCinemaView({ listings: listings.slice(5), summaries: [], today: '2026-12-24', now: '2026-12-24T19:30' });
  assert.equal(w.groups[0].items[0].sessions[0].time, '20:00');
  // 2026-10-29 19:30 Sydney = 08:30Z
  const x = buildCinemaView({ listings: [listings[0]], summaries: [], nowMs: Date.parse('2026-10-29T08:30:00Z') });
  assert.deepEqual(x.groups[0].items[0].sessions.map(s => s.date + s.time), ['2026-10-30' + '18:00']);
});

test('empty input is fine', () => {
  const v = buildCinemaView({ today: '2026-10-29' });
  assert.equal(v.total, 0);
  assert.equal(v.groups.length, 3);
});

test('needsRefresh: once per Sydney day after about 07:00, pause after a failed try', () => {
  const ok = (fetchedAt, extra = {}) => ({ version: 3, fetchedAt, films: {}, ...extra });
  assert.equal(needsRefresh(null, MORNING), true);
  assert.equal(needsRefresh({ fetchedAt: MORNING, listings: [] }, MORNING + 48 * H), true); // old shape: read again
  assert.equal(needsRefresh(ok(MORNING - 24 * H), MORNING), true); // yesterday's read, past 07:00
  assert.equal(needsRefresh(ok(MORNING - 24 * H), MORNING - 2 * H), false); // 05:30: what we hold is current
  assert.equal(needsRefresh(ok(MORNING - 24 * H), MORNING - 31 * 60000 - 20 * H), false); // 11:00 the evening before is far from due
  assert.equal(needsRefresh(ok(MORNING), MORNING + 10 * H), false); // read this morning
  assert.equal(needsRefresh(ok(MORNING), MORNING + 24 * H + 60000), true); // next morning
  assert.equal(needsRefresh(ok(MORNING - 24 * H, { triedAt: MORNING - H }), MORNING), false);
  assert.equal(needsRefresh(ok(MORNING - 24 * H, { triedAt: MORNING - 4 * H }), MORNING), true);
  assert.equal(needsRefresh(ok(MORNING, { incomplete: true, triedAt: MORNING }), MORNING + H), false);
  assert.equal(needsRefresh(ok(MORNING, { incomplete: true, triedAt: MORNING }), MORNING + 4 * H), true);
  assert.equal(needsRefresh(ok(MORNING - 5 * H), MORNING, 3 * H), true); // explicit age limit
  assert.equal(needsRefresh(ok(MORNING - H), MORNING, 3 * H), false);
});

const entry = (slug, extra = {}) => ({ slug, title: slug, titleFrom: 'anchor', seen: { comingSoon: true }, ...extra });

test('mergeCache keeps firstDate, directors, rating, kind and seen; film pages replace list sessions', () => {
  const page = { ...parseFilmPage(fx('dendy-film.html')), sessions: sess('2026-10-29T13:15', '2026-10-30T10:30') };
  const c0 = mergeCache(null, [entry('the-velvet-orchard', { title: 'Velvet', seen: { sitemap: true, nowShowing: true }, sessions: sess('2026-10-29T13:15') })], { 'the-velvet-orchard': page }, 1000, { sitemapRead: true });
  const f = c0.films['the-velvet-orchard'];
  assert.equal(c0.version, 3);
  assert.equal(c0.fetchedAt, 1000);
  assert.equal(f.title, 'The Velvet Orchard');
  assert.equal(f.titleFrom, 3);
  assert.deepEqual(f.directors, ['Iris Calloway']);
  assert.equal(f.rating, 'M');
  assert.equal(f.firstDate, '2026-10-01');
  assert.equal(f.runtimeMin, 110);
  assert.equal(f.kind, 'film');
  assert.equal(f.readAt, 1000);
  assert.equal(f.sessions.length, 2);
  assert.deepEqual(f.seen, { sitemap: true, comingSoon: false, nowShowing: true });
  assert.deepEqual(c0.snapshot, { fetchedAt: 1000, windowFrom: '2026-10-29', windowTo: '2026-10-30' });
  // a later run with only a slug-guess title does not downgrade the page title, and the page data stays
  const c1 = mergeCache(c0, [entry('the-velvet-orchard', { title: 'the velvet orchard', titleFrom: 'slug', seen: { sitemap: true } })], {}, 2000, { sitemapRead: true });
  assert.equal(c1.films['the-velvet-orchard'].title, 'The Velvet Orchard');
  assert.equal(c1.films['the-velvet-orchard'].readAt, 1000);
  assert.deepEqual(c1.films['the-velvet-orchard'].directors, ['Iris Calloway']);
  assert.equal(c1.films['the-velvet-orchard'].lastSeenAt, 2000);
  // events stay events
  const c2 = mergeCache(c1, [entry('the-velvet-orchard', { kind: 'event' })], {}, 3000);
  assert.equal(c2.films['the-velvet-orchard'].kind, 'event');
  // failed list read: the old data is kept
  const failed = mergeCache(c1, null, {}, 4000);
  assert.equal(failed.fetchedAt, 2000);
  assert.equal(failed.triedAt, 4000);
  assert.equal(Object.keys(failed.films).length, 1);
});

test('mergeCache: a film missing from one list is kept; with the sitemap read it goes after one extra day', () => {
  const c0 = mergeCache(null, [entry('a'), entry('b')], { a: { title: 'A', sessions: [] } }, 1000, { sitemapRead: true });
  // no sitemap this time: nothing is dropped
  const c1 = mergeCache(c0, [entry('a')], {}, 2000, { sitemapRead: false });
  assert.deepEqual(Object.keys(c1.films).sort(), ['a', 'b']);
  // sitemap read, 'b' gone from it: b was never page-read, so it goes; a (read) would stay for a day
  const c2 = mergeCache(c0, [entry('b')], {}, 1000 + 12 * H, { sitemapRead: true });
  assert.deepEqual(Object.keys(c2.films).sort(), ['a', 'b']);
  const c3 = mergeCache(c2, [entry('b')], {}, 1000 + 40 * H, { sitemapRead: true });
  assert.deepEqual(Object.keys(c3.films), ['b']);
});

test('listingsFromCache keeps films with no sessions and ignores the old cache shape', () => {
  const c = mergeCache(null, [entry('x', { title: 'Plain', titleRaw: 'House (Hausu Example) ', firstDate: '2026-12-01', directors: ['D E'] }), entry('y', { title: 'Why', kind: 'event' })], {}, 1000);
  const l = listingsFromCache(c);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0].sessions, []);
  assert.equal(l[0].firstDate, '2026-12-01');
  assert.deepEqual(l[0].directors, ['D E']);
  assert.deepEqual(l[0].variants, ['House', 'House Hausu Example', 'Hausu Example']);
  assert.equal(l[1].kind, 'event');
  assert.deepEqual(listingsFromCache({ fetchedAt: 1, listings: [{ slug: 'old' }], films: { old: { sessions: [] } } }), []);
  assert.deepEqual(listingsFromCache(null), []);
});

test('source builds only the allowed kinds of URL and is paced one at a time', async () => {
  for (const ok of ['/now-showing/', '/now-showing', '/movie/the-velvet-orchard/', '/coming-soon/', '/coming-soon', '/sitemap.xml', '/movie/a-tale-of-two-lanterns-/', '/movie/8/']) assert.equal(isAllowedPath(ok), true, ok);
  for (const no of ['/graphql', '/ahoy/x', '/checkout/showing/a/1/', '/movie/a/checkout/', '/en/checkout', '//evil.example/movie/a/', 'https://x/now-showing/', '/movie/../graphql', '/movie/a b/', '', '/explore-movies/', '/laika-retrospective/', '/dune--tickets-on-sale/', '/sitemap.xml/x', '/graphql?x=/sitemap.xml']) assert.equal(isAllowedPath(no), false, no);
  assert.deepEqual(HOST_RECOMMENDED['newtown.dendy.com.au'], { concurrency: 1, gap: 1800 });
  const seen = [];
  const http = { browserText: async url => { seen.push(url); return { status: 200, text: url.endsWith('.xml') ? fx('dendy-sitemap.xml') : url.includes('coming') ? fx('dendy-coming-soon.html') : fx('dendy-film.html') }; } };
  const src = createDendySource({ http });
  await src.fetchFilm('/movie/the-velvet-orchard/');
  assert.equal((await src.fetchSitemap()).slugs.length, 5);
  assert.equal((await src.fetchComingSoon()).films.length, 4);
  assert.deepEqual(seen, ['https://newtown.dendy.com.au/movie/the-velvet-orchard/', 'https://newtown.dendy.com.au/sitemap.xml', 'https://newtown.dendy.com.au/coming-soon/']);
  await assert.rejects(src.fetchFilm('/checkout/showing/a/1/'), { code: 'forbidden' });
  await assert.rejects(src.fetchFilm('/graphql'), { code: 'forbidden' });
  assert.equal(seen.length, 3);
});

test('source: blocked, changed and good pages', async () => {
  const mk = (status, text) => createDendySource({ http: { text: async () => ({ status, text }) } });
  await assert.rejects(mk(403, '').fetchListing(), { code: 'blocked', status: 403 });
  await assert.rejects(mk(429, '').fetchComingSoon(), { code: 'blocked', status: 429 });
  await assert.rejects(mk(500, '').fetchListing(), { code: 'http' });
  await assert.rejects(mk(200, '<html>Just a moment...</html>').fetchListing(), { code: 'changed' });
  await assert.rejects(mk(200, '<html>Just a moment...</html>').fetchComingSoon(), { code: 'changed' });
  await assert.rejects(mk(200, '<urlset></urlset>').fetchSitemap(), { code: 'changed' });
  const r = await mk(200, fx('dendy-now-showing.html')).fetchListing();
  assert.equal(r.films.length, 4);
  assert.equal(r.capped, true);
});

// A fake Dendy: a roster of slugs, titles, and the film page each slug returns.
function fakeSource({ nowFilms = [], comingSoon = [], sitemap = null, pages = {}, errors = {} }) {
  const calls = [];
  const maybe = (key) => { if (errors[key]) throw errors[key]; };
  return {
    calls,
    fetchListing: async () => { calls.push('now'); maybe('now'); return { films: nowFilms, capped: false, eventCount: 0 }; },
    fetchComingSoon: async () => { calls.push('coming'); maybe('coming'); return { films: comingSoon }; },
    fetchSitemap: async () => { calls.push('sitemap'); maybe('sitemap'); if (!sitemap) throw Object.assign(new Error('x'), { code: 'changed' }); return { slugs: sitemap }; },
    fetchFilm: async path => {
      calls.push(path); maybe(path);
      const slug = path.split('/')[2];
      return { title: slug, titleRaw: slug, slug, label: null, kind: 'film', rating: null, runtimeMin: null, directors: [], firstDate: null, sessions: [], ...(pages[slug] || {}) };
    },
  };
}
const refreshLib = [
  sum('today', 'Today Film', 1980, { watchlist: true, runtime: 100, dir: ['Pat Example'] }),
  sum('soon', 'Soon Film', 1979, { watched: true, runtime: 100, dir: ['Sam Sample'] }),
  sum('dune', 'Dune Example: Part Three', 2026, { watchlist: true, dir: ['Dena Vilas'] }),
];

test('refreshCinema: roster is the union of sitemap, coming soon and now showing; candidates only, watchlist first', async () => {
  const source = fakeSource({
    sitemap: ['not-mine', 'soon-film', 'today-film', 'dune-example-part-three', 'only-in-sitemap---directors-cut'],
    comingSoon: [{ slug: 'soon-film', title: 'Soon Film' }, { slug: 'only-coming', title: 'Only Coming' }],
    nowFilms: [{ title: 'Today Film', titleRaw: 'Today Film', slug: 'today-film', kind: 'film', directors: [], sessions: sess('2026-10-29T10:00'), firstDate: '2026-10-29' }],
    pages: {
      'today-film': { title: 'Today Film', directors: ['Pat Example'], runtimeMin: 100, sessions: sess('2026-10-29T18:00', '2026-10-30T18:00'), firstDate: '2026-10-29' },
      'dune-example-part-three': { title: 'Dune Example: Part Three', directors: ['Dena Vilas'], runtimeMin: 150, firstDate: '2026-12-16', rating: 'CTC' },
      'soon-film': { title: 'Soon Film', directors: ['Someone Else'], runtimeMin: 130 },
    },
  });
  const r = await refreshCinema({ source, summaries: refreshLib, nowMs: MORNING });
  assert.deepEqual(source.calls, ['now', 'coming', 'sitemap', '/movie/today-film/', '/movie/dune-example-part-three/', '/movie/soon-film/']);
  assert.equal(r.requests, 6);
  assert.equal(r.fetched, 3);
  assert.equal(r.error, null);
  assert.equal(r.skipped, false);
  assert.deepEqual(r.partial, []);
  assert.deepEqual(Object.keys(r.cache.films).sort(), ['dune-example-part-three', 'not-mine', 'only-coming', 'only-in-sitemap---directors-cut', 'soon-film', 'today-film']);
  assert.equal(r.cache.films['only-in-sitemap---directors-cut'].title, 'only in sitemap');
  assert.equal(r.cache.films['only-in-sitemap---directors-cut'].label, "Director's Cut");
  assert.equal(r.cache.films['dune-example-part-three'].firstDate, '2026-12-16');
  assert.equal(r.cache.films['today-film'].sessions.length, 2);
  assert.equal(r.cache.films['today-film'].seen.nowShowing, true);
  assert.equal(r.cache.films['today-film'].seen.sitemap, true);
  assert.equal(r.cache.incomplete, false);
  // view: dune is matched (page read, director agrees); soon-film is a candidate whose page contradicts it, so it stays unmatched
  const v = buildCinemaView({ listings: listingsFromCache(r.cache), summaries: refreshLib, today: '2026-10-29', now: '2026-10-29T07:30' });
  const all = v.groups.flatMap(g => g.items);
  assert.equal(all.find(i => i.slug === 'dune-example-part-three').filmKey, 'dune');
  assert.equal(all.find(i => i.slug === 'today-film').filmKey, 'today');
  assert.equal(all.find(i => i.slug === 'soon-film').filmKey, null);
  assert.ok(all.find(i => i.slug === 'not-mine')); // unmatched films stay in the view
  // same morning again: nothing to do
  const again = await refreshCinema({ source, cache: r.cache, summaries: refreshLib, nowMs: MORNING + H });
  assert.equal(again.skipped, true);
  assert.equal(again.requests, 0);
  assert.equal(source.calls.length, 6);
});

test('refreshCinema: pages read since the last rebuild are skipped, others are read, force reads all, sessionless films wait 3 days', async () => {
  const mkSource = () => fakeSource({
    sitemap: ['today-film', 'dune-example-part-three', 'soon-film'],
    pages: { 'today-film': { sessions: sess('2026-10-30T18:00') } },
  });
  const s1 = mkSource();
  const r1 = await refreshCinema({ source: s1, summaries: refreshLib, nowMs: MORNING });
  assert.equal(r1.fetched, 3);
  // next morning (due): today-film and soon-film were read before the 06:00 rebuild, dune has no sessions and starts in December: not re-read for 3 days
  const NEXT = MORNING + 24 * H;
  const s2 = mkSource();
  const r2 = await refreshCinema({ source: s2, cache: r1.cache, summaries: refreshLib, nowMs: NEXT });
  assert.deepEqual(s2.calls.filter(c => c.startsWith('/movie')), ['/movie/today-film/']);
  // soon-film has no sessions and no first date and was read yesterday: also waits
  assert.equal(r2.fetched, 1);
  const s3 = mkSource();
  const r3 = await refreshCinema({ source: s3, cache: r2.cache, summaries: refreshLib, nowMs: MORNING + 4 * 24 * H });
  assert.equal(r3.fetched, 3);
  const s4 = mkSource();
  const r4 = await refreshCinema({ source: s4, cache: r3.cache, summaries: refreshLib, nowMs: MORNING + 4 * 24 * H + H, force: true });
  assert.equal(r4.fetched, 3);
});

test('refreshCinema: a first date within 3 days is read daily even with no sessions', async () => {
  const src = () => fakeSource({ sitemap: ['dune-example-part-three'], pages: { 'dune-example-part-three': { firstDate: '2026-10-31', directors: ['Dena Vilas'] } } });
  const r1 = await refreshCinema({ source: src(), summaries: refreshLib, nowMs: MORNING });
  const s2 = src();
  const r2 = await refreshCinema({ source: s2, cache: r1.cache, summaries: refreshLib, nowMs: MORNING + 24 * H });
  assert.equal(r2.fetched, 1);
});

test('refreshCinema budget: maxFilms caps the pages and marks the run incomplete, the next run finishes the rest', async () => {
  const lib3 = ['a', 'b', 'c'].map(k => sum(k, 'Film ' + k.toUpperCase(), 2026, { watchlist: true }));
  const source = fakeSource({ sitemap: ['film-a', 'film-b', 'film-c'] });
  const r = await refreshCinema({ source, summaries: lib3, nowMs: MORNING, maxFilms: 2 });
  assert.equal(r.fetched, 2);
  assert.equal(r.cache.incomplete, true);
  assert.equal(needsRefresh(r.cache, MORNING + H), false);
  assert.equal(needsRefresh(r.cache, MORNING + 4 * H), true);
  const s2 = fakeSource({ sitemap: ['film-a', 'film-b', 'film-c'] });
  const r2 = await refreshCinema({ source: s2, cache: r.cache, summaries: lib3, nowMs: MORNING + 4 * H, maxFilms: 2 });
  assert.deepEqual(s2.calls.filter(c => c.startsWith('/movie')), ['/movie/film-c/']);
  assert.equal(r2.cache.incomplete, false);
});

test('refreshCinema: events are not read as library candidates', async () => {
  const source = fakeSource({
    sitemap: ['movie-trivia-at-the-den', 'nt-live-example-play'],
    comingSoon: [{ slug: 'movie-trivia-at-the-den', title: 'Movie Trivia at The Den' }, { slug: 'nt-live-example-play', title: 'NT Live: Example Play' }],
  });
  const r = await refreshCinema({ source, summaries: [sum('t', 'Movie Trivia at The Den', 2026), sum('p', 'Example Play', 2026)], nowMs: MORNING });
  assert.equal(r.fetched, 0);
  assert.equal(r.cache.films['nt-live-example-play'].kind, 'event');
  assert.equal(r.cache.films['movie-trivia-at-the-den'].kind, 'event');
});

test('refreshCinema: a block stops everything and keeps the old data; a failed side list is only noted', async () => {
  const blocked = Object.assign(new Error('no'), { code: 'blocked', status: 429 });
  const old = mergeCache(null, [entry('a')], {}, 1000, { sitemapRead: true });
  const r = await refreshCinema({ source: fakeSource({ errors: { now: blocked } }), cache: old, nowMs: MORNING });
  assert.equal(r.error, 'blocked');
  assert.equal(r.cache.films.a.slug, 'a');
  assert.equal(r.cache.fetchedAt, 1000);
  assert.equal(r.requests, 1);
  assert.equal(needsRefresh(r.cache, MORNING + 2 * H), false);
  assert.equal(needsRefresh(r.cache, MORNING + 4 * H), true);
  // blocked on the sitemap after the other lists worked: stop, no film pages
  const s2 = fakeSource({ errors: { sitemap: blocked } });
  const r2 = await refreshCinema({ source: s2, summaries: refreshLib, nowMs: MORNING });
  assert.equal(r2.error, 'blocked');
  assert.deepEqual(s2.calls, ['now', 'coming', 'sitemap']);
  // blocked on a film page: stop after it, keep the roster
  const s3 = fakeSource({ sitemap: ['today-film', 'soon-film'], errors: { '/movie/today-film/': blocked } });
  const r3 = await refreshCinema({ source: s3, summaries: refreshLib, nowMs: MORNING });
  assert.equal(r3.error, 'blocked');
  assert.equal(s3.calls.filter(c => c.startsWith('/movie')).length, 1);
  assert.equal(Object.keys(r3.cache.films).length, 2);
  assert.equal(r3.cache.incomplete, true);
  // the sitemap changed shape: carry on with the other lists and say so
  const s4 = fakeSource({ comingSoon: [{ slug: 'today-film', title: 'Today Film' }], pages: { 'today-film': { directors: ['Pat Example'] } } });
  const r4 = await refreshCinema({ source: s4, summaries: refreshLib, nowMs: MORNING });
  assert.equal(r4.error, null);
  assert.deepEqual(r4.partial, ['sitemap']);
  assert.equal(r4.fetched, 1);
  // every list failed with a plain error
  const bad = Object.assign(new Error('x'), { code: 'changed' });
  const r5 = await refreshCinema({ source: fakeSource({ errors: { now: bad, coming: bad } }), nowMs: MORNING });
  assert.equal(r5.error, 'changed');
  assert.equal(r5.fetched, 0);
  // aborted before it starts
  const ac = new AbortController(); ac.abort();
  const r6 = await refreshCinema({ source: fakeSource({}), signal: ac.signal, nowMs: MORNING });
  assert.equal(r6.error, 'aborted');
});

test('parse + match end to end on the synthetic list page', () => {
  const films = parseListing(fx('dendy-now-showing.html')).films;
  const l = films.map(f => ({ ...f }));
  const library = [sum('cafe', 'Cafe Lumiere', 1993, { runtime: 125 }), sum('ferry', 'Night Ferry', 2026, { runtime: 130 })];
  const m = matchToLibrary(l, library, { todayYear: 2026 });
  assert.deepEqual(m.map(x => x.filmKey), [null, 'cafe', null, 'ferry']);
  assert.equal(m[1].matchedBy, 'title+runtime');
});
