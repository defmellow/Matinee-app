// Audit fixes for the key-less open-API providers: TV pages are misses, USD-only money, safe film identity,
// boxd breaker, future-year films, and Wikidata failures that must not be recorded as "not found".
import test from 'node:test';
import assert from 'node:assert/strict';
import mc from '../../core/providers/metacritic.js';
import rt from '../../core/providers/rottentomatoes.js';
import boxd from '../../core/providers/boxd.js';
import wikidata from '../../core/providers/wikidata.js';
import { isNonFilmPage } from '../../core/parse/critics.js';
import { resolveFilm } from '../../core/library.js';
import { HttpError } from '../../core/net.js';

const rec = () => ({ done: [], fail: [], log: [] });
const mkCtx = (http, r) => ({
  http, settings: {}, signal: null, progress() {},
  log: (...a) => r.log.push(a.join(' ')),
  done: (f, d, ids) => r.done.push({ f, d, ids }),
  fail: (f, e) => r.fail.push({ f, e }),
});

test('a loaded TV-series page is a miss for Metacritic, not a failure', async () => {
  const tv = '<script type="application/ld+json">{"@type":"TVSeries","name":"X"}</script>';
  assert.equal(isNonFilmPage(tv), true);
  assert.equal(isNonFilmPage('<html><title>Just a moment...</title></html>'), false);
  const http = { async text(url) { return { status: 200, url, headers: new Headers(), text: tv }; } };
  const r = rec();
  await mc.enrich([{ key: 'a', title: 'X', year: 2020, ids: { metacritic: 'tv/x' } }], mkCtx(http, r));
  assert.equal(r.fail.length, 0);
  assert.deepEqual(r.done.map(d => d.d), [null]);
});

test('an unrecognisable page (no type declared) is still a failure', async () => {
  const http = { async text(url) { return { status: 200, url, headers: new Headers(), text: '<html>Just a moment...</html>' }; } };
  const r = rec();
  await rt.enrich([{ key: 'a', title: 'X', year: 2020, ids: { rt: 'm/x' } }], mkCtx(http, r));
  assert.equal(r.fail.length, 1);
  assert.equal(r.done.length, 0);
});

test('future-year films are not required by RT or Metacritic', () => {
  const next = new Date().getFullYear() + 1;
  for (const p of [rt, mc]) {
    assert.equal(p.requires({ title: 'A', year: next, ids: {} }), false);
    assert.equal(p.requires({ title: 'A', year: 1999, ids: {} }), true);
    assert.equal(p.requires({ title: 'A', year: null, ids: {} }), true);
  }
});

test('resolveFilm: two distinct lids with the same title and year stay separate', () => {
  const store = { films: {}, library: {}, touch() {} };
  const a = resolveFilm(store, { lid: 'A', title: 'Les Misérables', year: 2012 });
  const b = resolveFilm(store, { lid: 'B', title: 'Les Miserables', year: 2012 });
  assert.notEqual(a, b);
  assert.equal(Object.keys(store.films).length, 2);
});

test('resolveFilm: non-Latin titles (empty normalised title) never merge by title', () => {
  const store = { films: {}, library: {}, touch() {} };
  const a = resolveFilm(store, { slug: 's1', title: 'Θάνατος', year: 2015 });
  const b = resolveFilm(store, { slug: 's2', title: 'Ο άνθρωπος', year: 2015 });
  assert.notEqual(a, b);
});

test('resolveFilm: a slug-only entry still finds the export film with the same title and year', () => {
  const store = { films: {}, library: {}, touch() {} };
  const a = resolveFilm(store, { lid: 'A', title: 'Paris, Texas', year: 1984 });
  const b = resolveFilm(store, { slug: 'paris-texas', title: 'Paris, Texas', year: 1984 });
  assert.equal(a, b);
  assert.equal(a.slug, 'paris-texas');
});

test('boxd: a 429 storm stops after about 3 requests', async () => {
  const films = Array.from({ length: 20 }, (_, i) => ({ key: `lid:${i}`, lid: String(i), ids: {} }));
  let calls = 0;
  const http = { async response() { calls++; await new Promise(r => setTimeout(r, 1)); return new Response(null, { status: 429 }); } };
  const r = rec();
  await boxd.enrich(films, mkCtx(http, r));
  assert.ok(calls <= 6, `made ${calls} requests`);
  assert.ok(r.log.some(l => /busy/.test(l)));
});

