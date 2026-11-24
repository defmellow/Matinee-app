import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNowShowing, parseListing, parseFilmPage, parseSitemap, parseComingSoon, splitLabel, titleFromSlug, slugFromUrl, decodeText, jsonLdNodes } from '../../core/parse/dendy.js';

// Synthetic pages (invented films) that mimic the structure of the cinema's JSON-LD.
const fx = n => readFileSync(new URL(`../fixtures/synthetic/${n}`, import.meta.url), 'utf8');

test('list page: films, labels, sessions and the 20-session cap flag', () => {
  const r = parseListing(fx('dendy-now-showing.html'));
  assert.equal(r.hasTheater, true);
  assert.equal(r.eventCount, 20);
  assert.equal(r.capped, true);
  assert.deepEqual(r.films.map(f => f.slug), ['the-velvet-orchard', 'retrospective-cafe-lumiere', 'harbour-lights', 'night-ferry-2']);
  const retro = r.films[1];
  assert.equal(retro.title, 'Café Lumière');
  assert.equal(retro.label, "Director's Cut");
  assert.equal(retro.rating, null);
  assert.deepEqual(retro.directors, []);
  assert.equal(retro.runtimeMin, 125);
  assert.equal(retro.path, '/movie/retrospective-cafe-lumiere/');
  assert.equal(r.films[3].title, 'Night Ferry');
  assert.equal(r.films[3].label, '4K Restoration');
  const first = r.films[0];
  assert.equal(first.sessions.length, 5);
  assert.deepEqual(first.sessions[0], { date: '2026-10-28', time: '10:00', bookingUrl: 'https://newtown.dendy.com.au/checkout/showing/the-velvet-orchard/1000/' });
  assert.equal(first.firstDate, '2026-10-01'); // dateCreated: Dendy's first-showing date, not the first session
  assert.deepEqual(first.dates, ['2026-10-28']);
  assert.equal(parseNowShowing(fx('dendy-now-showing.html')).length, 4);
});

test('film page: sessions in order, duplicates dropped, dates and times as written', () => {
  const f = parseFilmPage(fx('dendy-film.html'));
  assert.equal(f.title, 'The Velvet Orchard');
  assert.equal(f.slug, 'the-velvet-orchard');
  assert.deepEqual(f.sessions.map(s => s.date + ' ' + s.time), ['2026-10-29 13:15', '2026-10-29 18:00', '2026-10-30 10:30', '2026-11-05 19:45', '2026-12-20 20:00']);
});

test('a list under 20 sessions is not flagged as capped', () => {
  const html = fx('dendy-now-showing.html');
  const r = parseListing(html.replace(/"startDate": "2026-10-28T13:00:00\+11:00"/g, '"startDate": "nonsense"'));
  assert.ok(r.eventCount < 20);
  assert.equal(r.capped, false);
});

test('malformed or unexpected input fails soft', () => {
  for (const bad of ['', null, undefined, '<html><body>nothing</body></html>', '<script type="application/ld+json">{oops</script>', '<script type="application/ld+json">[1,null,"x"]</script>']) {
    assert.deepEqual(parseNowShowing(bad), []);
    assert.equal(parseFilmPage(bad), null);
  }
  const half = '<script type="application/ld+json">{bad</script>' + fx('dendy-film.html');
  assert.equal(parseFilmPage(half).sessions.length, 5);
  assert.equal(jsonLdNodes('<script type="application/ld+json">{"@type":"Movie"}</script>').length, 1);
});

test('events without a usable date or film are ignored; a foreign booking link is not kept', () => {
  const html = `<script type="application/ld+json">{"@graph":[
    {"@type":"Movie","@id":"https://x/movie/a-film/#movie","name":"A Film"},
    {"@type":"ScreeningEvent","startDate":"2026-11-01T19:30:00+11:00","url":"https://elsewhere.example/buy","workPresented":{"@id":"https://x/movie/a-film/#movie"}},
    {"@type":"ScreeningEvent","startDate":"soon","workPresented":{"@id":"https://x/movie/a-film/#movie"}},
    {"@type":"ScreeningEvent","startDate":"2026-11-02T19:30:00+11:00"}]}</script>`;
  const f = parseFilmPage(html);
  assert.deepEqual(f.sessions, [{ date: '2026-11-01', time: '19:30' }]);
});

