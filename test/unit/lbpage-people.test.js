// Person slugs from a (synthetic) Letterboxd film page: JSON-LD sameAs, page links for writers and for names without a URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLetterboxdFilm } from '../../core/parse/lbpage.js';

const ld = {
  '@type': 'Movie', name: 'Invented', director: [{ '@type': 'Person', name: 'Dir One', sameAs: 'https://letterboxd.com/director/dir-one/' }],
  actor: [{ name: 'Act One', sameAs: 'https://letterboxd.com/actor/act-one/' }, { name: 'Act Two' }, { name: 'Act Three', url: 'https://letterboxd.com/actor/act-three-2/' }],
};
const page = `<html><head><title>Invented (2001) • Letterboxd</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>
<a href="/writer/wri-one/" class="contributor"><span class="prettify">Wri One</span></a><a href="/writer/wri-one/">Wri One</a>
<a href="/actor/act-two/" class="tooltip">Act Two</a><a href="/director/someone-else/">Someone Else</a></body></html>`;

test('people carry their Letterboxd slug when the page names it', () => {
  const p = parseLetterboxdFilm(page).people;
  assert.deepEqual(p.director, [{ name: 'Dir One', slug: 'dir-one' }]);
  assert.deepEqual(p.cast, [{ name: 'Act One', slug: 'act-one' }, { name: 'Act Two', slug: 'act-two' }, { name: 'Act Three', slug: 'act-three-2' }]);
  assert.deepEqual(p.writer, [{ name: 'Wri One', slug: 'wri-one' }]);
});

test('a name with no link stays a plain name', () => {
  const p = parseLetterboxdFilm(page.replace('<a href="/actor/act-two/" class="tooltip">Act Two</a>', '')).people;
  assert.deepEqual(p.cast[1], { name: 'Act Two' });
});

test('a url for the wrong role is not taken as the slug', () => {
  const bad = page.replace('letterboxd.com/director/dir-one/', 'letterboxd.com/actor/dir-one/');
  assert.deepEqual(parseLetterboxdFilm(bad).people.director, [{ name: 'Dir One' }]);
});
