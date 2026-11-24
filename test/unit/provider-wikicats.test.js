// Wikipedia categories provider tests. Network is faked; fixtures are synthetic (test/fixtures/synthetic/wikicats-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import wikicats, { plainTitle, cleanCategory, dbpediaUri, dbpediaQuery } from '../../core/providers/wikicats.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));
const page1 = load('wikicats-wikipedia-page1');
const page2 = load('wikicats-wikipedia-page2');
const dbp = load('wikicats-dbpedia');

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
const isWiki = c => c.host === 'en.wikipedia.org';
const isDb = c => c.host === 'dbpedia.org';
const dbQuery = c => new URL(c.url).searchParams.get('query');

function makeCtx(http, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [] };
  const ctx = {
    http, settings: {}, signal,
    progress: (d, t) => rec.progress.push([d, t]),
    log: () => {},
    done: (film, data) => rec.done.push({ film, data }),
    fail: (film, err) => rec.fail.push({ film, err }),
  };
  return { ctx, rec };
}
const film = (key, enwiki) => ({ key, title: key, year: 2000, ids: { enwiki } });
const run = async (films, http, opts) => { const { ctx, rec } = makeCtx(http, opts); await wikicats.enrich(films, ctx); return rec; };
const dataOf = (rec, key) => rec.done.find(d => d.film.key === key)?.data;

test('provider shape and default rules', () => {
  assert.equal(wikicats.id, 'wikicats');
  assert.equal(wikicats.label, 'Wikipedia categories');
  assert.deepEqual(wikicats.gives, ['themes and subjects']);
  assert.equal(wikicats.needsKey, false);
  assert.equal(wikicats.refreshDays, 120);
  assert.equal(wikicats.retryMissDays, 30);
  assert.equal(wikicats.requires(film('a', 'X')), true);
  assert.equal(wikicats.requires({ ids: {} }), false);
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(defaultWants(wikicats, film('a', 'X'), { now }), true);
});

test('helpers: titles, category labels, DBpedia IRIs', () => {
  assert.equal(plainTitle('https://en.wikipedia.org/wiki/Paris,_Texas_(film)'), 'Paris, Texas (film)');
  assert.equal(plainTitle(' Se7en '), 'Se7en');
  assert.equal(cleanCategory('Category:Films_about_atonement'), 'Films about atonement');
  for (const m of ['Articles with short description', 'Pages using sidebar', 'All articles lacking sources', 'Wikipedia articles X', 'CS1 errors', 'Webarchive template wayback links',
    'Use dmy dates from May 2020', 'Use mdy dates from May 2020', 'Short description is different', 'Commons category link is on Wikidata', 'Good articles', 'Featured articles']) {
    assert.equal(cleanCategory('Category:' + m), null, m);
  }
  assert.equal(cleanCategory('Films about Wikipedia'), 'Films about Wikipedia');
  assert.equal(dbpediaUri('Paris, Texas (film)'), 'http://dbpedia.org/resource/Paris,_Texas_(film)');
  assert.equal(dbpediaUri('Amélie'), 'http://dbpedia.org/resource/Amélie');
  assert.equal(dbpediaUri('Se7en'), 'http://dbpedia.org/resource/Se7en');
  assert.equal(dbpediaUri('WALL·E: Rise'), 'http://dbpedia.org/resource/WALL·E:_Rise');
  assert.equal(dbpediaUri('A "B" <C>'), 'http://dbpedia.org/resource/A_%22B%22_%3CC%3E');
  assert.match(dbpediaQuery([dbpediaUri('Amélie')]), /VALUES \?t \{ <http:\/\/dbpedia\.org\/resource\/Amélie> \} \?t dct:subject \?c/);
});

test('Wikipedia: follows clcontinue, maps normalised titles and redirects, filters maintenance categories', async () => {
  const http = fakeHttp(c => ok(c.url.includes('clcontinue') ? page2 : page1));
  const films = [film('pt', 'paris, Texas (film)'), film('hl', 'Old Name'), film('q', 'Quiet Film')];
  const rec = await run(films.slice(0, 2), http);
  assert.equal(http.calls.length, 2);
  assert.ok(http.calls[0].url.startsWith('https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=categories&cllimit=max&clshow=!hidden&redirects=1&titles=paris%2C%20Texas%20(film)|Old%20Name'));
  assert.ok(http.calls[1].url.includes('clcontinue=111%7CFilms_set_in_Texas'));
  assert.deepEqual(dataOf(rec, 'pt'), { categories: ['Films about atonement', 'Films set in Texas'], via: 'wikipedia', title: 'paris, Texas (film)' });
  assert.deepEqual(dataOf(rec, 'hl'), { categories: ['Films set in ports'], via: 'wikipedia', title: 'Old Name' });
  assert.equal(rec.fail.length, 0);
  assert.deepEqual(rec.progress.at(-1), [2, 2]);
});

test('batches of 50 titles, one request at a time', async () => {
  let live = 0, maxLive = 0;
  const http = fakeHttp(async c => {
    live++; maxLive = Math.max(maxLive, live);
    await new Promise(r => setImmediate(r));
    live--;
    const titles = decodeURIComponent(new URL(c.url).search.split('titles=')[1]).split('|');
    return ok({ query: { pages: titles.map(t => ({ title: t, categories: [{ title: 'Category:Films about ' + t }] })) } });
  });
  const films = Array.from({ length: 120 }, (_, i) => film('f' + i, 'Film ' + i));
  const rec = await run(films, http);
  assert.equal(http.calls.length, 3);
  assert.equal(maxLive, 1);
  assert.equal(rec.done.length, 120);
  assert.equal(dataOf(rec, 'f7').categories[0], 'Films about Film 7');
  assert.ok(http.calls.every(isWiki));
});

