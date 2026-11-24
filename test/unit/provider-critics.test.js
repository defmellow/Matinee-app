// Rotten Tomatoes + Metacritic: the pure parsers and the two providers, with no network.
// Fixtures in test/fixtures/synthetic/rt-*.html and mc-*.html are trimmed copies of real pages (fetched 21 Oct 2026:
// only the script tags / score elements the parsers read are kept). A few cases build tiny synthetic pages inline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRottenTomatoes, parseMetacritic } from '../../core/parse/critics.js';
import rt, { rtSlug, rtGuesses } from '../../core/providers/rottentomatoes.js';
import mc, { mcSlug, mcGuesses } from '../../core/providers/metacritic.js';
import { HttpError } from '../../core/net.js';
import { defaultWants, enrich } from '../../core/enrich.js';
import { compose } from '../../core/model.js';

const html = name => readFileSync(new URL(`../fixtures/synthetic/${name}`, import.meta.url), 'utf8');
const THIS_YEAR = new Date().getFullYear();

// ---------- Rotten Tomatoes parser ----------

test('RT parser: Paris, Texas has both scores, a certified Tomatometer and counts', () => {
  assert.deepEqual(parseRottenTomatoes(html('rt-paris-texas.html')), {
    critics: 95, criticsCount: 60, certified: true, audience: 93, audienceCount: 6084 + 479, year: 1984, title: 'Paris, Texas',
  });
});

test('RT parser: a film with no Tomatometer yet keeps only the audience score (counts from liked + not liked)', () => {
  const p = parseRottenTomatoes(html('rt-flow-2005.html'));
  assert.deepEqual(p, { audience: 67, audienceCount: 12, year: 2005, title: 'Flow' });
  assert.equal('critics' in p, false);
  assert.equal('certified' in p, false);
});

test('RT parser: a verified-audience Popcornmeter (recent film) is read like any other', () => {
  assert.deepEqual(parseRottenTomatoes(html('rt-flow-2024.html')), {
    critics: 97, criticsCount: 196, certified: true, audience: 98, audienceCount: 547 + 11, year: 2024, title: 'Flow',
  });
});

test('RT parser: a film with no scores at all has no score fields; the year comes from the ld+json when the hero has a date', () => {
  assert.deepEqual(parseRottenTomatoes(html('rt-upcoming.html')), { year: 2026, title: 'Avengers: Doomsday' });
});

test('RT parser: hideAudienceScore removes the audience score and its count, keeps the critics', () => {
  const hidden = html('rt-paris-texas.html').replace('"hideAudienceScore":false', '"hideAudienceScore":true');
  assert.notEqual(hidden, html('rt-paris-texas.html'));
  assert.deepEqual(parseRottenTomatoes(hidden), { critics: 95, criticsCount: 60, certified: true, year: 1984, title: 'Paris, Texas' });
});

/** A tiny synthetic RT page. */
function rtPage({ title = 'Some Film', props = ['R', '2019', '1h 40m'], critics, audience, hide = false } = {}) {
  const card = { hideAudienceScore: hide };
  if (critics) card.criticsScore = critics;
  if (audience) card.audienceScore = audience;
  return `<html><head><title>${title} | Rotten Tomatoes</title></head><body>
<script id="media-hero-json" type="application/json">${JSON.stringify({ content: { title, metadataProps: props } })}</script>
<script id="media-scorecard-json" type="application/json">${JSON.stringify(card)}</script></body></html>`;
}

test('RT parser: scores are strings; null, empty or out-of-range scores are left out', () => {
  const p = parseRottenTomatoes(rtPage({ critics: { score: null, reviewCount: 3 }, audience: { score: '', likedCount: 4, notLikedCount: 1 } }));
  assert.deepEqual(p, { year: 2019, title: 'Some Film' });
  assert.deepEqual(parseRottenTomatoes(rtPage({ critics: { score: '140' } })), { year: 2019, title: 'Some Film' });
  assert.equal(parseRottenTomatoes(rtPage({ critics: { score: '0', reviewCount: 12, certified: false } })).critics, 0);
});

test('RT parser: with no liked counts the audience count is the digits of the banded text; "Fewer than N" is no count', () => {
  const a = parseRottenTomatoes(rtPage({ audience: { score: '88', bandedRatingCount: '10,000+ Ratings' } }));
  assert.equal(a.audience, 88);
  assert.equal(a.audienceCount, 10000);
  const b = parseRottenTomatoes(rtPage({ audience: { score: '88', bandedRatingCount: 'Fewer than 50 Verified Ratings' } }));
  assert.equal(b.audience, 88);
  assert.equal('audienceCount' in b, false);
});

test('RT parser: the year is found inside "May 2026" and ignores runtimes and release-date text', () => {
  assert.equal(parseRottenTomatoes(rtPage({ props: ['PG-13', 'May 2026', '2h 12m'] })).year, 2026);
  assert.equal('year' in parseRottenTomatoes(rtPage({ props: ['In Theaters Dec 18', '2h 45m'] })), false);
});

test('RT parser: script attributes can come in any order and over several lines; entities in titles are decoded', () => {
  const page = `<script type="application/json"
   data-json="mediaHero"
   id="media-hero-json">{"content":{"title":"Schindler&#39;s List &amp; Co","metadataProps":["R","1993"]}}</script>`;
  assert.deepEqual(parseRottenTomatoes(page), { title: "Schindler's List & Co", year: 1993 });
});

