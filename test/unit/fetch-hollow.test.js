// Pages that load but show no scores: trouble streak, film.missNote bookkeeping, and the film page's "Not found" pill. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../../core/store.js';
import { createTrouble, enrich } from '../../core/enrich.js';
import { split, pillText, reasonText } from '../../ui/screens/film/fetchModel.js';

const rt = { id: 'rt', label: 'Rotten Tomatoes' };
const mk = () => createTrouble({ now: () => Date.parse('2026-11-10T00:00:00Z') });
const hollowN = (tr, n) => { for (let i = 0; i < n; i++) tr.hollow(rt, 'Film ' + i); };

test('five hollow pages in a row raise the notice; a plain miss neither resets nor raises; real data clears it', () => {
  const tr = mk();
  hollowN(tr, 4);
  assert.deepEqual(tr.list(), []);
  tr.ok(rt, 'Other', { gotData: false }); // a 404-style miss
  assert.deepEqual(tr.list(), []);
  hollowN(tr, 1); // still the 5th in a row
  const [n] = tr.list();
  assert.equal(n.key, 'hollow:rt');
  assert.equal(n.message, "Rotten Tomatoes pages load, but Matinee couldn't find the scores on them for a run of films that should have them. The site may have changed. Turn on Debug mode in Settings → Debug for a log you can copy.");
  tr.ok(rt, 'Miss', { gotData: false });
  assert.equal(tr.list().length, 1, 'a miss does not clear it');
  tr.ok(rt, 'Real', { gotData: true });
  assert.deepEqual(tr.list(), []);
  hollowN(tr, 4);
  assert.deepEqual(tr.list(), [], 'streak restarted after real data');
  assert.match(tr.text(), /hollow/);
});

test('a score-less page for a film nothing else has a score for counts for a quarter: a run of small films does not cry "site changed"', async () => {
  const { scoreExpected } = await import('../../core/enrich.js');
  const tr = mk();
  for (let i = 0; i < 19; i++) tr.hollow(rt, 'Small film ' + i, { expected: false });
  assert.deepEqual(tr.list(), [], 'nineteen small films in a row say nothing');
  tr.hollow(rt, 'Small film 20', { expected: false });
  assert.equal(tr.list().length, 1, 'twenty do');
  const mixed = mk();
  for (let i = 0; i < 8; i++) mixed.hollow(rt, 'Small ' + i, { expected: false });
  for (let i = 0; i < 3; i++) mixed.hollow(rt, 'Known ' + i, { expected: true });
  assert.equal(mixed.list().length, 1, 'three known films on top of eight small ones reach it (8 x 0.25 + 3)');
  assert.equal(scoreExpected(rt, { src: { omdb: { ratings: { rt: { critics: 91 } } } } }), true, "OMDb's copy says the score exists");
  assert.equal(scoreExpected(rt, { src: { rt: { ratings: { rt: { audience: 80 } } } } }), true, 'so does an earlier read of the page');
  assert.equal(scoreExpected(rt, { src: { omdb: { ratings: { metacritic: { critics: 70 } } } } }), false);
  assert.equal(scoreExpected({ id: 'lbpage' }, { src: {} }), true, 'other sources keep the plain rule');
});

test('done() stores and clears film.missNote and tells trouble', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-hollow-'));
  const store = createStore(dir);
  store.films['lid:h'] = { key: 'lid:h', slug: 'h', title: 'H', year: 2010, ids: {}, src: {}, checked: {}, missed: {} };
  const calls = [];
  const trouble = { ok: (p, t, o) => calls.push(['ok', o.gotData]), hollow: () => calls.push(['hollow']), fail() {}, observe() {}, list: () => [], text: () => '', hasCheck: () => false, check() {} };
  const seq = [[null, { hollow: 'no scores on the page' }], [{ ratings: { rt: { critics: 80 } } }, undefined], [null, undefined]];
  const p = { id: 'rt', label: 'Rotten Tomatoes', wants: () => true, async enrich(films, ctx) { const [data, info] = seq.shift(); ctx.done(films[0], data, undefined, info); } };
  const run = () => enrich({ store, providers: [p], http: {}, only: ['lid:h'], ignoreBackoff: true, force: true, trouble });
  const f = store.films['lid:h'];
  await run();
  assert.deepEqual(f.missNote, { rt: 'no scores on the page' });
  assert.ok(f.missed.rt);
  await run();
  assert.equal(f.missNote, undefined, 'cleared once data arrives');
  await run(); // re-read finds nothing: keeps old data, a plain miss
  assert.deepEqual(calls, [['hollow'], ['ok', true], ['ok', false]]);
});

test('fetch pill model: misses are listed after failed and deferred, with plain reasons', () => {
  const status = { outcomes: [
    { provider: 'rt', status: 'miss', reason: 'page there, no scores', hollow: true },
    { provider: 'allmovie', status: 'miss', reason: 'AllMovie has nothing on this film' },
    { provider: 'imdb', status: 'ok', reason: '' },
  ] };
  assert.equal(split(status).missed.length, 2);
  assert.equal(pillText(status), 'Not found on 2 sources');
  assert.equal(pillText({ outcomes: [status.outcomes[0]] }), 'Not found on 1 source');
  assert.equal(pillText({ outcomes: [...status.outcomes, { provider: 'x', status: 'deferred' }] }), 'Waiting on 1 source');
  assert.equal(pillText({ outcomes: [...status.outcomes, { provider: 'x', status: 'failed' }] }), 'Failed 1 source');
  assert.equal(pillText({ outcomes: [status.outcomes[2]] }), '');
  assert.equal(reasonText(status.outcomes[0]), "The film's page is there, but Matinee couldn't find the scores on it.");
  assert.equal(reasonText({ status: 'miss', reason: 'page there, no scores' }), "The film's page is there, but Matinee couldn't find the scores on it.");
  assert.equal(reasonText(status.outcomes[1]), "This site doesn't seem to have the film.");
});
