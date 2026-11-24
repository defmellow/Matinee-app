// The places a Mac works differently: Map wheel gestures, the zoom keys in words, mouse side buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wheelAction } from '../../ui/screens/map/model.js';
import { zoomKeysText, installMacMouseButtons } from '../../ui/platform.js';

test('elsewhere the wheel zooms the Map and Ctrl + wheel is left to the app', () => {
  assert.equal(wheelAction({ deltaY: 100, ctrlKey: true }, false), null);
  const z = wheelAction({ deltaY: -100 }, false);
  assert.ok(z.zoom > 1);
  assert.ok(wheelAction({ deltaY: 3, deltaMode: 1 }, false).zoom < 1, 'line mode counts lines');
});

test('on a Mac two fingers move around, a pinch or ⌘ + wheel zooms', () => {
  assert.deepEqual(wheelAction({ deltaX: 10, deltaY: -20 }, true), { pan: [-10, 20] });
  assert.ok(wheelAction({ deltaY: -5, ctrlKey: true }, true).zoom > 1, 'pinch out zooms in');
  assert.ok(wheelAction({ deltaY: 5, ctrlKey: true }, true).zoom < 1);
  assert.ok(wheelAction({ deltaY: -100, metaKey: true }, true).zoom > 1);
  assert.equal(wheelAction({ deltaY: -10000, ctrlKey: true }, true).zoom, 2, 'one event never jumps further than double');
});

test('zoom keys in words', () => {
  assert.equal(zoomKeysText(true), '⌘ + and ⌘ − to zoom, ⌘ 0 to reset.');
  assert.equal(zoomKeysText(false), 'Ctrl + and Ctrl − to zoom, Ctrl 0 to reset.');
});

test('mouse side buttons go back and forward on a Mac only', () => {
  const calls = [];
  globalThis.history = { back: () => calls.push('back'), forward: () => calls.push('forward') };
  const t = new EventTarget();
  const fire = button => { const e = new Event('mouseup', { cancelable: true }); e.button = button; t.dispatchEvent(e); };
  const off = installMacMouseButtons(true, t);
  fire(3); fire(4); fire(0);
  off(); fire(3);
  assert.deepEqual(calls, ['back', 'forward']);
  installMacMouseButtons(false, t); fire(3);
  assert.deepEqual(calls, ['back', 'forward']);
  delete globalThis.history;
});