// ---- Wikidata: failures are not misses ----
const lit = value => ({ value });
function wdHttp({ labelError = null, subclassError = null, articles = null } = {}) {
  return {
    async json(url, opts = {}) {
      const u = new URL(url);
      if (u.host !== 'query.wikidata.org') throw new HttpError(429, url);
      const q = new URLSearchParams(opts.body).get('query');
      if (q.includes('wdt:P279*') && subclassError) throw subclassError;
      if (q.includes('schema:about') && articles) return { results: { bindings: articles(q) } };
      if (q.includes('BIND') && labelError) throw labelError;
      return { results: { bindings: [] } };
    },
  };
}

test('wikidata: a network error in the label search fails the film instead of recording a miss', async () => {
  const r = rec();
  await wikidata.enrich([{ key: 'k', title: 'Obscure', year: 2001, ids: {} }], mkCtx(wdHttp({ labelError: new TypeError('fetch failed') }), r));
  assert.equal(r.done.length, 0);
  assert.equal(r.fail.length, 1);
});

test('wikidata: a genuine empty answer is still a miss', async () => {
  const r = rec();
  await wikidata.enrich([{ key: 'k', title: 'Obscure', year: 2001, ids: {} }], mkCtx(wdHttp(), r));
  assert.deepEqual(r.done.map(d => d.d), [null]);
  assert.equal(r.fail.length, 0);
});

test('wikidata: sitelink and Wikipedia both down, label search empty: failed, not a miss', async () => {
  const http = {
    async json(url, opts = {}) {
      const u = new URL(url);
      if (u.host === 'en.wikipedia.org') throw new HttpError(429, url);
      const q = new URLSearchParams(opts.body).get('query');
      if (q.includes('schema:about')) throw new HttpError(504, url);
      return { results: { bindings: [] } };
    },
  };
  const r = rec();
  await wikidata.enrich([{ key: 'a', title: 'One', year: 2001, ids: {} }, { key: 'b', title: 'Two', year: 2002, ids: {} }], mkCtx(http, r));
  assert.equal(r.done.length, 0);
  assert.equal(r.fail.length, 2);
});

test('wikidata: a failed film-type lookup fails the films that depended on it', async () => {
  const r = rec();
  const http = wdHttp({
    subclassError: new HttpError(503, 'x'),
    articles: () => [{ k: lit('0'), name: { value: 'Odd', 'xml:lang': 'en' }, item: { value: 'http://www.wikidata.org/entity/Q9' }, type: { value: 'http://www.wikidata.org/entity/Q99999' }, d: lit('2001-01-01T00:00:00Z'), sl: lit('10') }],
  });
  await wikidata.enrich([{ key: 'k', title: 'Odd', year: 2001, ids: {} }], mkCtx(http, r));
  assert.equal(r.done.length, 0);
  assert.equal(r.fail.length, 1);
});

import { mapEntity } from '../../core/parse/wikidata.js';
const money = (prop, amount, unit) => ({ [prop]: [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { amount, unit: `http://www.wikidata.org/entity/${unit}` } } } }] });

test('wikidata: a budget with no USD claim is dropped, USD claims still take the largest', () => {
  const inr = mapEntity({ id: 'Q1', claims: money('P2130', '+90000000', 'Q80524') }, () => null).data;
  assert.equal(inr.budget ?? null, null);
  const usd = mapEntity({ id: 'Q1', claims: { ...money('P2130', '+90000000', 'Q80524'), P2142: money('P2142', '+5', 'Q4917').P2142 } }, () => null).data;
  assert.equal(usd.budget ?? null, null); // budget is P2130 only
  const both = mapEntity({ id: 'Q1', claims: { P2130: [...money('P2130', '+90000000', 'Q80524').P2130, ...money('P2130', '+3', 'Q4917').P2130, ...money('P2130', '+7', 'Q4917').P2130] } }, () => null).data;
  assert.equal(both.budget, 7);
});
