import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toSydney, parseRoster, parseShowings, parseConfig, bookingUrl, ALMOST_SOLD_OUT_SEATS } from '../../core/parse/dendy.js';
import { createDendySource, isAllowedPath, GRAPHQL_HEADERS, HOST_RECOMMENDED } from '../../core/sources/dendy.js';
import { refreshCinema, needsRefresh, buildCinemaView, listingsFromCache, mergeGraphqlCache } from '../../core/features/cinema.js';

// Fixtures are SYNTHETIC (invented films, real field structure).
const fxJson = n => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8'));
const fxText = n => readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8');
const H = 3600e3;
const MORNING = Date.parse('2026-10-28T20:30:00Z'); // 2026-10-29 07:30 Sydney
const sum = (key, title, year, { runtime, watched = false, watchlist = false, dir = [] } = {}) =>
  ({ key, title, year, runtime, directors: dir.map((name, i) => ({ id: 'p' + i, name })), user: { watched, watchlist } });

const names = parseConfig(fxJson('dendy-graphql-config.json'));

test('Sydney conversion: midnight session, and both daylight-saving changes', () => {
  assert.deepEqual(toSydney('2026-12-15T13:01:00Z'), { date: '2026-12-16', time: '00:01' }); // 12:01 am, next calendar day
  assert.deepEqual(toSydney('2026-12-15T12:59:00Z'), { date: '2026-12-15', time: '23:59' });
  // DST ends first Sunday of April: 3:00 am AEDT becomes 2:00 am AEST at 16:00Z on the Saturday
  assert.deepEqual(toSydney('2027-04-03T15:59:00Z'), { date: '2027-04-04', time: '02:59' });
  assert.deepEqual(toSydney('2027-04-03T16:00:00Z'), { date: '2027-04-04', time: '02:00' });
  assert.deepEqual(toSydney('2027-04-04T01:30:00Z'), { date: '2027-04-04', time: '11:30' }); // +10 afterwards
  // DST starts first Sunday of October: 2:00 am AEST becomes 3:00 am AEDT
  assert.deepEqual(toSydney('2027-10-02T15:59:00Z'), { date: '2027-10-03', time: '01:59' });
  assert.deepEqual(toSydney('2027-10-02T16:00:00Z'), { date: '2027-10-03', time: '03:00' });
  assert.equal(toSydney('nonsense'), null);
});

test('parseShowings: Sydney times, end, screens, badges, sold out; unpublished and private rows are dropped', () => {
  const r = parseShowings(fxJson('dendy-graphql-showings.json'), names);
  assert.equal(r.ok, true);
  assert.equal(r.unchanged, false);
  assert.equal(r.truncated, false);
  assert.equal(r.resultVersion, '2000000002');
  const orchard = r.movies['90001'];
  // rows 910005 (private) and 910006 (not published) are gone
  assert.deepEqual(orchard.sessions.map(s => s.id), ['910002', '910003', '910004']);
  const [mid, almost, sold] = orchard.sessions;
  assert.deepEqual([mid.date, mid.time], ['2026-12-16', '00:01']);
  assert.equal(mid.endTime, '02:31'); // 150 min later
  assert.equal(mid.end, '2026-12-15T15:31:00.000Z');
  assert.equal(mid.screen, 'Cinema 1');
  assert.equal(mid.bookingUrl, 'https://newtown.dendy.com.au/checkout/showing/the-glass-orchard/910002/');
  assert.equal(mid.soldOut, undefined);
  assert.equal(mid.almostSoldOut, undefined);
  assert.equal(mid.format, undefined); // "Reserved Seating" is dropped
  assert.equal(almost.almostSoldOut, true);
  assert.equal(almost.soldOut, undefined);
  assert.equal(almost.format, 'AD');
  assert.equal(sold.soldOut, true);
  assert.equal(sold.almostSoldOut, undefined);
  assert.deepEqual(sold.labels, ['Q&A']);
  assert.equal(orchard.runtimeMin, 150);
  assert.deepEqual(orchard.directors, ['Ada Quill']);
  const harbour = r.movies['90002'];
  assert.equal(harbour.title, 'Harbour Lights');
  assert.equal(harbour.label, "Director's Cut");
  assert.deepEqual(harbour.directors, ['Bo Merrin', 'Cass Vale']);
  assert.equal(harbour.sessions[0].time, '19:30'); // 08:30Z in November is +11
  assert.equal(ALMOST_SOLD_OUT_SEATS, 10);
});

