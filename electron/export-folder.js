// The Letterboxd export as a folder: Macs unzip downloads by themselves, so "Choose the file" may hand Matinee a folder.
// Reads the CSVs under it (a few levels deep, no links followed) and packs them into the ZIP the core already reads.
import fs from 'node:fs';
import path from 'node:path';
import { packExportFiles } from '../core/parse/export.js';

const MAX_DEPTH = 4, MAX_FILES = 5000;

/** @returns {Uint8Array} ZIP bytes. Throws the core's friendly "isn't a Letterboxd export" error when there are no CSVs. */
export function zipExportFolder(dir) {
  const files = [];
  const walk = (abs, rel, depth) => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const r = rel ? rel + '/' + d.name : d.name;
      if (d.isDirectory() && depth < MAX_DEPTH) walk(path.join(abs, d.name), r, depth + 1);
      else if (d.isFile() && d.name.toLowerCase().endsWith('.csv')) files.push({ path: r, bytes: new Uint8Array(fs.readFileSync(path.join(abs, d.name))) });
    }
  };
  walk(dir, '', 0);
  return packExportFiles(files);
}
