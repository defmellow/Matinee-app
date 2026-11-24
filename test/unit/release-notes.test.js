import test from 'node:test';
import assert from 'node:assert/strict';
import { topSection } from '../../scripts/release-notes.mjs';

test('topSection returns the first section body only', () => {
  const t = '# Title\n\nIntro line.\n\n## v0.4.1 — date\n- One\n- Two\n\n## v0.4\n- Old\n';
  assert.equal(topSection(t), '- One\n- Two');
});
test('topSection handles CRLF, a single section, and none', () => {
  assert.equal(topSection('## A\r\n- x\r\n'), '- x');
  assert.equal(topSection('no headings'), null);
  assert.equal(topSection('## Empty\n\n## Next\n- y'), null);
});
