// Discover, filmography and series tests against a fake network built from test/fixtures/synthetic/features-graph.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { discover, lovedPeople } from '../../core/features/discover.js';
import { filmography } from '../../core/features/filmography.js';
import { series } from '../../core/features/series.js';
import { personFilms, seriesMembers, filmBasics } from '../../core/features/wikidata-graph.js';

const FX = JSON.parse(readFileSync(new URL('../fixtures/synthetic/features-graph.json', import.meta.url), 'utf8'));
const uri = q => ({ value: `http://www.wikidata.org/entity/${q}` });
const lit = x => ({ value: String(x) });

function rowFor(r, extra = {}) {
  const b = { film: uri(r.film), title: lit(r.title), date: lit(r.date), types: lit(r.types.join('|')), ...extra };
  if (r.imdb) b.im = lit(r.imdb);
  if (r.wiki) b.w = lit(r.wiki);
  if (r.runtime) b.run = lit(r.runtime);
  return b;
}

/** A fake core/net.js http. Counts calls by kind. */
function fakeNet({ ratings = true } = {}) {
  const calls = { sparql: 0, ratings: 0, wiki: 0, queries: [] };
  const sparql = query => {
    calls.sparql++;
    calls.queries.push(query);
    const bindings = [];
    if (query.includes('Q1983062')) {
      for (const q of FX.episodeTypes || []) if (query.includes(`wd:${q}`)) bindings.push({ t: uri(q) });
    } else if (query.includes('wdt:P279*') && !query.includes('?series')) {
      for (const q of FX.subclassesOfFilm) if (query.includes(`wd:${q}`)) bindings.push({ t: uri(q), root: uri('Q11424') });
    } else if (query.includes('?series ?film')) {
      for (const r of FX.seriesMembers) if (query.includes(`wd:${r.series}`)) bindings.push({ ...rowFor(r), series: uri(r.series), sname: lit(r.sname), ...(r.ord ? { ord: lit(r.ord) } : {}) });
    } else if (query.includes('?dn')) {
      const ids = [...new Set(FX.personFilms.map(r => r.film))].filter(q => query.includes(`wd:${q} `) || query.includes(`wd:${q}}`));
      for (const q of ids) {
        const r = FX.personFilms.find(x => x.film === q);
        bindings.push({ ...rowFor(r), dirs: lit('Alice Ant|Dana Dog'), genres: lit('Drama|Comedy') });
      }
    } else {
      for (const r of FX.personFilms) if (query.includes(`wd:${r.person} `) || query.includes(`wd:${r.person}}`)) {
        bindings.push({ ...rowFor(r), person: uri(r.person), roles: lit(r.roles.join('|')) });
      }
    }
    return { results: { bindings } };
  };
  return {
    calls,
    async json(url, opts = {}) {
      if (url.startsWith('https://query.wikidata.org/')) return sparql(new URLSearchParams(opts.body).get('query'));
      if (url.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/')) {
        calls.wiki++;
        const title = decodeURIComponent(url.split('/').pop());
        if (title === 'Gamma_Dawn') return { type: 'standard', originalimage: { source: 'https://upload.wikimedia.org/wikipedia/en/a/ab/Gamma.jpg?utm_source=x', width: 500, height: 740 } };
        throw Object.assign(new Error('not found'), { status: 404 });
      }
      throw new Error(`unexpected ${url}`);
    },
    async response(url) {
      assert.match(url, /title\.ratings/);
      calls.ratings++;
      if (!ratings) return { ok: false, status: 500 };
      const bytes = gzipSync(Buffer.from(FX.ratings));
      return { ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) };
    },
  };
}

function fakeStore(films, userFilms) {
  const cache = {};
  return {
    films, library: { films: userFilms },
    cached(name, maxAge) { const c = cache[name]; return c && Date.now() - Date.parse(c.at) < maxAge ? c.value : undefined; },
    setCached(name, value) { cache[name] = { at: new Date().toISOString(), value }; return value; },
  };
}