test('parseShowings: past rows, drop-listed badges, unknown screens, daylight-saving end time', () => {
  const movie = { id: '1', name: 'Edge', urlSlug: 'edge', duration: 120, rating: 'M', directedBy: 'A B' };
  const row = (id, extra) => ({ id, time: '2027-04-03T15:00:00Z', screenId: '999', seatsRemaining: 50, published: true, private: false, past: false, showingBadgeIds: [], movie, ...extra });
  const body = rows => ({ data: { showingsForDate: { count: rows.length, resultVersion: 'v', data: rows } } });
  const cfg = { screens: {}, badges: { 1: '$13 Ticket', 2: 'Test', 3: 'zzzTest', 4: 'Reserved Seating', 5: '4K', 6: 'AD' } };
  const r = parseShowings(body([
    row('a', { showingBadgeIds: ['1', '2', '3', '4', '5', '6', '6', '77'] }),
    row('b', { past: true }),
    row('c', { time: 'garbage' }),
    row('d', { seatsRemaining: 10 }), row('e', { seatsRemaining: 11 }), row('f', { seatsRemaining: -1 }),
  ]), cfg);
  const s = r.movies['1'].sessions;
  assert.deepEqual(s.map(x => x.id), ['a', 'd', 'e', 'f']);
  assert.deepEqual(s[0].labels, ['4K', 'AD']);
  assert.equal(s[0].screen, undefined); // unknown screen id: nothing shown
  // 2027-04-03T15:00Z is 02:00 AEDT on 4 Apr; plus 120 min crosses the change: 17:00Z = 03:00 AEST
  assert.deepEqual([s[0].date, s[0].time, s[0].endTime], ['2027-04-04', '02:00', '03:00']);
  assert.deepEqual(s.map(x => [x.almostSoldOut, x.soldOut]), [[undefined, undefined], [true, undefined], [undefined, undefined], [undefined, true]]);
});

test('parseShowings: unchanged reply, error replies and odd shapes', () => {
  assert.deepEqual(parseShowings(fxJson('dendy-graphql-unchanged.json')), { ok: true, unchanged: true, resultVersion: '2000000002' });
  const e = parseShowings(fxJson('dendy-graphql-error.json'));
  assert.equal(e.ok, false);
  assert.match(e.error, /Site that does not exist/);
  assert.equal(parseShowings({ data: null, errors: [{ message: 'boom' }] }).error, 'boom');
  assert.equal(parseShowings({ data: { showingsForDate: { data: null, count: null, resultVersion: null } } }).ok, false); // null with no version is not "unchanged"
  assert.equal(parseShowings(null).ok, false);
  assert.equal(parseShowings({ data: { showingsForDate: { data: 'x' } } }).ok, false);
  assert.equal(parseShowings({ data: { showingsForDate: { count: 0, resultVersion: 'v', data: [] } } }).ok, true); // an empty day is fine
});

test('parseShowings: 300 sessions means the reply was cut', () => {
  const movie = { id: '1', name: 'Big', urlSlug: 'big', duration: 90 };
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: String(i), time: '2026-12-01T01:00:00Z', published: true, private: false, past: false, movie }));
  const r = parseShowings({ data: { showingsForDate: { count: 300, resultVersion: 'v', data: rows } } });
  assert.equal(r.truncated, true);
  assert.equal(r.movies['1'].sessions.length, 300);
  const under = parseShowings({ data: { showingsForDate: { count: 299, resultVersion: 'v', data: rows.slice(1) } } });
  assert.equal(under.truncated, false);
});

