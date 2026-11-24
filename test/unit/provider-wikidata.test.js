// Wikidata provider tests: fake http, synthetic fixtures (test/fixtures/synthetic/wikidata-*.json). No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import wikidata from '../../core/providers/wikidata.js';
import { readDetails, mapEntity, tidyGenre, tidyCountry, titleCandidates, sitelinkTitles, readTitleResolution, verifyCandidate, parseTime, canonicalGenres, wikipediaCase, TV_TYPES } from '../../core/parse/wikidata.js';
import { HttpError } from '../../core/net.js';
import { defaultWants } from '../../core/enrich.js';

const load = name => JSON.parse(readFileSync(new URL(`../fixtures/synthetic/${name}.json`, import.meta.url), 'utf8'));
const paris = load('wikidata-entity-paris-texas').entities.Q100;
const labelsFx = load('wikidata-labels');

const snak = value => ({ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value } } });
const filmEntity = (id, year, { type = 'Q11424', extra = {} } = {}) => ({
  id, labels: { en: { value: `Film ${id}` } },
  claims: { P31: [snak({ id: type })], P577: [snak({ time: `+${year}-06-01T00:00:00Z`, precision: 11 })], ...extra },
});

const wd = q => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` });
const lit = (value, extra = {}) => ({ type: 'literal', value, ...extra });

/** Turn a wbgetentities-style entity into the rows the SPARQL details query would return (test helper). */
function rowsFromEntity(e, label) {
  const item = wd(e.id);
  const rows = [{ item, kind: lit('meta'), vl: lit(e.labels.en.value), ...(e.sitelinks?.enwiki ? { v: lit(e.sitelinks.enwiki.title) } : {}) }];
  for (const [p, claims] of Object.entries(e.claims)) {
    claims.forEach((c, i) => {
      const v = c.mainsnak.datavalue.value, kind = lit(p), st = lit(`${e.id}-${p}-${i}`);
      if (p === 'P577' || p === 'P580') rows.push({ item, kind, st, t: lit(v.time.slice(1)), prec: lit(String(v.precision)) });
      else if (['P2047', 'P2130', 'P2142'].includes(p)) rows.push({ item, kind, st, a: lit(v.amount.replace('+', '')), u: { type: 'uri', value: v.unit } });
      else if (p === 'P1476') rows.push({ item, kind, v: lit(v.text, { 'xml:lang': v.language }) });
      else if (v?.id) {
        const row = { item, kind, st, v: wd(v.id) };
        if (label(v.id)) row.vl = lit(label(v.id));
        const q = c.qualifiers || {};
        if (q.P1545) row.ord = lit(q.P1545[0].datavalue.value);
        if (q.P585) row.t = lit(q.P585[0].datavalue.value.time.slice(1));
        if (q.P453) { row.role = wd(q.P453[0].datavalue.value.id); if (label(row.role.value.split('/').pop())) row.rl = lit(label(row.role.value.split('/').pop())); }
        rows.push(row);
      } else rows.push({ item, kind, v: lit(v) });
    });
  }
  return rows;
}

/**
 * Fake http. routes:
 *   entities: { qid: entity }   action API wbgetentities (labels answered from labelsFx)
 *   articles: { 'Title (film)': { qid, types:[…], years:[…] } }   sitelink SPARQL answers
 *   subclasses: Set of type qids that are film subclasses
 *   details(qids) → bindings    SPARQL details answers (default: built from `entities`)
 *   sparql(query) → bindings | Error   anything else (id lookups, label search)
 *   sitelinkError / wiki(titles) / wikidataApi(url) for failure injection
 */
function fakeHttp(routes = {}) {
  const calls = [];
  const entityLabel = id => (routes.labels?.[id] ?? labelsFx.entities[id] ?? { labels: { en: { value: `L-${id}` } } }).labels?.en?.value ?? null;
  return {
    calls,
    async json(url, opts = {}) {
      calls.push({ url, opts });
      const u = new URL(url);
      if (u.host === 'query.wikidata.org') {
        const query = new URLSearchParams(opts.body).get('query');
        let r;
        if (query.includes('quantityAmount')) {
          const asked = [...query.matchAll(/wd:(Q\d+)/g)].map(m => m[1]);
          r = routes.details ? await routes.details(asked) : asked.flatMap(q => (routes.entities?.[q] ? rowsFromEntity(routes.entities[q], entityLabel) : []));
        } else if (query.includes('schema:about')) {
          if (routes.sitelinkError) throw routes.sitelinkError;
          r = [];
          for (const m of query.matchAll(/\("(\d+)" "((?:[^"\\]|\\.)*)"@en\)/g)) {
            const a = routes.articles?.[m[2]];
            if (!a) continue;
            for (const t of a.types || ['Q11424']) for (const y of a.years?.length ? a.years : [null]) {
              r.push({ k: lit(m[1]), name: lit(m[2], { 'xml:lang': 'en' }), item: wd(a.qid), type: wd(t), ...(y ? { d: lit(`${y}-06-01T00:00:00Z`) } : {}), sl: lit('10') });
            }
          }
        } else if (query.includes('wdt:P279*')) {
          const asked = [...query.matchAll(/wd:(Q\d+)/g)].map(m => m[1]);
          r = asked.filter(q => routes.subclasses?.has(q) || routes.tvSubclasses?.has(q)).map(q => ({ t: wd(q), ...(routes.tvSubclasses?.has(q) ? { root: wd('Q5398426') } : {}) }));
        } else r = routes.sparql ? await routes.sparql(query, opts) : [];
        if (r instanceof Error) throw r;
        return { results: { bindings: r } };
      }
      if (u.host === 'en.wikipedia.org') return routes.wiki(u.searchParams.get('titles').split('|'));
      if (routes.wikidataApi) await routes.wikidataApi(url);
      const ids = u.searchParams.get('ids').split('|');
      const props = u.searchParams.get('props');
      if (props === 'labels') {
        const entities = {};
        for (const id of ids) entities[id] = routes.labels?.[id] ?? labelsFx.entities[id] ?? { id, labels: { en: { value: `L-${id}` } } };
        return { entities };
      }
      const entities = {};
      for (const id of ids) entities[id] = routes.entities?.[id] || { id, missing: '' };
      return { entities };
    },
  };
}

function makeCtx(http, { signal } = {}) {
  const rec = { done: [], fail: [], progress: [], log: [] };
  return {
    rec,
    ctx: {
      http, settings: {}, signal,
      progress: (d, t) => rec.progress.push([d, t]),
      log: (...a) => rec.log.push(a.join(' ')),
      done: (film, data, ids) => rec.done.push({ film, data, ids }),
      fail: (film, err) => rec.fail.push({ film, err }),
    },
  };
}
const film = (title, year, extra = {}) => ({ key: `ty:${title}|${year}`, title, year, ids: {}, ...extra });
const sparqlRow = (qid, extra) => ({ item: { value: `http://www.wikidata.org/entity/${qid}` }, ...extra });

