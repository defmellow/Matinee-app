// Synthetic library only: invented films with real-sounding names, not real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQuery, facets, parseQueryText } from '../../core/analysis/query.js';

const p = (name, id) => ({ name, id });
const NO_RATINGS = { imdb: null, letterboxd: null, rt: null, metacritic: null, tmdb: null };
const mk = (key, title, o = {}) => ({
  key, title, originalTitle: null, year: null, poster: null, runtime: null, genres: [], countries: [], languages: [],
  directors: [], cast: [], keywords: [], subjects: [], awards: [], collection: null, basedOn: [],
  ratings: { ...NO_RATINGS }, score: null, autoTags: [], timesWatched: 0, lastWatched: null, firstWatched: null,
  ...o,
  user: { watched: false, rating: null, liked: false, watchlist: false, watchlistOrder: null, watchlistAddedAt: null, tags: [], ...o.user },
});

const COPPOLA = p('Francis Ford Coppola', 'wd:C'), WENDERS = p('Wim Wenders', 'wd:W');

const L = {
  amelie: mk('amelie', 'Amélie', {
    originalTitle: 'Le Fabuleux Destin d’Amélie Poulain', year: 2001, runtime: 122, genres: ['Comedy', 'Romance'], countries: ['France'], languages: ['French'],
    directors: [p('Jean-Pierre Jeunet', 'wd:J')], cast: [p('Audrey Tautou', 'wd:T')], score: 82,
    ratings: { ...NO_RATINGS, imdb: { value: 8.3, votes: 800000 }, letterboxd: { value: 4.1, votes: 1200000 } },
    autoTags: ['decade:2000s', 'country:france', 'genre:comedy'], timesWatched: 2, lastWatched: '2024-05-01',
    user: { watched: true, rating: 9, liked: true, tags: ['comfort'] },
  }),
  paris: mk('paris', 'Paris, Texas', {
    year: 1984, runtime: 145, genres: ['Drama'], countries: ['West Germany', 'France', 'United States of America'], languages: ['English'],
    directors: [WENDERS], cast: [p('Harry Dean Stanton', 'wd:H'), p('Nastassja Kinski', 'wd:N')], score: 88,
    ratings: { ...NO_RATINGS, imdb: { value: 8.1, votes: 150000 }, letterboxd: { value: 4.3, votes: 90000 } },
    autoTags: ['decade:1980s', 'country:france', 'country:usa', 'genre:drama'], timesWatched: 1, lastWatched: '2024-06-01',
    user: { watched: true, rating: 10, tags: ['comfort', 'sad'] },
  }),
  wings: mk('wings', 'Wings of Desire', {
    originalTitle: 'Der Himmel über Berlin', year: 1987, runtime: 128, genres: ['Drama', 'Fantasy'], countries: ['Germany'], languages: ['German'],
    directors: [WENDERS], cast: [p('Bruno Ganz', 'wd:B')], score: 86, ratings: { ...NO_RATINGS, imdb: { value: 8.0, votes: 60000 } },
    autoTags: ['decade:1980s', 'country:germany', 'genre:drama', 'genre:fantasy'], timesWatched: 1, lastWatched: '2023-11-11',
    user: { watched: true, rating: 8 },
  }),
  godfather: mk('godfather', 'The Godfather', {
    year: 1972, runtime: 175, genres: ['Crime', 'Drama'], countries: ['United States of America'], languages: ['English'], directors: [COPPOLA],
    cast: [p('Marlon Brando', 'wd:M'), p('Al Pacino', 'wd:A')], collection: 'The Godfather Collection', score: 92,
    ratings: { ...NO_RATINGS, imdb: { value: 9.2, votes: 2000000 } }, autoTags: ['decade:1970s', 'genre:crime', 'genre:drama'],
    timesWatched: 1, lastWatched: '2022-03-03', user: { watched: true },
  }),
  godfather2: mk('godfather2', 'The Godfather Part II', {
    year: 1974, runtime: 202, genres: ['Crime', 'Drama'], countries: ['United States of America'], languages: ['English'], directors: [COPPOLA],
    cast: [p('Al Pacino', 'wd:A')], collection: 'The Godfather Collection', score: 90,
    ratings: { ...NO_RATINGS, imdb: { value: 9.0, votes: 1000000 }, letterboxd: { value: 4.5, votes: 700000 } }, autoTags: ['decade:1970s', 'genre:crime', 'genre:drama', 'length:epic'],
    timesWatched: 3, lastWatched: '2024-01-01', user: { watched: true, rating: 10 },
  }),
  spirited: mk('spirited', 'Spirited Away', {
    originalTitle: '千と千尋の神隠し', year: 2001, runtime: 125, genres: ['Animation', 'Fantasy'], countries: ['Japan'], languages: ['Japanese'],
    directors: [p('Hayao Miyazaki', 'wd:Y')], cast: [], score: 85, autoTags: ['decade:2000s', 'genre:animation', 'genre:fantasy'],
    user: { watchlist: true, watchlistOrder: 2, watchlistAddedAt: '2024-02-02' },
  }),
  jetee: mk('jetee', 'La Jetée', {
    year: 1962, runtime: 28, genres: ['Sci-Fi'], countries: ['France'], languages: ['French'], directors: [p('Chris Marker', 'wd:K')], score: null,
    autoTags: ['decade:1960s', 'length:short'], user: { watchlist: true, watchlistOrder: 1, watchlistAddedAt: '2024-03-03' },
  }),
  zodiac: mk('zodiac', 'Zodiac', {
    year: 2007, runtime: null, genres: ['Crime'], countries: ['United States of America'], languages: ['English'], directors: [p('David Fincher', 'wd:F')], score: 78,
    autoTags: ['decade:2000s', 'genre:crime'],
  }),
};
const ALL = Object.values(L);
const keys = list => list.map(s => s.key);
const run = q => keys(applyQuery(ALL, q));
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());