test('parseRoster and parseConfig', () => {
  const r = parseRoster(fxJson('dendy-graphql-movies.json'), { list: 'coming-soon' });
  assert.equal(r.ok, true);
  assert.equal(r.resultVersion, '1000000001');
  assert.deepEqual(r.films.map(f => f.dendyId), ['90001', '90002', '90003', '90004']);
  const h = r.films[1];
  assert.deepEqual([h.slug, h.title, h.label, h.runtimeMin, h.firstDate, h.status, h.showingCount, h.inList], ['harbour-lights---directors-cut', 'Harbour Lights', "Director's Cut", 101, '2026-11-20', 'On Sale', 1, 'coming-soon']);
  assert.deepEqual(h.directors, ['Bo Merrin', 'Cass Vale']);
  assert.equal(r.films[3].firstDate, null);
  assert.equal(parseRoster(fxJson('dendy-graphql-error.json')).ok, false);
  assert.equal(parseRoster({ data: { movies: { data: {} } } }).ok, false);
  assert.equal(parseRoster({ data: { movies: { count: 1, data: [{ id: '5', name: 'Quiz Night', urlSlug: 'quiz', rating: 'E' }] } } }).films[0].kind, 'event');
  assert.equal(names.ok, true);
  assert.equal(names.screens['111'], 'Dendy Lounge');
  assert.equal(names.badges['64'], 'Q&A');
  assert.equal(parseConfig(fxJson('dendy-graphql-error.json')).ok, false);
  assert.equal(bookingUrl('x', 5), 'https://newtown.dendy.com.au/checkout/showing/x/5/');
});

// ---- the source, against a fake http ----

const rosterReply = (films, version = 'r1') => ({ data: { movies: { count: films.length, resultVersion: version, data: films } } });
const movie = (id, name, extra = {}) => ({ id, name, urlSlug: name.toLowerCase().replace(/\W+/g, '-'), duration: 100, rating: 'M', directedBy: 'Some One', showingCount: 1, dateOfFirstShowing: '2026-01-01', showingStatus: 'Now Playing', ...extra });
const row = (id, m, time, extra = {}) => ({ id, time, screenId: '108', seatsRemaining: 100, published: true, private: false, past: false, showingBadgeIds: [], movie: { id: m.id, name: m.name, urlSlug: m.urlSlug, duration: m.duration, rating: m.rating, directedBy: m.directedBy, dateOfFirstShowing: m.dateOfFirstShowing, showingStatus: m.showingStatus }, ...extra });
const showReply = (rows, version = 's1') => ({ data: { showingsForDate: { count: rows.length, resultVersion: version, data: rows } } });

/** A fake http.text: `handler(vars, query, call)` returns the JSON body (or {status, body}) for each POST /graphql. */
function fakeHttp(handler, pages = {}) {
  const calls = [];
  return {
    calls,
    async text(url, opts = {}) {
      calls.push({ url, ...opts });
      if (url.endsWith('/graphql')) {
        const { query, variables } = JSON.parse(opts.body);
        const out = handler(variables, query, calls.length);
        const status = out?.status ?? 200;
        return { status, text: JSON.stringify(out?.status ? out.body : out) };
      }
      const path = new URL(url).pathname;
      if (pages[path] != null) return { status: 200, text: pages[path] };
      return { status: 404, text: '' };
    },
  };
}
const kindOf = (q) => (q.includes('movies(') ? 'movies' : q.includes('showingsForDate') ? 'showings' : q.includes('addOrUpdateClientConfig') ? 'config' : 'other');

test('source: the four queries, the two headers, only the two list types, POST /graphql only', async () => {
  const http = fakeHttp((vars, q) => kindOf(q) === 'movies' ? rosterReply([movie('1', 'Alpha')]) : fxJson('dendy-graphql-config.json'));
  const src = createDendySource({ http, priority: 2 });
  const r = await src.fetchRoster();
  assert.equal(r.requests, 2);
  assert.deepEqual(http.calls.map(c => JSON.parse(c.body).variables.type), ['coming-soon', 'now-playing']);
  for (const c of http.calls) {
    assert.equal(c.url, 'https://newtown.dendy.com.au/graphql');
    assert.equal(c.method, 'POST');
    assert.equal(c.headers['site-id'], '36');
    assert.equal(c.headers['client-type'], 'consumer');
    assert.equal(c.priority, 2);
  }
  assert.deepEqual(r.films.map(f => [f.dendyId, f.lists]), [['1', ['coming-soon', 'now-playing']]]);
  const cfg = await src.fetchConfig();
  assert.equal(cfg.screens['108'], 'Cinema 1');
  assert.equal(GRAPHQL_HEADERS['site-id'], '36');
  assert.deepEqual(HOST_RECOMMENDED['newtown.dendy.com.au'], { concurrency: 1, gap: 1800 });
  // the page reader still refuses /graphql, checkout and ahoy
  for (const no of ['/graphql', '/ahoy/events', '/checkout/showing/a/1/']) assert.equal(isAllowedPath(no), false);
  await assert.rejects(src.fetchFilm('/graphql'), { code: 'forbidden' });
});