test('provider shape', () => {
  assert.equal(wikidata.id, 'wikidata');
  assert.equal(wikidata.needsKey, false);
  assert.equal(wikidata.refreshDays, 60);
  assert.equal(wikidata.retryMissDays, 21);
  assert.equal(defaultWants(wikidata, film('A', 2000)), true);
});

test('mapEntity: full Paris, Texas style item', () => {
  const label = id => labelsFx.entities[id]?.labels?.en?.value ?? null;
  const { data, ids } = mapEntity(paris, label);
  assert.deepEqual(data.genres, ['Drama']);
  assert.deepEqual(data.keywords, ['LGBTQ+']); // fine-grained labels become tags
  assert.deepEqual(data.countries, ['USA', 'West Germany']);
  assert.equal(data.runtime, 145);
  assert.equal(data.released, '1984-05-19');
  assert.equal(data.originalTitle, undefined);
  assert.deepEqual(data.people.director, [{ name: 'Wim Wenders', id: 'wd:Q101' }]);
  // ordinal qualifier puts Harry Dean Stanton first; the label-less actor is dropped, never shown as a QID
  assert.deepEqual(data.people.cast.map(p => p.name), ['Harry Dean Stanton', 'Nastassja Kinski']);
  assert.equal(data.people.cast[0].role, 'Travis');
  assert.equal(JSON.stringify(data).includes('Q199'), false);
  assert.deepEqual(data.awards, [
    { name: "Palme d'Or", id: 'wd:Q120', won: true, year: 1984 },
    { name: 'BAFTA Award for Best Film', id: 'wd:Q121', won: false, year: 1985 },
  ]);
  assert.equal(data.budget, 1800000); // USD preferred over the bigger non-USD number
  assert.equal(data.boxOffice, 2300000); // largest USD
  assert.deepEqual(ids, { wikidata: 'Q100', imdb: 'tt0087884', tmdb: '655', letterboxd: 'paris-texas', rt: 'm/paris_texas', metacritic: 'movie/paris-texas', enwiki: 'Paris, Texas (film)' });
});