test('an empty Wikipedia result falls back to DBpedia; no categories anywhere is recorded as null', async () => {
  const http = fakeHttp(c => {
    if (isWiki(c)) return ok({ query: { pages: [{ title: 'Quiet Film', categories: [{ title: 'Category:Good articles' }] }, { title: 'Nothing', missing: true }] } });
    return ok({ results: { bindings: [{ t: { value: 'http://dbpedia.org/resource/Quiet_Film' }, c: { value: 'http://dbpedia.org/resource/Category:Films_about_silence' } }] } });
  });
  const rec = await run([film('q', 'Quiet Film'), film('n', 'Nothing')], http);
  assert.equal(http.calls.filter(isDb).length, 1);
  assert.deepEqual(dataOf(rec, 'q'), { categories: ['Films about silence'], via: 'dbpedia', title: 'Quiet Film' });
  assert.equal(rec.done.find(d => d.film.key === 'n').data, null);
  assert.equal(rec.fail.length, 0);
});

test('a Wikipedia 429 sends the batch to DBpedia, in batches of 20, with awkward titles intact', async () => {
  const http = fakeHttp(c => {
    if (isWiki(c)) return { status: 429 };
    return ok(dbp);
  });
  const films = [film('pt', 'Paris, Texas (film)'), film('am', 'Amélie'), film('se', 'Se7en'), film('wl', 'WALL·E: Rise')];
  for (let i = 0; i < 22; i++) films.push(film('x' + i, 'Filler ' + i));
  const rec = await run(films, http);
  const dbCalls = http.calls.filter(isDb);
  assert.equal(dbCalls.length, 2);
  const q = dbQuery(dbCalls[0]);
  assert.ok(q.includes('<http://dbpedia.org/resource/Paris,_Texas_(film)>'));
  assert.ok(q.includes('<http://dbpedia.org/resource/Amélie>'));
  assert.ok(q.includes('<http://dbpedia.org/resource/Se7en>'));
  assert.ok(q.includes('<http://dbpedia.org/resource/WALL·E:_Rise>'));
  assert.equal((q.match(/<http:\/\/dbpedia\.org\/resource\//g)).length, 20);
  assert.equal((dbQuery(dbCalls[1]).match(/<http:\/\/dbpedia\.org\/resource\//g)).length, 6);
  assert.ok(dbCalls[0].url.startsWith('https://dbpedia.org/sparql?format=application%2Fsparql-results%2Bjson&query='));
  assert.deepEqual(dataOf(rec, 'pt'), { categories: ['Films about atonement', "Palme d'Or winners", 'Films set in Texas'], via: 'dbpedia', title: 'Paris, Texas (film)' });
  assert.deepEqual(dataOf(rec, 'am').categories, ['French romantic comedy films', 'Films about Paris, France']); // deduped, %2C decoded
  assert.equal(dataOf(rec, 'se'), null);
  assert.equal(rec.done.length, 26);
});

test('a network error fails that batch only and carries on with the next', async () => {
  let n = 0;
  const http = fakeHttp(c => {
    n++;
    if (n === 1) return new TypeError('fetch failed');
    const titles = decodeURIComponent(new URL(c.url).search.split('titles=')[1]).split('|');
    return ok({ query: { pages: titles.map(t => ({ title: t, categories: [{ title: 'Category:Films about x' }] })) } });
  });
  const films = Array.from({ length: 60 }, (_, i) => film('f' + i, 'Film ' + i));
  const rec = await run(films, http);
  assert.equal(rec.fail.length, 50);
  assert.equal(rec.done.length, 10);
  assert.equal(http.calls.length, 2);
});

test('DBpedia failing too is a failure, not a miss', async () => {
  const http = fakeHttp(c => (isWiki(c) ? { status: 403 } : { status: 500 }));
  const rec = await run([film('a', 'A Film')], http);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 1);
});

test('categories are capped at 80', async () => {
  const cats = Array.from({ length: 120 }, (_, i) => ({ title: 'Category:Films about thing ' + i }));
  const http = fakeHttp(() => ok({ query: { pages: [{ title: 'Big', categories: cats }] } }));
  const rec = await run([film('b', 'Big')], http);
  assert.equal(dataOf(rec, 'b').categories.length, 80);
});

test('stops with code "aborted" before or during the run', async () => {
  const pre = new AbortController(); pre.abort();
  const http = fakeHttp(() => ok(page1));
  const { ctx } = makeCtx(http, { signal: pre.signal });
  await assert.rejects(() => wikicats.enrich([film('a', 'A')], ctx), e => e.code === 'aborted');
  assert.equal(http.calls.length, 0);

  const ac = new AbortController();
  const http2 = fakeHttp(() => { ac.abort(); return Object.assign(new Error('Stopped.'), { code: 'aborted' }); });
  const { ctx: ctx2, rec } = makeCtx(http2, { signal: ac.signal });
  await assert.rejects(() => wikicats.enrich([film('a', 'A')], ctx2), e => e.code === 'aborted');
  assert.equal(rec.fail.length, 0);
});