test('source: sessions are batched by showingCount and a cut reply is split in half and asked again', async () => {
  const films = Array.from({ length: 8 }, (_, i) => movie(String(i + 1), 'Film ' + (i + 1)));
  const sessionsOf = m => Array.from({ length: 60 }, (_, i) => row(m.id + '-' + i, m, `2026-12-${String(1 + (i % 28)).padStart(2, '0')}T01:00:00Z`));
  // Batches by count: 4 films of 60 -> 240 per batch (<= 250), so 2 requests for 8 films.
  const http = fakeHttp(vars => showReply(vars.movieIds.flatMap(id => sessionsOf(films[+id - 1])), 'v' + vars.movieIds.join('')));
  const src = createDendySource({ http });
  const r = await src.fetchSessions(films.map(f => ({ id: f.id, showingCount: 60 })), {});
  assert.equal(r.requests, 2);
  assert.deepEqual(http.calls.map(c => JSON.parse(c.body).variables.movieIds.length), [4, 4]);
  assert.equal(r.fetched.length, 8);
  assert.equal(r.movies['3'].sessions.length, 60);

  // Counts that lie (showingCount 1 each) make one big request of 480 sessions: Dendy cuts it at 300, so it is split until it fits.
  const cut = fakeHttp(vars => {
    const rows = vars.movieIds.flatMap(id => sessionsOf(films[+id - 1]));
    const sent = rows.slice(0, 300);
    return { data: { showingsForDate: { count: sent.length, resultVersion: 'x' + vars.movieIds.join(''), data: sent } } };
  });
  const r2 = await createDendySource({ http: cut }).fetchSessions(films.map(f => ({ id: f.id, showingCount: 1 })), {});
  const sizes = cut.calls.map(c => JSON.parse(c.body).variables.movieIds.length);
  assert.deepEqual(sizes, [8, 4, 4]);
  assert.equal(r2.fetched.length, 8);
  assert.deepEqual(r2.cut, []);
  for (const f of films) assert.equal(r2.movies[f.id].sessions.length, 60, f.name);
  assert.equal(Object.keys(r2.versions).length, 2); // the cut parent reply has no version stored

  // A single film that still hits the limit is reported as cut
  const one = fakeHttp(vars => showReply(Array.from({ length: 300 }, (_, i) => row('s' + i, films[0], '2026-12-01T01:00:00Z'))));
  const r3 = await createDendySource({ http: one }).fetchSessions([{ id: '1', showingCount: 400 }], {});
  assert.deepEqual(r3.cut, ['1']);
});

test('source: the previous resultVersion is sent per request shape; an unchanged reply keeps the old sessions', async () => {
  const f = movie('1', 'Alpha');
  const http = fakeHttp(vars => vars.resultVersion === 'same' ? { data: { showingsForDate: { data: null, count: null, resultVersion: 'same' } } } : showReply([row('1', f, '2026-12-01T01:00:00Z')], 'new'));
  const src = createDendySource({ http });
  const a = await src.fetchSessions([{ id: '1' }], { versions: { 1: 'same' } });
  assert.deepEqual(a.unchanged, ['1']);
  assert.deepEqual(a.fetched, []);
  assert.equal(JSON.parse(http.calls[0].body).variables.resultVersion, 'same');
  const b = await src.fetchSessions([{ id: '1' }], { versions: { 2: 'same' } }); // a different shape: nothing sent
  assert.equal(JSON.parse(http.calls[1].body).variables.resultVersion, undefined);
  assert.deepEqual(b.versions, { 1: 'new' });
});

test('source: errors map to blocked / http / changed', async () => {
  const mk = (out, status) => createDendySource({ http: { text: async () => ({ status: status || 200, text: typeof out === 'string' ? out : JSON.stringify(out) }) } });
  await assert.rejects(mk('', 429).fetchRoster(), { code: 'blocked', status: 429 });
  await assert.rejects(mk('', 403).fetchConfig(), { code: 'blocked' });
  await assert.rejects(mk('<html>', 500).fetchRoster(), { code: 'http' });
  await assert.rejects(mk('<html>').fetchRoster(), { code: 'changed' });
  await assert.rejects(mk(fxJson('dendy-graphql-error.json'), 400).fetchRoster(), { code: 'changed' });
  await assert.rejects(mk({ data: null, errors: [{ message: 'x' }] }).fetchSessions([{ id: '1' }]), { code: 'changed' });
  const thrown = createDendySource({ http: { text: async () => { throw Object.assign(new Error('x'), { status: 429 }); } } });
  await assert.rejects(thrown.fetchRoster(), { code: 'blocked' });
});