test('RT parser: pages that are not film pages give null', () => {
  assert.equal(parseRottenTomatoes(''), null);
  assert.equal(parseRottenTomatoes(undefined), null);
  assert.equal(parseRottenTomatoes('<html><title>Just a moment...</title></html>'), null);
  assert.equal(parseRottenTomatoes('<script id="media-scorecard-json" type="application/json">{broken</script>'), null);
});

// ---------- Metacritic parser ----------

test('MC parser: Paris, Texas reads the Metascore from ld+json and the user score from the global badge, not from a review card', () => {
  assert.deepEqual(parseMetacritic(html('mc-paris-texas.html')), {
    critics: 81, criticsCount: 13, users: 7.7, usersCount: 95, year: 1984, title: 'Paris, Texas',
  });
});

test('MC parser: a user score of TBD (too few ratings) is left out, even though a review card on the page has a score', () => {
  const p = parseMetacritic(html('mc-flow-love-of-water.html'));
  assert.equal(p.critics, 67);
  assert.equal(p.criticsCount, 11);
  assert.equal(p.year, 2008);
  assert.equal(p.title, 'Flow: For Love of Water');
  assert.equal('users' in p, false);
  assert.equal('usersCount' in p, false);
});

test('MC parser: a film with no scores yet (no aggregateRating, both TBD) has no score fields', () => {
  assert.deepEqual(parseMetacritic(html('mc-upcoming.html')), { year: 2026, title: 'Avengers: Doomsday' });
});

test('MC parser: Flow (2024)', () => {
  assert.deepEqual(parseMetacritic(html('mc-flow-2024.html')), {
    critics: 87, criticsCount: 31, users: 8.2, usersCount: 348, year: 2024, title: 'Flow',
  });
});

/** A tiny synthetic MC page. */
function mcPage({ ld, body = '' } = {}) {
  const movie = { '@context': 'https://schema.org', '@type': 'Movie', name: 'Some Film', datePublished: '2019-05-01', ...ld };
  return `<html><head><script type="application/ld+json">${JSON.stringify(movie)}</script></head><body>${body}</body></html>`;
}
const userBadge = (score, n) => `<a href="/user-reviews/">Based on ${n} User Ratings</a>
<div title="User score ${score} out of 10" aria-label="User score ${score} out of 10" data-testid="global-score-value-wrapper"><span>${score}</span></div>`;

test('MC parser: a count with a thousands separator, and a whole-number user score', () => {
  const p = parseMetacritic(mcPage({ body: userBadge('7', '1,294') }));
  assert.equal(p.users, 7);
  assert.equal(p.usersCount, 1294);
});

test('MC parser: ld+json may be an array or an @graph, and string ratings still parse', () => {
  const graph = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Movie', name: 'G', datePublished: '2001-01-01', aggregateRating: { ratingValue: '64', reviewCount: '9' } }] })}</script>`;
  assert.deepEqual(parseMetacritic(graph), { critics: 64, criticsCount: 9, title: 'G', year: 2001 });
});

test('MC parser: old-layout fallbacks (badge without the test id; Metascore from the markup when ld+json has no rating)', () => {
  const body = '<div title="Metascore 72 out of 100"></div><a>Based on 20 Critic Reviews</a>'
    + '<a>Based on 41 User Ratings</a><div class="x" title="User score 6.5 out of 10"></div>';
  assert.deepEqual(parseMetacritic(mcPage({ body })), { critics: 72, criticsCount: 20, users: 6.5, usersCount: 41, title: 'Some Film', year: 2019 });
});

test('MC parser: pages that are not film pages give null', () => {
  assert.equal(parseMetacritic(''), null);
  assert.equal(parseMetacritic(null), null);
  assert.equal(parseMetacritic('<html><title>Just a moment...</title></html>'), null);
  assert.equal(parseMetacritic('<script type="application/ld+json">{"@type":"TVSeries","name":"X"}</script>'), null);
  assert.equal(parseMetacritic('<script type="application/ld+json">{not json</script>'), null);
});

// ---------- helpers for the provider tests ----------

/** A fake http. Like the real one, text() resolves with { status, url, text } for any status (even 403/404). */
function fakeHttp(route) {
  const calls = [];
  return {
    calls,
    async text(url, opts = {}) {
      calls.push({ url, opts });
      const r = await route(url, calls.length);
      if (r instanceof Error) throw r;
      return { status: r.status ?? 200, url: r.url ?? url, headers: new Headers(), text: r.body ?? '' };
    },
  };
}
const page = body => ({ status: 200, body });
const notFound = { status: 404, body: '<html><title>404</title></html>' };
const blocked = { status: 403, body: '<html>Access denied</html>' };

