import test from 'node:test';
import assert from 'node:assert/strict';
import { n, plural, pluralN, MONTHS_SHORT } from '../../ui/format.js';

// The old per-screen copies, kept here to prove the shared helpers give identical output.
const oldPlural = (c, one, many) => `${c} ${c === 1 ? one : many}`;
const oldSelectPlural = (c, one, many = one + 's') => `${c} ${c === 1 ? one : many}`;
const oldPersonPlural = (c, one, many) => `${n(c)} ${c === 1 ? one : many}`;

test('plural matches the old helpers', () => {
  for (const c of [0, 1, 2, 5, 1234]) {
    assert.equal(plural(c, 'film', 'films'), oldPlural(c, 'film', 'films'));
    assert.equal(plural(c, 'entry', 'entries'), oldPlural(c, 'entry', 'entries'));
    assert.equal(plural(c, 'film'), oldSelectPlural(c, 'film'));
    assert.equal(pluralN(c, 'film', 'films'), oldPersonPlural(c, 'film', 'films'));
  }
  assert.equal(pluralN(1234, 'film'), '1,234 films');
});

test('MONTHS_SHORT is the three-letter list used before', () => {
  assert.deepEqual(MONTHS_SHORT, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
});