test('film page keeps directors, rating, first date (not a year), runtime and flags a full 20 sessions', () => {
  const f = parseFilmPage(fx('dendy-film.html'));
  assert.deepEqual(f.directors, ['Iris Calloway']);
  assert.equal(f.rating, 'M');
  assert.equal(f.firstDate, '2026-10-01');
  assert.equal(f.runtimeMin, 110);
  assert.equal(f.kind, 'film');
  assert.equal(f.maybeCut, false);
  const ev = (i) => `{"@type":"ScreeningEvent","startDate":"2026-11-01T${String(8 + i).padStart(2, '0')}:00:00+11:00","workPresented":{"@id":"https://x/movie/a-film/#movie"}}`;
  const mk = n => `<script type="application/ld+json">{"@graph":[{"@type":"Movie","@id":"https://x/movie/a-film/#movie","name":"A Film"},${Array.from({ length: n }, (_, i) => ev(i)).join(',')}]}</script>`;
  assert.equal(parseFilmPage(mk(20)).maybeCut, true);
  assert.equal(parseFilmPage(mk(19)).maybeCut, false);
  const none = parseFilmPage(fx('dendy-film-future.html'));
  assert.equal(none.sessions.length, 0);
  assert.equal(none.firstDate, '2026-12-16');
  assert.equal(none.rating, 'CTC');
  assert.equal(none.kind, 'film');
  assert.deepEqual(none.directors, ['Dena Vilas']);
  const noDate = parseFilmPage(mk(1));
  assert.equal(noDate.firstDate, null);
});

test('rating E makes a film an event', () => {
  const f = parseFilmPage(fx('dendy-film-event.html'));
  assert.equal(f.rating, 'E');
  assert.equal(f.kind, 'event');
  assert.equal(f.title, 'Example Play');
  assert.equal(f.label, 'NT Live');
  const plain = `<script type="application/ld+json">{"@graph":[{"@type":"Movie","@id":"https://x/movie/reel-thing/#movie","name":"Some Exhibit","contentRating":"E"}]}</script>`;
  assert.equal(parseFilmPage(plain).kind, 'event');
});

test('sitemap: film slugs only, in order, no duplicates, odd slug shapes kept', () => {
  assert.deepEqual(parseSitemap(fx('dendy-sitemap.xml')), [
    'the-velvet-orchard', 'a-tale-of-two-lanterns-', '8', '1900-novecento-example---original-directors-cut', 'harbour-lights---directors-cut']);
  assert.deepEqual(parseSitemap(''), []);
  assert.deepEqual(parseSitemap(null), []);
  assert.deepEqual(parseSitemap('<urlset><loc>nothing</loc></urlset>'), []);
});

test('coming soon: anchors to film pages, entities decoded, duplicates and other links ignored', () => {
  const r = parseComingSoon(fx('dendy-coming-soon.html'));
  assert.equal(r.hasTheater, true);
  assert.deepEqual(r.films, [
    { slug: 'dune-example-part-three', title: 'Dune Example: Part Three' },
    { slug: 'house-hausu-example-', title: 'House (Hausu Example)' },
    { slug: 'the-lamp-keepers-daughter', title: "The Lamp Keeper's Daughter" },
    { slug: 'love-example---20th-anniversary', title: 'Love Example' },
    { slug: 'rock-&-roll-night', title: 'Rock & Roll Night' },
  ].filter(f => f.slug !== 'rock-&-roll-night'));
  assert.deepEqual(parseComingSoon('<html>Just a moment...</html>'), { films: [], hasTheater: false });
  assert.deepEqual(parseComingSoon(null), { films: [], hasTheater: false });
});

test('slugs: trailing hyphens, triple hyphens and bare digits', () => {
  assert.equal(slugFromUrl('https://newtown.dendy.com.au/movie/a-tale-of-two-lanterns-/'), 'a-tale-of-two-lanterns-');
  assert.equal(slugFromUrl('https://newtown.dendy.com.au/movie/8/'), '8');
  assert.equal(slugFromUrl('https://x/movie/1900-novecento-example---original-directors-cut/#movie'), '1900-novecento-example---original-directors-cut');
  assert.equal(slugFromUrl('https://x/movie/a/checkout/'), null);
  assert.equal(slugFromUrl('https://x/now-showing/'), null);
  assert.equal(titleFromSlug('alien---directors-cut'), 'alien - directors cut');
  assert.equal(titleFromSlug('house-hausu-'), 'house hausu');
});

