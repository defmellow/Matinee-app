// App shell helpers: safe route decoding, latest-call-wins guard, theme cache, page titles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, safeDecode } from '../../ui/router.js';
import { makeSeq, cachedTheme, cacheTheme, routeTitle } from '../../ui/shell.js';

test('safeDecode never throws and keeps the raw text for bad escapes', () => {
  assert.equal(safeDecode('a%20b'), 'a b');
  assert.equal(safeDecode('%E0%A4%A'), '%E0%A4%A');
  assert.equal(safeDecode('100%'), '100%');
});

test('parse survives a malformed hash', () => {
  assert.deepEqual(parse('#/film/100%'), { name: 'film', param: '100%', qs: '' });
  assert.deepEqual(parse('#/film/%E0%A4%A'), { name: 'film', param: '%E0%A4%A', qs: '' });
  assert.equal(parse('#/film/a%2Fb').param, 'a/b');
  assert.equal(parse('').name, 'library');
});

test('makeSeq: only the newest call is current; cancel drops everything', () => {
  const s = makeSeq();
  const a = s.next(), b = s.next();
  assert.equal(s.current(a), false);
  assert.equal(s.current(b), true);
  s.cancel();
  assert.equal(s.current(b), false);
});

test('theme cache keeps only light/dark and tolerates broken storage', () => {
  const mem = new Map();
  const store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  assert.equal(cachedTheme(store), null);
  cacheTheme(store, 'light'); assert.equal(cachedTheme(store), 'light');
  cacheTheme(store, 'neutral'); assert.equal(cachedTheme(store), 'neutral');
  cacheTheme(store, 'neutral-light'); assert.equal(cachedTheme(store), 'neutral-light');
  cacheTheme(store, 'system'); assert.equal(cachedTheme(store), null);
  cacheTheme(store, 'junk'); assert.equal(cachedTheme(store), null);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(cachedTheme(broken), null);
  assert.doesNotThrow(() => cacheTheme(broken, 'dark'));
  assert.equal(cachedTheme(undefined), null);
});

test('routeTitle', () => {
  assert.equal(routeTitle('settings'), 'Settings - Matinee');
  assert.equal(routeTitle('nope'), 'Library - Matinee');
});