// ---- the whole refresh ----

const lib = [
  sum('orchard', 'The Glass Orchard', 2026, { runtime: 150, watchlist: true, dir: ['Ada Quill'] }),
  sum('harbour', 'Harbour Lights', 1994, { runtime: 101, watched: true, dir: ['Zed Other'] }), // same title, other director: not this film
  sum('moons', 'Paper Moons', 1973, { runtime: 102, dir: ['Peter Bogdanovich'] }), // title matches, runtime and director do not
];

/** Dendy fake: coming-soon gets `coming`, now-playing `playing`, a day query `day`, and sessions are looked up by film id. */
function dendyFake({ coming = [], playing = [], day = [], sessions = {}, config = fxJson('dendy-graphql-config.json'), versions = {} } = {}) {
  const log = { movies: [], showings: [], config: 0 };
  const handler = (vars, q) => {
    const k = kindOf(q);
    if (k === 'config') { log.config++; return config; }
    if (k === 'movies') { log.movies.push(vars.type); return rosterReply(vars.type === 'coming-soon' ? coming : playing); }
    if (vars.date) { log.showings.push('day:' + vars.date); return showReply(day, 'day1'); }
    log.showings.push(vars.movieIds.join(','));
    const key = [...vars.movieIds].sort().join(',');
    if (vars.resultVersion && vars.resultVersion === versions[key]) return { data: { showingsForDate: { data: null, count: null, resultVersion: vars.resultVersion } } };
    return showReply(vars.movieIds.flatMap(id => sessions[id] || []), versions[key] || 'sv-' + key);
  };
  return { http: fakeHttp(handler), log };
}

