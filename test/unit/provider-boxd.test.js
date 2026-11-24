import { test } from 'node:test';
import assert from 'node:assert/strict';
import boxd, { slugFromLocation } from '../../core/providers/boxd.js';

test('slug from a boxd.it redirect', () => {
  assert.equal(slugFromLocation('https://letterboxd.com/film/paris-texas/'), 'paris-texas');
  assert.equal(slugFromLocation('https://letterboxd.com/film/leave-the-world-behind-2023/'), 'leave-the-world-behind-2023');
  assert.equal(slugFromLocation('https://letterboxd.com/film_fan/film/rango/1/'), null);
  assert.equal(slugFromLocation(null), null);
});

test('boxd provider records slugs, misses and failures', async () => {
  const films = [{ key: 'lid:29Ts', lid: '29Ts', ids: {} }, { key: 'lid:gone', lid: 'gone', ids: {} }, { key: 'lid:boom', lid: 'boom', ids: {} }];
  const calls = [];
  const http = {
    async response(url, opts) {
      calls.push([url, opts.method, opts.redirect]);
      if (url.endsWith('29Ts')) return new Response(null, { status: 302, headers: { location: 'https://letterboxd.com/film/paris-texas/' } });
      if (url.endsWith('gone')) return new Response(null, { status: 404 });
      throw Object.assign(new Error('network down'), {});
    },
  };
  const done = [], failed = [];
  await boxd.enrich(films, { http, signal: null, progress() {}, log() {}, done: (f, d, ids) => done.push([f.key, d, ids]), fail: (f, e) => failed.push([f.key, e.message]) });
  assert.deepEqual(done, [['lid:29Ts', { slug: 'paris-texas' }, { letterboxd: 'paris-texas' }], ['lid:gone', null, undefined]]);
  assert.deepEqual(failed, [['lid:boom', 'network down']]);
  assert.equal(films[0].slug, 'paris-texas');
  assert.ok(calls.every(c => c[1] === 'HEAD' && c[2] === 'manual'));
  assert.equal(boxd.requires({ lid: 'x', ids: {} }), true);
  assert.equal(boxd.requires({ lid: 'x', slug: 'y', ids: {} }), false);
});
