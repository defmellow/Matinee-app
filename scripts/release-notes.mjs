// Writes notes.md for a release from the top "## " section of a changelog: node scripts/release-notes.mjs docs/CHANGELOG.md notes.md
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Body of the first "## " section (without its heading), or null. */
export function topSection(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith('## '));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const [src, out] = process.argv.slice(2);
  writeFileSync(out, (topSection(readFileSync(src, 'utf8')) || 'Automatic build.') + '\n');
}
