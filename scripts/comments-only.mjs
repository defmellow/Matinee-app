// Proves a change touched only comments: compares each changed .js/.jsx/.mjs/.cjs/.css file with its version at <ref> after esbuild
// (Babel) strips comments and whitespace. Prints the files whose code differs (and exits 1), else "only comments changed".
//   node scripts/comments-only.mjs [ref=HEAD]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { parse } from '@babel/parser';
import generateMod from '@babel/generator';
const generate = generateMod.default || generateMod;

const ref = process.argv[2] || 'HEAD';
const files = execFileSync('git', ['diff', '--name-only', ref, '--', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.css'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter(f => fs.existsSync(f));
const stripCss = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
const stripJs = src => generate(parse(src, { sourceType: 'unambiguous', plugins: ['jsx', 'importAttributes'], errorRecovery: false }), { comments: false, compact: true }).code;
const bad = [];
for (const f of files) {
  const before = execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8', maxBuffer: 64e6 });
  const after = fs.readFileSync(f, 'utf8');
  try { const strip = f.endsWith('.css') ? stripCss : stripJs;
  if (strip(before) !== strip(after)) bad.push(f); } catch (e) { bad.push(`${f} (could not parse: ${e.message.split('\n')[0]})`); }
}
console.log(bad.length ? `CODE CHANGED in:\n${bad.join('\n')}` : `only comments changed (${files.length} files)`);
process.exit(bad.length ? 1 : 0);
