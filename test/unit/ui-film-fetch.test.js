import test from 'node:test';
import assert from 'node:assert/strict';
import { reasonText, pillText, split, applyEvent, eventIsFor, shouldFetch, providerLabel, REOPEN_MS } from '../../ui/screens/film/fetchModel.js';
import { optionLabel, tileState } from '../../ui/components/posterOptions.js';

const st = outcomes => ({ key: 'k', at: 1, outcomes });
const o = (provider, status, reason = '') => ({ provider, label: provider, status, reason });

test('pillText counts failed sources, plural aware, and is empty when all is well', () => {
  assert.equal(pillText(null), '');
  assert.equal(pillText(st([o('a', 'ok'), o('c', 'skipped')])), '');
  assert.equal(pillText(st([o('a', 'ok'), o('b', 'miss'), o('c', 'skipped')])), 'Not found on 1 source'); // misses show quietly since 10 Nov
  assert.equal(pillText(st([o('a', 'failed')])), 'Failed 1 source');
  assert.equal(pillText(st([o('a', 'failed'), o('b', 'failed'), o('c', 'ok')])), 'Failed 2 sources');
});

test('deferred sources are counted separately as waiting, failed wins the pill', () => {
  assert.equal(pillText(st([o('a', 'deferred'), o('b', 'deferred')])), 'Waiting on 2 sources');
  assert.equal(pillText(st([o('a', 'deferred'), o('b', 'failed')])), 'Failed 1 source');
  const s = split(st([o('a', 'deferred'), o('b', 'failed'), o('c', 'ok')]));
  assert.equal(s.failed.length, 1); assert.equal(s.deferred.length, 1);
});

test('reasonText is plain English, never a status code', () => {
  for (const r of ['status 429', 'timeout', 'HTTP 403 cf-mitigated', 'fetch failed', 'weird thing', '', 'not found 404']) {
    const t = reasonText(o('a', 'failed', r));
    assert.ok(t && !/\b(429|403|404|cf-|http|status)\b/i.test(t), t);
  }
  assert.match(reasonText(o('a', 'failed', 'status 429')), /slow down/);
  assert.match(reasonText(o('a', 'deferred')), /slow down/);
});

test('applyEvent folds a source result into the status without mutating it', () => {
  const s0 = st([o('a', 'ok')]);
  const s1 = applyEvent(s0, { key: 'k', provider: 'b', status: 'failed', reason: 'timeout' });
  assert.equal(s0.outcomes.length, 1);
  assert.equal(s1.outcomes.length, 2);
  const s2 = applyEvent(s1, { key: 'k', provider: 'b', status: 'ok' });
  assert.equal(s2.outcomes.find(x => x.provider === 'b').status, 'ok');
  assert.equal(applyEvent(s2, { key: 'k', done: true }), s2);
  assert.equal(applyEvent(null, { provider: 'tmdb', status: 'failed' }).outcomes[0].label, 'TMDB');
});

test('eventIsFor matches key or keys', () => {
  assert.ok(eventIsFor({ key: 'a' }, 'a'));
  assert.ok(eventIsFor({ key: 'x', keys: ['a', 'b'] }, 'b'));
  assert.ok(!eventIsFor({ key: 'x', keys: ['y'] }, 'a'));
  assert.ok(!eventIsFor(null, 'a'));
});

test('shouldFetch allows one run per film per two minutes', () => {
  const seen = new Map();
  assert.equal(shouldFetch('a', 1000, seen), true);
  assert.equal(shouldFetch('a', 1000 + REOPEN_MS - 1, seen), false);
  assert.equal(shouldFetch('b', 1500, seen), true);
  assert.equal(shouldFetch('a', 1000 + REOPEN_MS, seen), true);
});

test('providerLabel falls back sensibly', () => {
  assert.equal(providerLabel('lbpage'), 'Letterboxd');
  assert.equal(providerLabel('zzz'), 'Zzz');
  assert.equal(providerLabel('lbpage', 'Mine'), 'Mine');
});

test('poster options: labels and exactly one chosen tile', () => {
  assert.equal(optionLabel({ source: 'tmdb' }), 'TMDB');
  assert.equal(optionLabel({ source: 'lbpage' }), 'Letterboxd');
  assert.equal(optionLabel({ source: 'x', label: 'Custom' }), 'Custom');
  const opts = { chosen: 'tmdb', auto: 'wikipedia' };
  assert.equal(tileState(opts, { source: 'tmdb' }).picked, true);
  assert.equal(tileState(opts, { source: 'wikipedia' }).picked, false);
  assert.equal(tileState({ chosen: null, auto: 'wikipedia' }, { source: 'wikipedia' }).picked, false);
});
