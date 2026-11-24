import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLetterboxdFilm, parseReleases, ausRelease } from '../../core/parse/lbpage.js';
import { toData } from '../../core/providers/lbpage.js';
import lbpage from '../../core/providers/lbpage.js';
import { compose, emptyFilm } from '../../core/model.js';

const html = readFileSync(new URL('../fixtures/lbpage-releases.html', import.meta.url), 'utf8'); // synthetic

test('parseReleases reads every type, date and country (stops before the by-country view)', () => {
  const r = parseReleases(html);
  assert.ok(r.some(x => x.country === 'France' && x.type === 'Premiere' && x.date === '2026-05-12'));
  assert.ok(r.some(x => x.country === 'New Zealand' && x.type === 'Theatrical' && x.date === '2026-11-12'));
  assert.ok(r.some(x => x.country === 'Australia' && x.type === 'Digital'));
  assert.ok(!r.some(x => x.date === '2030-01-01'));
});

test('Theatrical beats Theatrical (limited); Digital is ignored', () => {
  const p = parseLetterboxdFilm(html);
  assert.deepEqual(p.ausRelease, { date: '2026-11-12', type: 'Theatrical' });
  assert.ok(p.releases.some(r => r.country === 'France' && r.type === 'Premiere'));
  assert.ok(!p.releases.some(r => r.country === 'United Kingdom'));
});

test('falls back to Theatrical (limited), and to nothing when only digital', () => {
  assert.deepEqual(ausRelease([{ country: 'Australia', date: '2026-11-05', type: 'Theatrical (limited)' }, { country: 'Australia', date: '2026-12-10', type: 'Digital' }]), { date: '2026-11-05', type: 'Theatrical (limited)' });
  assert.equal(ausRelease([{ country: 'Australia', date: '2026-12-10', type: 'Digital' }]), null);
});

test('Australia missing: no ausRelease, premiere still kept', () => {
  const noAus = html.replace(/<span class="name">Australia<\/span>/g, '<span class="name">Ireland</span>');
  const p = parseLetterboxdFilm(noAus);
  assert.equal(p.ausRelease, undefined);
  assert.deepEqual(p.releases, [{ country: 'France', date: '2026-05-12', type: 'Premiere' }]);
});

test('a page with no releases tab parses as before', () => {
  const p = parseLetterboxdFilm('<html><title>X • Letterboxd</title><div class="production-synopsis"></div></html>');
  assert.equal(p.releases, undefined);
  assert.equal(p.ausRelease, undefined);
});

test('toData keeps ausRelease and compose exposes it', () => {
  const data = toData(parseLetterboxdFilm(html));
  assert.deepEqual(data.ausRelease, { date: '2026-11-12', type: 'Theatrical' });
  const f = emptyFilm({ lid: 'x', slug: 'example', title: 'Example Film', year: 2026 });
  f.src.lbpage = data;
  assert.deepEqual(compose(f).ausRelease, { date: '2026-11-12', type: 'Theatrical' });
  assert.equal(compose(emptyFilm({ lid: 'y', title: 'Y' })).ausRelease, null);
});

test('wants(): recent films without an Australian date are re-read weekly, old ones are not', () => {
  const now = Date.parse('2026-10-22T00:00:00Z');
  const mk = (year, checkedDaysAgo, src = {}) => ({ ...emptyFilm({ lid: 'a', slug: 's', title: 'T', year }), src: { lbpage: src }, checked: { lbpage: new Date(now - checkedDaysAgo * 864e5).toISOString() } });
  assert.equal(lbpage.wants(mk(2026, 10), { now }), true);
  assert.equal(lbpage.wants(mk(2026, 3), { now }), false);
  assert.equal(lbpage.wants(mk(2026, 10, { ausRelease: { date: '2026-11-12', type: 'Theatrical' } }), { now }), false);
  assert.equal(lbpage.wants(mk(1985, 10), { now }), false);
});
