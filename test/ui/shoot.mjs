// Screenshot routes of a running dev server in dark + light, at the default and minimum window sizes,
// and report console errors and horizontal overflow.
//   node test/ui/shoot.mjs --base http://localhost:5317 --out /tmp/shots library film/lid:29Ts diary
//   options: --sizes 1280x820,960x640  --themes dark,light  --wait 1500  --full (full-page screenshots)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); if (i === -1) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf('--' + name); if (i === -1) return false; args.splice(i, 1); return true; };
const base = opt('base', 'http://localhost:5317');
const out = opt('out', '/tmp/matinee-shots');
const sizes = opt('sizes', '1280x820,960x640').split(',').map(s => s.split('x').map(Number));
const themes = opt('themes', 'dark,light').split(',');
const wait = Number(opt('wait', '1500'));
const full = flag('full');
const routes = args.length ? args : ['library'];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const theme of themes) for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') problems.push(`${theme} ${w}x${h}: console error: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`${theme} ${w}x${h}: page error: ${e.message}`));
  for (const r of routes) {
    await page.goto(`${base}/#/${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(wait);
    const overflow = await page.evaluate(() => {
      const m = document.querySelector('.main') || document.documentElement;
      return Math.max(document.documentElement.scrollWidth - innerWidth, m.scrollWidth - m.clientWidth);
    });
    if (overflow > 1) problems.push(`${theme} ${w}x${h} #/${r}: horizontal overflow ${overflow}px`);
    const file = path.join(out, `${r.replace(/[^\w.-]+/g, '_')}-${theme}-${w}.png`);
    await page.screenshot({ path: file, fullPage: full });
    console.log('saved', file);
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'No console errors or overflow.');
process.exitCode = problems.length ? 1 : 0;
