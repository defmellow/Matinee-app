// Runs in the window before the page, with a narrow bridge: window.matinee = { call, onEvent, openExternal, ... }.
// CommonJS because sandboxed preload scripts can't be ES modules.
const { contextBridge, ipcRenderer } = require('electron');

// Failures are written with console.error: the main process sees them (console-message), logs them and passes them to the problem list.
const failed = (name, fallback) => e => { console.error('[matinee] ' + name + ' failed:', e); return fallback; };

const FAILED = { error: { message: 'Matinee stopped responding. Try again in a moment.', code: 'ipc' } };

contextBridge.exposeInMainWorld('matinee', {
  /** True when the window has no system title bar and the page should draw its own drag strip (Windows, Linux). */
  titleBar: process.argv.includes('--matinee-titlebar'),
  /** Resolves { result } or { error: { message, code } }. Never rejects. */
  async call(method, args) {
    try {
      const raw = await ipcRenderer.invoke('matinee:call', method, args); // a JSON string (the core runs in another process)
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return r && typeof r === 'object' ? r : FAILED;
    } catch (e) {
      // The page gets the plain failure; the cause is written to the log from here (the preload has no log file of its own).
      console.error('[matinee] call failed:', method, e);
      return FAILED;
    }
  },
  /** cb(event, payload) for 'progress', 'library', 'film', 'state'. Returns an unsubscribe function. */
  onEvent(cb) {
    const handler = (_e, event, payload) => { try { cb(event, payload); } catch (e) { console.error('[matinee] event listener failed:', event, e); } }; // main logs it via console-message
    ipcRenderer.on('matinee:event', handler);
    return () => ipcRenderer.removeListener('matinee:event', handler);
  },
  /** Open an http(s) link in the default browser. */
  openExternal(url) {
    ipcRenderer.send('matinee:open-external', String(url));
  },
  /** Capture a rectangle of the window as a PNG and ask where to save it. Resolves { saved, path? }; never rejects. */
  async saveImage(rect, suggestedName) {
    try {
      const r = await ipcRenderer.invoke('matinee:saveImage', rect, suggestedName);
      return r && r.saved ? { saved: true, path: r.path } : { saved: false };
    } catch (e) {
      console.error('[matinee] saveImage failed:', e);
      return { saved: false };
    }
  },
  /** Choose the Letterboxd export: the ZIP, or on a Mac also the folder it was unzipped into. Resolves { bytes } | { error } | null (cancelled). */
  pickExport: () => ipcRenderer.invoke('matinee:pick-export').catch(e => { console.error('[matinee] pick-export failed:', e); return { error: "Matinee couldn't open that. Try dropping it here instead." }; }),
  /** Tell the window frame which theme the app is using: 'system' | 'light' | 'dark'. Anything else is ignored. */
  setTheme(theme) {
    if (['system', 'light', 'dark', 'neutral', 'neutral-light'].includes(theme)) ipcRenderer.send('matinee:theme', theme);
  },
  /** Share data for troubleshooting: the Documents folder (or null), and show the finished file in Explorer. */
  share: {
    documentsDir: () => ipcRenderer.invoke('matinee:documents-dir').catch(failed('documents-dir', null)),
    reveal: file => ipcRenderer.invoke('matinee:reveal-share-file', String(file)).catch(failed('reveal-share-file', false)),
  },
  openDataFolder: () => ipcRenderer.invoke('matinee:open-data-folder').catch(failed('open-data-folder', undefined)),
  /** Open the logs folder (matinee.log, problems.log, problems.json) in Explorer. Resolves { ok, path, error }; never rejects. */
  async openLogs() {
    try {
      const r = await ipcRenderer.invoke('matinee:open-logs');
      return r && typeof r === 'object' ? { ok: !!r.ok, path: r.path || null, ...(r.error ? { error: String(r.error) } : {}) } : { ok: false, path: null, error: 'No answer.' };
    } catch (e) {
      return { ok: false, path: null, error: String((e && e.message) || e) }; // the main process logs its own side; the page gets the reason
    }
  },
  /** The logs folder's path (to show in Settings), or null. */
  async logsPath() {
    try { return (await ipcRenderer.invoke('matinee:logs-path')) || null; } catch (e) { console.error('[matinee] logsPath failed:', e); return null; }
  },
  /** Updates (installed builds). Each resolves a status { state, current, next, percent, portable } and never rejects. */
  updates: {
    status: () => ipcRenderer.invoke('matinee:update-status').catch(failed('update-status', ({ state: 'off' }))),
    install: () => ipcRenderer.invoke('matinee:update-install').catch(failed('update-install', undefined)),
    openDownload: () => ipcRenderer.invoke('matinee:update-download').catch(failed('update-download', undefined)),
    /** Runs a check now and resolves the new status (which has channel, lastCheckedAt, checking, checkFailed). */
    check: () => ipcRenderer.invoke('matinee:update-check').catch(failed('update-check', ({ state: 'off' }))),
    /** After a failed install: clears it and checks again. Resolves the new status. */
    retry: () => ipcRenderer.invoke('matinee:update-retry').catch(failed('update-retry', ({ state: 'off' }))),
    /** name: 'main' | 'experimental'. Resolves { ok } or { ok: false, reason }. Starts a check. */
    setChannel: name => ipcRenderer.invoke('matinee:update-set-channel', String(name)).catch(failed('update-set-channel', ({ ok: false, reason: 'off' }))),
  },
});
