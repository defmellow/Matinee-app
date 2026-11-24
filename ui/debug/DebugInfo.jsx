// The one small, faint block of extra detail that Debug mode adds to a screen. Renders nothing when Debug mode is off.
// <DebugInfo title="Library" rows={{ films: 612, 'loaded in': '84 ms' }} /> or give it children for free-form content.
import { useDebug } from './useDebug.js';
import { debugRows } from './model.js';
import './debug.css';

export default function DebugInfo({ title = 'Debug', rows, children, class: cls = '' }) {
  const on = useDebug();
  if (!on) return null;
  const list = debugRows(rows);
  if (!list.length && !children) return null;
  return (
    <div class={('debug-info ' + cls).trim()} role="note" aria-label={`${title} (debug details)`}>
      <span class="debug-info-title">{title}</span>
      {list.map(([k, v]) => <span key={k} class="debug-info-item"><span class="debug-info-key">{k}</span> <span class="debug-info-val">{v}</span></span>)}
      {children}
    </div>
  );
}

/** Shows a screen's load error inline in Debug mode (when Debug mode is off the screen's own message is all there is). */
export function DebugError({ error, what = 'This screen' }) {
  const on = useDebug();
  if (!on || !error) return null;
  return <div class="debug-info debug-error" role="alert"><span class="debug-info-title">Error</span> {what}: {String((error && error.message) || error)}</div>;
}
