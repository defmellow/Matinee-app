// The only way the UI talks to the core. In the app it's the Electron bridge (preload.cjs → window.matinee);
// in development it's HTTP + server-sent events from dev/server.js. Screens never need to know which.
const bridge = typeof window !== 'undefined' ? window.matinee : null;

export class ApiError extends Error {}

// Debug/report code listens here, so every failed call is recorded without each screen having to remember to.
// sink({ kind: 'call' | 'event', method, args, error }). It must never throw (report.js guards it too).
let errorSink = null;
export function setErrorSink(fn) { errorSink = fn; }
function tell(info) { if (!errorSink) return; try { errorSink(info); } catch (e) { console.warn(e); } }

export async function call(method, args = {}) {
  try { return await rawCall(method, args); } catch (error) { tell({ kind: 'call', method, args, error }); throw error; }
}

async function rawCall(method, args) {
  if (bridge) {
    const r = await bridge.call(method, args);
    if (r && r.error) throw Object.assign(new ApiError(r.error.message), r.error);
    return r.result;
  }
  let body = args;
  if (args && args.bytes instanceof Uint8Array) body = { ...args, bytes: undefined, base64: toBase64(args.bytes) };
  const res = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: { message: 'Matinee stopped responding. Try again in a moment.' } }));
  if (j.error) throw Object.assign(new ApiError(j.error.message), j.error);
  return j.result;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- events ----
const listeners = new Map(); // event -> Set(fn)
let connected = false;
function dispatch(event, payload) { (listeners.get(event) || []).forEach(fn => { try { fn(payload); } catch (error) { console.warn(error); tell({ kind: 'event', method: event, error }); } }); }
function connect() {
  if (connected) return; connected = true;
  if (bridge) { bridge.onEvent((event, payload) => dispatch(event, payload)); return; }
  const open = () => {
    const es = new EventSource('/api/events');
    es.onmessage = m => {
      let msg;
      try { msg = JSON.parse(m.data); } catch (error) { tell({ kind: 'event', method: 'message', error }); return; }
      dispatch(msg.event, msg.payload);
    };
    // The dev server dropped the stream: reconnect quietly (the gate in report.js stops this repeating in the log).
    es.onerror = () => { es.close(); tell({ kind: 'event', method: 'connection', error: new Error('The live update connection dropped; reconnecting.'), level: 'warning' }); setTimeout(open, 2000); };
  };
  open();
}

/** Subscribe to a core event ('progress', 'library', 'film'). Returns an unsubscribe function. */
export function on(event, fn) {
  connect();
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

/** Remote images go through a local cache so posters work offline and load fast. */
export function imageUrl(url) {
  if (!url) return null;
  return bridge ? `matinee-img://cache/?u=${encodeURIComponent(url)}` : `/img?u=${encodeURIComponent(url)}`;
}

/** Open a link in the user's normal browser. */
export function openExternal(url) {
  if (bridge) bridge.openExternal(url); else window.open(url, '_blank', 'noopener');
}
