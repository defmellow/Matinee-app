// Fetchers for development and tests. The app itself uses electron/fetcher.js.
// Interface: text(url, { browser }) -> { status, url, text }
import fs from 'node:fs';
import { createRequire } from 'node:module';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export async function plainFetch(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-AU,en;q=0.9' }, redirect: 'follow' });
  return { status: r.status, url: r.url, text: await r.text() };
}

// Real Chromium via Playwright (headed under xvfb passes Cloudflare far more often than headless).
export async function createPlaywrightFetcher({ headed = !!process.env.HEADED, playwrightPath = process.env.PW || '/opt/node22/lib/node_modules/playwright' } = {}) {
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  const browser = await chromium.launch({ headless: !headed, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ userAgent: UA, locale: 'en-AU' });
  const pages = [];
  const getPage = async () => pages.pop() || context.newPage();
  return {
    async text(url, { browser: useBrowser = true } = {}) {
      if (!useBrowser) return plainFetch(url);
      const page = await getPage();
      try {
        const resp = await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 20 && /Just a moment/i.test(await page.title()); i++) await page.waitForTimeout(1000);
        return { status: resp ? resp.status() : 0, url: page.url(), text: await page.content() };
      } finally { pages.push(page); }
    },
    // Same shape as electron/page-renderer.js: load like a browser, wait for `waitFor` (or settleMs), return the page HTML.
    async render(url, { signal, waitFor, settleMs } = {}) {
      if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { code: 'aborted' });
      const page = await getPage();
      try {
        const resp = await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
        if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 }).catch(() => {});
        else await page.waitForTimeout(settleMs ?? 600);
        return { status: resp ? resp.status() : 0, url: page.url(), text: await page.content() };
      } finally { pages.push(page); }
    },
    close: () => browser.close(),
  };
}

// Offline: serve saved pages. map: url -> file path (or function(url) -> path|null)
export function createFixtureFetcher(map) {
  const lookup = typeof map === 'function' ? map : url => map[url];
  return {
    async text(url) {
      const f = lookup(url);
      if (!f || !fs.existsSync(f)) return { status: 404, url, text: '<html><head><title>Page Not Found</title></head><body class="error"></body></html>' };
      return { status: 200, url, text: fs.readFileSync(f, 'utf8') };
    },
  };
}
