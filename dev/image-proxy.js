// Dev-server side of /img?u=<encoded remote url>: the same disk cache and allowlist the app uses for matinee-img://.
import { createImageCache } from '../electron/image-cache.js';

/** @returns {(req, res) => Promise<void>} a plain Node request handler for GET /img */
export function createImageProxy({ dir, fetch: fetchImpl = globalThis.fetch, maxBytes } = {}) {
  const cache = createImageCache({ dir, fetch: fetchImpl, ...(maxBytes ? { maxBytes } : {}) });
  return async function imageProxy(req, res) {
    const u = new URL(req.url, 'http://localhost').searchParams.get('u');
    const r = await cache.handle(u);
    res.writeHead(r.status, r.headers);
    res.end(req.method === 'HEAD' ? undefined : r.body);
  };
}
