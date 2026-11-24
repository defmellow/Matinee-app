import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chipTag, filterHref } from '../../ui/components/chip.js';
import { queryFromParam, normalise } from '../../ui/screens/library/model.js';

const root = new URL('../../ui/', import.meta.url).pathname;
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const src = p => readFileSync(join(root, p), 'utf8');
const files = walk(root).filter(p => /\.(jsx|css)$/.test(p));

test('no .chip-static anywhere: static labels are Badges', () => {
  for (const p of files) assert.ok(!/chip-static/.test(readFileSync(p, 'utf8')), p);
});

test('chipTag: a link when it has an href, a button otherwise', () => {
  assert.equal(chipTag({ href: '#/library' }), 'a');
  assert.equal(chipTag({}), 'button');
  assert.equal(chipTag(), 'button');
});

test('Chip renders an <a>/<button>, Badge a non-interactive span (source check)', () => {
  const ui = src('components/ui.jsx');
  assert.match(ui, /export function Chip[\s\S]*?chipTag\(/);
  assert.match(ui, /export function Badge[\s\S]*?<span class=\{\('badge '/);
  assert.doesNotMatch(ui.slice(ui.indexOf('export function Badge'), ui.indexOf('export function ChipToggle')), /<(a|button)\b/);
});

test('filterHref builds Library links', () => {
  assert.equal(filterHref('genre', 'Drama'), '#/library/genre%3ADrama');
  assert.equal(filterHref('status', 'watchlist'), '#/library/status%3Awatchlist');
  assert.equal(filterHref('text', 'year:1984'), '#/library/q%3Ayear%3A1984');
});

test('Library reads each link form', () => {
  assert.deepEqual(queryFromParam('genre:Drama').genres, ['Drama']);
  assert.equal(queryFromParam('status:watchlist').status, 'watchlist');
  assert.equal(queryFromParam('status:bogus'), null);
  assert.equal(queryFromParam('decade:1984').decade, 1980);
  assert.deepEqual(queryFromParam('country:Japan').countries, ['Japan']);
  assert.equal(queryFromParam('q:language:korean').text, 'language:korean');
  assert.deepEqual(queryFromParam('tag:with mum').tags, ['with mum']);
  assert.deepEqual(queryFromParam('auto:genre:drama').autoTags, ['genre:drama']);
  assert.equal(queryFromParam('nonsense'), null);
  assert.deepEqual(normalise(queryFromParam('genre:Drama')), queryFromParam('genre:Drama'));
});

test('film page: genres, status, year, countries are links', () => {
  const hero = src('screens/film/Hero.jsx');
  assert.match(hero, /<Chip key=\{g\} href=\{filterHref\('genre', g\)\}/);
  assert.match(hero, /<StatusBadge user=\{u\} href=\{filterHref\('status'/);
  assert.match(hero, /href=\{filterHref\('text', `year:/);
  assert.match(src('screens/film/About.jsx'), /links\(film\.countries/);
  assert.match(src('components/StatusBadge.jsx'), /if \(href\) return <Chip/);
});

test('base.css documents the chip/button rule and badges are flat', () => {
  const css = src('styles/base.css');
  assert.match(css, /THE RULE: pill-shaped/);
  const badge = css.match(/\n\.badge \{[^}]*\}/)[0];
  assert.doesNotMatch(badge, /border:|border-radius: 999px/);
});
