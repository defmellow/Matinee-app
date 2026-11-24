import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sinceText, noticeText, troubleId } from '../../ui/components/trouble.js';

test('noticeText: first message plus "+N more"', () => {
  assert.equal(noticeText([]), '');
  assert.equal(noticeText([{ message: 'A is slow.' }]), 'A is slow.');
  assert.equal(noticeText([{ message: 'A.' }, { message: 'B.' }, { message: 'C.' }]), 'A. +2 more');
});

test('sinceText: friendly local time, blank when missing', () => {
  assert.equal(sinceText(''), '');
  assert.equal(sinceText('nope'), '');
  assert.match(sinceText(new Date(2026, 9, 28, 15, 40).toISOString()), /^since 3:40 pm$/);
});

test('troubleId ignores order', () => {
  assert.equal(troubleId([{ key: 'b' }, { key: 'a' }]), troubleId([{ key: 'a' }, { key: 'b' }]));
});

test('notice is mounted, links to Settings and uses the shared button classes', () => {
  const src = p => readFileSync(new URL('../../ui/' + p, import.meta.url), 'utf8');
  assert.match(src('app.jsx'), /<FetchNotice \/>/);
  const n = src('components/FetchNotice.jsx');
  assert.match(n, /go\('settings'\)/);
  assert.match(n, /class="btn-link"/);
  assert.match(src('screens/settings/Sources.jsx'), /Log copied\./);
});