// ---------- filtering ----------

test('no query returns everything in the original order, as a new array', () => {
  const out = applyQuery(ALL, {});
  assert.deepEqual(keys(out), keys(ALL));
  assert.notEqual(out, ALL);
  assert.deepEqual(keys(applyQuery(ALL)), keys(ALL));
  assert.deepEqual(keys(applyQuery(ALL, null)), keys(ALL));
  assert.deepEqual(keys(applyQuery(ALL, { status: 'all', text: '', genres: [], tags: [], people: [] })), keys(ALL));
});

test('empty and missing libraries', () => {
  assert.deepEqual(applyQuery([], { text: 'x', sort: 'title' }), []);
  assert.deepEqual(applyQuery(undefined, {}), []);
  assert.deepEqual(applyQuery([null, undefined], {}), []);
});

test('status filters', () => {
  sameSet(run({ status: 'watched' }), ['amelie', 'paris', 'wings', 'godfather', 'godfather2']);
  sameSet(run({ status: 'watchlist' }), ['spirited', 'jetee']);
  sameSet(run({ status: 'liked' }), ['amelie']);
  sameSet(run({ status: 'unrated' }), ['godfather']);          // watched, no rating
  sameSet(run({ status: 'rewatched' }), ['amelie', 'godfather2']); // seen more than once
});

test('rating range, on the 1–10 scale; unrated films never pass', () => {
  sameSet(run({ ratingMin: 9 }), ['amelie', 'paris', 'godfather2']);
  sameSet(run({ ratingMax: 8 }), ['wings']);
  sameSet(run({ ratingMin: 8, ratingMax: 9 }), ['amelie', 'wings']);
  sameSet(run({ ratingMin: 10, ratingMax: 10 }), ['paris', 'godfather2']);
  sameSet(run({ ratingMin: 1 }), ['amelie', 'paris', 'wings', 'godfather2']);
});

test('score, year and runtime filters', () => {
  sameSet(run({ scoreMin: 88 }), ['paris', 'godfather', 'godfather2']);
  assert.equal(run({ scoreMin: 90 }).includes('jetee'), false); // no score: out
  sameSet(run({ scoreMax: 80 }), ['zodiac']);
  sameSet(run({ yearMin: 1984, yearMax: 1987 }), ['paris', 'wings']);
  sameSet(run({ yearMax: 1972 }), ['godfather', 'jetee']);
  sameSet(run({ yearMin: 2001 }), ['amelie', 'spirited', 'zodiac']);
  sameSet(run({ runtimeMax: 125 }), ['amelie', 'spirited', 'jetee']); // zodiac has no runtime: out
  sameSet(run({ runtimeMin: 175 }), ['godfather', 'godfather2']);
  sameSet(run({ runtimeMin: 120, runtimeMax: 130 }), ['amelie', 'wings', 'spirited']);
});

