// Wikipedia provider tests. Responses are hand-written synthetic fixtures (test/fixtures/synthetic/wikipedia-*.json),
// shaped from the public REST API docs: no live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import wikipedia, { titleForUrl, thumbUrl, posterFrom, mapSummary, splitSections, SECTIONS_RULE } from '../../core/providers/wikipedia.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';
import { compose } from '../../core/model.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));
const filmJson = load('wikipedia-film');
const smallPoster = load('wikipedia-small-poster');
const commons = load('wikipedia-commons');
const landscape = load('wikipedia-landscape');
const noImage = load('wikipedia-no-image');
const shortExtract = load('wikipedia-short-extract');
const disambiguation = load('wikipedia-disambiguation');

/** A fake http. Like the real one, json() throws HttpError for anything that isn't a 2xx. */
function fakeHttp(route) {
  const calls = [];
  return {
    calls,
    async json(url, opts = {}) {
      const call = { url, host: new URL(url).host, signal: opts.signal };
      calls.push(call);
      const r = await route(call);
      if (r instanceof Error) throw r;
      const status = r.status ?? 200;
      if (status < 200 || status >= 300) throw new HttpError(status, url);
      return r.body;
    },
  };
}
const ok = body => ({ status: 200, body });

function makeCtx(http, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  const ctx = {
    http, settings: {}, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: (...a) => rec.log.push(a.join(' ')),
    done: (film, data, ids) => rec.done.push({ film, data, ids }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const film = (i, o = {}) => ({ key: `k${i}`, title: 'Harbour Lights', year: 2019, ids: { enwiki: `Harbour Lights ${i} (film)` }, ...o });
const run = async (films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await wikipedia.enrich(films, ctx); return rec; };

// ---------- contract ----------

test('provider shape: key-less, needs an English Wikipedia title', () => {
  assert.equal(wikipedia.id, 'wikipedia');
  assert.equal(wikipedia.label, 'Wikipedia');
  assert.deepEqual(wikipedia.gives, ['posters', 'plot summaries']);
  assert.equal(wikipedia.needsKey, false);
  assert.equal(wikipedia.refreshDays, 90);
  assert.equal(wikipedia.retryMissDays, 30);
  assert.equal(wikipedia.requires(film(1)), true);
  assert.equal(wikipedia.requires({ ids: {} }), false);
  assert.equal(wikipedia.requires({ ids: { enwiki: '' } }), false);
  assert.equal(wikipedia.requires({}), false);
});

test('the default rules: unchecked films run, misses retry after 30 days, an opened older film refreshes after six months', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(defaultWants(wikipedia, { ids: {} }, { now }), false);
  assert.equal(defaultWants(wikipedia, film(1), { now }), true);
  assert.equal(defaultWants(wikipedia, film(1, { checked: { wikipedia: '2026-09-20T00:00:00Z' }, missed: { wikipedia: 'x' } }), { now }), false);
  assert.equal(defaultWants(wikipedia, film(1, { checked: { wikipedia: '2026-08-20T00:00:00Z' }, missed: { wikipedia: 'x' } }), { now }), true);
  assert.equal(defaultWants(wikipedia, film(1, { checked: { wikipedia: '2026-08-20T00:00:00Z' } }), { now, full: true }), false);
  assert.equal(defaultWants(wikipedia, film(1, { checked: { wikipedia: '2026-03-01T00:00:00Z' } }), { now, full: true }), true);
});

// ---------- titles ----------

test('titleForUrl: spaces become underscores, then everything is URL-encoded', () => {
  assert.equal(titleForUrl('District 9'), 'District_9');
  assert.equal(titleForUrl('Paris, Texas (film)'), 'Paris%2C_Texas_(film)');
  assert.equal(titleForUrl('Sinners (2025 film)'), 'Sinners_(2025_film)');
  assert.equal(titleForUrl('Amélie'), 'Am%C3%A9lie');
  assert.equal(titleForUrl('Face/Off'), 'Face%2FOff');
  assert.equal(titleForUrl('Who Framed Roger Rabbit?'), 'Who_Framed_Roger_Rabbit%3F');
  assert.equal(titleForUrl('  Spaced   out  '), 'Spaced_out');
});

test('titleForUrl: a pasted article link works too', () => {
  assert.equal(titleForUrl('https://en.wikipedia.org/wiki/Paris,_Texas_(film)'), 'Paris%2C_Texas_(film)');
  assert.equal(titleForUrl('https://en.wikipedia.org/wiki/Am%C3%A9lie'), 'Am%C3%A9lie');
});

// ---------- thumbnails ----------

test('thumbUrl: /wikipedia/en/ originals get a 250px thumbnail path', () => {
  assert.equal(
    thumbUrl('https://upload.wikimedia.org/wikipedia/en/a/ab/Harbour_Lights_%282019%29_poster.jpg'),
    'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Harbour_Lights_%282019%29_poster.jpg/250px-Harbour_Lights_%282019%29_poster.jpg');
});

test('thumbUrl: /wikipedia/commons/ originals too', () => {
  assert.equal(
    thumbUrl('https://upload.wikimedia.org/wikipedia/commons/1/1f/The_Salt_Road_poster.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/The_Salt_Road_poster.jpg/250px-The_Salt_Road_poster.jpg');
});

test('thumbUrl: another width, an SVG (rendered as PNG), and links it cannot rewrite', () => {
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/en/a/ab/F.png', 500), 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.png/500px-F.png');
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/Logo.svg'), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Logo.svg/250px-Logo.svg.png');
  const alreadyThumb = 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.jpg/320px-F.jpg';
  assert.equal(thumbUrl(alreadyThumb), alreadyThumb);
  assert.equal(thumbUrl('https://example.com/poster.jpg'), 'https://example.com/poster.jpg');
  assert.equal(thumbUrl('https://upload.wikimedia.org/wikipedia/en/a/ab/Scan.tif'), 'https://upload.wikimedia.org/wikipedia/en/a/ab/Scan.tif');
});

// ---------- posters ----------

test('a portrait poster is accepted: query string stripped, thumbnail built, size kept', () => {
  assert.deepEqual(posterFrom(filmJson), {
    url: 'https://upload.wikimedia.org/wikipedia/en/a/ab/Harbour_Lights_%282019%29_poster.jpg',
    thumb: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Harbour_Lights_%282019%29_poster.jpg/250px-Harbour_Lights_%282019%29_poster.jpg',
    width: 255,
    height: 393,
  });
});

test('a poster no wider than 250px is its own thumbnail', () => {
  assert.deepEqual(posterFrom(smallPoster), {
    url: 'https://upload.wikimedia.org/wikipedia/en/c/cd/Paper_Boats_poster.png',
    thumb: 'https://upload.wikimedia.org/wikipedia/en/c/cd/Paper_Boats_poster.png',
    width: 200,
    height: 300,
  });
});

test('a large poster stored on Commons gets a Commons thumbnail', () => {
  const p = posterFrom(commons);
  assert.equal(p.url, 'https://upload.wikimedia.org/wikipedia/commons/1/1f/The_Salt_Road_poster.jpg');
  assert.equal(p.thumb, 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/The_Salt_Road_poster.jpg/250px-The_Salt_Road_poster.jpg');
  assert.deepEqual([p.width, p.height], [1000, 1500]);
});

test('a landscape image is not a poster', () => {
  assert.equal(posterFrom(landscape), null);
});

test('portrait means clearly taller than wide: height must beat width × 1.2', () => {
  const img = (width, height) => ({ originalimage: { source: 'https://upload.wikimedia.org/wikipedia/en/a/ab/F.jpg', width, height } });
  assert.equal(posterFrom(img(500, 500)), null, 'square');
  assert.equal(posterFrom(img(500, 600)), null, 'exactly 1.2 is not enough');
  assert.equal(posterFrom(img(500, 601))?.height, 601);
  assert.equal(posterFrom(img(500, 750))?.height, 750);
});

test('images with unknown or odd sizes are not trusted as posters', () => {
  const src = 'https://upload.wikimedia.org/wikipedia/en/a/ab/F.jpg';
  assert.equal(posterFrom({ originalimage: { source: src } }), null);
  assert.equal(posterFrom({ originalimage: { source: src, width: 0, height: 900 } }), null);
  assert.equal(posterFrom({ originalimage: { source: src, width: '500', height: '900' } }), null);
  assert.equal(posterFrom({}), null);
  assert.equal(posterFrom(null), null);
});

test('with only a thumbnail (no original), the thumbnail is used', () => {
  const p = posterFrom({ thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.jpg/220px-F.jpg?x=1', width: 220, height: 330 } });
  assert.deepEqual(p, { url: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.jpg/220px-F.jpg', thumb: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/F.jpg/220px-F.jpg', width: 220, height: 330 });
});

// ---------- mapping ----------

test('maps a full summary: poster, synopsis, one-line description', () => {
  const data = mapSummary(filmJson);
  assert.equal(data.poster.width, 255);
  assert.match(data.synopsis, /^Harbour Lights is a 2019 French-American thriller film/);
  assert.equal(data.wikipediaDescription, '2019 French-American thriller film');
});

test('a landscape still: no poster, but the synopsis and description are kept', () => {
  const data = mapSummary(landscape);
  assert.equal(data.poster, null);
  assert.match(data.synopsis, /^Night Ferry is a 2003 British film/);
  assert.equal(data.wikipediaDescription, '2003 British film');
});

test('no image at all: poster is null, the rest is kept', () => {
  const data = mapSummary(noImage);
  assert.equal(data.poster, null);
  assert.ok(data.synopsis);
});

test('an extract under 40 characters is dropped, the poster stays', () => {
  const data = mapSummary(shortExtract);
  assert.equal(data.synopsis, null);
  assert.equal(data.poster.url, 'https://upload.wikimedia.org/wikipedia/en/e/e2/Lantern_Hill_poster.jpg');
  assert.equal(data.wikipediaDescription, '2021 film');
});

test('the synopsis is trimmed, and exactly 40 characters is kept', () => {
  const forty = 'x'.repeat(40);
  assert.equal(mapSummary({ extract: `  ${forty}\n` }).synopsis, forty);
  assert.equal(mapSummary({ extract: 'y'.repeat(39) }), null);
});

test('a disambiguation page, or a summary with nothing in it, maps to null', () => {
  assert.equal(mapSummary(disambiguation), null);
  assert.equal(mapSummary({ type: 'standard', title: 'Empty' }), null);
  assert.equal(mapSummary({ extract: 'too short', description: '  ' }), null);
  assert.equal(mapSummary(null), null);
});

test('the mapped data feeds compose(): TMDB outranks Wikipedia, Wikipedia fills the gaps', () => {
  const f = { key: 'k', title: 'Harbour Lights', year: 2019, ids: {}, src: { wikipedia: mapSummary(filmJson) } };
  const c = compose(f);
  assert.equal(c.poster.width, 255);
  assert.equal(c.sources.poster, 'wikipedia');
  assert.match(c.synopsis, /ferry pilot/);
  const both = compose({ ...f, src: { tmdb: { synopsis: 'From TMDB.' }, wikipedia: mapSummary(filmJson) } });
  assert.equal(both.synopsis, 'From TMDB.');
});

// ---------- running ----------

test('asks the REST summary endpoint for each film by title and records the mapped data', async () => {
  const http = fakeHttp(() => ok(filmJson));
  const f = film(1, { ids: { enwiki: 'Paris, Texas (film)' } });
  const rec = await run([f], http);
  const summaryCalls = http.calls.filter(c => c.url.includes('/api/rest_v1/'));
  assert.equal(summaryCalls.length, 1);
  assert.equal(summaryCalls[0].url, 'https://en.wikipedia.org/api/rest_v1/page/summary/Paris%2C_Texas_(film)');
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].film, f);
  assert.equal(rec.done[0].data.poster.height, 393);
  assert.deepEqual(rec.progress, [[1, 1]]);
  assert.equal(rec.fail.length, 0);
});

test('a 404 (no such article) is recorded as "found nothing"', async () => {
  const http = fakeHttp(() => ({ status: 404, body: load('wikipedia-not-found') }));
  const rec = await run([film(1)], http);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
  assert.equal(rec.fail.length, 0);
});

test('a disambiguation page is recorded as "found nothing"', async () => {
  const http = fakeHttp(() => ok(disambiguation));
  const rec = await run([film(1)], http);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
});

test('a landscape lead image still records the synopsis, with poster null', async () => {
  const http = fakeHttp(() => ok(landscape));
  const rec = await run([film(1)], http);
  assert.equal(rec.done[0].data.poster, null);
  assert.ok(rec.done[0].data.synopsis);
});

test('every film is looked up and progress counts them', async () => {
  const http = fakeHttp(() => ok(filmJson));
  const rec = await run([film(1), film(2), film(3), film(4)], http);
  assert.equal(rec.done.length, 4);
  assert.equal(http.calls.filter(c => c.url.includes('/api/rest_v1/')).length, 4);
  assert.deepEqual(rec.progress.map(p => p[0]).sort(), [1, 2, 3, 4]);
  assert.ok(rec.progress.every(p => p[1] === 4));
  assert.ok(http.calls.every(c => c.host === 'en.wikipedia.org'));
});

test('a server or network failure on one film is a failure for that film only, not a "checked" mark', async () => {
  const http = fakeHttp(call => (call.url.includes('Harbour_Lights_2_') ? { status: 500 } : call.url.includes('Harbour_Lights_3_') ? new TypeError('fetch failed') : ok(filmJson)));
  const rec = await run([film(1), film(2), film(3), film(4)], http);
  assert.deepEqual(rec.done.map(d => d.film.key).sort(), ['k1', 'k4']);
  assert.deepEqual(rec.fail.map(d => d.film.key).sort(), ['k2', 'k3']);
});

test('a rate-limit reply (429) that survives net.js retries is a failure, not a miss', async () => {
  const http = fakeHttp(() => new HttpError(429, 'https://en.wikipedia.org/x'));
  const rec = await run([film(1)], http);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 1);
});

test('stops with code "aborted" when the signal is aborted before or during the run', async () => {
  const pre = new AbortController(); pre.abort();
  const http = fakeHttp(() => ok(filmJson));
  const { ctx } = makeCtx(http, { signal: pre.signal });
  await assert.rejects(() => wikipedia.enrich([film(1)], ctx), err => err.code === 'aborted');
  assert.equal(http.calls.length, 0);

  const ac = new AbortController();
  const http2 = fakeHttp(() => { ac.abort(); return Object.assign(new Error('Stopped.'), { code: 'aborted' }); });
  const { ctx: ctx2, rec } = makeCtx(http2, { signal: ac.signal });
  await assert.rejects(() => wikipedia.enrich([film(1), film(2), film(3)], ctx2), err => err.code === 'aborted');
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 0);
});

