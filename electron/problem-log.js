// "Never go silent": helpers for the logs folder and for passing problems on to the core's problem list.
// No Electron imports (fs and the sender are injected), so everything here is unit-tested.
//
//   userData/logs/matinee.log       what the Electron side did (rolled to matinee.log.old at 1 MB)
//   userData/logs/problems.json     the core's problem list (Settings → Debug), plus problems.log, written by the core
import { formatLogArg } from './shell-util.js';

export const LOG_NAME = 'matinee.log';
export const LOG_LIMIT = 1024 * 1024;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** Technical detail for a problem: an Error's message and first stack line, or whatever was passed, clipped. Never throws. */
export function detailFrom(error) {
  try {
    if (error == null) return '';
    if (error instanceof Error) {
      const at = String(error.stack || '').split('\n').map(s => s.trim()).find(s => s.startsWith('at '));
      return clip([error.code, error.message, at].filter(Boolean).join(' · '), 400);
    }
    return clip(formatLogArg(error), 400);
  } catch { return ''; }
}

/** Roll `file` to `file.old` when it is over `limit`. A missing file is normal (first run). Returns { rolled, error? }. */
export function rollLog({ fs, file, limit = LOG_LIMIT }) {
  try {
    if (fs.statSync(file).size <= limit) return { rolled: false };
    fs.renameSync(file, file + '.old');
    return { rolled: true };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { rolled: false }; // no log yet
    return { rolled: false, error };
  }
}

/**
 * First start of the version that has a logs folder: move userData/matinee.log(.old) into it. If the new place already has a
 * file of that name, the old one is kept next to it as `<name>.previous` rather than overwritten.
 * Returns { moved: [names], failed: [{ name, error }] }; the caller logs the failures. Nothing here throws.
 */
export function moveOldLogs({ fs, fromDir, logsDir, join, names = [LOG_NAME, LOG_NAME + '.old'] }) {
  const out = { moved: [], failed: [] };
  try { fs.mkdirSync(logsDir, { recursive: true }); } catch (error) { out.failed.push({ name: logsDir, error }); return out; }
  for (const name of names) {
    const from = join(fromDir, name);
    try {
      if (!fs.existsSync(from)) continue; // nothing to move: a fresh install, or already moved
      const exists = fs.existsSync(join(logsDir, name));
      fs.renameSync(from, join(logsDir, exists ? name + '.previous' : name));
      out.moved.push(name);
    } catch (error) { out.failed.push({ name, error }); }
  }
  return out;
}

/**
 * Passes problems to the core's list (core.call('reportProblem', ...)) without ever throwing, looping or flooding:
 * the same area + message is passed on at most once a `gapMs`, and at most `perMinute` in total (the log file still has all of them).
 * Problems raised before the core is up wait (up to `queueMax`) and go out when `attach(send)` is called.
 * `send(payload)` must return a promise that rejects when the core did not take it. A failure to pass on is only logged.
 */
export function createReporter({ log = () => {}, now = Date.now, gapMs = 60_000, perMinute = 60, queueMax = 50 } = {}) {
  let send = null;
  const queue = [];
  const last = new Map(); // key -> time last passed on
  let stamps = [];

  const logFailure = (what, e) => { try { log(what, e); } catch { /* logging must never break the app */ } };
  function dispatch(p) {
    try {
      Promise.resolve(send(p)).catch(e => logFailure('Could not pass a problem on to the core:', e));
    } catch (e) { logFailure('Could not pass a problem on to the core:', e); }
  }

  function report(p) {
    try {
      const { area = 'App', message = 'Something went wrong.', error, detail, level = 'error', film = '' } = p || {};
      const payload = { area: String(area), message: String(message), detail: clip(detail != null ? detail : detailFrom(error), 400), film: String(film || ''), level: level === 'warning' ? 'warning' : 'error' };
      const t = now();
      const key = payload.area + '|' + payload.message;
      if (last.has(key) && t - last.get(key) < gapMs) return false;
      stamps = stamps.filter(x => t - x < 60_000);
      if (stamps.length >= perMinute) return false;
      stamps.push(t);
      last.set(key, t);
      if (last.size > 500) for (const [k, v] of last) if (t - v >= gapMs) last.delete(k);
      if (!send) { if (queue.length < queueMax) queue.push(payload); return true; }
      dispatch(payload);
      return true;
    } catch (e) { logFailure('Could not record a problem:', e); return false; }
  }

  return {
    report,
    attach(fn) { send = fn; while (queue.length) dispatch(queue.shift()); },
    detach() { send = null; },
    get queued() { return queue.length; },
  };
}

/**
 * The arguments of a webContents 'console-message' event as { message, where } when it is an error, else null.
 * Newer Electron passes one event object ({ level: 'error', message, lineNumber, sourceId }); older versions pass
 * (event, level, message, line, sourceId) with level 0-3 (3 = error).
 */
export function parseConsoleMessage(args) {
  try {
    const first = args[0];
    let level, message, line, source;
    if (first && typeof first === 'object' && typeof first.message === 'string' && 'level' in first) ({ level, message, lineNumber: line, sourceId: source } = first);
    else [, level, message, line, source] = args;
    if (level !== 'error' && level !== 3) return null;
    const file = String(source || '').split(/[\\/]/).pop();
    return { message: clip(message, 300), where: file ? `${file}${line ? ':' + line : ''}` : '' };
  } catch { return null; }
}
