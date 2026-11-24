import test from 'node:test';
import assert from 'node:assert/strict';
import { photoUrl, initials, personIdOf, libraryFacts, isRich, libraryLine, placeBeside, PERSON_DELAY } from '../../ui/components/personpop.js';

test('photoUrl builds TMDB image URLs from a stored path and refuses anything else', () => {
  assert.equal(photoUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w185/abc.jpg');
  assert.equal(photoUrl('/abc.jpg', 'h632'), 'https://image.tmdb.org/t/p/h632/abc.jpg');
  for (const bad of [null, undefined, '', 'abc.jpg', 'https://evil.example/x.jpg', '/a/b.jpg', 42]) assert.equal(photoUrl(bad), null);
});

test('initials: first and last word, unicode safe, empty for nothing', () => {
  assert.equal(initials('Robert De Niro'), 'RN');
  assert.equal(initials('Natalie Portman'), 'NP');
  assert.equal(initials('Björk'), 'B');
  assert.equal(initials('Élodie Yung'), 'ÉY');
  assert.equal(initials('  '), '');
  assert.equal(initials(null), '');
});

test('personIdOf reads the id out of a person link', () => {
  assert.equal(personIdOf('#/person/p:robert-de-niro?role=cast'), 'p:robert-de-niro');
  assert.equal(personIdOf('#/person/Jean%20Reno'), 'Jean Reno');
  assert.equal(personIdOf('#/film/lid:x'), null);
  assert.equal(personIdOf(null), null);
});

const mk = (title, year, user, poster = { thumb: `/${title}.jpg` }, key = `lid:${title}`) => ({ film: { key, title, year, poster, user } });
test('libraryFacts counts every library film but lists only rich ones: watched (best rated first), then watchlist, then the rest', () => {
  const rows = [
    mk('A', 1990, { watched: true, rating: 6 }), mk('B', 1995, { watched: true, rating: 10 }), mk('C', 2000, { watched: true, rating: null }),
    mk('D', 2001, { watched: true, rating: 8 }), mk('E', 2010, { watched: true, rating: 8 }, null), mk('F', 2020, { watchlist: true }), mk('G', 2021, { watchlist: true, watched: true, rating: 2 }),
    mk('H', 2005, { watchlist: true }), mk('I', 1999, null), mk('J', 2015, {}, { url: 'http://x/j.jpg' }), mk('K', 2016, {}, { thumb: '/k.jpg' }, null),
  ];
  const f = libraryFacts(rows);
  assert.equal(f.seen, 6); assert.equal(f.onList, 2); assert.equal(f.inLibrary, 11);
  assert.deepEqual(f.rich.map(x => x.title), ['B', 'D', 'A', 'G', 'C', 'F', 'H', 'J', 'I'], 'watched by rating then year, watchlist, others; no poster or no page is left out');
  assert.deepEqual(libraryFacts(null), { seen: 0, onList: 0, inLibrary: 0, rich: [] });
  assert.equal(isRich({ key: 'k', title: 't', poster: {} }), false);
});

test('libraryLine wording', () => {
  assert.equal(libraryLine({ seen: 4, onList: 2, inLibrary: 6 }), "You've seen 4 of their films · 2 on your watchlist");
  assert.equal(libraryLine({ seen: 1, onList: 0, inLibrary: 1 }), "You've seen 1 of their films");
  assert.equal(libraryLine({ seen: 0, onList: 3, inLibrary: 3 }), '3 on your watchlist');
  assert.equal(libraryLine({ seen: 0, onList: 0, inLibrary: 2 }), "You haven't seen any of their films yet");
  assert.equal(libraryLine({ seen: 0, onList: 0, inLibrary: 0 }), 'None of their films are in your library yet');
});

test('placeBeside: right of the name, flips left near the edge, never overlaps the name, stays on screen', () => {
  const size = { w: 292, h: 140 }, vp = { w: 1280, h: 900 };
  const mid = placeBeside({ left: 200, top: 300, right: 280, bottom: 320 }, size, vp);
  assert.equal(mid.side, 'right'); assert.ok(mid.left >= 280);
  const edge = placeBeside({ left: 1000, top: 300, right: 1080, bottom: 320 }, size, vp);
  assert.equal(edge.side, 'left'); assert.ok(edge.left + size.w <= 1000);
  const low = placeBeside({ left: 200, top: 880, right: 280, bottom: 898 }, size, vp);
  assert.ok(low.top + size.h <= 900);
  assert.equal(PERSON_DELAY, 600);
});

import { prefetchPerson } from '../../ui/components/personpop.js';
test('prefetchPerson asks for the person page data once per person, with the person page args', () => {
  const calls = [];
  const send = (m, a) => { calls.push([m, a]); return Promise.resolve({}); };
  assert.equal(prefetchPerson('p:test-one', send), true);
  assert.equal(prefetchPerson('p:test-one', send), false);
  assert.equal(prefetchPerson('', send), false);
  assert.deepEqual(calls, [['getPersonFilms', { id: 'p:test-one', name: 'p:test-one' }]]);
  assert.doesNotThrow(() => prefetchPerson('p:test-two', () => { throw new Error('x'); }));
});
