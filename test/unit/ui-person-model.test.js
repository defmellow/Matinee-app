// Person page model: merging the library part with the full filmography, filters, sorts and counts. Synthetic films only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupItems, mergeFilms, applyFilters, sortItems, statusCounts, roleChoices, decadeChoices, roleLine, STATUS_CHOICES, visibleStatuses, validStatus, DEFAULT_FILTERS } from '../../ui/screens/person/model.js';
import { STATUS_OPTIONS } from '../../ui/screens/library/model.js';
import { roleText } from '../../ui/screens/film/format.js';
import { href, parse } from '../../ui/router.js';

const lib = (key, title, year, user = {}, score = null) => ({ key, title, year, user, score });
const A = lib('a', 'Alpha', 1999, { watched: true, rating: 8, liked: true }, 80);
const B = lib('b', 'Beta', 2005, { watchlist: true }, 70);
const C = lib('c', 'Gamma', 2012, { watched: true }, 60);
const mine = [{ film: A, roles: ['director'] }, { film: B, roles: ['cast:Hero'] }, { film: C, roles: ['director', 'writer'] }];
const remote = [
  { title: 'Alpha', year: 1999, url: 'u/a', slug: 'alpha', key: 'a', poster: null, role: 'cast' },
  { title: 'Delta', year: 1985, url: 'u/d', slug: 'delta', key: null, poster: 'p.jpg', role: 'director' },
  { title: 'Delta', year: 1985, url: 'u/d', slug: 'delta', key: null, poster: null, role: 'writer' },
  { title: 'Epsilon', year: null, url: null, slug: 'epsilon', key: null, poster: null, role: 'cast' },
];
const byKey = new Map([A, B, C].map(f => [f.key, f]));

test('merge: library films alone work while the full list is still loading', () => {
  const items = mergeFilms(mine, [], byKey);
  assert.equal(items.length, 3);
  assert.ok(items.every(i => i.film));
});

test('merge: same film is one tile, roles are joined, non-library films stay plain', () => {
  const items = mergeFilms(mine, remote, byKey);
  assert.equal(items.length, 5);
  const a = items.find(i => i.key === 'a');
  assert.deepEqual(a.roles, ['director', 'cast']);
  const d = items.find(i => i.title === 'Delta');
  assert.equal(d.film, null);
  assert.equal(d.poster, 'p.jpg');
  assert.deepEqual(d.roles, ['director', 'writer']);
  assert.equal(d.user, null);
});

test('merge: a remote film with a library key not in getPerson is shown with its library status', () => {
  const items = mergeFilms([], [{ title: 'Beta', year: 2005, url: 'u/b', slug: 'beta', key: 'b', poster: null, role: 'cast' }], byKey);
  assert.equal(items.length, 1);
  assert.equal(items[0].film, B);
});

test('status control uses the Library wording, plus Not seen, without Liked and Unrated', () => {
  const labels = STATUS_CHOICES.map(([, l]) => l);
  assert.deepEqual(labels, ['All', 'Watched', 'Watchlist', 'Not seen']);
  assert.equal(validStatus('liked'), 'all');
  assert.equal(validStatus('watched'), 'watched');
  for (const [v, l] of STATUS_OPTIONS) if (STATUS_CHOICES.some(c => c[0] === v)) assert.equal(STATUS_CHOICES.find(c => c[0] === v)[1], l);
});

test('status filters and counts', () => {
  const items = mergeFilms(mine, remote, byKey);
  const c = statusCounts(items, DEFAULT_FILTERS);
  assert.deepEqual(c, { all: 5, watched: 2, watchlist: 1, unseen: 3 });
  const ids = s => applyFilters(items, { ...DEFAULT_FILTERS, status: s }).map(i => i.title).sort();
  assert.deepEqual(ids('unseen'), ['Beta', 'Delta', 'Epsilon']);
  assert.deepEqual(ids('watchlist'), ['Beta']);
});

test('visible statuses hide empty options and a Not seen that equals All', () => {
  const v = c => visibleStatuses(c).map(x => x[0]);
  assert.deepEqual(v({ all: 5, watched: 2, watchlist: 1, unseen: 3 }), ['all', 'watched', 'watchlist', 'unseen']);
  assert.deepEqual(v({ all: 5, watched: 0, watchlist: 0, unseen: 5 }), ['all']);
  assert.deepEqual(v({ all: 5, watched: 5, watchlist: 0, unseen: 0 }), ['all', 'watched']);
  assert.deepEqual(visibleStatuses({ all: 5, watched: 0, watchlist: 0, unseen: 5 }, 'watched').map(x => x[0]), ['all', 'watched']);
});

