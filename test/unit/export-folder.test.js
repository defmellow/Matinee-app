// The export as an unzipped folder (a Mac unzips downloads by itself): packed back into a ZIP it reads the same as the ZIP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8 } from 'fflate';
import { parseExportZip, packExportFiles, NOT_AN_EXPORT } from '../../core/parse/export.js';
import { zipExportFolder } from '../../electron/export-folder.js';
import { FILES, makeExport } from '../fixtures/synthetic/export.js';

const asFiles = (prefix = '') => Object.entries(FILES).map(([p, text]) => ({ path: prefix + p, bytes: strToU8(text) }));

test('a folder of the export CSVs reads the same as the ZIP', () => {
  const fromZip = parseExportZip(makeExport());
  assert.deepEqual(parseExportZip(packExportFiles(asFiles())), fromZip);
  assert.deepEqual(parseExportZip(packExportFiles(asFiles('letterboxd-synth-2026/'))), fromZip, 'a wrapper folder is fine');
  assert.deepEqual(parseExportZip(packExportFiles(asFiles().map(f => ({ ...f, path: f.path.replace(/\//g, '\\') })))), fromZip, 'backslashes');
});

test('only CSVs are kept; Mac resource files and the ignored folders are left out', () => {
  const files = [...asFiles(), { path: '.DS_Store', bytes: new Uint8Array([1, 2]) }, { path: '._watched.csv', bytes: new Uint8Array([0]) }, { path: '__MACOSX/watched.csv', bytes: new Uint8Array([0]) }];
  assert.deepEqual(parseExportZip(packExportFiles(files)), parseExportZip(makeExport()));
});

test('a folder with no CSVs says it is not an export', () => {
  assert.throws(() => packExportFiles([{ path: 'photo.jpg', bytes: new Uint8Array([1]) }]), { message: NOT_AN_EXPORT });
  assert.throws(() => packExportFiles([]), { message: NOT_AN_EXPORT });
});

test('zipExportFolder reads a real folder on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-export-'));
  try {
    for (const [p, text] of Object.entries(FILES)) { fs.mkdirSync(path.join(dir, 'inner', path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(dir, 'inner', p), text); }
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a csv');
    assert.deepEqual(parseExportZip(zipExportFolder(dir)), parseExportZip(makeExport()));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
