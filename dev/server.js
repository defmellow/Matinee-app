// `npm run dev`: the UI in a browser against the real core. One server: Vite for the UI, POST /api/<method>,
// GET /api/events (server-sent events) and GET /img?u=<url> (cached posters). Same shapes as the Electron bridge.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import { createCore } from '../core/api.js';
import { createEventForwarder, runCall } from '../electron/rpc.js';
import { createImageProxy } from './image-proxy.js';
import { createPlaywrightFetcher } from './fetchers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 5317;
const dataDir = path.resolve(process.env.MATINEE_DATA || path.join(root, '.cache', 'devdata'));
const MAX_BODY = 200 * 1024 * 1024; // a Letterboxd export is a few MB; this is only a guard

const clients = new Set();
const forwarder = createEventForwarder((event, payload) => {
  const line = `data: ${JSON.stringify({ event, payload })}\n\n`;
  for (const res of clients) res.write(line);
});
// MATINEE_RENDER=playwright: pages that need a real browser load through Playwright's Chromium (otherwise a plain request).
const pw = process.env.MATINEE_RENDER === 'playwright' ? await createPlaywrightFetcher() : null;
const core = createCore({ dataDir, render: pw ? (u, o) => pw.render(u, o) : undefined, onEvent: forwarder.emit }); // Node's fetch (set NODE_USE_ENV_PROXY=1 behind a proxy)
const images = createImageProxy({ dir: path.join(root, '.cache', 'img') });

let vite; // created after the HTTP server so hot reload shares its port (same origin → allowed by the page's CSP)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (pathname.startsWith('/api/') && req.method === 'POST') {
      const method = decodeURIComponent(pathname.slice(5));
      let args = {};
      try { const raw = (await readBody(req)).toString('utf8'); if (raw) args = JSON.parse(raw); }
      catch { return sendJson(res, 400, { error: { message: 'Bad request.', code: 'bad-request' } }); }
      return sendJson(res, 200, await runCall(core, method, args));
    }
    if (pathname === '/img' && (req.method === 'GET' || req.method === 'HEAD')) return await images(req, res);
    vite.middlewares(req, res, () => { res.writeHead(404); res.end('Not found'); });
  } catch (e) {
    console.error('[dev] request failed:', e);
    if (!res.headersSent) sendJson(res, 500, { error: { message: 'Something went wrong. Try again in a moment.', code: 'error' } });
    else res.end();
  }
});

vite = await createVite({ root: path.join(root, 'ui'), configFile: path.join(root, 'vite.config.js'), server: { middlewareMode: true, hmr: { server }, fs: { allow: [root, fs.realpathSync(path.join(root, 'node_modules'))] } }, appType: 'spa' }); // a worktree links node_modules: let Vite serve the fonts in it

server.listen(port, () => {
  console.log(`Matinee dev server: http://localhost:${port}  (data: ${dataDir})`);
  if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) console.log('Behind a proxy? Set NODE_USE_ENV_PROXY=1 so network calls use it.');
});

let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  forwarder.dispose();
  for (const res of clients) res.end();
  try { core.close(); } catch { /* ignore */ }
  try { if (pw) await pw.close(); } catch { /* ignore */ }
  await vite.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