test('role, title and decade filters; counts follow the other filters', () => {
  const items = mergeFilms(mine, remote, byKey);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, role: 'director' }).map(i => i.title).sort(), ['Alpha', 'Delta', 'Gamma']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, text: ' gAmMa ' }).map(i => i.title), ['Gamma']);
  assert.deepEqual(applyFilters(items, { ...DEFAULT_FILTERS, decade: 1980 }).map(i => i.title), ['Delta']);
  assert.equal(statusCounts(items, { ...DEFAULT_FILTERS, role: 'writer' }).all, 2);
});

test('roles that exist, in order of how many films', () => {
  const items = mergeFilms(mine, remote, byKey);
  const r = roleChoices(items);
  assert.deepEqual(r.map(x => x.value), ['director', 'cast', 'writer']);
  assert.equal(r[0].count, 3);
  assert.deepEqual(decadeChoices(items).map(d => d.value), [2010, 2000, 1990, 1980]);
});

test('sorts keep missing values last', () => {
  const items = mergeFilms(mine, remote, byKey);
  const t = s => sortItems(items, s).map(i => i.title);
  assert.deepEqual(t('newest'), ['Gamma', 'Beta', 'Alpha', 'Delta', 'Epsilon']);
  assert.deepEqual(t('oldest'), ['Delta', 'Alpha', 'Beta', 'Gamma', 'Epsilon']);
  assert.deepEqual(t('title'), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
  assert.deepEqual(t('rating').slice(0, 1), ['Alpha']);
  assert.deepEqual(t('score').slice(0, 3), ['Alpha', 'Beta', 'Gamma']);
});

test('role line wording', () => {
  assert.equal(roleLine(['director', 'cast:Hero'], roleText), 'Director, as Hero');
  assert.equal(roleLine(['cast', 'Cast'], roleText), 'Actor');
});

test('a plain name round-trips through the person route', () => {
  for (const name of ['Agnès Varda', 'Jean/Luc', '50% Cent & Co']) assert.equal(parse(href('person', name)).param, name);
});

test('mainRole / resolveRole: link role wins, else the department TMDB gives, else the role with most films', async () => {
  const { mainRole, resolveRole, rolePhrase } = await import('../../ui/screens/person/model.js');
  const mk = (n, role) => Array.from({ length: n }, (_, i) => ({ id: role + i, title: role + i, roles: [role] }));
  const items = [...mk(5, 'director'), ...mk(9, 'cast:Himself'), ...mk(2, 'writer')];
  assert.equal(mainRole(items), 'cast');                 // most films
  assert.equal(mainRole(items, 'director'), 'director'); // TMDB's known_for beats the count
  assert.equal(mainRole(items, 'composer'), 'cast');     // known role they have no films in: ignored
  assert.equal(resolveRole('writer', items, 'director'), 'writer');
  assert.equal(resolveRole('all', items, 'director'), 'all');
  assert.equal(resolveRole(null, items, 'director'), 'director');
  assert.equal(resolveRole('editor', items, 'director'), 'director');      // no editor films: main role
  assert.equal(resolveRole('editor', items, 'director', true), 'editor');  // still loading: keep what the link asked
  assert.equal(resolveRole(null, [], null), null);
  assert.equal(rolePhrase('cast'), 'as an actor'); assert.equal(rolePhrase('all'), '');
});

test('groupItems: library films in the chosen sort, outside films always by year (newest first unless Oldest)', () => {
  const items = mergeFilms(mine, [
    { title: 'Old', year: 1970, url: 'u/o', slug: 'old', key: null, poster: null, role: 'director' },
    { title: 'New', year: 2020, url: 'u/n', slug: 'new', key: null, poster: null, role: 'director' },
    { title: 'Mid', year: 1990, url: 'u/m', slug: 'mid', key: null, poster: null, role: 'director' },
  ], byKey);
  const all = applyFilters(items, DEFAULT_FILTERS);
  const t = (s, f = all) => { const g = groupItems(f, s); return [g.mine.map(i => i.title), g.more.map(i => i.title)]; };
  assert.deepEqual(t('newest'), [['Gamma', 'Beta', 'Alpha'], ['New', 'Mid', 'Old']]);
  assert.deepEqual(t('oldest'), [['Alpha', 'Beta', 'Gamma'], ['Old', 'Mid', 'New']]);
  assert.deepEqual(t('score'), [['Alpha', 'Beta', 'Gamma'], ['New', 'Mid', 'Old']]);
  assert.deepEqual(t('rating')[1], ['New', 'Mid', 'Old']);
  const only = status => groupItems(applyFilters(items, { ...DEFAULT_FILTERS, status }), 'newest');
  assert.equal(only('watched').more.length, 0);
  assert.equal(only('watchlist').more.length, 0);
  assert.equal(only('unseen').more.length, 3);
  assert.equal(only('all').more.length, 3);
});
