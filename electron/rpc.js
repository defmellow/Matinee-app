// The thin layer between "the UI called a method" and the core, shared by the Electron IPC handler and the
// dev HTTP server so both behave identically: bytes become Buffers, errors become friendly messages,
// progress events are throttled. No Electron imports.

const OFFLINE = "Matinee can't reach the internet right now. Check your connection and try again.";
const GENERIC = 'Something went wrong. Try again in a moment.';

/** Uint8Array / ArrayBuffer arguments (one level deep) become Buffers, which is what the core expects. */
export function toBuffers(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Buffer.isBuffer(args)) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (Buffer.isBuffer(v)) out[k] = v;
    else if (v instanceof Uint8Array) out[k] = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    else if (v instanceof ArrayBuffer) out[k] = Buffer.from(v);
    else out[k] = v;
  }
  return out;
}

/** The message a person sees. Core errors are already written for people; system and programming errors are not. */
export function friendlyError(e) {
  const msg = e && typeof e.message === 'string' ? e.message : '';
  const code = e && e.code;
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK|CONNECTION|TIMED_OUT|PROXY|TUNNEL|ADDRESS)/.test(msg) || msg === 'fetch failed') return OFFLINE;
  if (typeof code === 'string' && /^(E[A-Z0-9]+|ERR_[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(code)) {
    if (/^(ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_.*)$/.test(code)) return OFFLINE;
    if (code === 'ENOSPC') return 'Your disk is full, so Matinee could not save. Free up some space and try again.';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EBUSY') return "Matinee couldn't save to its data folder. Check that another program isn't using it.";
    return GENERIC;
  }
  if (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError || e instanceof ReferenceError) return GENERIC;
  if (!msg || msg.length > 300 || /\n\s+at /.test(msg)) return GENERIC;
  return msg;
}

/**
 * Run one core method. Resolves `{ result }` or `{ error: { message, code } }` and never rejects.
 * The full error (with stack) goes to `log`; the caller only gets the friendly message.
 * `onUnexpected(method, e)` is also called for errors that are bugs rather than things a person can act on (the "Something went
 * wrong" kind), so they reach the problem list. A callback that throws is ignored: reporting must never break a call.
 */
export async function runCall(core, method, args, log = console.error, onUnexpected = null) {
  try {
    if (typeof method !== 'string' || !method) throw Object.assign(new Error(GENERIC), { code: 'bad-request' });
    const result = await core.call(method, toBuffers(args));
    return { result };
  } catch (e) {
    if (!e || e.code !== 'aborted') log(`[matinee] ${method} failed:`, e && e.stack ? e.stack : e);
    const message = friendlyError(e);
    if (onUnexpected && message === GENERIC && (!e || e.code !== 'aborted')) { try { onUnexpected(method, e); } catch (x) { try { log('[matinee] could not report a failure:', x); } catch { /* nothing more to do */ } } }
    return { error: { message, code: message === OFFLINE ? 'offline' : (e && typeof e.code === 'string' ? e.code : 'error') } };
  }
}

/**
 * Wrap an event sink so 'progress' goes out at most `perSecond` times a second (the last one is never lost,
 * and { phase: 'done' } is never delayed). Everything else passes straight through.
 * @returns {{ emit(event, payload): void, dispose(): void }}
 */
export function createEventForwarder(send, { perSecond = 10, now = Date.now } = {}) {
  const gap = 1000 / perSecond;
  let last = 0, pending = null, timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const p = pending; pending = null; last = now();
    send('progress', p.payload);
  };
  return {
    emit(event, payload) {
      if (event !== 'progress') return send(event, payload);
      if (payload && payload.phase === 'done') {
        if (timer) { clearTimeout(timer); timer = null; }
        pending = null; last = now();
        return send(event, payload);
      }
      const wait = last + gap - now();
      if (wait <= 0 && !timer) { last = now(); return send(event, payload); }
      pending = { payload };
      if (!timer) timer = setTimeout(flush, Math.max(wait, 0));
    },
    dispose() { if (timer) clearTimeout(timer); timer = null; pending = null; },
  };
}