test('decodeText: entities, curly apostrophes, spaces', () => {
  assert.equal(decodeText('  Don&#39;t&nbsp;Look &amp; Run  '), "Don't Look & Run");
  assert.equal(decodeText('Schindler\u2019s  List'), "Schindler's List");
  assert.equal(decodeText(null), '');
});

test('title shapes seen on the real site (invented films)', () => {
  const s = (raw) => { const { title, label, kind } = splitLabel(raw); return [title, label, kind]; };
  // edition after a dash
  assert.deepEqual(s('Nightmare Ship - Directors Cut'), ['Nightmare Ship', "Director's Cut", 'film']);
  assert.deepEqual(s("The Haunted Lift - Director's Cut"), ['The Haunted Lift', "Director's Cut", 'film']);
  assert.deepEqual(s('The Gleaming - 4k Extended Cut'), ['The Gleaming', '4K Extended Cut', 'film']);
  assert.deepEqual(s('Das Boat Example - Complete Uncut Version'), ['Das Boat Example', 'Complete Uncut Version', 'film']);
  assert.deepEqual(s('Sisters and Brothers - TV Miniseries'), ['Sisters and Brothers', 'TV Miniseries', 'film']);
  assert.deepEqual(s('Love Example - 20th Anniversary'), ['Love Example', '20th Anniversary', 'film']);
  // edition in brackets
  assert.deepEqual(s('The Godfather Example (4K Re-release)'), ['The Godfather Example', '4K Re-release', 'film']);
  assert.deepEqual(s('Lake Example (4K Restoration)'), ['Lake Example', '4K Restoration', 'film']);
  // other name in brackets: tried with and without the tail
  assert.deepEqual(splitLabel('House (Hausu Example) ').variants, ['House', 'House Hausu Example', 'Hausu Example']);
  assert.equal(splitLabel('House (Hausu Example) ').label, null);
  const both = splitLabel("1900 (Novecento Example) - Original Director's Cut");
  assert.equal(both.title, '1900');
  assert.equal(both.label, "Original Director's Cut");
  assert.deepEqual(both.variants, ['1900', '1900 Novecento Example', 'Novecento Example']);
  // a dash inside a name is not an edition
  assert.deepEqual(s('Spider-Man Example'), ['Spider-Man Example', null, 'film']);
  assert.deepEqual(s('Mission - Impossible Example'), ['Mission - Impossible Example', null, 'film']);
  // events
  assert.deepEqual(s('EXHIBITION ON SCREEN: Monet Example'), ['Monet Example', 'Exhibition on Screen', 'event']);
  assert.deepEqual(s('NT Live: Golden Example'), ['Golden Example', 'NT Live', 'event']);
  assert.deepEqual(s('Movie Trivia at The Den'), ['Movie Trivia at The Den', null, 'event']);
  assert.deepEqual(s('Rivals Example - Season 1 Marathon'), ['Rivals Example', 'Season 1 Marathon', 'event']);
  assert.deepEqual(s("Andrew Example's Starlight Express - Live on Stage"), ["Andrew Example's Starlight Express", 'Live on Stage', 'event']);
  assert.deepEqual(s("Andre Example's 2026 Christmas Concert: Let It Snow"), ["Andre Example's 2026 Christmas Concert: Let It Snow", null, 'event']);
  assert.equal(splitLabel('Reel Rock 20').kind, 'event');
  // ordinary prefixes are left alone, the old invented prefixes no longer exist
  assert.deepEqual(s('Doctor Example: The Pit'), ['Doctor Example: The Pit', null, 'film']);
  assert.deepEqual(s('Retrospective: Alien'), ['Retrospective: Alien', null, 'film']);
  // apostrophes and spaces
  assert.equal(splitLabel('Don\u2019t  Look').title, "Don't Look");
  assert.deepEqual(s('Plain Title'), ['Plain Title', null, 'film']);
  assert.deepEqual(s(null), ['', null, 'film']);
});
