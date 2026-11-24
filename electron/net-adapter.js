// Electron's net.fetch throws "Redirect was cancelled" for redirect:'manual' (Electron 44), which the core needs to read
// boxd.it's Location header. This wraps fetch so manual redirects go through net.request instead. No Electron import:
// both functions are injected, so it is unit-testable.

const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

function setUrl(res, url) {
  try { Object.defineProperty(res, 'url', { value: url }); } catch { /* expected: `url` is read-only on some runtimes; callers fall back to the address they asked for */ }
  return res;
}

function headersFromRecord(rec = {}, log = () => {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(rec)) {
    for (const one of Array.isArray(v) ? v : [v]) { try { h.append(k, String(one)); } catch (e) { log('Dropped a response header the runtime refused:', k, e && e.message); } }
  }
  return h;
}

const hostOf = url => { try { return new URL(url).hostname; } catch { return 'a website'; } };

function manualRequest(request, url, { method = 'GET', headers, body, signal } = {}, { log = () => {}, report = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const req = request({ url, method, redirect: 'manual' });
    let settled = false;
    const finish = fn => { if (settled) return false; settled = true; if (signal) signal.removeEventListener('abort', onAbort); fn(); return true; };
    function onAbort() { if (finish(() => reject(abortError()))) { try { req.abort(); } catch { /* expected: the request had already finished, nothing to stop */ } } }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers || {});
    for (const [k, v] of entries) { try { req.setHeader(k, String(v)); } catch (e) { log('Could not set a request header:', k, e && e.message); } }

    req.on('redirect', (statusCode, _method, redirectUrl, rec) => {
      if (!finish(() => {
        const h = headersFromRecord(rec, log);
        h.set('location', redirectUrl);
        resolve(setUrl(new Response(null, { status: statusCode, headers: h }), url));
      })) return;
      try { req.abort(); } catch { /* expected: the redirect answer is all we wanted and the request may already be closed */ }
    });
    req.on('response', res => {
      const chunks = [];
      const h = headersFromRecord(res.headers, log);
      const status = res.statusCode;
      const noBody = method === 'HEAD' || status === 204 || status === 304;
      if (!noBody) {
        res.on('data', c => chunks.push(Buffer.from(c)));
        res.on('error', e => log('The body of a response broke off (using what arrived):', hostOf(url), e && e.message)); // best effort once the headers are in
      }
      finish(() => {
        // Wait for the body before resolving so text() has it; HEAD and empty responses resolve at once.
        const make = () => resolve(setUrl(new Response(noBody ? null : Buffer.concat(chunks), { status, headers: h }), url));
        if (noBody) return make();
        res.on('end', make);
        res.on('error', make); // already logged above
      });
    });
    req.on('error', err => finish(() => {
      // The caller gets the rejection (so it is not swallowed); we also keep a line in the logs.
      log('A web request failed:', hostOf(url), err && err.message);
      report({ area: 'Network', message: `Matinee couldn't reach ${hostOf(url)}.`, error: err, level: 'warning' });
      reject(new TypeError(err && err.message ? err.message : 'fetch failed'));
    }));
    if (body != null) req.write(typeof body === 'string' ? body : Buffer.from(body));
    req.end();
  });
}

/**
 * @param {{ fetch: typeof fetch, request: (opts) => object }} deps  net.fetch and net.request (or fakes)
 * @returns {typeof fetch}
 */
export function createElectronFetch({ fetch, request, log = () => {}, report = () => {} }) {
  return (url, opts = {}) => {
    if (opts.redirect !== 'manual') return fetch(url, opts);
    return manualRequest(request, String(url), opts, { log, report });
  };
}
