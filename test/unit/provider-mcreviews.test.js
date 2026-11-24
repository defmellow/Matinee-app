// Metacritic reviews: parsers and provider. Fixtures in test/fixtures/synthetic/mcreviews-*.html are trimmed copies of
// real pages (Paris, Texas, fetched 22 Oct 2026). No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMcCritics, parseMcUsers, isMostlyEnglish, clip } from '../../core/parse/reviews.js';
import mcreviews from '../../core/providers/mcreviews.js';
import { defaultWants } from '../../core/enrich.js';

const html = name => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), 'utf8');
const card = (quote, title) => `<div data-testid="review-card"><a href="/user/secret_handle/"><div title="${title}">x</div> secret_handle</a><div data-testid="review-quote-text">${quote}</div></div>`;

test('critics parser: quotes and 0–100 scores, entities decoded, no names', () => {
  const r = parseMcCritics(html('mcreviews-critics.html'));
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], { text: 'Then there are the miracles of the performances by Harry Dean Stanton, Nastassja Kinski and Hunter Carson.', score: 100 });
  assert.ok(r.every(x => x.text.length <= 320 && Number.isInteger(x.score)));
  assert.ok(r.some(x => x.text.includes('"America."')));
  assert.ok(r.every(x => !/Ebert|Chicago/.test(JSON.stringify(x))));
});

test('users parser: 0–10 scores, long reviews cut at a word boundary, Spanish dropped, no usernames', () => {
  const r = parseMcUsers(html('mcreviews-users.html'));
  assert.equal(r.length, 4); // 5 cards, one in Spanish
  assert.deepEqual(r[0], { text: "Absentee fathers don't deserve redemption or closure. To hell with the directors who glorify this trope.", score: 5 });
  assert.ok(r.every(x => x.text.length <= 320 && x.score >= 0 && x.score <= 10));
  const cut = r.find(x => x.text.startsWith("They don't make"));
  assert.ok(cut.text.endsWith('…') && !/\s…$/.test(cut.text));
  assert.ok(!JSON.stringify(r).includes('sachineldho'));
});

test('parsers: empty or odd input gives [], duplicates and empties dropped, max 10', () => {
  assert.deepEqual(parseMcUsers(''), []);
  assert.deepEqual(parseMcCritics(null), []);
  assert.deepEqual(parseMcCritics('<html>nothing here</html>'), []);
  const page = card('Lovely film.', 'Metascore 80 out of 100') + card('lovely film.', 'Metascore 70 out of 100') + card('  ', 'Metascore 60 out of 100');
  assert.deepEqual(parseMcCritics(page), [{ text: 'Lovely film.', score: 80 }]);
  const many = Array.from({ length: 15 }, (_, i) => card(`Review ${i} is fine.`, 'User score 7 out of 10')).join('');
  assert.equal(parseMcUsers(many).length, 10);
  assert.deepEqual(parseMcUsers(card('No score here.', 'nothing')), [{ text: 'No score here.' }]);
});

test('isMostlyEnglish', () => {
  assert.equal(isMostlyEnglish('Enigmatic and fascinating.'), true);
  assert.equal(isMostlyEnglish('Una película muy buena'), true); // short ASCII-ish texts pass
  assert.equal(isMostlyEnglish('これは素晴らしい映画です'), false);
  assert.equal(isMostlyEnglish('Eine wunderbare Geschichte über Liebe und Verlust, die man nicht so schnell vergisst, wirklich sehr gut.'), false);
  assert.equal(isMostlyEnglish('The story is slow but it is a moving portrait of loss, told with real patience and care.'), true);
  assert.equal(isMostlyEnglish(''), false);
});

test('clip: cuts at a word boundary with an ellipsis', () => {
  assert.equal(clip('  short   text '), 'short text');
  const c = clip('word '.repeat(100), 50);
  assert.ok(c.length <= 50 && c.endsWith('word…'));
});

// ---------- provider ----------

function makeCtx(handler, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [], urls: [] };
  const http = { async text(url, opts) { rec.urls.push([url, opts]); return handler(url); } };
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
const film = (n = 1) => ({ key: `lid:${n}`, title: 'Paris, Texas', year: 1984, ids: { metacritic: 'movie/paris-texas' } });
const pages = url => ok(html(url.includes('critic-reviews') ? 'mcreviews-critics.html' : 'mcreviews-users.html'));

test('provider shape and wants: only films that already have a Metacritic id', () => {
  assert.equal(mcreviews.id, 'mcreviews');
  assert.equal(mcreviews.needsKey, false);
  assert.deepEqual(mcreviews.gives, ['critic quotes', 'audience reviews']);
  assert.equal(mcreviews.refreshDays, 180);
  assert.equal(mcreviews.retryMissDays, 45);
  assert.equal(defaultWants(mcreviews, { key: 'a', ids: {} }), false);
  assert.equal(defaultWants(mcreviews, film()), true);
});

test('provider: fetches the critic then user pages in order and stores both lists', async () => {
  const { ctx, rec } = makeCtx(pages);
  await mcreviews.enrich([film()], ctx);
  assert.deepEqual(rec.urls.map(u => u[0]), [
    'https://www.metacritic.com/movie/paris-texas/critic-reviews/',
    'https://www.metacritic.com/movie/paris-texas/user-reviews/',
  ]);
  assert.ok(rec.urls.every(u => u[1].browser === true));
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data.critics.length, 5);
  assert.equal(rec.done[0].data.users.length, 4);
  assert.deepEqual(rec.progress.at(-1), [1, 1]);
});