test('genres, countries and languages match any of the chosen values, ignoring case and accents', () => {
  sameSet(run({ genres: ['drama'] }), ['paris', 'wings', 'godfather', 'godfather2']);
  sameSet(run({ genres: ['Fantasy', 'Sci-Fi'] }), ['wings', 'spirited', 'jetee']);
  sameSet(run({ countries: ['France'] }), ['amelie', 'paris', 'jetee']);
  sameSet(run({ countries: ['USA'] }), ['paris', 'godfather', 'godfather2', 'zodiac']); // same country as "United States of America"
  sameSet(run({ countries: ['Japan', 'germany'] }), ['wings', 'spirited']);
  sameSet(run({ languages: ['french'] }), ['amelie', 'jetee']);
  sameSet(run({ languages: ['English', 'Japanese'] }), ['paris', 'godfather', 'godfather2', 'zodiac', 'spirited']);
  assert.deepEqual(run({ genres: ['Western'] }), []);
});

test('personal tags must all match', () => {
  sameSet(run({ tags: ['comfort'] }), ['amelie', 'paris']);
  sameSet(run({ tags: ['Comfort', 'sad'] }), ['paris']);
  assert.deepEqual(run({ tags: ['comfort', 'missing'] }), []);
});

test('automatic tags must all match, using the stored ids', () => {
  sameSet(run({ autoTags: ['decade:1980s'] }), ['paris', 'wings']);
  sameSet(run({ autoTags: ['decade:1980s', 'country:france'] }), ['paris']);
  sameSet(run({ autoTags: ['genre:drama', 'genre:crime'] }), ['godfather', 'godfather2']);
  assert.deepEqual(run({ autoTags: ['decade:1980s', 'decade:1990s'] }), []);
});

test('automatic tags are worked out from the film when a summary does not carry them', () => {
  const bare = { key: 'x', title: 'X', year: 1984, genres: ['Drama'], user: {} };
  assert.deepEqual(keys(applyQuery([bare], { autoTags: ['decade:1980s', 'genre:drama'] })), ['x']);
  assert.deepEqual(keys(applyQuery([bare], { autoTags: ['decade:1990s'] })), []);
});

test('people: ids or exact names, directors or cast, any of them', () => {
  sameSet(run({ people: ['wd:W'] }), ['paris', 'wings']);
  sameSet(run({ people: ['Wim Wenders'] }), ['paris', 'wings']);
  sameSet(run({ people: ['wim wenders'] }), ['paris', 'wings']);
  sameSet(run({ people: ['wd:A'] }), ['godfather', 'godfather2']);       // an actor
  sameSet(run({ people: ['Al Pacino', 'Bruno Ganz'] }), ['godfather', 'godfather2', 'wings']);
  sameSet(run({ people: ['Jean Pierre Jeunet'] }), ['amelie']);           // punctuation ignored
  assert.deepEqual(run({ people: ['Wenders'] }), []);                     // exact names only here
});

test('directors: part of a name is enough', () => {
  sameSet(run({ directors: ['wenders'] }), ['paris', 'wings']);
  sameSet(run({ directors: ['wim wen'] }), ['paris', 'wings']);
  sameSet(run({ directors: ['coppola', 'miyazaki'] }), ['godfather', 'godfather2', 'spirited']);
  assert.deepEqual(run({ directors: ['stanton'] }), []);                  // an actor, not a director
});

test('filters combine', () => {
  sameSet(run({ status: 'watched', genres: ['Drama'], yearMin: 1980, ratingMin: 9 }), ['paris']);
  sameSet(run({ status: 'watchlist', runtimeMax: 60 }), ['jetee']);
  assert.deepEqual(run({ status: 'liked', genres: ['Drama'] }), []);
});

// ---------- text search ----------

test('text search ignores case and accents', () => {
  assert.deepEqual(run({ text: 'amelie' }), ['amelie']);
  assert.deepEqual(run({ text: 'AMÉLIE' }), ['amelie']);
  assert.deepEqual(run({ text: 'Amélie' }), ['amelie']);
  assert.deepEqual(run({ text: 'jetee' }), ['jetee']);
  assert.deepEqual(run({ text: 'himmel uber berlin' }), ['wings']);
});

