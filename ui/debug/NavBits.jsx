// Small pieces for the app shell: the quiet dot on Settings, and the Debug-mode count badge.
import { useDebug, useProblemCounts } from './useDebug.js';
import { levelText } from './model.js';
import { href } from '../router.js';
import './debug.css';

/** Only unseen ERRORS light the dot (warnings are numerous and harmless, so they never disturb), and only in Debug mode: the
 *  Problems list it points to is shown only then. Problems are still recorded and logged either way. */
export function SettingsDot() {
  const on = useDebug();
  const c = useProblemCounts();
  if (!on || !(c.unseenError > 0)) return null;
  const level = 'error';
  return <i class="nav-dot" data-level={level} title="Something was recorded in Settings → Debug → Problems" aria-label="New items in Settings, Debug, Problems" />;
}

/** Only in Debug mode: "2 errors · 5 warnings", linking to the Problems section. */
export function DebugBadge() {
  const on = useDebug();
  const c = useProblemCounts();
  if (!on) return null;
  const level = c.error ? 'error' : c.warning ? 'warning' : 'none';
  return (
    <a class="rail-debug" data-level={level} href={href('settings', null, { s: 'debug' })} title={`Debug mode: ${levelText(c)} (${c.unseen} new). Open Problems.`}>
      <div>{c.error} err</div><div>{c.warning} warn</div>
    </a>
  );
}
