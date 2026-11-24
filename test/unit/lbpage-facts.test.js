// Letterboxd film page: the extra facts (poster, synopsis, runtime, names, ids) and how compose() uses them as a fallback.
// Synthetic fixture with invented values. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLetterboxdFilm, isoMinutes } from '../../core/parse/lbpage.js';
import lbpage, { toData } from '../../core/providers/lbpage.js';
import { compose } from '../../core/model.js';

const html = readFileSync(new URL('../fixtures/synthetic/lbpage-facts.html', import.meta.url), 'utf8');
const parsed = parseLetterboxdFilm(html);
const data = toData(parsed);

test('parser: poster, synopsis, runtime, dates, lists, ids', () => {
  assert.equal(parsed.poster, 'https://a.ltrbxd.com/resized/film-poster/0/0/0/1/example-harbour-0-600-0-900-crop.jpg?v=abc&w=1');
  assert.equal(parsed.synopsis, 'A lighthouse keeper & a stranger share one winter.');
  assert.equal(parsed.runtime, 112);
  assert.equal(parsed.released, '2001-05-03');
  assert.equal(parsed.year, 2001);
  assert.deepEqual(parsed.genres, ['Drama', 'Mystery']);
  assert.deepEqual(parsed.countries, ['Australia', 'Canada']);
  assert.deepEqual(parsed.languages, ['en', 'fr']);
  assert.deepEqual(parsed.studios, ['Invented Pictures']);
  assert.deepEqual(parsed.people.director, [{ name: 'Ada Fictional', slug: 'ada-fictional' }]); // updated 29 Oct: person slugs are stored now (for person pages)
  assert.equal(parsed.people.cast.length, 8);
  assert.deepEqual(parsed.ids, { imdb: 'tt0123456', tmdb: '4242' });
  assert.equal(parsed.average, 3.9);
});

test('parser: durations and missing fields', () => {
  assert.equal(isoMinutes('PT2H25M'), 145);
  assert.equal(isoMinutes('PT90M'), 90);
  assert.equal(isoMinutes('nonsense'), null);
  assert.equal(isoMinutes(null), null);
  const bare = parseLetterboxdFilm('<html><title>X • Letterboxd</title><body><section class="production-synopsis"></section></body></html>');
  assert.equal(bare.poster, undefined);
  assert.equal(bare.ids, undefined);
  assert.equal(bare.people, undefined);
  // the square og:image crop is not a poster; a TV id is not used as a film id
  const tv = html.replace('data-tmdb-type="movie"', 'data-tmdb-type="tv"').replace(/"image":"[^"]*",/, '');
  const p2 = parseLetterboxdFilm(tv);
  assert.equal(p2.poster, undefined);
  assert.deepEqual(p2.ids, { imdb: 'tt0123456' });
});

test('toData keeps the new fields and still builds ratings', () => {
  assert.equal(data.poster, parsed.poster);
  assert.equal(data.ratings.letterboxd.value, 3.9);
  assert.deepEqual(data.ids, { imdb: 'tt0123456', tmdb: '4242' });
});

const lbOnly = () => ({ key: 'lid:a', title: 'Example Harbour', year: 2001, ids: {}, src: { lbpage: data }, checked: {}, missed: {} });

test('compose: a film found only on Letterboxd gets a complete card', () => {
  const c = compose(lbOnly());
  assert.equal(c.poster.url, data.poster); // changed 29 Oct: posters come out as { url, thumb } whatever the source stored
  assert.equal(c.sources.poster, 'lbpage');
  assert.equal(c.synopsis, data.synopsis);
  assert.deepEqual(c.genres, ['Drama', 'Mystery']);
  assert.equal(c.runtime, 112);
  assert.equal(c.released, '2001-05-03');
  assert.deepEqual(c.countries, ['Australia', 'Canada']);
  assert.deepEqual(c.languages, ['en', 'fr']);
  assert.deepEqual(c.studios, ['Invented Pictures']);
  assert.equal(c.people.director[0].name, 'Ada Fictional');
  assert.equal(c.people.cast.length, 8);
  assert.equal(c.ids.imdb, 'tt0123456');
  assert.equal(c.ids.tmdb, '4242');
});

test('compose: other sources keep winning; lbpage only fills gaps (poster excepted: Letterboxd now beats Wikipedia, 29 Oct)', () => {
  const f = lbOnly();
  f.ids = { imdb: 'tt9999999' };
  f.src.wikipedia = { poster: 'https://wiki/p.jpg', synopsis: 'Wiki text.' };
  f.src.wikidata = { genres: ['Thriller'], runtime: 100, people: { director: [{ name: 'W Person', id: 'wd:Q1' }] }, countries: ['Canada'] };
  const c = compose(f);
  assert.equal(c.poster.url, data.poster); // changed 29 Oct: lbpage poster is preferred over Wikipedia's (bare strings come out as { url, thumb })
  assert.equal(c.sources.poster, 'lbpage');
  assert.equal(c.synopsis, 'Wiki text.');
  assert.deepEqual(c.genres, ['Thriller']);
  assert.equal(c.runtime, 100);
  assert.deepEqual(c.countries, ['Canada']);
  assert.equal(c.people.director[0].id, 'wd:Q1');
  assert.equal(c.people.cast.length, 8); // roles are chosen one by one: Wikidata had no cast
  assert.equal(c.ids.imdb, 'tt9999999'); // a disagreeing id is not applied
  assert.equal(c.ids.tmdb, '4242');      // a gap is filled
});

test('compose: tmdb poster beats lbpage, which beats wikipedia, omdb and rss', () => {
  const f = lbOnly();
  f.src.rss = { poster: 'https://rss/p.jpg' };
  f.src.wikipedia = { poster: { url: 'https://wiki/p.jpg' } };
  assert.equal(compose(f).poster.url, data.poster);
  f.src.tmdb = { poster: 'https://tmdb/p.jpg' };
  assert.equal(compose(f).poster.url, 'https://tmdb/p.jpg');
  delete f.src.tmdb; delete f.src.lbpage;
  assert.equal(compose(f).poster.url, 'https://wiki/p.jpg');
  f.src.omdb = { poster: { url: 'https://omdb/p.jpg' } };
  assert.equal(compose(f).poster.url, 'https://wiki/p.jpg');
  delete f.src.wikipedia;
  assert.equal(compose(f).poster.url, 'https://omdb/p.jpg');
  delete f.src.omdb;
  assert.equal(compose(f).poster.url, 'https://rss/p.jpg');
});

test('provider: re-reads once (since moved) and a 429 stops the pass without opening the window', async () => {
  assert.ok(Date.parse(lbpage.since) >= Date.parse('2026-10-28'));
  const rec = { win: 0, fail: [], done: 0 };
  for (const mode of ['returned', 'thrown']) {
    const http = {
      async browserText() { if (mode === 'thrown') throw Object.assign(new Error('x'), { status: 429 }); return { status: 429, text: '' }; },
      async page() { rec.win++; return { status: 200, text: html }; },
    };
    let progress = 0;
    await lbpage.enrich([1, 2, 3].map(n => ({ key: `lid:${n}`, slug: 'x' })), {
      http, progress: () => progress++, log() {}, done: () => rec.done++, fail: (f, e) => rec.fail.push(e),
    });
  }
  assert.equal(rec.win, 0);
  assert.equal(rec.done, 0);
  assert.equal(rec.fail.length, 2); // one failed film per mode, then the pass stopped
});