function makeCtx(http, { signal } = {}) {
  const rec = { done: [], infos: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, settings: {}, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: (...a) => rec.log.push(a.join(' ')),
    done: (film, data, ids, info) => { rec.done.push({ film, data, ids }); rec.infos.push(info); },
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const run = async (provider, films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await provider.enrich(films, ctx); return rec; };
const film = (title, year, ids = {}) => ({ key: `ty:${title}|${year}`, title, year, ids });
const aborted = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

// ---------- both providers: the shared behaviour ----------

const suites = [
  {
    name: 'Rotten Tomatoes', provider: rt, idKey: 'rt', file: 'rt',
    url: id => `https://www.rottentomatoes.com/${id}`,
    knownId: 'm/paris_texas', guesses: { flow: ['m/flow', 'm/flow_2024'], paris: 'm/paris_texas' },
    parisRatings: { critics: 95, criticsCount: 60, certified: true, audience: 93, audienceCount: 6563 },
    // for "no scores yet" pages with a given title/year
    blank: (title, year) => rtPage({ title, props: ['R', String(year)] }),
    scored: (title, year) => rtPage({ title, props: ['R', String(year)], critics: { score: '80', reviewCount: 10, certified: false } }),
  },
  {
    name: 'Metacritic', provider: mc, idKey: 'metacritic', file: 'mc',
    url: id => `https://www.metacritic.com/${id}/`,
    knownId: 'movie/paris-texas', guesses: { flow: ['movie/flow', 'movie/flow-2024'], paris: 'movie/paris-texas' },
    parisRatings: { critics: 81, criticsCount: 13, users: 7.7, usersCount: 95 },
    blank: (title, year) => mcPage({ ld: { name: title, datePublished: `${year}-03-01` } }),
    scored: (title, year) => mcPage({ ld: { name: title, datePublished: `${year}-03-01`, aggregateRating: { ratingValue: 70, reviewCount: 8 } } }),
  },
];

for (const s of suites) {
  const { provider } = s;
  const ratingsKey = s.idKey; // src.<id>.ratings.<same key>: 'rt' and 'metacritic'
  const paris = () => html(`${s.file}-paris-texas.html`);
  const wrongFlow = () => (s.file === 'rt' ? html('rt-flow-2005.html') : html('mc-flow-love-of-water.html'));
  const rightFlow = () => html(`${s.file}-flow-2024.html`);

  test(`${s.name}: provider shape`, () => {
    assert.equal(provider.id, s.idKey);
    assert.equal(provider.label, s.name);
    assert.equal(provider.needsKey, false);
    assert.equal(provider.refreshDays, 14);
    assert.equal(provider.retryMissDays, 30);
    assert.ok(Array.isArray(provider.gives) && provider.gives.length === 2);
    assert.equal(typeof provider.enrich, 'function');
    assert.equal(provider.requires(film('X', 2000)), true, 'runs for films without a known id (it guesses)');
    assert.equal(provider.enabled, undefined);
  });

  test(`${s.name}: default freshness rules (an opened old film re-reads after 45 days, a new one after 2; 30 days to retry a miss)`, () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    const f = (extra = {}) => ({ ...film('X', 2000), ...extra });
    assert.equal(defaultWants(provider, f(), { now }), true);
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-10-15T00:00:00Z' } }), { now, full: true }), false);
    // A film from 2000: its scores no longer move, so 20 days is still fresh when it is opened (it was re-read after 14 before 11 Nov).
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-10-01T00:00:00Z' } }), { now, full: true }), false);
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-09-01T00:00:00Z' } }), { now, full: true }), true);
    // A film in cinemas now: its scores move, so three days is already old when it is opened.
    const hot = { src: { tmdb: { released: '2026-10-10' } } };
    assert.equal(defaultWants(provider, f({ ...hot, checked: { [s.idKey]: '2026-10-20T00:00:00Z' } }), { now, full: true }), false);
    assert.equal(defaultWants(provider, f({ ...hot, checked: { [s.idKey]: '2026-10-18T00:00:00Z' } }), { now, full: true }), true);
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-10-01T00:00:00Z' } }), { now }), false);
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-10-10T00:00:00Z' }, missed: { [s.idKey]: '2026-10-10T00:00:00Z' } }), { now }), false);
    assert.equal(defaultWants(provider, f({ checked: { [s.idKey]: '2026-09-10T00:00:00Z' }, missed: { [s.idKey]: '2026-09-10T00:00:00Z' } }), { now }), true);
  });

  test(`${s.name}: a known id is fetched as a browser, and only the scores found are recorded`, async () => {
    const http = fakeHttp(() => page(paris()));
    const f = film('Paris, Texas', 1984, { [s.idKey]: s.knownId });
    const rec = await run(provider, [f], http);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].url, s.url(s.knownId));
    assert.equal(http.calls[0].opts.browser, true);
    assert.deepEqual(rec.done, [{ film: f, data: { ratings: { [ratingsKey]: s.parisRatings } }, ids: undefined }]);
    assert.deepEqual(rec.fail, []);
    assert.deepEqual(rec.progress.at(-1), [1, 1]);
  });

  test(`${s.name}: the result composes into film.ratings.${ratingsKey}`, async () => {
    const http = fakeHttp(() => page(paris()));
    const rec = await run(provider, [film('Paris, Texas', 1984, { [s.idKey]: s.knownId })], http);
    const composed = compose({ key: 'k', title: 'Paris, Texas', year: 1984, ids: {}, src: { [s.idKey]: rec.done[0].data } });
    assert.deepEqual(composed.ratings[ratingsKey], s.parisRatings);
  });

  test(`${s.name}: a known id with a 404 falls back to the guesses; none found records "found nothing"`, async () => {
    const http = fakeHttp(() => notFound);
    const f = film('Paris, Texas', 1984, { [s.idKey]: 'stale/id' });
    const rec = await run(provider, [f], http);
    assert.deepEqual(http.calls.map(c => c.url), [s.url('stale/id'), s.url(s.guesses.paris), s.url(`${s.guesses.paris}${s.idKey === 'rt' ? '_' : '-'}1984`)]);
    assert.deepEqual(rec.done, [{ film: f, data: null, ids: undefined }]);
    assert.deepEqual(rec.fail, []);
  });

  test(`${s.name}: a dead known id is replaced by the guess that checks out (The Moon 2023)`, async () => {
    const http = fakeHttp(url => (url === s.url('stale/id') ? notFound : page(paris())));
    const f = film('Paris, Texas', 1984, { [s.idKey]: 'stale/id' });
    const rec = await run(provider, [f], http);
    assert.equal(rec.done.length, 1);
    assert.equal(f.ids[s.idKey], s.guesses.paris); // replaced in place: the store only fills ids that are empty
    assert.deepEqual(rec.fail, []);
  });

  test(`${s.name}: a released film whose page has no scores is marked hollow; a film from this year is a plain miss`, async () => {
    const old = film('Quiet Film', 2019, { [s.idKey]: s.knownId });
    const recOld = await run(provider, [old], fakeHttp(() => page(s.blank('Quiet Film', 2019))));
    assert.deepEqual(recOld.infos, [{ hollow: 'no scores on the page' }]);
    const year = new Date().getFullYear();
    const fresh = film('Fresh Film', year, { [s.idKey]: s.knownId });
    const recNew = await run(provider, [fresh], fakeHttp(() => page(s.blank('Fresh Film', year))));
    assert.equal(recNew.done[0].data, null);
    assert.deepEqual(recNew.infos, [undefined]);
  });

  test(`${s.name}: a page with no scores yet records "found nothing"`, async () => {
    const http = fakeHttp(() => page(s.blank('Quiet Film', 2019)));
    const f = film('Quiet Film', 2019, { [s.idKey]: s.knownId });
    const rec = await run(provider, [f], http);
    assert.deepEqual(rec.done, [{ film: f, data: null, ids: undefined }]);
  });

  test(`${s.name}: guessing tries the plain slug first and accepts it when year and title match`, async () => {
    const http = fakeHttp(() => page(paris()));
    const f = film('Paris, Texas', 1984);
    const rec = await run(provider, [f], http);
    assert.deepEqual(http.calls.map(c => c.url), [s.url(s.guesses.paris)]);
    assert.equal(rec.done.length, 1);
    assert.deepEqual(rec.done[0].ids, { [s.idKey]: s.guesses.paris });
    assert.deepEqual(rec.done[0].data.ratings[ratingsKey], s.parisRatings);
  });

  test(`${s.name}: a guess is rejected when its year is wrong, then the slug with the year is tried`, async () => {
    const [first, second] = s.guesses.flow;
    const http = fakeHttp(url => (url === s.url(first) ? page(wrongFlow()) : url === s.url(second) ? page(rightFlow()) : notFound));
    const f = film('Flow', 2024);
    const rec = await run(provider, [f], http);
    assert.deepEqual(http.calls.map(c => c.url), [s.url(first), s.url(second)]);
    assert.equal(rec.done.length, 1);
    assert.deepEqual(rec.done[0].ids, { [s.idKey]: second });
    assert.ok(rec.done[0].data.ratings[ratingsKey].critics >= 80);
  });

  test(`${s.name}: the year may be one out either way, but not two`, async () => {
    for (const [year, accepted] of [[1983, true], [1985, true], [1982, false], [1986, false]]) {
      const http = fakeHttp(() => page(paris()));
      const rec = await run(provider, [film('Paris, Texas', year)], http);
      assert.equal(rec.done.length, 1, `year ${year}`);
      assert.equal(rec.done[0].data !== null, accepted, `year ${year}`);
    }
  });

  test(`${s.name}: a guess whose title is different is rejected even when the year fits`, async () => {
    const http = fakeHttp(() => page(paris()));
    const rec = await run(provider, [film('Paris Nights', 1984)], http);
    assert.equal(http.calls.length, 2, 'both guesses tried');
    assert.deepEqual(rec.done, [{ film: rec.done[0].film, data: null, ids: undefined }]);
  });

  test(`${s.name}: titles are compared ignoring case, accents and punctuation`, async () => {
    const http = fakeHttp(() => page(paris()));
    const rec = await run(provider, [film('PARIS TEXAS', 1984)], http);
    assert.ok(rec.done[0].data, 'accepted');
  });

  test(`${s.name}: both guesses 404 → found nothing, no id recorded`, async () => {
    const http = fakeHttp(() => notFound);
    const f = film('A Film Nobody Made', 2001);
    const rec = await run(provider, [f], http);
    assert.equal(http.calls.length, 2);
    assert.deepEqual(rec.done, [{ film: f, data: null, ids: undefined }]);
  });

  test(`${s.name}: no year, no guessing`, async () => {
    const http = fakeHttp(() => page(paris()));
    const f = film('Paris, Texas', null);
    const rec = await run(provider, [f], http);
    assert.equal(http.calls.length, 0);
    assert.deepEqual(rec.done, [{ film: f, data: null, ids: undefined }]);
  });

  test(`${s.name}: a guess that checks out is remembered even when the page has no scores yet`, async () => {
    const http = fakeHttp(() => page(s.blank('Quiet Film', THIS_YEAR)));
    const rec = await run(provider, [film('Quiet Film', THIS_YEAR)], http);
    assert.equal(rec.done[0].data, null);
    assert.equal(Object.values(rec.done[0].ids)[0], http.calls[0].url.replace(/^https:\/\/[^/]+\//, '').replace(/\/$/, ''));
  });

  test(`${s.name}: a guess that redirects records where it landed`, async () => {
    const landed = s.idKey === 'rt' ? 'm/quiet_film_extended' : 'movie/quiet-film-extended';
    const http = fakeHttp(url => ({ status: 200, url: s.url(landed), body: s.scored('Quiet Film', THIS_YEAR) }));
    const rec = await run(provider, [film('Quiet Film', THIS_YEAR)], http);
    assert.deepEqual(rec.done[0].ids, { [s.idKey]: landed });
  });

  test(`${s.name}: films that are not out yet are skipped, with nothing recorded and no request`, async () => {
    const http = fakeHttp(() => page(paris()));
    const rec = await run(provider, [film('Future Film', THIS_YEAR + 1, { [s.idKey]: s.knownId }), film('Paris, Texas', 1984, { [s.idKey]: s.knownId })], http);
    assert.equal(http.calls.length, 1);
    assert.equal(rec.done.length, 1);
    assert.equal(rec.done[0].film.title, 'Paris, Texas');
    assert.deepEqual(rec.progress.map(p => p[0]), [1, 2]);
    assert.deepEqual(rec.fail, []);
  });

  test(`${s.name}: this year's films are looked up`, async () => {
    const http = fakeHttp(() => page(s.scored('This Year', THIS_YEAR)));
    const rec = await run(provider, [film('This Year', THIS_YEAR)], http);
    assert.equal(http.calls.length, 1);
    assert.ok(rec.done[0].data);
  });

  test(`${s.name}: one film's network error is reported and the next film still runs`, async () => {
    let n = 0;
    const flaky = fakeHttp(() => (++n === 1 ? new Error('socket hang up') : page(paris())));
    const a = film('Paris, Texas', 1984, { [s.idKey]: s.knownId });
    const b = film('Paris, Texas', 1984, { [s.idKey]: s.knownId });
    const rec = await run(provider, [a, b], flaky);
    assert.equal(rec.fail.length, 1);
    assert.equal(rec.fail[0].film, a);
    assert.match(rec.fail[0].err.message, /socket hang up/);
    assert.equal(rec.done.length, 1);
    assert.equal(rec.done[0].film, b);
    assert.deepEqual(rec.progress.map(p => p[0]), [1, 2]);
  });

  test(`${s.name}: an unexpected status (500 after retries) is a failure, not "found nothing"`, async () => {
    const http = fakeHttp(() => new HttpError(503, s.url(s.knownId)));
    const rec = await run(provider, [film('X', 2000, { [s.idKey]: s.knownId })], http);
    assert.equal(rec.done.length, 0);
    assert.equal(rec.fail.length, 1);
  });

  test(`${s.name}: stops for the run after 3 blocked requests in a row, and says so`, async () => {
    const http = fakeHttp(() => blocked);
    const films = [1, 2, 3, 4, 5].map(i => film(`Film ${i}`, 2000 + i, { [s.idKey]: s.knownId }));
    const rec = await run(provider, films, http);
    assert.equal(http.calls.length, 3);
    assert.equal(rec.done.length, 0);
    assert.equal(rec.fail.length, 3, 'each blocked film is reported, so it is retried next time');
    assert.equal(rec.log.length, 1);
    assert.match(rec.log[0], new RegExp(s.name));
    assert.match(rec.log[0], /403/);
    assert.match(rec.log[0], /stopped asking|next time/i);
  });

  test(`${s.name}: 429s (thrown by the http layer once its retries run out) count too`, async () => {
    const http = fakeHttp(url => new HttpError(429, url));
    const films = [1, 2, 3, 4].map(i => film(`Film ${i}`, 2000 + i, { [s.idKey]: s.knownId }));
    const rec = await run(provider, films, http);
    assert.equal(http.calls.length, 3);
    assert.match(rec.log[0], /429/);
  });

  test(`${s.name}: blocked requests that are not in a row do not stop the run`, async () => {
    const script = [blocked, blocked, page(paris()), blocked, blocked, page(paris()), blocked];
    const http = fakeHttp((url, n) => script[n - 1]);
    const films = script.map((_, i) => film(`Film ${i}`, 1984, { [s.idKey]: s.knownId }));
    const rec = await run(provider, films, http);
    assert.equal(http.calls.length, 7);
    assert.equal(rec.done.length, 2);
    assert.equal(rec.fail.length, 5);
    assert.deepEqual(rec.log, []);
  });

  test(`${s.name}: a 404 between blocks resets the count`, async () => {
    const script = [blocked, blocked, notFound, blocked, blocked];
    let known = 0; // only the known-id requests follow the script; the fallback guesses after the 404 also find nothing
    const http = fakeHttp(url => (url === s.url(s.knownId) ? script[known++] : notFound));
    const films = script.map((_, i) => film(`Film ${i}`, 2000, { [s.idKey]: s.knownId }));
    const rec = await run(provider, films, http);
    assert.equal(known, 5);
    assert.deepEqual(rec.log, []);
  });

  test(`${s.name}: a block while guessing stops the guessing for that film and counts once`, async () => {
    const http = fakeHttp(() => blocked);
    const rec = await run(provider, [film('Some Film', 2010)], http);
    assert.equal(http.calls.length, 1);
    assert.equal(rec.fail.length, 1);
    assert.equal(rec.done.length, 0);
  });

  test(`${s.name}: pages that cannot be read (a challenge page with status 200) are failures, and 3 in a row stop the run`, async () => {
    const http = fakeHttp(() => page('<html><title>Just a moment...</title></html>'));
    const films = [1, 2, 3, 4].map(i => film(`Film ${i}`, 2000 + i, { [s.idKey]: s.knownId }));
    const rec = await run(provider, films, http);
    assert.equal(http.calls.length, 3);
    assert.equal(rec.done.length, 0);
    assert.equal(rec.fail.length, 3);
    assert.match(rec.log[0], /could not read/);
  });

  test(`${s.name}: honours the abort signal (before and during a run)`, async () => {
    const ac = new AbortController();
    ac.abort();
    const http = fakeHttp(() => page(paris()));
    await assert.rejects(run(provider, [film('X', 1984, { [s.idKey]: s.knownId })], http, { signal: ac.signal }), { code: 'aborted' });
    assert.equal(http.calls.length, 0);

    const ac2 = new AbortController();
    const http2 = fakeHttp(() => { ac2.abort(); return page(paris()); });
    const films = [1, 2, 3].map(i => film(`Film ${i}`, 1984, { [s.idKey]: s.knownId }));
    await assert.rejects(run(provider, films, http2, { signal: ac2.signal }), { code: 'aborted' });
    assert.equal(http2.calls.length, 1);

    const http3 = fakeHttp(() => aborted());
    await assert.rejects(run(provider, films, http3), { code: 'aborted' });
    assert.equal(http3.calls.length, 1);
  });

  test(`${s.name}: passes the signal on to http`, async () => {
    const ac = new AbortController();
    const http = fakeHttp(() => page(paris()));
    await run(provider, [film('X', 2000, { [s.idKey]: s.knownId })], http, { signal: ac.signal });
    assert.equal(http.calls[0].opts.signal, ac.signal);
  });

  test(`${s.name}: works through enrich(): scores stored, ids remembered, misses marked`, async () => {
    const found = { key: 'a', title: 'Paris, Texas', year: 1984, ids: {}, src: {}, checked: {}, missed: {} };
    const nothing = { key: 'b', title: 'No Such Film', year: 1999, ids: {}, src: {}, checked: {}, missed: {} };
    const store = { library: { settings: {} }, films: { a: found, b: nothing }, touch() {}, flush() {} };
    const http = fakeHttp(url => (url.includes('paris') ? page(paris()) : notFound));
    const { problems } = await enrich({ store, providers: [provider], http });
    assert.deepEqual(problems, []);
    assert.deepEqual(found.src[s.idKey].ratings[ratingsKey], s.parisRatings);
    assert.equal(found.ids[s.idKey], s.guesses.paris);
    assert.ok(found.checked[s.idKey]);
    assert.equal(found.missed[s.idKey], undefined);
    assert.ok(nothing.checked[s.idKey]);
    assert.ok(nothing.missed[s.idKey]);
    assert.equal(nothing.src[s.idKey], undefined);
  });
}

// ---------- slugs ----------

test('RT slugs: lowercase words joined with underscores, punctuation and accents dropped, "&" spelled out', () => {
  assert.equal(rtSlug('Paris, Texas'), 'paris_texas');
  assert.equal(rtSlug("Don't Look Up"), 'dont_look_up');
  assert.equal(rtSlug('Amélie'), 'amelie');
  assert.equal(rtSlug('Mr. & Mrs. Smith'), 'mr_and_mrs_smith');
  assert.equal(rtSlug('WALL·E'), 'wall_e');
  assert.equal(rtSlug('Star Wars: Episode IV – A New Hope'), 'star_wars_episode_iv_a_new_hope');
  assert.deepEqual(rtGuesses({ title: 'Flow', year: 2024 }), ['m/flow', 'm/flow_2024']);
  assert.deepEqual(rtGuesses({ title: 'Flow', year: null }), []);
  assert.deepEqual(rtGuesses({ title: '???', year: 2000 }), []);
});

test('MC slugs: lowercase, accents and apostrophes dropped, everything else non-alphanumeric becomes "-"', () => {
  assert.equal(mcSlug('Paris, Texas'), 'paris-texas');
  assert.equal(mcSlug("Don't Look Up"), 'dont-look-up');
  assert.equal(mcSlug('Amélie'), 'amelie');
  assert.equal(mcSlug('WALL·E'), 'wall-e');
  assert.equal(mcSlug('Mr. & Mrs. Smith'), 'mr-mrs-smith');
  assert.equal(mcSlug('  Flow!  '), 'flow');
  assert.deepEqual(mcGuesses({ title: 'Flow', year: 2024 }), ['movie/flow', 'movie/flow-2024']);
  assert.deepEqual(mcGuesses({ title: 'Flow' }), []);
});

// ---------- Critics Consensus ----------

test('RT parser: Critics Consensus is plain text with entities decoded', () => {
  const p = parseRottenTomatoes(html('rt-consensus-paris-texas.html'));
  assert.equal(p.critics, 95);
  assert.equal(p.consensus, 'A quiet yet deeply moving kind of Western, Paris, Texas captures a place and people like never before (or after).');
});

test('RT parser: no consensus block means no consensus field; long ones are cut at 400 characters', () => {
  assert.equal('consensus' in parseRottenTomatoes(html('rt-flow-2005.html')), false);
  const base = html('rt-consensus-paris-texas.html');
  const long = base.replace(/<p>A quiet yet[\s\S]*?<\/p>/, `<p>${'Word &amp; more '.repeat(60)}</p>`);
  const c = parseRottenTomatoes(long).consensus;
  assert.ok(c.length <= 400 && c.endsWith('…') && c.startsWith('Word & more'));
});

test('RT toData: consensus is stored beside the ratings, and alone when there are no scores', async () => {
  const { toData } = await import('../../core/providers/rottentomatoes.js');
  assert.deepEqual(toData({ critics: 90, consensus: 'Fine.' }), { ratings: { rt: { critics: 90 } }, consensus: 'Fine.' });
  assert.deepEqual(toData({ consensus: 'Fine.' }), { consensus: 'Fine.' });
  assert.equal(toData({ year: 2020 }), null);
});

test('Metacritic: a redirect handed back as a status is followed (same host, a few hops)', async () => {
  const h = new Headers({ location: '/movie/a-hidden-life-2019/' });
  const http = fakeHttp(url => (url.includes('a-hidden-life-2019')
    ? page(html('mc-paris-texas.html'))
    : { status: 301, body: '' }));
  http.text = (orig => async (url, opts) => { const r = await orig(url, opts); return r.status === 301 ? { ...r, headers: h } : r; })(http.text);
  const f = film('Paris, Texas', 1984, { metacritic: 'movie/a-hidden-life' });
  const rec = await run(mc, [f], http);
  assert.equal(http.calls.length, 2);
  assert.deepEqual(rec.fail, []);
  assert.equal(rec.done.length, 1);
});

test('Metacritic: a redirect to another host is not followed and counts as a miss, not a failure', async () => {
  const h = new Headers({ location: 'https://example.com/x' });
  const http = fakeHttp(() => ({ status: 301, body: '' }));
  http.text = (orig => async (url, opts) => ({ ...(await orig(url, opts)), headers: h }))(http.text);
  const rec = await run(mc, [film('Paris, Texas', 1984, { metacritic: 'movie/x' })], http);
  assert.ok(http.calls.every(c => new URL(c.url).host === 'www.metacritic.com')); // never followed to example.com
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
});

// ---------- redirects to a year-suffixed slug (synthetic) ----------
test('Metacritic: a 301 to the year-suffixed slug is followed, and the new slug replaces the old one', async () => {
  const f = film('Alien', 1979, { metacritic: 'movie/alien' });
  const urls = [];
  const http = { async text(url) {
    urls.push(url);
    if (url.endsWith('/movie/alien/')) return { status: 301, text: '', headers: new Headers({ location: '/movie/alien-1979/' }) };
    return { status: 200, url, text: `<html><head><title>Alien - Metacritic</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name: 'Alien', datePublished: '1979-05-25', aggregateRating: { ratingValue: 89, reviewCount: 30 } })}</script></head></html>` };
  } };
  const rec = await run(mc, [f], http);
  assert.deepEqual(urls, ['https://www.metacritic.com/movie/alien/', 'https://www.metacritic.com/movie/alien-1979/']);
  assert.equal(rec.fail.length, 0);
  assert.equal(f.ids.metacritic, 'movie/alien-1979');
});

test('Metacritic: a redirect to a page of another year is a miss, not a failure', async () => {
  const f = film('Alien', 1979, { metacritic: 'movie/alien' });
  const http = { async text(url) {
    if (url.endsWith('/movie/alien/')) return { status: 301, text: '', headers: new Headers({ location: '/movie/alien-1986/' }) };
    return { status: 200, url, text: `<html><head><title>Aliens - Metacritic</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name: 'Aliens', datePublished: '1986-07-18', aggregateRating: { ratingValue: 84, reviewCount: 20 } })}</script></head></html>` };
  } };
  const rec = await run(mc, [f], http);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data, null);
  assert.equal(f.ids.metacritic, 'movie/alien');
});

