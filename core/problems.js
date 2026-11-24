// One place for every error in the app (core, Electron and UI), so nothing fails silently.
//   const problems = createProblems({ file, onNew });
//   problems.report({ area: 'Rotten Tomatoes', message: "Couldn't read the scores on The Moon's page", error, film: 'The Moon (2023)' });
// `message` is plain English for the user's; `error` is the raw error, kept as technical detail for the copyable log.
// Repeats of the same area + message within an hour are counted on one entry instead of flooding the list.
// Nothing here interrupts the user's: the list shows in Settings → Debug (and as it happens only when Debug mode is on).
// On disk, in the app's logs folder (<data>/logs/): problems.json (the list the app shows, last MAX entries) and problems.log
// (every problem as a plain-text line, appended, rolled over at 2 MB to problems.old.log) so a crash or restart loses nothing.
// A stopped job (code 'aborted') is not a problem and is ignored.
import fs from 'node:fs';
import path from 'node:path';

export const MAX = 2000;
/** The reporter used when a caller passes none (tests, scripts): reports go nowhere. */
export const NO_PROBLEMS = Object.freeze({ report() { return null; } });
/** "Title (Year)", or just the title when there is no year: how a problem names a film. */
export const filmLabel = f => (f && f.title ? (f.year ? `${f.title} (${f.year})` : String(f.title)) : '');
const LOG_LIMIT = 2 * 1024 * 1024;
const REPEAT_MS = 60 * 60 * 1000;
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** Technical detail of an error: status, code, message and the first stack line that isn't the message. */
export function detailOf(error) {
  if (error == null) return '';
  if (typeof error !== 'object') return clip(error, 400);
  const bits = [];
  if (error.status) bits.push(`HTTP ${error.status}`);
  if (error.code && error.code !== error.status) bits.push(String(error.code));
  if (error.message) bits.push(error.message);
  if (error.url) bits.push(error.url);
  const at = String(error.stack || '').split('\n').map(s => s.trim()).find(s => s.startsWith('at '));
  if (at) bits.push(at);
  return clip(bits.join(' · '), 400);
}

/**
 * @param {{ dir?: string|null, now?: () => number, onNew?: (entry: object) => void, onChange?: () => void }} o
 *   dir = the logs folder (created when missing); null keeps everything in memory (tests).
 *   onNew fires for a new entry (not for a counted repeat), so the UI can show it straight away.
 */
export function createProblems({ dir = null, now = Date.now, onNew = () => {}, onChange = () => {} } = {}) {
  let list = [];
  let seq = 0;
  let seenAt = 0; // entries after this are "new" (the badge count)
  const file = dir ? path.join(dir, 'problems.json') : null;
  const logFile = dir ? path.join(dir, 'problems.log') : null;
  if (dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('[problems] could not create the logs folder:', e); } }
  const flag = e => (e.level === 'warning' ? '[WARN] ' : '[ERROR]');
  const line = e => `${e.at.replace('T', ' ').slice(0, 19)}  ${flag(e)}  [${e.area}]${e.film ? ' ' + e.film + ':' : ''} ${e.message}${e.detail ? '  | ' + e.detail : ''}\n`;
  const append = e => {
    if (!logFile) return;
    try {
      try { if (fs.statSync(logFile).size > LOG_LIMIT) fs.renameSync(logFile, path.join(dir, 'problems.old.log')); } catch (x) { if (x.code !== 'ENOENT') throw x; }
      fs.appendFileSync(logFile, line(e));
    } catch (x) { console.error('[problems] could not write problems.log:', x); }
  };
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(saved.list)) list = saved.list.slice(-MAX);
      seenAt = Number(saved.seenAt) || 0;
      seq = list.reduce((m, e) => Math.max(m, e.id || 0), 0);
    } catch (e) {
      // A missing file is a first run. A broken one is replaced, and that is itself reported once the list exists.
      if (e.code !== 'ENOENT') list.push({ id: ++seq, at: new Date(now()).toISOString(), area: 'Matinee', message: 'The list of earlier problems could not be read, so it starts again.', detail: detailOf(e), count: 1 });
    }
  }
  let saveTimer = null;
  // Written to a temporary file and renamed, so a crash mid-write (also on quit) never leaves a half-written list.
  const writeNow = () => {
    try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ seenAt, list })); fs.renameSync(tmp, file); }
    catch (e) { console.error('[problems] could not save the problem list:', e); } // the log itself failing: the console is all that is left
  };
  const save = () => {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, 500);
    saveTimer.unref?.();
  };

  const api = {
    /**
     * @param {{ area: string, message: string, error?: any, film?: string, level?: 'error'|'warning' }} p
     * @returns {object|null} the entry (null when ignored: a stopped job)
     */
    report({ area = 'Matinee', message, error = null, film = '', level = 'error' } = {}) {
      if (error && error.code === 'aborted') return null;
      const t = now();
      const msg = clip(message || (error && error.message) || 'Something went wrong.', 300);
      const last = [...list].reverse().find(e => e.area === area && e.message === msg && (e.film || '') === (film || ''));
      if (last && t - Date.parse(last.lastAt || last.at) < REPEAT_MS) {
        last.count = (last.count || 1) + 1; last.lastAt = new Date(t).toISOString();
        if (error) last.detail = detailOf(error);
        append({ ...last, at: last.lastAt, message: `${msg} (again, ×${last.count})` });
        save(); onChange();
        return last;
      }
      const entry = { id: ++seq, at: new Date(t).toISOString(), area: clip(area, 60), message: msg, detail: detailOf(error), film: clip(film, 100) || undefined, level, count: 1 };
      list.push(entry);
      if (list.length > MAX) list = list.slice(-MAX);
      append(entry);
      save(); onChange(); onNew({ ...entry });
      return entry;
    },
    /** Newest first. */
    list() { return [...list].reverse().map(e => ({ ...e, isNew: e.id > seenAt })); },
    /** How many entries the user hasn't looked at yet. */
    unseen() { return list.filter(e => e.id > seenAt).length; },
    /** How many of each flag: { error, warning, unseenError, unseenWarning }. */
    counts() {
      const c = { error: 0, warning: 0, unseenError: 0, unseenWarning: 0 };
      for (const e of list) { const w = e.level === 'warning'; c[w ? 'warning' : 'error']++; if (e.id > seenAt) c[w ? 'unseenWarning' : 'unseenError']++; }
      return c;
    },
    markSeen() { seenAt = seq; save(); onChange(); },
    clear() { list = []; seenAt = seq; save(); onChange(); },
    /** The whole list as plain text, oldest first, ready to paste into a bug report. */
    text() {
      const head = 'Matinee problems (oldest first, times in UTC)';
      if (!list.length) return head + '\nNo problems recorded.';
      return head + '\n' + list.map(e => `${e.at.replace('T', ' ').slice(0, 19)}  ${flag(e)}  [${e.area}]${e.film ? ' ' + e.film + ':' : ''} ${e.message}${e.count > 1 ? ` (×${e.count}, last ${String(e.lastAt).replace('T', ' ').slice(0, 19)})` : ''}${e.detail ? '\n    ' + e.detail : ''}`).join('\n');
    },
    /** Write now (on quit). */
    flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } if (file) writeNow(); },
  };
  return api;
}
