import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchLog, cleanText, describeData, siteForHost, siteForProvider } from '../../core/fetchlog.js';

test('the log keeps only the newest entries and numbers them in order', () => {
  const log = createFetchLog({ max: 300, flushMs: 1 });
  for (let i = 0; i < 450; i++) log.add({ site: 'Wikipedia', provider: 'wikipedia', title: `Film ${i}`, kind: 'ok', text: 'got poster' });
  const all = log.list();
  assert.equal(all.length, 300);
  assert.equal(all[0].title, 'Film 150');
  assert.equal(all[299].title, 'Film 449');
  assert.equal(all[299].n, 450);
  assert.deepEqual(log.list({ since: 448 }).map(e => e.n), [449, 450]);
  assert.equal(log.last, 450);
});

test('unknown kinds fall back to fetch; entries have the documented shape', () => {
  const e = createFetchLog().add({ site: 'X', kind: 'nonsense', text: 'hi' });
  assert.equal(e.kind, 'fetch');
  assert.deepEqual(Object.keys(e).sort(), ['kind', 'n', 'provider', 'site', 't', 'text', 'title']);
});

test('web addresses never reach the log', () => {
  assert.equal(cleanText('HTTP 404 for https://en.wikipedia.org/wiki/Secret_Person and www.example.com/x done'), 'HTTP 404 for and done');
  const e = createFetchLog().add({ site: 'Wikidata', text: 'failed https://query.wikidata.org/sparql?query=abc' });
  assert.doesNotMatch(JSON.stringify(e), /https?:|sparql\?/);
});

test('describeData names the kinds of thing found, never the values', () => {
  const secret = 'A lovely review that must stay out of the log';
  assert.equal(describeData({ poster: { url: 'https://x/y.jpg' }, synopsis: secret }), 'poster and synopsis');
  assert.equal(describeData({ ratings: { imdb: { value: 8 } } }), 'ratings');
  assert.equal(describeData({ reviews: [{ text: secret }], keywords: ['a'] }), 'themes and reviews');
  assert.equal(describeData({ weird: 1 }), 'details');
  assert.equal(describeData(null), 'details');
  assert.ok(!describeData({ synopsis: secret, reviews: [secret] }).includes('lovely'));
});

test('site names come from hosts and providers', () => {
  assert.equal(siteForHost('query.wikidata.org'), 'Wikidata');
  assert.equal(siteForHost('www.example.org'), 'example.org');
  assert.equal(siteForProvider('lbpage'), 'Letterboxd');
  assert.equal(siteForProvider('zzz', 'Zed'), 'Zed');
});

test('onChange is throttled: a burst of entries gives one notice with the latest number', async () => {
  const seen = [];
  const log = createFetchLog({ flushMs: 20, onChange: i => seen.push(i.last) });
  for (let i = 0; i < 50; i++) log.add({ text: 'x' });
  assert.equal(seen.length, 0);
  await new Promise(r => setTimeout(r, 60));
  assert.deepEqual(seen, [50]);
});
