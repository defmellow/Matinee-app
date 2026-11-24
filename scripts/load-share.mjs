// Turns matinee-share.zip back into a data folder that the feel scripts can run on.
//   node scripts/load-share.mjs <matinee-share.zip> <outDir>
// Then: node scripts/feel-anchors.mjs --data <outDir>
// Writes films.json and library.json in store format (films.json is the same content as the store; library.json has no account details),
// plus profiles.json (the feel profiles as exported), header.json, fetch-log.txt and test-fetch.txt.
import fs from 'node:fs';
import path from 'node:path';
import { readZip } from '../core/zip.js';

const [zipPath, outDir] = process.argv.slice(2);
if (!zipPath || !outDir || zipPath === '--help') { console.error('Usage: node scripts/load-share.mjs <matinee-share.zip> <outDir>'); process.exit(zipPath === '--help' ? 0 : 1); }

const files = readZip(fs.readFileSync(zipPath));
const text = name => (files.has(name) ? files.get(name).toString('utf8') : '');
const films = {}, profiles = {};
for (const line of text('films.ndjson').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  films[row.k] = row.f;
  if (row.p) profiles[row.k] = row.p;
}
fs.mkdirSync(outDir, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(outDir, name), typeof data === 'string' ? data : JSON.stringify(data));
const header = JSON.parse(text('header.json') || '{}');
write('films.json', films);
write('library.json', text('library.json') || '{}');
write('profiles.json', profiles);
write('header.json', header);
write('fetch-log.txt', text('fetch-log.txt'));
write('test-fetch.txt', text('test-fetch.txt'));
console.log(`Wrote ${Object.keys(films).length} films to ${outDir}`);