test('provider: 404 or no reviews on either page records a miss (null); one list is enough to store', async () => {
  let { ctx, rec } = makeCtx(() => ({ status: 404, text: '' }));
  await mcreviews.enrich([film()], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  ({ ctx, rec } = makeCtx(url => (url.includes('critic-reviews') ? ok('<html><head><title>Critic Reviews - Metacritic</title></head></html>') : ok(html('mcreviews-users.html')))));
  await mcreviews.enrich([film()], ctx);
  assert.equal(rec.done[0].data.critics.length, 0);
  assert.equal(rec.done[0].data.users.length, 4);
});

test('provider: three blocked films in a row stop the run; nothing is recorded as a miss', async () => {
  const { ctx, rec } = makeCtx(() => ({ status: 403, text: '' }));
  await mcreviews.enrich([1, 2, 3, 4, 5].map(film), ctx);
  assert.equal(rec.fail.length, 3);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.urls.length, 3);
  assert.match(rec.log[0], /stopped asking/);
});

test('provider: an aborted signal stops straight away', async () => {
  const ac = new AbortController(); ac.abort();
  const { ctx, rec } = makeCtx(pages, { signal: ac.signal });
  await assert.rejects(mcreviews.enrich([film()], ctx), { code: 'aborted' });
  assert.equal(rec.urls.length, 0);
});

// ---------- redirects (Metacritic moves "movie/alien" to "movie/alien-1979"), synthetic ----------
const alien = (year = 1979) => ({ key: 'lid:a', title: 'Alien', year, ids: { metacritic: 'movie/alien' } });
const moved = (to, extra = {}) => ({ status: 301, text: '', headers: new Headers({ location: to }), ...extra });
const critics = html('mcreviews-critics.html'), users = html('mcreviews-users.html');

test('mcreviews: follows a 301 to the year-suffixed slug, reads both pages there and remembers the slug', async () => {
  const f = alien();
  const { ctx, rec } = makeCtx(url => {
    if (url === 'https://www.metacritic.com/movie/alien/critic-reviews/') return moved('/movie/alien-1979/critic-reviews/');
    if (url === 'https://www.metacritic.com/movie/alien-1979/critic-reviews/') return ok(critics);
    if (url === 'https://www.metacritic.com/movie/alien-1979/user-reviews/') return ok(users);
    return { status: 404, text: '' };
  });
  await mcreviews.enrich([f], ctx);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data.critics.length, 5);
  assert.equal(f.ids.metacritic, 'movie/alien-1979');
  assert.ok(rec.urls.every(u => !u[0].includes('/movie/alien/user-reviews')));
});

test('mcreviews: a redirect to a different year is a miss, not a failure, and the slug is left alone', async () => {
  const f = alien();
  const { ctx, rec } = makeCtx(url => (url.includes('/movie/alien/') ? moved('/movie/alien-1986/critic-reviews/') : ok(critics)));
  await mcreviews.enrich([f], ctx);
  assert.equal(rec.fail.length, 0);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  assert.equal(f.ids.metacritic, 'movie/alien');
});

test('mcreviews: a redirect that never lands (loop) is a miss, not a failure', async () => {
  const { ctx, rec } = makeCtx(() => moved('/movie/alien/critic-reviews/'));
  await mcreviews.enrich([alien()], ctx);
  assert.equal(rec.fail.length, 0);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
});

// ---------- known id whose page is another film's (year shown on the page), synthetic ----------
const yearPage = (name, date, body) => `<html><head><title>${name} critic reviews - Metacritic</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name, datePublished: date, aggregateRating: { ratingValue: 60, reviewCount: 9 } })}</script></head><body>${body}</body></html>`;

test('mcreviews: a wrong-year page tries the year-suffixed slug once; the id is replaced when that fits', async () => {
  const f = { key: 's', title: 'Solaris', year: 1972, ids: { metacritic: 'movie/solaris' } };
  const { ctx, rec } = makeCtx(url => (url.includes('solaris-1972')
    ? ok(url.includes('critic-reviews') ? critics : users)
    : ok(yearPage('Solaris', '2002-11-27', ''))));
  await mcreviews.enrich([f], ctx);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data.critics.length, 5);
  assert.equal(f.ids.metacritic, 'movie/solaris-1972');
});

test('mcreviews: a wrong-year page with no fitting fallback is a miss; a page with no year is accepted', async () => {
  const f = { key: 's', title: 'Solaris', year: 1972, ids: { metacritic: 'movie/solaris' } };
  let { ctx, rec } = makeCtx(url => (url.includes('-1972') ? { status: 404, text: '' } : ok(yearPage('Solaris', '2002-11-27', ''))));
  await mcreviews.enrich([f], ctx);
  assert.deepEqual(rec.done.map(d => d.data), [null]);
  assert.equal(f.ids.metacritic, 'movie/solaris');
  ({ ctx, rec } = makeCtx(pages)); // the fixture pages show no year
  await mcreviews.enrich([f], ctx);
  assert.equal(rec.done[0].data.critics.length, 5);
});
