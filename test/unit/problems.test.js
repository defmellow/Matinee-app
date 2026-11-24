// The app-wide problem log (core/problems.js): repeats counted, stops ignored, kept on disk in the logs folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProblems, detailOf } from '../../core/problems.js';

test('a problem is listed newest first with plain message and technical detail; a stop is ignored', () => {
  let t = Date.parse('2026-11-10T00:00:00Z'); const fresh = [];
  const p = createProblems({ now: () => t, onNew: e => fresh.push(e) });
  p.report({ area: 'Rotten Tomatoes', message: 'Scores could not be read', error: Object.assign(new Error('boom'), { status: 500 }), film: 'The Moon (2023)' });
  t += 1000; p.report({ area: 'TMDB', message: 'Lookup failed' });
  assert.equal(p.report({ area: 'X', message: 'y', error: { code: 'aborted' } }), null);
  const list = p.list();
  assert.deepEqual(list.map(e => e.area), ['TMDB', 'Rotten Tomatoes']);
  assert.match(list[1].detail, /HTTP 500 · boom/);
  assert.equal(fresh.length, 2);
  assert.equal(p.unseen(), 2); p.markSeen(); assert.equal(p.unseen(), 0);
  assert.match(p.text(), /\[Rotten Tomatoes\] The Moon \(2023\): Scores could not be read/);
});

test('repeats within an hour are counted on one entry; later ones start a new entry', () => {
  let t = 0; const p = createProblems({ now: () => t });
  p.report({ area: 'A', message: 'm' }); t += 60_000; p.report({ area: 'A', message: 'm' });
  assert.equal(p.list().length, 1); assert.equal(p.list()[0].count, 2);
  t += 2 * 3600_000; p.report({ area: 'A', message: 'm' });
  assert.equal(p.list().length, 2);
});

test('kept in the logs folder: problems.json survives a restart, problems.log gets a line each time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-problems-'));
  const a = createProblems({ dir });
  a.report({ area: 'Saving', message: "Couldn't save" }); a.report({ area: 'Saving', message: "Couldn't save" }); a.flush();
  const b = createProblems({ dir });
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].count, 2);
  const log = fs.readFileSync(path.join(dir, 'problems.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 2);
  assert.match(log[1], /again, ×2/);
});

test('detailOf never throws', () => {
  assert.equal(detailOf(null), '');
  assert.equal(detailOf('plain'), 'plain');
  const circ = {}; circ.self = circ; circ.message = 'x';
  assert.match(detailOf(circ), /x/);
});