// ---------- sections (plot / themes / reception) ----------

const SAMPLE = `Harbour Lights is a 2019 thriller.


== Plot ==
A ferry pilot[1] named Ana returns to the port town where she grew up.[12] She finds her brother gone.

== Cast ==
Someone as Ana.

== Production ==
=== Music ===
The score is sparse and watery.[3]

== Themes ==
The film is about atonement and the weight of memory.

== Reception ==
=== Critical response ===
Critics praised the quiet tension.[note 1] The review aggregator gave it 91%.[citation needed]

=== Accolades ===
It won nothing.

==== Box office ====
Counted under accolades text.

== See also ==
Other films.
`;

test('splitSections: plot, themes (music no longer counts) and reception (incl. sub-sections), cleaned', () => {
  const s = splitSections(SAMPLE);
  assert.equal(s.plot, 'A ferry pilot named Ana returns to the port town where she grew up. She finds her brother gone.');
  assert.equal(s.themes, 'The film is about atonement and the weight of memory.');
  assert.doesNotMatch(s.themes, /score|watery/);
  assert.equal(s.rule, SECTIONS_RULE);
  assert.match(s.reception, /^Critics praised the quiet tension\. The review aggregator gave it 91%\./);
  assert.doesNotMatch(s.reception, /\[|Someone|Other films/);
  assert.doesNotMatch(s.plot, /Someone/);
});

test('splitSections: a page with only Music has no themes text', () => {
  const s = splitSections('Lead.\n\n== Music ==\nA haunting score.\n\n== Plot ==\nThings happen to people.');
  assert.equal('themes' in s, false);
  assert.equal(s.plot, 'Things happen to people.');
});

test('splitSections: Cinematography, Style and Genre never become themes', () => {
  const s = splitSections('== Cinematography ==\nShot on film.\n\n== Style ==\nSlow and quiet.\n\n== Genre ==\nScience fiction.\n\n== Music ==\nStrings.');
  assert.deepEqual(s, {});
});

test('splitSections: genuine analysis headings feed themes', () => {
  for (const h of ['Themes', 'Themes and analysis', 'Analysis', 'Interpretation', 'Interpretations', 'Symbolism', 'Themes and motifs', 'Themes and interpretation']) {
    assert.equal(splitSections(`== Music ==\nScore.\n\n== ${h} ==\nGrief and time.`).themes, 'Grief and time.', h);
  }
  assert.equal('themes' in splitSections('== Reception and analysis ==\nPraised.'), false);
  assert.equal(splitSections('== Reception and analysis ==\nPraised.').reception, 'Praised.');
});

test('splitSections: empty or heading-less text gives {}', () => {
  assert.deepEqual(splitSections(''), {});
  assert.deepEqual(splitSections(null), {});
  assert.deepEqual(splitSections('Just a lead paragraph.'), {});
});

test('splitSections: caps at 3000 characters, cutting at a sentence end', () => {
  const long = '== Plot ==\n' + 'This is a sentence about the plot. '.repeat(200);
  const s = splitSections(long);
  assert.ok(s.plot.length <= 3000);
  assert.ok(s.plot.endsWith('plot.'));
  const noStops = splitSections('== Plot ==\n' + 'word '.repeat(1000)).plot;
  assert.ok(noStops.length <= 3000 && noStops.endsWith('word'));
});

const extractBody = text => ({ query: { pages: [{ title: 'X', extract: text }] } });

test('stores sections next to the summary, fetched with the plain-text extract request', async () => {
  const http = fakeHttp(call => ok(call.url.includes('prop=extracts') ? extractBody(SAMPLE) : filmJson));
  const rec = await run([film(1, { ids: { enwiki: 'Paris, Texas (film)' } })], http);
  assert.equal(http.calls.length, 2);
  assert.ok(http.calls[1].url.startsWith('https://en.wikipedia.org/w/api.php?action=query'));
  assert.ok(http.calls[1].url.includes('explaintext=1') && http.calls[1].url.endsWith('titles=Paris%2C_Texas_(film)'));
  assert.equal(rec.done[0].data.poster.height, 393);
  assert.match(rec.done[0].data.sections.plot, /^A ferry pilot/);
});

test('a failed sections request keeps the summary and just omits sections', async () => {
  const http = fakeHttp(call => (call.url.includes('prop=extracts') ? { status: 429 } : ok(filmJson)));
  const rec = await run([film(1)], http);
  assert.equal(rec.fail.length, 0);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data.poster.height, 393);
  assert.equal('sections' in rec.done[0].data, false);
});