test('Metacritic: a 301 with no Location header (what a script-style request gets) falls back to the year-suffixed slug, once', async () => {
  const f = film('Alien', 1979, { metacritic: 'movie/alien' });
  const urls = [];
  const http = { async text(url, opts) {
    urls.push(url);
    assert.equal(opts.headers['sec-fetch-mode'], 'navigate');
    if (url.endsWith('/movie/alien/')) return { status: 301, text: '{"error":true}', headers: new Headers() };
    return { status: 200, url, text: `<html><head><title>Alien - Metacritic</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name: 'Alien', datePublished: '1979-05-25', aggregateRating: { ratingValue: 89, reviewCount: 30 } })}</script></head></html>` };
  } };
  const rec = await run(mc, [f], http);
  assert.deepEqual(urls, ['https://www.metacritic.com/movie/alien/', 'https://www.metacritic.com/movie/alien-1979/']);
  assert.equal(rec.fail.length, 0);
  assert.equal(f.ids.metacritic, 'movie/alien-1979');
});

test('Metacritic: a 301 with no Location and no year to try is a miss, not a failure', async () => {
  const f = film('Alien', null, { metacritic: 'movie/alien' });
  const http = { async text() { return { status: 301, text: '', headers: new Headers() }; } };
  const rec = await run(mc, [f], http);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data, null);
});

