// The feel work kept on disk: round trip, wrong code stamp, damaged file, unreadable sources. SYNTHETIC records.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeelMemoFile, codeStamp } from '../../core/feel-memo-file.js';
import { buildFeelIndex, adoptMemo, profileOf } from '../../core/analysis/feel/index.js';
import { mkVec } from '../../core/analysis/feel/similar.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-memo-'));
const sample = () => new Map([
  ['a', { sig: 'x1', rec: { key: 'a', descs: new Map([['sad', { score: 0.5 }]]), people: mkVec([['p:1', 1], ['p:2', 0.5]]), tokens: ['one', 'two'], profile: { themes: [{ id: 't', films: 2 }] } } }],
  ['b', { sig: 'x2', rec: { key: 'b', descs: new Map(), people: mkVec([]), tokens: [], profile: { themes: [] } } }],
]);

test('saved feel work comes back as it went in', async () => {
  const dir = tmp();
  try {
    const problems = [];
    const f = createFeelMemoFile({ dir, report: p => problems.push(p) });
    assert.equal(await f.load(), null, 'no file yet: nothing, and nothing to report');
    assert.equal(await f.save(sample()), true);
    const back = await createFeelMemoFile({ dir, report: p => problems.push(p) }).load(); // "a restart": a new object
    assert.deepEqual(back, sample());
    assert.ok(back.get('a').rec.people.ids instanceof Int32Array && back.get('a').rec.people.m instanceof Map, 'vectors keep their typed arrays and maps');
    assert.deepEqual(problems, []);
    assert.equal(fs.existsSync(f.file + '.tmp'), false, 'no temp file left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('work saved by other code is ignored, not served', async () => {
  const dir = tmp();
  try {
    const problems = [];
    await createFeelMemoFile({ dir, stamp: async () => 'old-code' }).save(sample());
    assert.equal(await createFeelMemoFile({ dir, stamp: async () => 'new-code', report: p => problems.push(p) }).load(), null);
    assert.deepEqual(problems, [], 'a changed engine is expected, not a problem');
    assert.equal((await createFeelMemoFile({ dir, stamp: async () => 'old-code' }).load()).size, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a damaged file is reported, removed, and rebuilt from nothing', async () => {
  const dir = tmp();
  try {
    const problems = [];
    const f = createFeelMemoFile({ dir, report: p => problems.push(p) });
    await f.save(sample());
    const bytes = fs.readFileSync(f.file);
    fs.writeFileSync(f.file, bytes.subarray(0, Math.floor(bytes.length / 2))); // cut short
    assert.equal(await f.load(), null);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].area, 'Feel'); assert.equal(problems[0].level, 'warning'); assert.ok(problems[0].error);
    assert.equal(fs.existsSync(f.file), false);
    fs.writeFileSync(f.file, 'not a memo at all');
    assert.equal(await f.load(), null);
    assert.equal(problems.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('if the engine files cannot be read nothing is saved, and it is said once', async () => {
  const dir = tmp();
  try {
    const problems = [];
    const f = createFeelMemoFile({ dir, report: p => problems.push(p), stamp: async () => { throw new Error('no such file'); } });
    assert.equal(await f.save(sample()), false);
    assert.equal(await f.load(), null);
    assert.equal(await f.save(sample()), false);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].level, 'warning');
    assert.equal(fs.existsSync(f.file), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the code stamp is stable and a loaded memo is kept by buildFeelIndex but cleared for another lexicon', async () => {
  assert.equal(await codeStamp(), await codeStamp());
  const input = { key: 'k', title: 'T', year: 2000, texts: [{ source: 'review', text: 'A tender, sad film about grief.' }] };
  const memo = new Map();
  const first = buildFeelIndex([input], { memo });
  assert.equal(memo.dirty, true, 'a new entry marks the memo as worth saving');
  assert.match(memo.get('k').sig, /^[A-Za-z0-9+/=]{20,40}$/, 'a short hash, not the film text');
  const dir = tmp();
  try {
    const f = createFeelMemoFile({ dir });
    await f.save(memo);
    const loaded = adoptMemo(await f.load());
    loaded.dirty = false;
    const again = buildFeelIndex([input], { memo: loaded });
    assert.equal(loaded.dirty, false, 'nothing was rebuilt');
    assert.deepEqual(profileOf(again, 'k'), profileOf(first, 'k'));
    const clearedBy = buildFeelIndex([input], { memo: loaded, lexicon: [] });
    assert.ok(clearedBy && loaded.dirty === true, 'another lexicon clears the loaded memo');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
