import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelog, sectionsSince, compareVersions, normalizeVersion, inlineParts } from '../../ui/whatsnew/changelog.js';

const MD = `# Changelog

## Next build (v0.16)
- (nothing yet)

## v0.15 — 8 Nov 2026
- **Big thing:** it works.
  Second line continues.
- Plain one.

## v0.14 — 29 Oct 2026 (hotfix)
- Fix.

## v0.13-exp.2 — 1 Nov 2026
- Early.

## v0.12 exp 1 — 30 Oct 2026
- Older early.

## v0.11 — 29 Oct 2026
- Old.
`;

test('parseChangelog keeps only versioned sections and joins wrapped bullets', () => {
  const s = parseChangelog(MD);
  assert.deepEqual(s.map(x => x.version), ['0.15.0', '0.14.0', '0.13.0-exp.2', '0.12.0-exp.1', '0.11.0']);
  assert.equal(s[0].date, '8 Nov 2026');
  assert.equal(s[0].items.length, 2);
  assert.equal(s[0].items[0], '**Big thing:** it works. Second line continues.');
  assert.equal(s[1].date, '29 Oct 2026');
  assert.equal(s[1].title, 'hotfix');
});

test('parseChangelog handles empty, CRLF and sections without bullets', () => {
  assert.deepEqual(parseChangelog(''), []);
  assert.deepEqual(parseChangelog(null), []);
  assert.equal(parseChangelog('## v1.0 — x\r\n- a\r\n').length, 1);
  assert.deepEqual(parseChangelog('## v1.0 — x\nJust prose.\n'), []);
});

test('versions compare tolerantly', () => {
  assert.equal(compareVersions('v0.15', '0.15.0'), 0);
  assert.ok(compareVersions('0.15.0-exp.3', '0.15.0') < 0);
  assert.ok(compareVersions('0.15.0-exp.3', '0.15.0-exp.10') < 0);
  assert.ok(compareVersions('0.15.0-exp.1', '0.14.0') > 0);
  assert.equal(normalizeVersion('v0.15 exp 3'), '0.15.0-exp.3');
  assert.equal(normalizeVersion('nonsense'), '');
});

test('sectionsSince: newer than lastSeen, up to current, newest first', () => {
  const s = parseChangelog(MD);
  assert.deepEqual(sectionsSince(s, '0.11.0', '0.15.0').map(x => x.version), ['0.15.0', '0.14.0', '0.13.0-exp.2', '0.12.0-exp.1']);
  assert.deepEqual(sectionsSince(s, '0.14.0', '0.14.0'), []);
  assert.deepEqual(sectionsSince(s, '0.13.0', '0.14.0').map(x => x.version), ['0.14.0']);
  assert.deepEqual(sectionsSince(s, '0.12.0-exp.1', '0.13.0-exp.2').map(x => x.version), ['0.13.0-exp.2']);
});

test('sectionsSince: unknown lastSeen gives the newest section not past current', () => {
  const s = parseChangelog(MD);
  assert.deepEqual(sectionsSince(s, '', '0.14.0').map(x => x.version), ['0.14.0']);
  assert.deepEqual(sectionsSince(s, 'junk', '0.15.0').map(x => x.version), ['0.15.0']);
  assert.deepEqual(sectionsSince(s, '', '0.1.0'), []);
});

test('inlineParts splits bold and never emits markup', () => {
  assert.deepEqual(inlineParts('a **b** c `d`'), [{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c d', bold: false }]);
  assert.deepEqual(inlineParts(''), []);
});

test('pickSections: the running version picks the changelog, not which files are bundled', async () => {
  const { pickSections } = await import('../../ui/whatsnew/changelog.js');
  const main = [{ version: '0.38.0' }], exp = [{ version: '0.36.0-exp.48' }];
  assert.equal(pickSections('0.38.0', main, exp), main); // stable v0.38 once read the experimental list and showed nothing
  assert.equal(pickSections('0.36.0-exp.48', main, exp), exp);
  assert.equal(pickSections('0.39.0-exp.51', main, []), main); // no experimental sections: fall back to main
  assert.equal(pickSections('', main, exp), main);
});