test('normalisers and small readers', () => {
  assert.equal(tidyGenre('drama film'), 'Drama');
  assert.equal(tidyGenre('science fiction film'), 'Science fiction');
  assert.equal(tidyGenre('LGBT-related film'), 'LGBTQ+');
  assert.equal(tidyGenre('anime'), 'Anime');
  assert.equal(tidyGenre(null), null);
  assert.equal(tidyCountry('United States of America'), 'USA');
  assert.equal(tidyCountry('United Kingdom'), 'UK');
  assert.equal(tidyCountry('France'), 'France');
  assert.deepEqual(parseTime({ time: '+1984-00-00T00:00:00Z', precision: 9 }), { year: 1984, date: null });
  assert.deepEqual(titleCandidates('Dune: Part Two', 2024), ['Dune: Part Two (2024 film)', 'Dune: Part Two (film)', 'Dune: Part Two']);
});

test('mapEntity: hours runtime, award years, originalTitle', () => {
  const e = filmEntity('Q1', 2000, { extra: {
    P2047: [snak({ amount: '+2.5', unit: 'http://www.wikidata.org/entity/Q25235' })],
    P1476: [snak({ text: 'Le Film', language: 'fr' })],
    P166: [snak({ id: 'Q5' }), { ...snak({ id: 'Q6' }), qualifiers: { P585: [{ snaktype: 'value', datavalue: { value: { time: '+2001-03-01T00:00:00Z', precision: 11 } } }] } }],
  } });
  const { data } = mapEntity(e, id => `L-${id}`);
  assert.equal(data.runtime, 150);
  assert.equal(data.originalTitle, 'Le Film');
  assert.deepEqual(data.awards.map(a => a.year), [null, 2001]);
});

test('sitelinkTitles adds the spellings Wikipedia tends to use', () => {
  assert.deepEqual(sitelinkTitles('Dune', 2021).slice(0, 3), ['Dune (2021 film)', 'Dune (film)', 'Dune']);
  assert.ok(sitelinkTitles('GoodFellas', 1990).includes('Goodfellas (1990 film)'));
  assert.ok(sitelinkTitles('WALL·E', 2008).includes('WALL-E (film)'));
  assert.ok(sitelinkTitles('Tom & Jerry', 2021).includes('Tom and Jerry (2021 film)'));
  assert.deepEqual(sitelinkTitles('', 2000), []);
});

test('verifyCandidate: film type and year within one', () => {
  assert.equal(verifyCandidate(filmEntity('Q1', 1984), 1985), true);
  assert.equal(verifyCandidate(filmEntity('Q1', 1984), 1990), false);
  assert.equal(verifyCandidate(filmEntity('Q1', 1984, { type: 'Q5' }), 1984), false);
  assert.equal(verifyCandidate(undefined, 1984), false);
});

test('readTitleResolution follows redirects, skips disambiguation and missing pages', () => {
  const json = { query: {
    normalized: [{ from: 'dune', to: 'Dune' }],
    redirects: [{ from: 'Flow (film)', to: 'Flow (2024 film)' }],
    pages: [
      { title: 'Dune', pageprops: { disambiguation: '', wikibase_item: 'Q1' } },
      { title: 'Flow (2024 film)', pageprops: { wikibase_item: 'Q2' } },
      { title: 'Nope', missing: true },
    ] } };
  const r = readTitleResolution(json, ['dune', 'Flow (film)', 'Nope']);
  assert.deepEqual([...r.keys()], ['Flow (film)']);
  assert.equal(r.get('Flow (film)').qid, 'Q2');
});

test('path (a)+(b): known Wikidata id, TMDB id and Letterboxd slug; no verification', async () => {
  const entities = { Q100: paris, Q7: filmEntity('Q7', 1999), Q8: filmEntity('Q8', 1950) };
  const http = fakeHttp({
    entities,
    sparql: q => {
      assert.match(q, /P4947/); assert.match(q, /P6127/);
      return [sparqlRow('Q7', { t: { value: '77' } }), sparqlRow('Q8', { l: { value: 'old-one' } })];
    },
  });
  const { ctx, rec } = makeCtx(http);
  const a = film('Paris, Texas', 1984, { ids: { wikidata: 'Q100' } });
  const b = film('Whatever', 2005, { ids: { tmdb: 77 } }); // year far from item: still accepted, id match is trusted
  const c = film('Old', 1950, { slug: 'old-one' });
  await wikidata.enrich([a, b, c], ctx);
  assert.equal(rec.done.length, 3);
  assert.equal(rec.done.find(d => d.film === a).ids.imdb, 'tt0087884');
  assert.equal(rec.done.find(d => d.film === b).ids.wikidata, 'Q7');
  assert.equal(rec.done.find(d => d.film === c).ids.wikidata, 'Q8');
  const sparqlCalls = http.calls.filter(x => x.url.includes('query.wikidata.org') && !x.opts.body.includes('quantityAmount')); // not counting details
  assert.equal(sparqlCalls.length, 1);
  assert.equal(sparqlCalls[0].opts.method, 'POST');
  assert.equal(http.calls.some(x => x.url.includes('wikipedia.org')), false);
  assert.deepEqual(rec.progress.at(-1), [3, 3]);
});