test('refreshCinema (Dendy data): matches on director and runtime, fetches only what matters, keeps every session', async () => {
  const orchard = movie('90001', 'The Glass Orchard', { duration: 150, directedBy: 'Ada Quill', dateOfFirstShowing: '2026-12-16', showingStatus: 'On Sale', showingCount: 63 });
  const harbour = movie('90002', 'Harbour Lights', { duration: 101, directedBy: 'Bo Merrin', dateOfFirstShowing: '2026-12-20', showingStatus: 'On Sale', showingCount: 2 });
  const moons = movie('90003', 'Paper Moons', { duration: 118, directedBy: 'Ada Quill', dateOfFirstShowing: '2027-02-04', showingStatus: 'Coming Soon', showingCount: 0 });
  const now1 = movie('90010', 'Playing Now', { showingCount: 3 });
  const soon1 = movie('90011', 'Opens Friday', { dateOfFirstShowing: '2026-11-02', showingStatus: 'On Sale', showingCount: 2 });
  const straggler = movie('90020', 'Bicycle Example', { showingCount: null });
  const many = Array.from({ length: 63 }, (_, i) => row('o' + i, orchard, new Date(Date.parse('2026-12-15T13:01:00Z') + i * 4 * H).toISOString()));
  const { http, log } = dendyFake({
    coming: [orchard, harbour, moons, soon1], playing: [now1],
    day: [row('d1', straggler, '2026-10-29T08:00:00Z'), row('d2', now1, '2026-10-29T09:00:00Z')],
    sessions: {
      90001: many, 90010: [row('n1', now1, '2026-10-30T08:00:00Z')], 90011: [row('f1', soon1, '2026-11-02T08:00:00Z')],
      90020: [row('b1', straggler, '2026-10-29T08:00:00Z'), row('b2', straggler, '2026-11-03T08:00:00Z')],
    },
  });
  const source = createDendySource({ http });
  const r = await refreshCinema({ source, summaries: lib, nowMs: MORNING });
  assert.equal(r.error, null);
  assert.deepEqual(r.partial, []);
  assert.equal(r.cache.version, 3);
  assert.equal(r.cache.source, 'graphql');
  assert.deepEqual(log.movies, ['coming-soon', 'now-playing']);
  assert.equal(log.config, 1);
  // Sessions asked for: the matched Glass Orchard, the film now playing, the one opening within a week, and the straggler found on today's day.
  // Not asked for: Harbour Lights (title matches but the director does not), Paper Moons (nothing booked).
  const asked = log.showings.filter(x => !x.startsWith('day:')).join(',').split(',').sort();
  assert.deepEqual(asked, ['90001', '90010', '90011', '90020']);
  assert.deepEqual(log.showings.filter(x => x.startsWith('day:')), ['day:2026-10-29']);
  assert.equal(r.requests, 2 + 1 + 1 + 1);
  assert.equal(r.fetched, 4);
  const films = r.cache.films;
  assert.equal(films['the-glass-orchard'].sessions.length, 63); // all kept in the cache
  assert.equal(films['the-glass-orchard'].dendyId, '90001');
  assert.equal(films['the-glass-orchard'].sessions[0].time, '00:01');
  assert.equal(films['the-glass-orchard'].sessions[0].screen, 'Cinema 1');
  assert.equal(films['harbour-lights'].sessions.length, 0);
  assert.equal(films['bicycle-example'].fromDay, '2026-10-29');
  assert.ok(r.cache.config.screens['108']);
  assert.ok(Object.keys(r.cache.resultVersions).length >= 2);

  // The view: sessions capped at 6 plus the count, grouped by Sydney date; only the director-matched film is linked to the library.
  const v = buildCinemaView({ listings: listingsFromCache(r.cache), summaries: lib, nowMs: MORNING, fetchedAt: r.cache.fetchedAt });
  const all = v.groups.flatMap(g => g.items);
  const o = all.find(i => i.slug === 'the-glass-orchard');
  assert.equal(o.filmKey, 'orchard');
  assert.equal(o.sessionCount, 63);
  assert.equal(o.sessions.length, 6);
  assert.equal(o.days[0].date, '2026-12-16');
  assert.equal(o.days.reduce((n, d) => n + d.sessions.length, 0), 6);
  assert.equal(all.find(i => i.slug === 'harbour-lights').filmKey, null); // title matches but the director does not
  assert.equal(all.find(i => i.slug === 'paper-moons').filmKey, null); // title matches but nothing else does
  const pm = all.find(i => i.slug === 'paper-moons');
  assert.deepEqual([pm.hasSessions, pm.firstDate, pm.next], [false, '2027-02-04', '2027-02-04']); // "From <date>"
  assert.equal(all.find(i => i.slug === 'bicycle-example').sessionCount, 2);
  assert.equal(v.fetchedAt, r.cache.fetchedAt);

  // Same hour again: not due. After 4 hours: due; Dendy says nothing changed for the matched film, so its sessions stay.
  assert.equal((await refreshCinema({ source, cache: r.cache, summaries: lib, nowMs: MORNING + H })).skipped, true);
  const versions = r.cache.resultVersions;
  const second = dendyFake({ coming: [orchard, harbour, moons, soon1], playing: [now1], day: [row('d1', straggler, '2026-10-29T08:00:00Z')], sessions: {}, versions: Object.fromEntries(Object.entries(versions).filter(([k]) => !k.startsWith('day:'))) });
  const r2 = await refreshCinema({ source: createDendySource({ http: second.http }), cache: r.cache, summaries: lib, nowMs: MORNING + 5 * H });
  assert.equal(r2.error, null);
  assert.equal(r2.cache.films['the-glass-orchard'].sessions.length, 63);
  assert.equal(r2.cache.films['bicycle-example'].sessions.length, 2);
  assert.equal(r2.cache.fetchedAt, MORNING + 5 * H);
});

test('refreshCinema (Dendy data): a matched film is found by runtime when the director is missing', async () => {
  const noDir = movie('1', 'The Glass Orchard', { directedBy: '', duration: 148, showingCount: 2, dateOfFirstShowing: '2027-03-01' });
  const far = movie('2', 'The Glass Orchard', { urlSlug: 'glass-orchard-other', directedBy: '', duration: 95, showingCount: 2, dateOfFirstShowing: '2027-03-01' });
  const { http, log } = dendyFake({ coming: [noDir, far], sessions: { 1: [row('a', noDir, '2027-03-01T08:00:00Z')] } });
  const r = await refreshCinema({ source: createDendySource({ http }), summaries: [sum('o', 'The Glass Orchard', 1990, { runtime: 150 })], nowMs: MORNING });
  assert.deepEqual(log.showings.filter(x => !x.startsWith('day:')), ['1']); // 148 is within 10 minutes of 150, 95 is not
  assert.equal(r.cache.films['the-glass-orchard'].dendyId, '1');
});

