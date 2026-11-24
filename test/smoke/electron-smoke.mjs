// Launches the BUILT app (the unpacked folder electron-builder made) with an empty data folder and walks through it:
// welcome screen -> import a small synthetic export -> Library -> a film page -> Map -> Settings -> close and reopen, a screenshot after each step.
// Fails on any page error, any crash screen ('.empty.crash') or a step that does not happen. Never touches live websites on purpose
// (the export has no profile, so Matinee has no Letterboxd name to look up; background fetching may start and is not waited on).
//
//   node test/smoke/electron-smoke.mjs <path to the built app> [screenshot folder]
//   e.g. xvfb-run -a node test/smoke/electron-smoke.mjs release/linux-unpacked/matinee shots
//        node test/smoke/electron-smoke.mjs release/mac-arm64/Matinee.app/Contents/MacOS/Matinee shots
//        node test/smoke/electron-smoke.mjs release/win-unpacked/Matinee.exe shots
// Env: PW=<playwright folder> (default: the global one in the cloud container, else `npm i -g playwright` on CI).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = process.argv[2] && path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'matinee-smoke-shots'));
if (!exe || !fs.existsSync(exe)) { console.error(`Usage: node test/smoke/electron-smoke.mjs <built app> [screenshot folder]\nNot found: ${process.argv[2]}`); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const tries = [process.env.PW, 'playwright', 'playwright-core', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  try { tries.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright-core')); } catch { /* no npm: the other paths may still work */ }
  for (const t of tries) { try { return require(t); } catch { /* try the next */ } }
  throw new Error('Playwright was not found. Install it with: npm install -g playwright (or set PW to its folder).');
}
const { _electron } = loadPlaywright();
const { makeExport } = await import(pathToFileURL(path.join(root, 'test/fixtures/synthetic/export.js')).href);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-smoke-'));
const userData = path.join(work, 'userdata'); // empty: a first run
const zipFile = path.join(work, 'synthetic-export.zip');
fs.writeFileSync(zipFile, makeExport({ replace: { 'profile.csv': null } }));

const problems = []; // page errors and crash screens: any one fails the run
let step = 0;
const results = [];
async function stepOf(name, win, fn) {
  const n = String(++step).padStart(2, '0');
  const file = path.join(shots, `${n}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`);
  try {
    const detail = await fn();
    await win.waitForTimeout(500); // fonts and layout settle
    await win.screenshot({ path: file });
    if (await win.locator('.empty.crash').count()) throw new Error('a crash screen is showing (".empty.crash")');
    results.push({ name, ok: true }); console.log(`  ok   ${name}${detail ? ' - ' + detail : ''}\n       ${file}`);
  } catch (e) {
    results.push({ name, ok: false }); console.log(`  FAIL ${name}\n       ${String((e && e.message) || e).split('\n').join('\n       ')}`);
    try { await win.screenshot({ path: file.replace(/\.png$/, '-FAILED.png') }); } catch { /* the window may be gone */ }
    throw e; // later steps need this one
  }
}

const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []; // CI containers lack the Chromium sandbox helper
console.log(`Matinee smoke test: ${exe}\n  data folder ${userData}`);
const app = await _electron.launch({ executablePath: exe, args, env: { ...process.env, MATINEE_USER_DATA: userData }, timeout: 90_000 })
  .catch(e => { console.error('Could not launch the app:', e.message); process.exit(2); });

let win;
try {
  win = await app.firstWindow({ timeout: 90_000 });
  win.on('pageerror', e => problems.push(`page error: ${e.message}`));
  win.on('crash', () => problems.push('the window crashed'));
  await win.waitForLoadState('load', { timeout: 60_000 });

  await stepOf('welcome', win, async () => {
    await win.waitForSelector('.onb-drop', { timeout: 60_000 });
    const t = await win.title();
    const where = await app.evaluate(() => `${process.platform} ${process.arch}`); // the app's own, so the Intel run shows x64
    return `title "${t}", ${where}`;
  });

  await stepOf('import export', win, async () => {
    await win.setInputFiles('.onb-drop input[type=file]', zipFile);
    await win.waitForSelector('.onb-found', { timeout: 60_000 });
    const h = (await win.locator('.onb-found h1').innerText()).trim();
    if (!/Found \d+ film/.test(h)) throw new Error(`unexpected heading "${h}"`);
    return h;
  });

  await stepOf('library', win, async () => {
    await win.getByRole('button', { name: /open my library/i }).click();
    await win.waitForSelector('a.film-card', { timeout: 60_000 });
    return `${await win.locator('a.film-card').count()} film cards`;
  });

  await stepOf('film page', win, async () => {
    const title = await win.locator('a.film-card').first().getAttribute('title');
    await win.locator('a.film-card').first().click();
    await win.waitForFunction(() => location.hash.startsWith('#/film'), null, { timeout: 15_000 });
    await win.waitForSelector('main h1', { timeout: 30_000 });
    return `opened ${title}`;
  });

  await stepOf('map', win, async () => {
    await win.locator('nav.rail a.rail-btn[href="#/map"]').click();
    await win.waitForFunction(() => location.hash.startsWith('#/map'), null, { timeout: 15_000 });
    await win.waitForSelector('main canvas, main .empty', { timeout: 60_000 });
    return await win.locator('main canvas').count() ? 'canvas drawn' : 'empty state shown';
  });

  await stepOf('settings', win, async () => {
    await win.locator('nav.rail a.rail-btn[href="#/settings"]').click();
    await win.waitForFunction(() => location.hash.startsWith('#/settings'), null, { timeout: 15_000 });
    await win.waitForSelector('main h1, main h2', { timeout: 30_000 });
  });
} catch (e) {
  if (!results.some(r => !r.ok)) { results.push({ name: 'run', ok: false }); console.log('FAIL unexpected:', (e && e.stack) || e); }
}

try { await app.close(); } catch (e) { problems.push(`closing the app failed: ${e.message}`); }

// Open it again on the same data folder: the library must still be there (saving and reading back work on this system).
if (!results.some(r => !r.ok)) {
  let again = null;
  try {
    again = await _electron.launch({ executablePath: exe, args, env: { ...process.env, MATINEE_USER_DATA: userData }, timeout: 90_000 });
    const w2 = await again.firstWindow({ timeout: 90_000 });
    w2.on('pageerror', e => problems.push(`page error after reopening: ${e.message}`));
    await stepOf('reopen', w2, async () => {
      await w2.waitForSelector('a.film-card', { timeout: 60_000 });
      if (await w2.locator('.onb-drop').count()) throw new Error('the welcome screen came back: the library was not kept');
      return `${await w2.locator('a.film-card').count()} film cards after a restart`;
    });
  } catch (e) {
    if (!results.some(r => !r.ok)) { results.push({ name: 'reopen', ok: false }); console.log('  FAIL reopen:', (e && e.message) || e); }
  }
  try { if (again) await again.close(); } catch (e) { problems.push(`closing the reopened app failed: ${e.message}`); }
}
// What the app wrote to its own problem list during the run: shown, not failed on (the build machine may not reach every site).
try {
  const logged = JSON.parse(fs.readFileSync(path.join(userData, 'logs', 'problems.json'), 'utf8'));
  const list = Array.isArray(logged) ? logged : (logged.problems || logged.items || []);
  if (list.length) {
    console.log(`\n  The app logged ${list.length} problem(s):`);
    for (const p of list.slice(0, 25)) console.log(`   - [${p.level || 'error'}] ${p.area || '?'}: ${p.message || ''}${p.count > 1 ? ` (x${p.count})` : ''}${p.detail ? ' | ' + String(p.detail).split('\n')[0].slice(0, 160) : ''}`);
  } else console.log('\n  The app logged no problems.');
} catch (e) { if (e.code !== 'ENOENT') console.log('  Could not read the app problem list:', e.message); else console.log('\n  The app logged no problems.'); }
fs.rmSync(work, { recursive: true, force: true });

for (const p of problems) console.log(`  FAIL ${p}`);
const failed = results.filter(r => !r.ok).length + problems.length;
console.log(failed ? `\nSmoke test FAILED (${failed} problem(s))` : `\nSmoke test passed (${results.length} steps). Screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