// ---------- known id that loads straight away but is another film's page (synthetic) ----------
const yrPage = (name, date, score = 67) => `<html><head><title>${name} - Metacritic</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', name, ...(date ? { datePublished: date } : {}), aggregateRating: { ratingValue: score, reviewCount: 30 } })}</script></head></html>`;

test('Metacritic: a known id that is the wrong year tries the year-suffixed slug once, and replaces the id when that fits', async () => {
  const f = film('Solaris', 1972, { metacritic: 'movie/solaris' });
  const urls = [];
  const http = { async text(url) {
    urls.push(url);
    return { status: 200, url, text: url.endsWith('/movie/solaris/') ? yrPage('Solaris', '2002-11-27') : yrPage('Solaris', '1972-03-20', 80) };
  } };
  const rec = await run(mc, [f], http);
  assert.deepEqual(urls, ['https://www.metacritic.com/movie/solaris/', 'https://www.metacritic.com/movie/solaris-1972/']);
  assert.equal(f.ids.metacritic, 'movie/solaris-1972');
  assert.equal(rec.done[0].data.ratings.metacritic.critics, 80);
});

test('Metacritic: a wrong-year known id with no fitting year-suffixed page is a miss and stores nothing', async () => {
  const f = film('Solaris', 1972, { metacritic: 'movie/solaris' });
  const http = { async text(url) { return url.endsWith('-1972/') ? { status: 404, url, text: '' } : { status: 200, url, text: yrPage('Solaris', '2002-11-27') }; } };
  const rec = await run(mc, [f], http);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done[0].data, null);
  assert.equal(f.ids.metacritic, 'movie/solaris');
});