const person = (name, qid) => ({ name, id: `p:${name.toLowerCase().replace(/\s+/g, '-')}`, sourceId: qid });
const ALICE = person('Alice Ant', 'wd:Q100'), DANA = person('Dana Dog', 'wd:Q300'), BOB = person('Bob Bee', 'wd:Q200'), CAROL = person('Carol Cat', 'tmdb:77');

function build() {
  // Alice and Dana are loved (high ratings), Bob is not (low), Carol has no Wikidata id.
  const specs = [
    ['A1', 'Alpha Road', 1990, ALICE, 9, 'Q1'], ['A2', 'Beta Night', 1995, ALICE, 10, 'Q2'], ['A3', 'Alpha Three', 1997, ALICE, 9, 'Q3'],
    ['D1', 'Dana One', 2000, DANA, 9, 'Q40'], ['D2', 'Dana Two', 2002, DANA, 9, 'Q41'],
    ['B1', 'Bob One', 2000, BOB, 3, null], ['B2', 'Bob Two', 2001, BOB, 3, null],
    ['C1', 'Carol One', 2000, CAROL, 10, null], ['C2', 'Carol Two', 2001, CAROL, 10, null],
    ['O1', 'Other One', 2000, person('Oz One', 'wd:Q501'), 5, null], ['O2', 'Other Two', 2000, person('Oz Two', 'wd:Q502'), 5, null],
    ['O3', 'Other Three', 2000, person('Oz Three', 'wd:Q503'), 5, null], ['O4', 'Other Four', 2000, person('Oz Four', 'wd:Q504'), 5, null],
  ];
  const films = {}, user = {}, summaries = [];
  for (const [key, title, year, p, rating, qid] of specs) {
    films[key] = { key, title, year, ids: qid ? { wikidata: qid } : {} };
    user[key] = { watched: true, rating };
    summaries.push({ key, title, year, ids: films[key].ids, poster: null, people: { director: [p] }, genres: [], user: { watched: true, rating, liked: false } });
  }
  // Orbit: two films watched (one matched by title + year only), part of the series Q900.
  films.S1 = { key: 'S1', title: 'Orbit', year: 1980, ids: {}, src: { wikidata: { collectionId: 'wd:Q900', collection: 'Orbit collection' } } };
  films.S2 = { key: 'S2', title: 'Orbit Two', year: 1984, ids: { wikidata: 'Q30' }, src: { wikidata: { collectionId: 'wd:Q900' } } };
  user.S1 = { watched: true, rating: 7 }; user.S2 = { watched: true, rating: 8 };
  summaries.push({ key: 'S1', title: 'Orbit', year: 1980, poster: { url: 'p1', thumb: 't1' }, people: {}, user: { watched: true, rating: 7 } });
  summaries.push({ key: 'S2', title: 'Orbit Two', year: 1984, poster: null, people: {}, user: { watched: true, rating: 8 } });
  // A watchlist film that discover must also treat as "in the library".
  films.W1 = { key: 'W1', title: 'Epsilon Ten', year: 2010, ids: {} };
  user.W1 = { watched: false, rating: null, watchlist: true };
  return { store: fakeStore(films, user), summaries };
}

const NOW = new Date('2026-10-21T00:00:00Z');

test('lovedPeople picks people you rate highly, with a Wikidata id and at least two rated films', () => {
  const { summaries } = build();
  const loved = lovedPeople(summaries);
  assert.deepEqual(loved.map(p => p.name).sort(), ['Alice Ant', 'Dana Dog']);
  const alice = loved.find(p => p.qid === 'Q100');
  assert.equal(alice.rated, 3);
  assert.equal(alice.average, '4.7');
});

test('personFilms returns kinds, learns unknown film subclasses and drops non-film items', async () => {
  const http = fakeNet();
  const m = await personFilms(http, ['wd:Q100']);
  const by = Object.fromEntries(m.get('Q100').map(f => [f.id, f]));
  assert.equal(by['wd:Q11'].kind, 'film');          // science fiction film learned as a film subclass
  assert.equal(by['wd:Q13'].kind, 'short');
  assert.equal(by['wd:Q15'], undefined);            // a painting
  assert.equal(by['wd:Q18'], undefined);            // an episode
  assert.equal(by['wd:Q12'].runtime, 95);
  assert.equal(by['wd:Q1'].year, 1990);
  assert.deepEqual(by['wd:Q2'].roles, ['director', 'writer']);
});

