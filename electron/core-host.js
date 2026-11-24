// Entry point of the core's utility process (see docs/briefs/core-process.md). Everything real is in core-bridge.js.
import { net } from 'electron';
import { createCoreHost } from './core-bridge.js';
import { friendlyError } from './rpc.js';
import { createElectronFetch } from './net-adapter.js';

const port = process.parentPort;
const host = createCoreHost({
  post: msg => port.postMessage(msg),
  loadCore: () => import('../core/api.js'),
  // Chromium's network stack, same session as the page window (the process is forked with that partition).
  makeFetch: () => createElectronFetch({
    fetch: (u, o) => net.fetch(u, o), request: o => net.request(o),
    log: (...a) => port.postMessage({ type: 'log', line: a.map(x => (x instanceof Error ? x.stack || x.message : String(x))).join(' ') }),
    report: p => port.postMessage({ type: 'problem', area: p.area, message: p.message, detail: String(p.detail || (p.error && (p.error.message || p.error)) || ''), level: p.level }),
  }),
  friendlyError,
});
// A stray rejection in a timer or callback must not take the whole core down; log it, tell main (which reports it) and carry on.
process.on('uncaughtException', e => host.noteCrash('uncaught exception', e));
process.on('unhandledRejection', e => host.noteCrash('unhandled rejection', e));
port.on('message', e => host.onMessage(e.data));
port.postMessage({ type: 'hello' });