test('path (c): sitelink query matches the most specific title, verified by type and year', async () => {
  const http = fakeHttp({
    entities: { Q100: paris },
    articles: {
      'Paris, Texas (film)': { qid: 'Q100', years: [1984] },
      'Paris, Texas': { qid: 'Q999', types: ['Q5'] }, // a place, not a film
    },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Paris, Texas', 1984)], ctx);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].ids.enwiki, 'Paris, Texas (film)');
  const q = http.calls.filter(x => x.url.includes('query.wikidata.org') && !x.opts.body.includes('quantityAmount'));
  assert.equal(q.length, 1); // one sitelink query, nothing else needed before details
  assert.match(new URLSearchParams(q[0].opts.body).get('query'), /"Paris, Texas \(1984 film\)"@en/);
  assert.equal(http.calls.some(x => x.url.includes('wikipedia.org')), false);
});

test('path (c): a candidate with the wrong year is ignored, the next one wins; capitalised first letter is tried', async () => {
  const http = fakeHttp({
    entities: { Q1: filmEntity('Q1', 1931), Q2: filmEntity('Q2', 2024) },
    articles: { 'Flow (film)': { qid: 'Q1', years: [1931] }, 'Flow (2024 film)': { qid: 'Q2', years: [2024] }, 'Jeen-yuhs': { qid: 'Q2', years: [2024] } },
  });
  const { ctx, rec } = makeCtx(http);
  const a = film('Flow', 2025); // 2025 is within a year of 2024; the 2025-titled candidate doesn't exist
  const b = film('jeen-yuhs', 2024);
  await wikidata.enrich([a, b], ctx);
  assert.equal(rec.done.length, 2);
  assert.equal(rec.done.find(d => d.film === b).ids.wikidata, 'Q2');
  assert.equal(rec.done.find(d => d.film === a).data, null); // only the 1931 film has a matching title, wrong year
});

test('subclass types are accepted through a cached set (one lookup per unknown type)', async () => {
  const many = Array.from({ length: 90 }, (_, i) => film(`T${i}`, 2000));
  const articles = {}, entities = {};
  many.forEach((f, i) => { articles[`T${i} (film)`] = { qid: `Q${1000 + i}`, types: ['Q471839', 'Q4'], years: [2000] }; entities[`Q${1000 + i}`] = filmEntity(`Q${1000 + i}`, 2000, { type: 'Q471839' }); });
  const http = fakeHttp({ entities, articles, subclasses: new Set(['Q471839']) });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(many, ctx);
  assert.equal(rec.done.length, 90);
  assert.ok(rec.done.every(d => d.data));
  const typeQueries = http.calls.filter(c => (c.opts.body || '').includes('P279'));
  assert.equal(typeQueries.length, 1, 'Q471839 and Q4 are resolved once, then remembered across batches');
  assert.equal(http.calls.filter(c => (c.opts.body || '').includes('schema%3Aabout') && !c.opts.body.includes('quantityAmount')).length, 3); // 90 films / 40 per query
});

test('a non-film type that is not a film subclass is rejected', async () => {
  const http = fakeHttp({ articles: { 'X (film)': { qid: 'Q9', types: ['Q4'], years: [2000] } }, subclasses: new Set() });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('X', 2000)], ctx);
  assert.equal(rec.done[0].data, null);
});