test('text search covers original title, directors, cast and collection', () => {
  assert.deepEqual(run({ text: 'poulain' }), ['amelie']);
  assert.deepEqual(run({ text: "d'Amélie" }), ['amelie']);
  assert.deepEqual(run({ text: '千尋' }), ['spirited']);
  sameSet(run({ text: 'wenders' }), ['paris', 'wings']);
  assert.deepEqual(run({ text: 'tautou' }), ['amelie']);
  assert.deepEqual(run({ text: 'brando' }), ['godfather']);
  sameSet(run({ text: 'collection' }), ['godfather', 'godfather2']);
});

test('every word must match, but each can match a different field', () => {
  assert.deepEqual(run({ text: 'wenders stanton' }), ['paris']);   // director + cast
  assert.deepEqual(run({ text: 'paris wenders' }), ['paris']);     // title + director
  assert.deepEqual(run({ text: 'wenders pacino' }), []);
  assert.deepEqual(run({ text: '  wings   desire ' }), ['wings']);
  assert.deepEqual(run({ text: 'zzz' }), []);
});

test('blank text is no filter; punctuation alone is no filter', () => {
  assert.equal(run({ text: '' }).length, ALL.length);
  assert.equal(run({ text: '   ' }).length, ALL.length);
  assert.equal(run({ text: '!!!' }).length, ALL.length);
  assert.equal(run({ text: undefined }).length, ALL.length);
});

test('text search combines with filters', () => {
  assert.deepEqual(run({ text: 'wenders', ratingMin: 10 }), ['paris']);
  assert.deepEqual(run({ text: 'godfather', status: 'unrated' }), ['godfather']);
});

test('with no sort chosen, titles that start with the search come first', () => {
  const list = ['Salient', 'Aliens', 'Alien', 'Xenoalien'].map((t, i) => mk(`k${i}`, t));
  assert.deepEqual(applyQuery(list, { text: 'alien' }).map(s => s.title), ['Alien', 'Aliens', 'Salient', 'Xenoalien']);
  // a leading "The" does not stop a title counting as a start
  const list2 = [mk('a', 'Beta Alien'), mk('b', 'The Alien Wars')];
  assert.deepEqual(applyQuery(list2, { text: 'alien' }).map(s => s.title), ['The Alien Wars', 'Beta Alien']);
  // original titles count as well
  const list3 = [mk('a', 'Zed', { directors: [p('Alien Person')] }), mk('b', 'Other', { originalTitle: 'Alien Origins' })];
  assert.deepEqual(applyQuery(list3, { text: 'alien' }).map(s => s.title), ['Other', 'Zed']);
});

test('a chosen sort beats the start-of-title ranking', () => {
  const list = [mk('a', 'Alien', { year: 1979 }), mk('b', 'Salient', { year: 2020 })];
  assert.deepEqual(applyQuery(list, { text: 'alien', sort: 'year' }).map(s => s.key), ['b', 'a']);
});

// ---------- sorting ----------

test('sort by title ignores accents and a leading The/A/An, and sorts numbers as numbers', () => {
  assert.deepEqual(run({ sort: 'title' }), ['amelie', 'godfather', 'godfather2', 'jetee', 'paris', 'spirited', 'wings', 'zodiac']);
  assert.deepEqual(run({ sort: 'title', dir: 'desc' }), ['zodiac', 'wings', 'spirited', 'paris', 'jetee', 'godfather2', 'godfather', 'amelie']);
  const films = [mk('a', 'Ocean 12'), mk('b', 'Ocean 2'), mk('c', 'An Affair'), mk('d', 'À bout de souffle'), mk('e', 'Écoute')];
  assert.deepEqual(applyQuery(films, { sort: 'title' }).map(s => s.title), ['À bout de souffle', 'An Affair', 'Écoute', 'Ocean 2', 'Ocean 12']);
});

test('sort by year defaults to newest first; ties fall back to title', () => {
  assert.deepEqual(run({ sort: 'year' }), ['zodiac', 'amelie', 'spirited', 'wings', 'paris', 'godfather2', 'godfather', 'jetee']);
  assert.deepEqual(run({ sort: 'year', dir: 'asc' }), ['jetee', 'godfather', 'godfather2', 'paris', 'wings', 'amelie', 'spirited', 'zodiac']);
});

