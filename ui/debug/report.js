// Every error in the UI ends up here, so nothing goes silent. Problems are sent to the core, which keeps them in a log
// folder and counts them; Debug mode (and Settings → Debug → Problems) is where they are shown. Nothing here shows
// a toast or a pop-up by itself.
import { call, setErrorSink } from '../api.js';
import { describeError, describeCall, makeGate, isBackgroundCall } from './model.js';

const NEVER = new Set(['reportProblem', 'getProblems', 'markProblemsSeen', 'clearProblems']); // reporting about reporting would loop
const gate = makeGate();
let busy = false;           // re-entrancy guard
const local = [];           // last few, kept here too in case the core can't be reached
const MAX_LOCAL = 50;

/** Problems this window has seen even if the core never got them: [{ at, area, message, detail, film, level }]. */
export const localProblems = () => local.slice();

/**
 * Record a problem. Safe to call from anywhere: never throws, never calls itself, repeats within a few seconds are dropped.
 * `detail` is technical text (an Error is fine, it gets described).
 */
export function reportProblem({ area = 'Matinee', message = 'Something went wrong.', detail = '', film = '', level = 'error' } = {}) {
  if (busy) return;
  busy = true;
  try {
    const text = detail && typeof detail === 'object' ? describeError(detail) : String(detail || '');
    if (!gate(`${area}|${message}|${text}|${film}`)) return;
    local.push({ at: new Date().toISOString(), area, message, detail: text, film: String(film || ''), level });
    if (local.length > MAX_LOCAL) local.shift();
    let p;
    try { p = call('reportProblem', { area, message, detail: text, film: String(film || ''), level }); } catch (e) { console.warn(e); return; }
    Promise.resolve(p).catch(e => console.warn('Could not record a problem:', e)); // the core is unreachable: console is all we have
  } catch (e) { console.warn(e); } finally { busy = false; }
}

/** For a catch block: `catch (e) { reportFailure('Settings', "Couldn't check for updates.", e) }`. */
export function reportFailure(area, message, error, extra = {}) {
  reportProblem({ area, message, detail: error, ...extra });
}

function fromSink({ kind, method, args, error, level }) {
  if (error && error.reported) return;
  if (kind === 'call') {
    if (NEVER.has(method)) return;
    const { area, message } = describeCall(method);
    const film = args && typeof args.key === 'string' ? args.key : '';
    if (error && typeof error === 'object') { try { error.reported = true; } catch { /* frozen */ } }
    reportProblem({ area, message, detail: `${method}: ${describeError(error)}`, film, level: level || (isBackgroundCall(method) ? 'warning' : 'error') });
  } else {
    reportProblem({ area: 'Matinee', message: 'A live update could not be read.', detail: `${method}: ${describeError(error)}`, level: level || 'warning' });
  }
}

let installed = false;
/** Called once at start-up (ui/main.jsx): failed core calls, uncaught errors and unhandled rejections are all recorded. */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  setErrorSink(fromSink);
  window.addEventListener('error', e => {
    // Browsers fire this for harmless layout loops; it isn't a real fault, so it isn't recorded.
    if (/ResizeObserver loop/i.test(String(e.message))) return;
    if (e.error && e.error.reported) return;
    const at = e.filename ? ` at ${String(e.filename).split('/').pop()}:${e.lineno}:${e.colno}` : '';
    reportProblem({ area: 'Matinee', message: 'Something unexpected went wrong.', detail: e.error ? describeError(e.error) : `${e.message}${at}` });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (r && r.reported) return;
    reportProblem({ area: 'Matinee', message: 'Something unexpected went wrong.', detail: describeError(r) });
  });
}
