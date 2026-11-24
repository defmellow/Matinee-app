import test from 'node:test';
import assert from 'node:assert/strict';
import { enrich } from '../../core/enrich.js';

// Synthetic stores and providers (clearly fake): this checks scheduling order only.
const store = () => ({ library: { settings: {}, films: {} }, films: { a: { key: 'a', title: 'A' }, b: { key: 'b', title: 'B' } }, touch() {}, flush() {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (id, order, extra = {}, ms = 10) => ({ id, label: id, async enrich(films, ctx) { order.push(id + ':start'); await sleep(ms); for (const f of films) ctx.done(f, { x: 1 }); order.push(id + ':end'); }, ...extra });
const http = {};

test('page sources wait for the Wikipedia cover pass, which starts right after Wikidata', async () => {
  const order = [];
  const providers = [
    mk('boxd', order), mk('wikidata', order),
    mk('lbpage', order, { startsAfter: 'boxd' }), mk('allmovie', order, { independent: true }),
    mk('imdbpage', order), mk('mcreviews', order), mk('imdb', order), mk('wikipedia', order, {}, 40),
  ];
  await enrich({ store: store(), http, providers });
  const at = s => order.indexOf(s);
  assert.ok(at('wikidata:end') < at('wikipedia:start'));
  assert.ok(at('wikipedia:start') < at('imdb:start') || at('wikipedia:start') < at('imdb:end'));
  for (const id of ['imdbpage', 'mcreviews']) assert.ok(at('wikipedia:end') < at(id + ':start'), `${id} waited for covers`);
  assert.ok(order.includes('imdb:end'));
});

test('without a Wikipedia provider, page sources are not held up', async () => {
  const order = [];
  await enrich({ store: store(), http, providers: [mk('wikidata', order), mk('lbpage', order)] });
  assert.deepEqual(order.filter(x => x.endsWith(':end')).sort(), ['lbpage:end', 'wikidata:end']);
});

test('a failing Wikipedia pass still lets the page sources run', async () => {
  const order = [];
  const bad = { id: 'wikipedia', label: 'w', async enrich() { throw new Error('boom'); } };
  const r = await enrich({ store: store(), http, providers: [mk('wikidata', order), bad, mk('imdbpage', order)] });
  assert.ok(order.includes('imdbpage:end'));
  assert.equal(r.problems.length, 1);
});