test('sort by rating puts unrated films last in both directions', () => {
  assert.deepEqual(run({ sort: 'rating' }), ['godfather2', 'paris', 'amelie', 'wings', 'godfather', 'jetee', 'spirited', 'zodiac']);
  assert.deepEqual(run({ sort: 'rating', dir: 'asc' }), ['wings', 'amelie', 'godfather2', 'paris', 'godfather', 'jetee', 'spirited', 'zodiac']);
});

test('sort by score and runtime put missing values last', () => {
  assert.deepEqual(run({ sort: 'score' }), ['godfather', 'godfather2', 'paris', 'wings', 'spirited', 'amelie', 'zodiac', 'jetee']);
  assert.deepEqual(run({ sort: 'score', dir: 'asc' }), ['zodiac', 'amelie', 'spirited', 'wings', 'paris', 'godfather2', 'godfather', 'jetee']);
  assert.deepEqual(run({ sort: 'runtime' }), ['godfather2', 'godfather', 'paris', 'wings', 'spirited', 'amelie', 'jetee', 'zodiac']);
  assert.deepEqual(run({ sort: 'runtime', dir: 'asc' }), ['jetee', 'amelie', 'spirited', 'wings', 'paris', 'godfather', 'godfather2', 'zodiac']);
});

test('sort by popularity uses the larger of IMDb and Letterboxd votes', () => {
  assert.deepEqual(run({ sort: 'popularity' }), ['godfather', 'amelie', 'godfather2', 'paris', 'wings', 'jetee', 'spirited', 'zodiac']);
  assert.deepEqual(run({ sort: 'popularity', dir: 'asc' }), ['wings', 'paris', 'godfather2', 'amelie', 'godfather', 'jetee', 'spirited', 'zodiac']);
});

test('sort by your take: films you rate above the crowd first', () => {
  // paris 100-88=+12, godfather2 100-90=+10, amelie 90-82=+8, wings 80-86=-6
  assert.deepEqual(run({ sort: 'yourTake' }), ['paris', 'godfather2', 'amelie', 'wings', 'godfather', 'jetee', 'spirited', 'zodiac']);
  assert.deepEqual(run({ sort: 'yourTake', dir: 'asc' }), ['wings', 'amelie', 'godfather2', 'paris', 'godfather', 'jetee', 'spirited', 'zodiac']);
});

test('sort by recent: last watched first, never-watched last', () => {
  assert.deepEqual(run({ sort: 'recent' }), ['paris', 'amelie', 'godfather2', 'wings', 'godfather', 'jetee', 'spirited', 'zodiac']);
  assert.deepEqual(run({ sort: 'recent', dir: 'asc' }), ['godfather', 'wings', 'godfather2', 'amelie', 'paris', 'jetee', 'spirited', 'zodiac']);
});

test('on the watchlist, "recent" follows your own watchlist order', () => {
  assert.deepEqual(run({ status: 'watchlist', sort: 'recent' }), ['jetee', 'spirited']);
  assert.deepEqual(run({ status: 'watchlist', sort: 'recent', dir: 'desc' }), ['spirited', 'jetee']);
  assert.deepEqual(run({ status: 'watchlist', sort: 'watchlist' }), ['jetee', 'spirited']);
  assert.deepEqual(run({ sort: 'watchlist' }).slice(0, 2), ['jetee', 'spirited']);
  assert.deepEqual(run({ sort: 'watchlist', dir: 'desc' }).slice(0, 2), ['spirited', 'jetee']);
});