test('label candidate that fails verification → done(film, null)', async () => {
  const http = fakeHttp({
    entities: { Q1: filmEntity('Q1', 1931) },
    sparql: () => [{ film: wd('Q1'), k: lit('0'), d: lit('2024-01-01T00:00:00Z'), sl: lit('3') }], // label hit, but the item itself is a 1931 film
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Flow', 2024)], ctx);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].data, null);
});

test('label search: finds a film the sitelinks missed; verification rejects wrong years', async () => {
  const http = fakeHttp({
    entities: { Q2: filmEntity('Q2', 2024) },
    sparql: q => {
      assert.match(q, /rdfs:label "Flow"@en/);
      assert.match(q, /wd:Q11424/);
      assert.doesNotMatch(q, /P279/);
      return [{ film: wd('Q2'), k: lit('0'), d: lit('2024-08-01T00:00:00Z'), sl: lit('30') }];
    },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Flow', 2024)], ctx);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].ids.wikidata, 'Q2');
});

test('label search: exact year then sitelinks break ties', async () => {
  const http = fakeHttp({
    entities: { Q3: filmEntity('Q3', 2010), Q4: filmEntity('Q4', 2011) },
    sparql: () => [
      { film: wd('Q4'), k: lit('0'), d: lit('2011-01-01T00:00:00Z'), sl: lit('99') },
      { film: wd('Q3'), k: lit('0'), d: lit('2010-01-01T00:00:00Z'), sl: lit('5') },
    ],
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Twin', 2010)], ctx);
  assert.equal(rec.done[0].ids.wikidata, 'Q3');
});

test('label search timeout: batch is split once, then every film fails (retried next run, no miss recorded)', async () => {
  const sizes = [];
  const http = fakeHttp({ sparql: q => { sizes.push((q.match(/BIND/g) || []).length); return new HttpError(500, 'x'); } });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('A', 2000), film('B', 2001), film('C', 2002), film('D', 2003)], ctx);
  assert.deepEqual(sizes, [4, 2, 2]);
  assert.equal(rec.done.length, 0);
  assert.equal(rec.fail.length, 4);
});

test('query service down: Wikipedia API fallback matches; its 429 switches it off for the rest of the run', async () => {
  const many = Array.from({ length: 90 }, (_, i) => film(`T${i}`, 2000));
  const entities = {};
  let wikiCalls = 0;
  const http = fakeHttp({
    entities, sitelinkError: new HttpError(503, 'x'),
    sparql: () => new HttpError(503, 'x'),
    wiki: () => { wikiCalls++; throw new HttpError(429, 'x'); },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(many, ctx);
  assert.equal(wikiCalls, 1, 'one 429 and the Wikipedia API is left alone');
  assert.equal(rec.fail.length, 90, 'nothing could be asked, so every film is recorded for a retry');
  assert.equal(rec.done.length, 0);
});

test('query service down but Wikipedia answers: fallback title resolution still works', async () => {
  const http = fakeHttp({
    entities: { Q100: paris }, sitelinkError: new HttpError(503, 'x'),
    wiki: titles => ({ query: { pages: titles.map(t => (t === 'Paris, Texas (film)' ? { title: t, pageprops: { wikibase_item: 'Q100' } } : { title: t, missing: true })) } }),
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Paris, Texas', 1984)], ctx);
  assert.equal(rec.done.length, 1);
  assert.equal(rec.done[0].ids.wikidata, 'Q100');
});

test('details come from the query service, 25 per query, without touching the Wikidata API', async () => {
  const films = Array.from({ length: 60 }, (_, i) => film(`T${i}`, 2000, { ids: { wikidata: `Q${2000 + i}` } }));
  let apiCalls = 0;
  const http = fakeHttp({
    wikidataApi: () => { apiCalls++; throw new HttpError(429, 'x'); },
    details: qids => { assert.ok(qids.length <= 25, `${qids.length} ids in one details query`); return qids.map(q => ({ item: wd(q), kind: lit('meta'), vl: lit(`Film ${q}`) })); },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(films, ctx);
  assert.equal(apiCalls, 0);
  assert.equal(rec.done.length, 60);
  assert.equal(rec.done[0].data.title, 'Film Q2000');
  assert.equal(http.calls.filter(c => (c.opts.body || '').includes('quantityAmount')).length, 3); // 60 / 25 → 3
});

test('query service cannot give details: the Wikidata API takes over for the rest of the run', async () => {
  const entities = {};
  const films = Array.from({ length: 60 }, (_, i) => { entities[`Q${3000 + i}`] = filmEntity(`Q${3000 + i}`, 2000); return film(`T${i}`, 2000, { ids: { wikidata: `Q${3000 + i}` } }); });
  let detailQueries = 0;
  const http = fakeHttp({ entities, details: () => { detailQueries++; return new HttpError(503, 'x'); } });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(films, ctx);
  assert.equal(rec.done.length, 60);
  assert.equal(detailQueries, 3, 'the first batch is tried, split once, then the query service is left alone'); // 25 → 13 + 12 fail, then API
  assert.ok(rec.log.some(l => /Wikidata API/.test(l)));
});

test('SPARQL details give the same fields as wbgetentities for the same film', async () => {
  const label = id => labelsFx.entities[id]?.labels?.en?.value ?? null;
  const viaApi = mapEntity(paris, label);
  const rows = rowsFromEntity(paris, label);
  const { entities, labels } = readDetails({ results: { bindings: rows } }, ['Q100']);
  const viaSparql = mapEntity(entities.get('Q100'), id => labels.get(id) ?? null);
  assert.deepEqual(viaSparql, viaApi);
  assert.equal(readDetails({ results: { bindings: [] } }, ['Q5']).entities.get('Q5'), null);
});

test('both the query service and the Wikidata API fail: batch split once, films recorded for retry', async () => {
  const sizes = [];
  const http = fakeHttp({
    wikidataApi: () => { throw new HttpError(429, 'x'); },
    details: qids => { sizes.push(qids.length); throw new HttpError(500, 'x'); },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([1, 2, 3, 4].map(i => film(`T${i}`, 2000, { ids: { wikidata: `Q${i}` } })), ctx);
  assert.deepEqual(sizes, [4, 2, 2]);
  assert.equal(rec.fail.length, 4);
  assert.equal(rec.done.length, 0);
});

test('progress is reported after every batch and ends at total', async () => {
  const many = Array.from({ length: 90 }, (_, i) => film(`T${i}`, 2000));
  const articles = {}, entities = {};
  many.forEach((f, i) => { articles[`T${i} (film)`] = { qid: `Q${1000 + i}`, years: [2000] }; entities[`Q${1000 + i}`] = filmEntity(`Q${1000 + i}`, 2000); });
  const http = fakeHttp({ entities, articles });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(many, ctx);
  assert.ok(rec.progress.length >= 3 + 2, `${rec.progress.length} progress calls`); // 3 matching batches + 2 detail batches
  for (let i = 1; i < rec.progress.length; i++) assert.ok(rec.progress[i][0] >= rec.progress[i - 1][0]);
  assert.deepEqual(rec.progress.at(-1), [90, 90]);
  assert.ok(rec.progress.every(([, t]) => t === 90));
});

test('batch sizes: ≤40 films per sitelink query, ≤50 ids per API call', async () => {
  const many = Array.from({ length: 120 }, (_, i) => film(`T${i}`, 2000));
  const articles = {}, entities = {};
  many.forEach((f, i) => { articles[`T${i} (film)`] = { qid: `Q${1000 + i}`, years: [2000] }; entities[`Q${1000 + i}`] = filmEntity(`Q${1000 + i}`, 2000, { extra: { P136: [snak({ id: `Q${5000 + i}` })] } }); });
  const http = fakeHttp({ entities, articles });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich(many, ctx);
  assert.equal(rec.done.length, 120);
  for (const c of http.calls) {
    if (c.url.includes('query.wikidata.org') && !(c.opts.body || '').includes('quantityAmount')) {
      const films = new Set([...new URLSearchParams(c.opts.body).get('query').matchAll(/\("(\d+)" "/g)].map(m => m[1]));
      assert.ok(films.size <= 40, `${films.size} films in one query`);
    }
  }
  assert.ok(http.calls.length <= 3 + 5, `${http.calls.length} calls`); // 3 sitelink queries + 5 details queries (25 each)
});

test('per-film failure goes to ctx.fail and others continue', async () => {
  const http = fakeHttp({ entities: { Q100: paris }, sparql: () => new HttpError(503, 'x'), details: () => new HttpError(503, 'x') });
  const orig = http.json;
  http.json = async (url, opts) => {
    if (url.includes('ids=Q404')) throw new HttpError(503, url);
    return orig(url, opts);
  };
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Paris, Texas', 1984, { ids: { wikidata: 'Q100' } })], ctx);
  assert.equal(rec.done.length, 1);
  const { ctx: ctx2, rec: rec2 } = makeCtx(http);
  await wikidata.enrich([film('X', 2000, { ids: { wikidata: 'Q404' } })], ctx2);
  assert.equal(rec2.fail.length, 1);
  assert.equal(rec2.done.length, 0);
  assert.match(rec2.fail[0].err.message, /Wikidata/);
});

test('abort: stops with an aborted error before any request', async () => {
  const http = fakeHttp({});
  const ac = new AbortController();
  ac.abort();
  const { ctx, rec } = makeCtx(http, { signal: ac.signal });
  await assert.rejects(wikidata.enrich([film('A', 2000)], ctx), e => e.code === 'aborted');
  assert.equal(http.calls.length, 0);
  assert.equal(rec.done.length, 0);
});


// ---------- genre clean-up, title variants, TV (polish) ----------

const G = (...labels) => canonicalGenres(labels);

test('canonicalGenres: compound labels map onto Letterboxd genres, the fine label stays as a style', () => {
  assert.deepEqual(G('Comedy drama'), { genres: ['Comedy', 'Drama'], styles: ['Comedy drama'] });
  assert.deepEqual(G('Crime thriller').genres, ['Crime', 'Thriller']);
  assert.deepEqual(G('Romantic comedy').genres, ['Comedy', 'Romance']);
  assert.deepEqual(G('Psychological thriller'), { genres: ['Thriller'], styles: ['Psychological thriller'] });
  assert.deepEqual(G('Suspense').genres, ['Thriller']);
  assert.deepEqual(G('Black comedy').genres, ['Comedy']);
  assert.deepEqual(G('Historical').genres, ['History']);
  assert.deepEqual(G('Historical drama').genres, ['Drama', 'History']);
  assert.deepEqual(G('Period drama').genres, ['Drama', 'History']);
  assert.deepEqual(G('Biographical').genres, ['History']);
  assert.deepEqual(G('Musical').genres, ['Music']);
  assert.deepEqual(G("Children's").genres, ['Family']);
  assert.deepEqual(G('Science fiction horror').genres, ['Horror', 'Science Fiction']);
  assert.deepEqual(G('Arthouse science fiction').genres, ['Science Fiction']);
  assert.deepEqual(G('Gangster').genres, ['Crime']);
  assert.deepEqual(G('Neo-noir').genres, ['Crime']);
  assert.deepEqual(G('Superhero').genres, ['Action']);
  assert.deepEqual(G('Animated').genres, ['Animation']);
  assert.deepEqual(G('Anime').genres, ['Animation']);
  assert.deepEqual(G('War drama').genres, ['Drama', 'War']);
  assert.deepEqual(G('Psychological horror').genres, ['Horror']);
  assert.deepEqual(G('Crime drama').genres, ['Crime', 'Drama']);
  assert.deepEqual(G('Melodrama').genres, ['Drama']);
});

test('canonicalGenres: exact genres are not styles; noise is dropped; Road becomes Road movie', () => {
  assert.deepEqual(G('Drama', 'Science fiction', 'Western', 'War'), { genres: ['Drama', 'Science Fiction', 'War', 'Western'], styles: [] });
  assert.deepEqual(G('Independent', 'Flashback', 'Film based on literature').styles, []);
  assert.deepEqual(G('Road').styles, ['Road movie']);
  assert.deepEqual(G('Coming-of-age', 'Dystopian', 'Epic', 'Teen', 'Post-apocalyptic', 'Magic realist', 'LGBTQ+'),
    { genres: [], styles: ['Coming-of-age', 'Dystopian', 'Epic', 'Teen', 'Post-apocalyptic', 'Magic realist', 'LGBTQ+'] });
  assert.deepEqual(G('Drama', 'Drama', 'Comedy drama').genres, ['Comedy', 'Drama']); // deduped, canonical order
  assert.deepEqual(canonicalGenres([]), { genres: [], styles: [] });
});

test('mapEntity: genres and keywords; Animation / Documentary come from the type when no genre is given', () => {
  const label = id => ({ G1: 'comedy drama film', G2: 'coming-of-age film' })[id] ?? null;
  const e = filmEntity('Q50', 2000, { extra: { P136: [snak({ id: 'G1' }), snak({ id: 'G2' })] } });
  const { data } = mapEntity(e, label);
  assert.deepEqual(data.genres, ['Comedy', 'Drama']);
  assert.deepEqual(data.keywords, ['Comedy drama', 'Coming-of-age']);
  assert.deepEqual(mapEntity(filmEntity('Q51', 2000, { type: 'Q202866' }), label).data.genres, ['Animation']);
  assert.deepEqual(mapEntity(filmEntity('Q52', 2000, { type: 'Q93204' }), label).data.genres, ['Documentary']);
  const styleOnly = filmEntity('Q53', 2000, { type: 'Q202866', extra: { P136: [snak({ id: 'G2' })] } });
  assert.deepEqual(mapEntity(styleOnly, label).data.genres, ['Animation']);
  assert.deepEqual(mapEntity(filmEntity('Q54', 2000), label).data.genres, []);
});

test('wikipediaCase lowercases small words except at the start or after a colon', () => {
  assert.equal(wikipediaCase('The Tale of The Princess Kaguya'), 'The Tale of the Princess Kaguya');
  assert.equal(wikipediaCase('Dune: The Part Two'), 'Dune: The Part Two');
  assert.equal(wikipediaCase('Kramer Vs Kramer'), 'Kramer vs Kramer');
  assert.equal(wikipediaCase('Lock, Stock And Two Smoking Barrels'), 'Lock, Stock and Two Smoking Barrels');
});

test('sitelinkTitles: title case, trailing full stop, "The Movie", dashes, TV spellings, colon parts', () => {
  const has = (t, y, x) => assert.ok(sitelinkTitles(t, y).includes(x), `${t} should try ${x}`);
  has('The Tale of The Princess Kaguya', 2013, 'The Tale of the Princess Kaguya (film)');
  has('Your Name.', 2016, 'Your Name (2016 film)');
  has('Your Name.', 2016, 'Your Name. (film)'); // the original spelling is still tried
  has('A Silent Voice: The Movie', 2016, 'A Silent Voice (film)');
  has('A Silent Voice – The Movie', 2016, 'A Silent Voice (film)');
  has('A Silent Voice : The Movie', 2016, 'A Silent Voice (film)');
  has('Fire – Water', 2000, 'Fire - Water (film)');
  has('Loki', 2021, 'Loki (TV series)');
  has('Loki', 2021, 'Loki (2021 TV series)');
  has("The Queen's Gambit", 2020, "The Queen's Gambit (miniseries)");
  has('Dune: Part Two', 2024, 'Dune (film)'); // part before the colon
  has('Radiohead: In Rainbows – From the Basement', 2008, 'Radiohead (film)');
  has('Radiohead: In Rainbows – From the Basement', 2008, 'In Rainbows – From the Basement (film)');
  const list = sitelinkTitles('Dune: Part Two', 2024); // the full title always comes before the colon fragments
  assert.ok(list.indexOf('Dune: Part Two (film)') < list.indexOf('Dune (film)'));
  assert.ok(!sitelinkTitles('Wait...', 2000).includes('Wait.. (film)')); // only a single trailing full stop is stripped
});

test('verifyCandidate: TV items use the year of first release (P577 or P580), films any release', () => {
  const tvTypes = new Set(TV_TYPES);
  const tv = (y, ...more) => filmEntity('Q60', y, { type: 'Q5398426', extra: more.length ? { P580: more.map(m => snak({ time: `+${m}-01-01T00:00:00Z`, precision: 9 })) } : {} });
  assert.equal(verifyCandidate(tv(2021), 2021, tvTypes), true);
  assert.equal(verifyCandidate(tv(2021), 2022, tvTypes), true);
  assert.equal(verifyCandidate(tv(2021), 2024, tvTypes), false);
  assert.equal(verifyCandidate(tv(2015, 2015, 2024), 2024, tvTypes), false); // a later date must not rescue a wrong first year
  const startOnly = { id: 'Q61', claims: { P31: [snak({ id: 'Q1259759' })], P580: [snak({ time: '+2020-10-23T00:00:00Z', precision: 11 })] } };
  assert.equal(verifyCandidate(startOnly, 2020, tvTypes), true);
  assert.equal(verifyCandidate(startOnly, 2023, tvTypes), false);
});

test('TV series are matched through "Title (TV series)", get kind "tv", and obey the first-release year', async () => {
  const http = fakeHttp({
    entities: { Q70: filmEntity('Q70', 2021, { type: 'Q5398426' }), Q71: filmEntity('Q71', 1999, { type: 'Q5398426' }) },
    articles: { 'Loki (TV series)': { qid: 'Q70', types: ['Q5398426'], years: [2021] }, 'Lost (TV series)': { qid: 'Q71', types: ['Q5398426'], years: [1999] } },
  });
  const { ctx, rec } = makeCtx(http);
  const loki = film('Loki', 2021), lost = film('Lost', 2020);
  await wikidata.enrich([loki, lost], ctx);
  const a = rec.done.find(d => d.film === loki);
  assert.equal(a.ids.wikidata, 'Q70');
  assert.equal(a.data.kind, 'tv');
  assert.equal(rec.done.find(d => d.film === lost).data, null); // started 1999: not 2020
});

test('a TV subclass (e.g. animated series) is learned once and marked tv', async () => {
  const http = fakeHttp({
    entities: { Q80: filmEntity('Q80', 2023, { type: 'Q117467246' }) },
    articles: { 'Scavengers Reign': { qid: 'Q80', types: ['Q117467246'], years: [2023] } },
    tvSubclasses: new Set(['Q117467246']),
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Scavengers Reign', 2023)], ctx);
  assert.equal(rec.done[0].ids.wikidata, 'Q80');
  assert.equal(rec.done[0].data.kind, 'tv');
});

test('title variants reach the film: "Your Name." and "A Silent Voice: The Movie"', async () => {
  const http = fakeHttp({
    entities: { Q90: filmEntity('Q90', 2016), Q91: filmEntity('Q91', 2016) },
    articles: { 'Your Name (film)': { qid: 'Q90', years: [2016] }, 'A Silent Voice (film)': { qid: 'Q91', years: [2016] } },
  });
  const { ctx, rec } = makeCtx(http);
  await wikidata.enrich([film('Your Name.', 2016), film('A Silent Voice: The Movie', 2016)], ctx);
  assert.deepEqual(rec.done.map(d => d.ids.wikidata).sort(), ['Q90', 'Q91']);
});

test('mapEntity: collection keeps its label and its wd: id; people keep wd: ids', () => {
  const label = id => ({ S1: 'Dune (franchise)', P9: 'Some Director' })[id] ?? null;
  const e = filmEntity('Q95', 2024, { extra: { P179: [snak({ id: 'S0' }), snak({ id: 'S1' })], P57: [snak({ id: 'P9' })] } });
  const { data } = mapEntity(e, label);
  assert.equal(data.collection, 'Dune (franchise)');
  assert.equal(data.collectionId, 'wd:S1'); // the first series that has an English label
  assert.equal(data.people.director[0].id, 'wd:P9');
  assert.equal(mapEntity(filmEntity('Q96', 2024), label).data.collectionId, undefined);
});
