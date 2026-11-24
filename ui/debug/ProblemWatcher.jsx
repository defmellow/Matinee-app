// Mounted once in the app shell. With Debug mode on, each new ERROR pops a toast (warnings are too many; they live in the list). With Debug mode off it does nothing.
import { useEvent, toast } from '../state.js';
import { useDebug } from './useDebug.js';
import { levelLabel } from './model.js';

export default function ProblemWatcher() {
  const on = useDebug();
  useEvent('problem', p => { if (on && p && p.level !== 'warning') toast(`${levelLabel(p.level)}: ${p.message || 'Something went wrong.'}`); });
  return null;
}