test('ties keep a stable, title-based order', () => {
  const list = ['Delta', 'Alpha', 'Charlie', 'Bravo'].map((t, i) => mk(`k${i}`, t, { year: 2000, score: 50 }));
  assert.deepEqual(applyQuery(list, { sort: 'year' }).map(s => s.title), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(applyQuery(list, { sort: 'score', dir: 'asc' }).map(s => s.title), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  // identical titles keep their input order
  const twins = [mk('first', 'Same', { year: 2000 }), mk('second', 'Same', { year: 2000 })];
  assert.deepEqual(keys(applyQuery(twins, { sort: 'year' })), ['first', 'second']);
  assert.deepEqual(keys(applyQuery(twins, { sort: 'year', dir: 'asc' })), ['first', 'second']);
});

test('an unknown sort or direction is ignored', () => {
  assert.deepEqual(run({ sort: 'banana' }), keys(ALL));
  assert.deepEqual(run({ sort: 'year', dir: 'sideways' }), run({ sort: 'year' }));
});

test('applyQuery does not change its input', () => {
  const copy = ALL.slice();
  const frozen = JSON.stringify(ALL);
  applyQuery(ALL, { sort: 'title', text: 'a', genres: ['Drama'] });
  assert.deepEqual(ALL, copy);
  assert.equal(JSON.stringify(ALL), frozen);
});

test('a bigger library is fast enough to run on every keystroke', () => {
  const big = Array.from({ length: 6000 }, (_, i) => mk(`k${i}`, `Film number ${i}`, { year: 1950 + (i % 70), genres: ['Drama'], directors: [p(`Director ${i % 300}`, `d${i % 300}`)], cast: [p(`Actor ${i}`, `a${i}`)], user: { watched: true, rating: 1 + (i % 10) } }));
  const t = Date.now();
  const out = applyQuery(big, { text: 'film 59', genres: ['drama'], sort: 'rating' });
  assert.ok(out.length > 0);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
});

// ---------- facets ----------

test('facets count films per value, most common first', () => {
  const f = facets(ALL);
  assert.deepEqual(f.genres, [
    { name: 'Drama', count: 4 }, { name: 'Crime', count: 3 }, { name: 'Fantasy', count: 2 },
    { name: 'Animation', count: 1 }, { name: 'Comedy', count: 1 }, { name: 'Romance', count: 1 }, { name: 'Sci-Fi', count: 1 },
  ]);
  assert.deepEqual(f.countries.slice(0, 2), [{ name: 'United States of America', count: 4 }, { name: 'France', count: 3 }]);
  assert.deepEqual(f.languages.slice(0, 2), [{ name: 'English', count: 4 }, { name: 'French', count: 2 }]);
  assert.deepEqual(f.tags, [{ name: 'comfort', count: 2 }, { name: 'sad', count: 1 }]);
});

test('facet decades run oldest first and carry their year range', () => {
  assert.deepEqual(facets(ALL).decades, [
    { name: '1960s', count: 1, yearMin: 1960, yearMax: 1969 },
    { name: '1970s', count: 2, yearMin: 1970, yearMax: 1979 },
    { name: '1980s', count: 2, yearMin: 1980, yearMax: 1989 },
    { name: '2000s', count: 3, yearMin: 2000, yearMax: 2009 },
  ]);
});

test('facet people are directors, most films first', () => {
  const people = facets(ALL).people;
  assert.deepEqual(people.slice(0, 2), [{ name: 'Francis Ford Coppola', id: 'wd:C', count: 2 }, { name: 'Wim Wenders', id: 'wd:W', count: 2 }]);
  assert.equal(people.length, 6);
  assert.equal(people.some(x => x.name === 'Harry Dean Stanton'), false); // actors are not facets
});

test('facet people stop at fifty', () => {
  const many = Array.from({ length: 80 }, (_, i) => mk(`k${i}`, `T${i}`, { directors: [p(`Director ${String(i).padStart(2, '0')}`, `d${i}`)] }));
  assert.equal(facets(many).people.length, 50);
});

test('facets merge spellings of a country and ignore blanks and repeats within one film', () => {
  const films = [
    mk('a', 'A', { countries: ['United States', 'United States of America', ''], genres: ['Drama', 'drama'] }),
    mk('b', 'B', { countries: ['USA'], genres: ['DRAMA'] }),
  ];
  const f = facets(films);
  assert.deepEqual(f.countries, [{ name: 'United States', count: 2 }]);
  assert.deepEqual(f.genres, [{ name: 'Drama', count: 2 }]);
});

test('facets of nothing', () => {
  for (const input of [[], undefined, [null]]) {
    assert.deepEqual(facets(input), { genres: [], countries: [], languages: [], decades: [], tags: [], people: [] });
  }
});

test('a facet value feeds straight back into a filter', () => {
  const f = facets(ALL);
  assert.deepEqual(run({ countries: [f.countries[0].name] }).length, f.countries[0].count);
  assert.deepEqual(run({ genres: [f.genres[0].name] }).length, f.genres[0].count);
  const dec = f.decades[2];
  assert.deepEqual(run({ yearMin: dec.yearMin, yearMax: dec.yearMax }).length, dec.count);
  assert.deepEqual(run({ people: [f.people[0].id] }).length, f.people[0].count);
  assert.deepEqual(run({ tags: [f.tags[0].name] }).length, f.tags[0].count);
});

// ---------- search-box operators ----------

test('plain text passes through untouched', () => {
  assert.deepEqual(parseQueryText('wings of desire'), { text: 'wings of desire' });
  assert.deepEqual(parseQueryText(''), { text: '' });
  assert.deepEqual(parseQueryText(undefined), { text: '' });
  assert.deepEqual(parseQueryText('   '), { text: '' });
});

test('dir: finds directors by part of a name', () => {
  assert.deepEqual(parseQueryText('dir:wenders'), { text: '', directors: ['wenders'] });
  assert.deepEqual(parseQueryText('paris dir:wenders'), { text: 'paris', directors: ['wenders'] });
  assert.deepEqual(parseQueryText('dir:"wim wenders" paris'), { text: 'paris', directors: ['wim wenders'] });
  assert.deepEqual(parseQueryText('Dir:wenders director:herzog'), { text: '', directors: ['wenders', 'herzog'] });
});

test('year: one year, a range, a decade, or a comparison', () => {
  assert.deepEqual(parseQueryText('year:1984'), { text: '', yearMin: 1984, yearMax: 1984 });
  assert.deepEqual(parseQueryText('year:1980-1989'), { text: '', yearMin: 1980, yearMax: 1989 });
  assert.deepEqual(parseQueryText('year:1989-1980'), { text: '', yearMin: 1980, yearMax: 1989 });
  assert.deepEqual(parseQueryText('year:1980s'), { text: '', yearMin: 1980, yearMax: 1989 });
  assert.deepEqual(parseQueryText('year:>=1990'), { text: '', yearMin: 1990 });
  assert.deepEqual(parseQueryText('year:<1990'), { text: '', yearMax: 1989 });
  assert.deepEqual(parseQueryText('year:>2000'), { text: '', yearMin: 2001 });
});

test('rated: works on the 1–10 scale and understands stars', () => {
  assert.deepEqual(parseQueryText('rated:>=8'), { text: '', ratingMin: 8 });
  assert.deepEqual(parseQueryText('rated:>8'), { text: '', ratingMin: 9 });
  assert.deepEqual(parseQueryText('rated:<=6'), { text: '', ratingMax: 6 });
  assert.deepEqual(parseQueryText('rated:<6'), { text: '', ratingMax: 5 });
  assert.deepEqual(parseQueryText('rated:7'), { text: '', ratingMin: 7, ratingMax: 7 });
  assert.deepEqual(parseQueryText('rated:7-9'), { text: '', ratingMin: 7, ratingMax: 9 });
  assert.deepEqual(parseQueryText('rating:>=8'), { text: '', ratingMin: 8 });
  assert.deepEqual(parseQueryText('★4+'), { text: '', ratingMin: 8 });
  assert.deepEqual(parseQueryText('★4'), { text: '', ratingMin: 8, ratingMax: 8 });
  assert.deepEqual(parseQueryText('★3.5+'), { text: '', ratingMin: 7 });
  assert.deepEqual(parseQueryText('★★★½'), { text: '', ratingMin: 7, ratingMax: 7 });
  assert.deepEqual(parseQueryText('★★★★★ wenders'), { text: 'wenders', ratingMin: 10, ratingMax: 10 });
  assert.deepEqual(parseQueryText('rated:★4+'), { text: '', ratingMin: 8 });
});

test('genre, tag, country, language and status operators', () => {
  assert.deepEqual(parseQueryText('genre:drama'), { text: '', genres: ['drama'] });
  assert.deepEqual(parseQueryText('genre:"science fiction" genre:drama'), { text: '', genres: ['science fiction', 'drama'] });
  assert.deepEqual(parseQueryText('tag:comfort'), { text: '', tags: ['comfort'] });
  assert.deepEqual(parseQueryText('country:japan'), { text: '', countries: ['japan'] });
  assert.deepEqual(parseQueryText('language:korean lang:japanese'), { text: '', languages: ['korean', 'japanese'] });
  assert.deepEqual(parseQueryText('is:watchlist'), { text: '', status: 'watchlist' });
  assert.deepEqual(parseQueryText('is:nonsense'), { text: 'is:nonsense' });
});

test('runtime and score operators', () => {
  assert.deepEqual(parseQueryText('runtime:<100'), { text: '', runtimeMax: 99 });
  assert.deepEqual(parseQueryText('runtime:<=100'), { text: '', runtimeMax: 100 });
  assert.deepEqual(parseQueryText('runtime:>=150'), { text: '', runtimeMin: 150 });
  assert.deepEqual(parseQueryText('runtime:90-120'), { text: '', runtimeMin: 90, runtimeMax: 120 });
  assert.deepEqual(parseQueryText('score:>=80'), { text: '', scoreMin: 80 });
  assert.deepEqual(parseQueryText('score:<50'), { text: '', scoreMax: 49 });
});

test('operators mix with each other and with words', () => {
  assert.deepEqual(parseQueryText('road dir:wenders year:1980-1989 rated:>=8 genre:drama tag:comfort country:germany runtime:<150 movie'), {
    text: 'road movie', directors: ['wenders'], yearMin: 1980, yearMax: 1989, ratingMin: 8, genres: ['drama'], tags: ['comfort'],
    countries: ['germany'], runtimeMax: 149,
  });
});

test('unknown operators and bad values stay in the text', () => {
  assert.deepEqual(parseQueryText('foo:bar'), { text: 'foo:bar' });
  assert.deepEqual(parseQueryText('mission: impossible'), { text: 'mission: impossible' });
  assert.deepEqual(parseQueryText('year:abc'), { text: 'year:abc' });
  assert.deepEqual(parseQueryText('rated:11'), { text: 'rated:11' });
  assert.deepEqual(parseQueryText('rated:>=0'), { text: 'rated:>=0' });
  assert.deepEqual(parseQueryText('★7'), { text: '★7' });
  assert.deepEqual(parseQueryText('★★★★★★'), { text: '★★★★★★' });
  assert.deepEqual(parseQueryText('dir:'), { text: 'dir:' });
  assert.deepEqual(parseQueryText('dir:wenders foo:bar'), { text: 'foo:bar', directors: ['wenders'] });
  assert.deepEqual(parseQueryText('year:99999'), { text: 'year:99999' });
});

test('a quoted phrase is kept as words; an unfinished quote still works while typing', () => {
  assert.deepEqual(parseQueryText('"wings of desire"'), { text: 'wings of desire' });
  assert.deepEqual(parseQueryText('dir:"wim wen'), { text: '', directors: ['wim wen'] });
});

test('parsed text feeds straight into applyQuery', () => {
  const find = str => keys(applyQuery(ALL, parseQueryText(str)));
  sameSet(find('dir:wenders'), ['paris', 'wings']);
  assert.deepEqual(find('dir:wenders rated:>=9'), ['paris']);
  assert.deepEqual(find('dir:wenders ★4+ desire'), ['wings']);
  sameSet(find('year:1970-1979'), ['godfather', 'godfather2']);
  sameSet(find('year:1970s'), ['godfather', 'godfather2']);
  sameSet(find('genre:drama runtime:<150'), ['paris', 'wings']);
  assert.deepEqual(find('tag:comfort tag:sad'), ['paris']);
  sameSet(find('country:usa year:>=2000'), ['zodiac']);
  assert.deepEqual(find('country:japan'), ['spirited']);
  sameSet(find('is:watchlist'), ['spirited', 'jetee']);
  assert.deepEqual(find('amelie'), ['amelie']);
  assert.deepEqual(find('foo:bar'), []);
  // Operators in the UI's own query are kept when merged
  const merged = { sort: 'title', status: 'watched', ...parseQueryText('dir:coppola') };
  assert.deepEqual(keys(applyQuery(ALL, merged)), ['godfather', 'godfather2']);
});

test('sort by Letterboxd average: highest first, films without one last', () => {
  const list = [mk('a', 'A', { ratings: { letterboxd: { value: 3.6 } } }), mk('b', 'B', { ratings: { letterboxd: { value: 4.4 } } }), mk('c', 'C', {}), mk('d', 'D', { ratings: { letterboxd: { value: 0 } } }), mk('e', 'E', { ratings: { letterboxd: { value: 4.1 } } })];
  assert.deepEqual(keys(applyQuery(list, { sort: 'letterboxd' })), ['b', 'e', 'a', 'c', 'd']);
  assert.deepEqual(keys(applyQuery(list, { sort: 'letterboxd', dir: 'asc' })), ['a', 'e', 'b', 'c', 'd']);
});
