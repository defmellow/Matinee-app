// One switch for Debug mode: Settings → Debug → "Debug mode". Stored in the core settings (settings.debug).
import { useState } from 'preact/hooks';
import { useCoreSelect, useEvent } from '../state.js';

/** true when Debug mode is on. Cheap to call from any component. */
export function useDebug() { return !!useCoreSelect(c => !!(c.settings && c.settings.debug)); }

const ZERO = { unseen: 0, total: 0, error: 0, warning: 0, unseenError: 0, unseenWarning: 0 };
/** The counts in a 'problems' event (or in the app state), every missing field zero. */
export const problemCounts = p => { const c = { ...ZERO }; for (const k of Object.keys(ZERO)) if (p && Number.isFinite(p[k])) c[k] = p[k]; if (!c.total) c.total = c.error + c.warning; return c; };
/** Problem counts by flag; follows the core's 'problem' / 'problems' events live. Missing fields count as zero. */
export function useProblemCounts() {
  const base = { ...ZERO, ...(useCoreSelect(c => c.problems) || {}) };
  const [live, setLive] = useState(null); // events since the last state load
  // The core sends every count with each change (a new problem, a repeat, marking them seen, Clear), so the event replaces what is
  // held. Before 12 Nov it carried only `unseen`, and the totals were kept by adding one per new problem: Clear emptied the list
  // but the sidebar went on saying "2 err 10 warn" and the Settings dot stayed lit.
  useEvent('problems', p => setLive(problemCounts(p)));
  return live || base;
}