test('an article with no matching headings stores no sections key', async () => {
  const http = fakeHttp(call => ok(call.url.includes('prop=extracts') ? extractBody('Lead only.') : filmJson));
  const rec = await run([film(1)], http);
  assert.equal('sections' in rec.done[0].data, false);
});

test('re-read drops themes stored by the old broad rule, even when the new read finds none', async () => {
  const f = film(1, { src: { wikipedia: { poster: null, sections: { plot: 'Old plot.', themes: 'The score is sparse and watery.' } } } });
  const http = fakeHttp(call => (call.url.includes('prop=extracts') ? { status: 429 } : ok(filmJson)));
  await run([f], http);
  assert.equal(f.src.wikipedia.sections.themes, undefined);
  assert.equal(f.src.wikipedia.sections.plot, 'Old plot.');
});

test('themes stored under the new rule are left alone', async () => {
  const f = film(1, { src: { wikipedia: { sections: { themes: 'Grief.', rule: SECTIONS_RULE } } } });
  const http = fakeHttp(call => (call.url.includes('prop=extracts') ? { status: 429 } : ok(filmJson)));
  await run([f], http);
  assert.equal(f.src.wikipedia.sections.themes, 'Grief.');
});

test('the provider asks for one re-read of films stored before the themes fix', () => {
  assert.ok(Date.parse(wikipedia.since) >= Date.parse('2026-10-29'));
});

test('the provider always reads the summary, even when TMDB has the poster and synopsis (enrich.js leaves it out of the urgent lanes instead)', async () => {
  const http = fakeHttp(call => (call.url.includes('/api/rest_v1/') ? ok(filmJson) : ok({ query: { pages: [{ extract: 'Intro.\n\n== Themes ==\nLoss and light.\n' }] } })));
  const f = film(1, { src: { tmdb: { poster: { url: 'x' }, synopsis: 'From TMDB' } } });
  const rec = await run([f], http);
  assert.ok(http.calls.some(c => c.url.includes('/api/rest_v1/')), 'the summary is requested');
  assert.equal(rec.fail.length, 0);
  assert.ok(rec.done[0].data.poster, 'Wikipedia\'s poster option is kept');
  assert.match(rec.done[0].data.sections.themes, /Loss and light/);
});
