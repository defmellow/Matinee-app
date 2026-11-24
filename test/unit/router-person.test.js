// Person links carry the role they came from: #/person/<id>?role=director
import test from 'node:test';
import assert from 'node:assert/strict';
import { href, parse, queryOf } from '../../ui/router.js';

test('href adds a query only when it has values', () => {
  assert.equal(href('person', 'p:martin-scorsese', { role: 'director' }), '#/person/p%3Amartin-scorsese?role=director');
  assert.equal(href('person', 'x', { role: null }), '#/person/x');
  assert.equal(href('film', 'a b'), '#/film/a%20b');
});

test('parse reads the id and the query apart, including ids with a question mark', () => {
  const r = parse('#/person/p%3Amartin-scorsese?role=cast');
  assert.deepEqual([r.name, r.param, queryOf(r.qs).role], ['person', 'p:martin-scorsese', 'cast']);
  assert.equal(parse('#/person/who%3F').param, 'who?');
  assert.equal(queryOf(parse('#/library').qs).role, undefined);
});
