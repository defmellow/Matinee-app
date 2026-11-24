import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trapTarget, inertAround } from '../../ui/components/a11y.js';

test('trapTarget wraps Tab at the ends and leaves the middle alone', () => {
  const [a, b, c] = ['a', 'b', 'c'];
  assert.equal(trapTarget([a, b, c], c, false), a);
  assert.equal(trapTarget([a, b, c], a, true), c);
  assert.equal(trapTarget([a, b, c], b, false), null);
  assert.equal(trapTarget([a, b, c], b, true), null);
});

test('trapTarget pulls focus in from outside and handles empty', () => {
  assert.equal(trapTarget(['a', 'b'], 'x', false), 'a');
  assert.equal(trapTarget(['a', 'b'], 'x', true), 'b');
  assert.equal(trapTarget([], 'x', false), null);
});

// Tiny fake DOM nodes: just enough for inertAround.
function node(parent) {
  const n = { parentElement: parent, children: [], attrs: new Set(),
    hasAttribute(k) { return this.attrs.has(k); }, setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); } };
  parent?.children.push(n);
  return n;
}

test('inertAround marks siblings up the tree and restores them', () => {
  const root = node(null), shell = node(root), modal = node(root);
  const rail = node(shell), main = node(shell), screen = node(main), other = node(main), overlay = node(screen);
  const undo = inertAround(overlay);
  assert.ok(rail.hasAttribute('inert') && other.hasAttribute('inert') && modal.hasAttribute('inert'));
  assert.ok(!shell.hasAttribute('inert') && !main.hasAttribute('inert') && !screen.hasAttribute('inert') && !overlay.hasAttribute('inert'));
  undo();
  assert.ok(![rail, other, modal].some(n => n.hasAttribute('inert')));
});

test('inertAround leaves already-inert nodes alone on restore', () => {
  const root = node(null), a = node(root), b = node(root);
  a.setAttribute('inert');
  const undo = inertAround(b);
  undo();
  assert.ok(a.hasAttribute('inert'));
});