test('seriesMembers and filmBasics read the grouped rows', async () => {
  const http = fakeNet();
  const s = (await seriesMembers(http, ['Q900'])).get('Q900');
  assert.equal(s.name, 'Orbit');
  assert.equal(s.films.length, 4);
  assert.equal(s.films.find(f => f.id === 'wd:Q31').ordinal, 3);
  const b = (await filmBasics(http, ['Q10'])).get('Q10');
  assert.deepEqual(b.directors, ['Alice Ant', 'Dana Dog']);
  assert.deepEqual(b.genres, ['Drama', 'Comedy']);
});

test('discover: sections per loved person, library films and unreleased films excluded, ranked by rating and loved people', async () => {
  const { store, summaries } = build();
  const http = fakeNet();
  const steps = [];
  const d = await discover({ store, http, summaries, now: NOW, progress: (a, b) => steps.push([a, b]) });
  const alice = d.sections.find(s => s.id === 'person:Q100');
  assert.equal(alice.title, 'More from Alice Ant');
  assert.equal(alice.subtitle, "You've rated 3 of their films, 4.7★ on average");
  const titles = alice.items.map(i => i.title);
  assert.ok(!titles.includes('Alpha Road'), 'library film by Wikidata id');
  assert.ok(!titles.includes('Beta Night'), 'library film by title + year');
  assert.ok(!titles.includes('Epsilon Ten'), 'watchlist film counts as in the library');
  assert.ok(!titles.includes('Future Alpha'), 'unreleased');
  assert.ok(!titles.includes('Tiny Alpha'), 'short');
  assert.ok(!titles.includes('Alpha Painting'), 'not a film');
  assert.ok(!titles.includes('Zeta Acting'), 'cast roles are not asked for');
  // Gamma Dawn is co-directed by two loved people and rated 8.0: first.
  assert.deepEqual(titles, ['Gamma Dawn', 'Delta Shore']);
  const gamma = alice.items[0];
  assert.equal(gamma.id, 'wd:Q10');
  assert.equal(gamma.imdb.value, 8);
  assert.equal(gamma.poster.url, 'https://upload.wikimedia.org/wikipedia/en/a/ab/Gamma.jpg');
  assert.deepEqual(gamma.directors, ['Alice Ant', 'Dana Dog']);
  assert.match(gamma.reasons[0], /^Directed by Alice Ant, whose films you rate 4\.7★$/);
  assert.equal(gamma.links.letterboxd, 'https://letterboxd.com/imdb/tt0000010/');
  assert.equal(gamma.kind, 'film');
  const dana = d.sections.find(s => s.id === 'person:Q300');
  assert.deepEqual(dana.items.map(i => i.title), ['Gamma Dawn', 'Eta Hills']);
  assert.ok(!d.sections.some(s => /Bob|Carol/.test(s.title)));
  assert.equal(calls(http).ratings, 1, 'one pass over the ratings file');
  assert.equal(steps.at(-1)[0], steps.at(-1)[1], 'progress ends complete');
});
const calls = h => h.calls;

test('discover: finish the series lists unwatched members in order with a reason', async () => {
  const { store, summaries } = build();
  const d = await discover({ store, http: fakeNet(), summaries, now: NOW });
  const s = d.sections.find(x => x.id === 'series');
  assert.equal(s.title, 'Finish the series');
  // Orbit Three (7.0, 20000 votes) outranks Orbit Four (6.0, 300 votes); Orbit Three is next after Orbit Two.
  assert.deepEqual(s.items.map(i => i.title), ['Orbit Three', 'Orbit Four']);
  assert.equal(s.items[0].reasons[0], 'Next in the Orbit series');
  assert.equal(s.items[1].reasons[0], "Part of the Orbit series (you've seen 2 of 4)");
});