test('Metacritic: a page that shows no year is accepted as it is', async () => {
  const f = film('Solaris', 1972, { metacritic: 'movie/solaris' });
  const urls = [];
  const http = { async text(url) { urls.push(url); return { status: 200, url, text: yrPage('Solaris', null, 70) }; } };
  const rec = await run(mc, [f], http);
  assert.equal(urls.length, 1);
  assert.equal(rec.done[0].data.ratings.metacritic.critics, 70);
});

test('Metacritic: a year-suffixed slug that fits is trusted even when the page shows a later re-release year', async () => {
  const f = film('Solaris', 1972, { metacritic: 'movie/solaris-1972' });
  const http = { async text(url) { return { status: 200, url, text: yrPage('Solaris (1972)', '1976-01-01', 93) }; } };
  const rec = await run(mc, [f], http);
  assert.equal(rec.done[0].data.ratings.metacritic.critics, 93);
});

test('parseRottenTomatoes: Nov 2026 pages carry "35%" in scorePercent and no score key', () => {
  const card = { criticsScore: { certified: false, likedCount: 6, notLikedCount: 11, ratingCount: 17, reviewCount: 17, scorePercent: '35%', title: 'Tomatometer' },
    audienceScore: { averageRating: '4.3', bandedRatingCount: '100+ Ratings', certified: false, scorePercent: '84%', title: 'Popcornmeter' } };
  const hero = { content: { title: 'The Moon', metadataProps: ['PG-13', 'Released Aug 2, 2023'] } };
  const html = `<html><head><title>The Moon (2023) | Rotten Tomatoes</title></head><body>
    <script id="media-hero-json" type="application/json">${JSON.stringify(hero)}</script>
    <script id="media-scorecard-json" type="application/json">${JSON.stringify(card)}</script></body></html>`;
  const r = parseRottenTomatoes(html);
  assert.equal(r.critics, 35);
  assert.equal(r.criticsCount, 17);
  assert.equal(r.audience, 84);
  assert.equal(r.audienceCount, 100);
  assert.equal(r.year, 2023);
});

test('rt: films that came back empty before the Nov 2026 reader fix are read again once; others are not', async () => {
  const { defaultWants } = await import('../../core/enrich.js');
  const now = Date.parse('2026-11-12');
  const before = '2026-11-05T00:00:00Z', after = '2026-11-11T00:00:00Z'; // stored as ISO strings
  const film = (missedAt, checkedAt) => ({ checked: { rt: checkedAt }, missed: missedAt ? { rt: missedAt } : {} });
  assert.equal(defaultWants(rt, film(before, before), { now }), true);   // empty read under the broken reader: retry
  assert.equal(defaultWants(rt, film(after, after), { now }), false);    // empty read after the fix: normal 30-day wait
  assert.equal(defaultWants(rt, film(null, before), { now }), false);    // had scores: untouched
});
