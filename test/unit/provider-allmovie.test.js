// AllMovie: parsers and provider. allmovie-search.html and allmovie-film.html are trimmed copies of real pages
// (Paris, Texas, 22 Oct 2026); allmovie-film-moods.html is SYNTHETIC (Moods/Flags/Tone not seen on a live page).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAllMovie, parseAllMovieSearch } from '../../core/parse/allmovie.js';
import allmovie, { pickResult } from '../../core/providers/allmovie.js';
import { defaultWants } from '../../core/enrich.js';

const html = name => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), 'utf8');

test('search parser: id, slug, title, year in page order', () => {
  const r = parseAllMovieSearch(html('allmovie-search.html'));
  assert.deepEqual(r[0], { id: 'am6630', slug: 'paris-texas-am6630', title: 'Paris, Texas', year: 1984 });
  assert.ok(r.length >= 3 && r.every(x => /^am\d+$/.test(x.id)));
  assert.deepEqual(parseAllMovieSearch(null), []);
});

test('film parser: real page gives themes only; synthetic page gives all four groups', () => {
  assert.deepEqual(parseAllMovie(html('allmovie-film.html')), { moods: [], themes: ['journey/travel'], tone: [], flags: [] });
  assert.deepEqual(parseAllMovie(html('allmovie-film-moods.html')), {
    moods: ['bleak', 'melancholy'], themes: ['journey/travel'], tone: ['somber'], flags: ['nudity', 'strong language'],
  });
  assert.equal(parseAllMovie(''), null);
  assert.equal(parseAllMovie('<html>nothing</html>'), null);
});

test('pickResult: title and year (±1) must match', () => {
  const rs = [{ title: 'Paris, Texas', year: 1985, slug: 'a', id: 'am1' }, { title: 'Paris, Texas', year: 1984, slug: 'b', id: 'am2' }, { title: 'Paris Texas 2', year: 1984, slug: 'c', id: 'am3' }];
  assert.equal(pickResult(rs, { title: 'Paris, Texas', year: 1984 }).id, 'am2');
  assert.equal(pickResult(rs.slice(0, 1), { title: 'Paris Texas', year: 1984 }).id, 'am1');
  assert.equal(pickResult(rs, { title: 'Paris, Texas', year: 1990 }), null);
  assert.equal(pickResult(rs, { title: 'Texas', year: 1984 }), null);
});

function makeCtx(handler, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [], urls: [] };
  const http = { async page(url) { rec.urls.push(url); return handler(url); } };
  const ctx = {
    http, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: m => rec.log.push(m),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const ok = text => ({ status: 200, text });
const film = (n = 1, title = 'Paris, Texas') => ({ key: `lid:${n}`, title, year: 1984, ids: {} });
const pages = url => ok(html(url.includes('/search/') ? 'allmovie-search.html' : 'allmovie-film-moods.html'));

test('provider shape and wants: needs title and year', () => {
  assert.equal(allmovie.id, 'allmovie');
  assert.equal(allmovie.label, 'AllMovie');
  assert.equal(allmovie.needsKey, false);
  assert.equal(allmovie.refreshDays, 365);
  assert.equal(allmovie.retryMissDays, 60);
  assert.equal(defaultWants(allmovie, { key: 'a', title: 'X', ids: {} }), false);
  assert.equal(defaultWants(allmovie, film()), true);
});

test('provider: searches, matches, fetches the film page and stores descriptors plus the page id', async () => {
  const { ctx, rec } = makeCtx(pages);
  await allmovie.enrich([film()], ctx);
  assert.deepEqual(rec.urls, ['https://www.allmovie.com/search/movies/Paris%2C%20Texas', 'https://www.allmovie.com/movie/paris-texas-am6630']);
  assert.deepEqual(rec.done[0].data.moods, ['bleak', 'melancholy']);
  assert.equal(rec.done[0].data.id, 'am6630');
  assert.deepEqual(rec.done[0].ids, { allmovie: 'am6630' });
  assert.deepEqual(rec.progress.at(-1), [1, 1]);
});

test('provider: no matching result is a miss and the film page is never fetched', async () => {
  const { ctx, rec } = makeCtx(pages);
  await allmovie.enrich([film(1, 'Something Else Entirely')], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  assert.equal(rec.urls.length, 1);
});

test('provider: 404 search or a page without descriptors is a miss', async () => {
  let { ctx, rec } = makeCtx(() => ({ status: 404, text: '' }));
  await allmovie.enrich([film()], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  ({ ctx, rec } = makeCtx(url => (url.includes('/search/') ? ok(html('allmovie-search.html')) : ok('<html></html>'))));
  await allmovie.enrich([film()], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
});

test('provider: three blocked films in a row stop the run', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 403, text: '' }));
  await allmovie.enrich([1, 2, 3, 4, 5].map(n => film(n)), ctx);
  assert.equal(rec.fail.length, 3);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.urls.length, 3);
  assert.match(rec.log[0], /stopped asking/);
});

test('provider: abort stops straight away; network error fails one film only', async () => {
  const ac = new AbortController(); ac.abort();
  let { ctx, rec } = makeCtx(pages, { signal: ac.signal });
  await assert.rejects(allmovie.enrich([film()], ctx), { code: 'aborted' });
  assert.equal(rec.urls.length, 0);
  ({ ctx, rec } = makeCtx(() => { throw new Error('offline'); }));
  await allmovie.enrich([film(1), film(2)], ctx);
  assert.equal(rec.fail.length, 2);
});