test('discover: no loved people and no series gives no sections; ratings outage still works', async () => {
  const d = await discover({ store: fakeStore({}, {}), http: fakeNet(), summaries: [], now: NOW });
  assert.deepEqual(d.sections, []);
  const { store, summaries } = build();
  const e = await discover({ store, http: fakeNet({ ratings: false }), summaries, now: NOW });
  assert.ok(e.sections.find(s => s.id === 'person:Q100').items.every(i => i.imdb === null));
});

test('discover: a stopped run throws', async () => {
  const { store, summaries } = build();
  const c = new AbortController(); c.abort();
  await assert.rejects(discover({ store, http: fakeNet(), summaries, now: NOW, signal: c.signal }), { code: 'aborted' });
});

test('filmography: all roles merged with library status, cached, status always fresh', async () => {
  const { store, summaries } = build();
  const http = fakeNet();
  const f = await filmography({ store, http, summaries, personId: ALICE.id });
  assert.equal(f.person.qid, 'wd:Q100');
  const by = Object.fromEntries(f.films.map(x => [x.title, x]));
  assert.equal(by['Alpha Road'].key, 'A1');
  assert.equal(by['Alpha Road'].watched, true);
  assert.equal(by['Beta Night'].rating, 10);
  assert.equal(by['Zeta Acting'].roles[0], 'cast');
  assert.equal(by['Gamma Dawn'].key, null);
  assert.equal(by['Gamma Dawn'].poster.url, 'https://upload.wikimedia.org/wikipedia/en/a/ab/Gamma.jpg');
  assert.equal(by['Gamma Dawn'].imdb.value, 8);
  assert.equal(by['Tiny Alpha'], undefined, 'shorts you have not logged are left out');
  // A1, A2 matched; A3 (Alpha Three) is in the library but not credited on Wikidata: still listed.
  assert.equal(by['Alpha Three'].key, 'A3');
  assert.equal(f.seen, 3);
  assert.equal(f.total, f.films.length);
  assert.deepEqual(f.films.map(x => x.year), [...f.films.map(x => x.year)].sort((a, b) => a - b));
  const n = http.calls.sparql;
  store.library.films.A1.watched = false;
  const g = await filmography({ store, http, summaries, personId: ALICE.id });
  assert.equal(http.calls.sparql, n, 'served from the cache');
  assert.equal(g.seen, 2);
});

test('filmography: a person without a Wikidata id gives the library films only, marked partial', async () => {
  const { store, summaries } = build();
  const http = fakeNet();
  const f = await filmography({ store, http, summaries, personId: CAROL.id });
  assert.equal(f.partial, true);
  assert.equal(f.person.qid, null);
  assert.deepEqual(f.films.map(x => x.title), ['Carol One', 'Carol Two']);
  assert.equal(f.seen, 2);
  assert.equal(http.calls.sparql, 0);
  await assert.rejects(filmography({ store, http, summaries, personId: 'p:nobody' }), { code: 'not-found' });
});

test('series: ordered by ordinal, status merged, cached; null without a collection', async () => {
  const { store, summaries } = build();
  const http = fakeNet();
  assert.equal(await series({ store, http, summaries, key: 'A1' }), null);
  assert.equal(await series({ store, http, summaries, key: 'nope' }), null);
  const s = await series({ store, http, summaries, key: 'S1' });
  assert.equal(s.id, 'wd:Q900');
  assert.equal(s.name, 'Orbit');
  assert.deepEqual(s.films.map(f => f.title), ['Orbit', 'Orbit Two', 'Orbit Three', 'Orbit Four']);
  assert.deepEqual(s.films.map(f => f.key), ['S1', 'S2', null, null]);
  assert.deepEqual(s.films.map(f => f.ordinal), [1, 2, 3, null]);
  assert.equal(s.films[0].poster.url, 'p1');
  assert.equal(s.films[3].poster, null);
  assert.equal(s.seen, 2);
  assert.equal(s.total, 4);
  const n = http.calls.sparql;
  store.library.films.S2.watched = false;
  const t = await series({ store, http, summaries, key: 'S1' });
  assert.equal(http.calls.sparql, n);
  assert.equal(t.seen, 1);
});
