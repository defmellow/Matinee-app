import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayFor, TITLEBAR_HEIGHT } from '../../electron/shell-util.js';

test('overlayFor: Blush colours for the caption buttons, matching tokens.css', () => {
  assert.deepEqual(overlayFor(true), { color: '#221d1d', symbolColor: '#d4c6bc', height: TITLEBAR_HEIGHT });
  assert.deepEqual(overlayFor(false), { color: '#faf5f2', symbolColor: '#5b4d4b', height: TITLEBAR_HEIGHT });
});