test('refreshCinema: Dendy data failing falls back to the plain pages and says so; a block does not', async () => {
  const pages = { '/now-showing/': fxText('dendy-now-showing.html'), '/coming-soon/': fxText('dendy-coming-soon.html'), '/sitemap.xml': fxText('dendy-sitemap.xml'), '/movie/the-velvet-orchard/': fxText('dendy-film.html') };
  const bad = fakeHttp(() => ({ status: 400, body: fxJson('dendy-graphql-error.json') }), pages);
  const r = await refreshCinema({ source: createDendySource({ http: bad }), summaries: [], nowMs: MORNING });
  assert.equal(r.error, null);
  assert.deepEqual(r.partial, ['graphql']);
  assert.equal(r.cache.source, 'pages');
  assert.equal(r.cache.fellBack, true);
  assert.ok(Object.keys(r.cache.films).length > 0);
  assert.ok(r.requests >= 4); // the failed call plus the pages
  assert.equal(r.cache.config, undefined);
  assert.deepEqual(r.cache.resultVersions, {});
  // fallback items have the same shape as Dendy-data items
  const v = buildCinemaView({ listings: listingsFromCache(r.cache), summaries: [], today: '2026-10-29', now: '2026-10-29T07:30' });
  const item = v.groups.flatMap(g => g.items)[0];
  for (const k of ['title', 'slug', 'kind', 'next', 'hasSessions', 'sessions', 'sessionCount', 'days', 'url']) assert.ok(k in item, k);
  // three hours later Dendy's own data is tried again
  assert.equal(needsRefresh(r.cache, MORNING + 2 * H), false);
  assert.equal(needsRefresh(r.cache, MORNING + 3 * H + 1), true);

  // a block (429) is not a reason to hit the pages: stop and keep the old data
  const blocked = fakeHttp(() => ({ status: 429, body: {} }), pages);
  const old = mergeGraphqlCache(null, [{ slug: 'a', dendyId: '1', title: 'A' }], {}, 1000);
  const b = await refreshCinema({ source: createDendySource({ http: blocked }), cache: old, summaries: [], nowMs: MORNING });
  assert.equal(b.error, 'blocked');
  assert.equal(blocked.calls.filter(c => !c.url.endsWith('/graphql')).length, 0);
  assert.equal(b.cache.films.a.dendyId, '1');
  assert.equal(b.cache.fetchedAt, 1000);
  // fallback fails too: its error is returned
  const none = fakeHttp(() => ({ status: 400, body: fxJson('dendy-graphql-error.json') }), {});
  const both = await refreshCinema({ source: createDendySource({ http: none }), summaries: [], nowMs: MORNING });
  assert.equal(both.error, 'http');
});

test('needsRefresh (Dendy data): first look of the Sydney day, then every 4 hours; a failed try waits 3 hours', () => {
  const at = ms => ({ version: 3, source: 'graphql', fetchedAt: ms, films: {} });
  const noon = Date.parse('2026-10-29T01:00:00Z'); // 12:00 Sydney
  assert.equal(needsRefresh(at(noon), noon + 3 * H + 59 * 60000), false);
  assert.equal(needsRefresh(at(noon), noon + 4 * H), true);
  // 23:30 the evening before, now 00:10 Sydney: new day, so look again
  const lateYesterday = Date.parse('2026-10-29T12:30:00Z'); // 23:30 Sydney on the 29th
  assert.equal(needsRefresh(at(lateYesterday), lateYesterday + 40 * 60000), true);
  assert.equal(needsRefresh(at(lateYesterday), lateYesterday + 20 * 60000), false); // 23:50, same day
  // before 07:00 is no longer a reason to wait: the first open of the day reads
  const early = Date.parse('2026-10-28T18:30:00Z'); // 05:30 Sydney on the 29th
  assert.equal(needsRefresh(at(early - 8 * H), early), true);
  // failed try: wait 3 h, then retry even though the data is only an hour old by fetchedAt
  assert.equal(needsRefresh({ ...at(noon - 25 * H), triedAt: noon }, noon + 2 * H), false);
  assert.equal(needsRefresh({ ...at(noon - 25 * H), triedAt: noon }, noon + 3 * H), true);
  assert.equal(needsRefresh({ version: 2, fetchedAt: noon, films: {} }, noon + 1), true); // old cache shape
});

test('parseShowings: a missing config (null) still parses', () => {
  const r = parseShowings(fxJson('dendy-graphql-showings.json'), null);
  assert.equal(r.ok, true);
});
