// Settings > Updates: keeps Matinee up to date from its public GitHub releases.
// Only exists in the installed app (window.matinee.updates); in a browser or an unpackaged run the row is hidden.
import { useEffect, useState } from 'preact/hooks';
import { on } from '../../api.js';
import { openWhatsNew } from '../../whatsnew/WhatsNew.jsx';

import { reportFailure } from '../../debug/report.js';
const bridge = () => (typeof window !== 'undefined' && window.matinee && window.matinee.updates) || null;

/** Current update status, or null when updates are not available here (no bridge, or state 'off'). */
export function useUpdates() {
  const [s, setS] = useState(null);
  useEffect(() => {
    const b = bridge();
    if (!b) return undefined;
    let live = true;
    b.status().then(v => { if (live) setS(v); }).catch(e => reportFailure('Updates', "Couldn't read the update status.", e, { level: 'warning' }));
    const off = on('update', v => setS(v));
    return () => { live = false; off(); };
  }, []);
  return s && s.state !== 'off' ? s : null;
}

const needsAttention = s => s && ['ready', 'available-portable', 'stalled'].includes(s.state);

/** Small pill in the sidebar: only when there is something to do. "Update ready" restarts into the new version straight away
 * (it only linked to Settings, so on the Settings page a click did nothing). Otherwise it opens Settings at
 * Updates, scrolling there when Settings is already open (the ?s= jump only runs when Settings first opens). */
export function UpdatePill({ href }) {
  const s = useUpdates();
  if (!needsAttention(s)) return null;
  if (s.state === 'ready') {
    const b = bridge();
    return <button type="button" class="rail-update" title={`Restart Matinee now to update to ${s.next}`} onClick={() => b?.install()}>Update ready</button>;
  }
  const toUpdates = () => document.getElementById('set-sec-updates')?.scrollIntoView({ block: 'start' });
  return <a class="rail-update" href={href} title="Update available" onClick={toUpdates}>Update available</a>;
}

function Message({ s }) {
  switch (s.state) {
    case 'downloading': return <p aria-live="polite">Getting version {s.next}… {s.percent ?? 0}%</p>;
    case 'ready': return <p>Version {s.next} is ready.</p>;
    case 'available-portable': return s.manual === 'mac' || s.manual === 'deb'
      ? <p>Version {s.next} is out. Download it and open it to update; this copy of Matinee can't update itself. Your library stays as it is.</p>
      : <p>Version {s.next} is out. This copy of Matinee can't update itself — install Matinee once and it will keep itself up to date. Your library stays as it is.</p>;
    case 'stalled': return <p>The update to {s.next} didn't finish installing.</p>;
    default: return <p>Matinee {s.current}. You're up to date — it checks every few hours.</p>;
  }
}

function UpdateNotes({ s }) {
  if (!s.notes || !['downloading', 'ready', 'available-portable'].includes(s.state)) return null;
  return <div class="set-small" style={{ whiteSpace: 'pre-line', margin: 'var(--space-2) 0' }}><strong>What's new</strong>{'\n'}{s.notes}</div>;
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : 'over a day ago';
}

/** Check now. (The Main / Experimental choice was removed: every copy follows the normal releases.) */
function CheckAndChannel({ s, b }) {
  const status = s.checking ? 'Checking…' : s.checkFailed ? "Couldn't reach GitHub. Try again in a moment." : s.lastCheckedAt ? `Last checked ${ago(s.lastCheckedAt)}.` : 'Not checked yet.';
  return (
    <div class="set-row">
      <button type="button" class="btn" disabled={!!s.checking} onClick={() => b.check()?.catch?.(e => reportFailure('Updates', "Couldn't check for updates.", e))}>Check for updates now</button>
      <span class="set-small" aria-live="polite">{status}</span>
    </div>
  );
}

export default function Updates() {
  const s = useUpdates();
  const b = bridge();
  if (!s || !b) return null;
  return (
    <section class="panel set-panel" aria-labelledby="set-updates">
      <h2 id="set-updates">Updates</h2>
      <Message s={s} />
      <UpdateNotes s={s} />
      <div class="set-row"><button type="button" class="btn btn-small" onClick={openWhatsNew}>What's new in this version</button></div>
      {s.state === 'ready' && (
        <>
          <div class="set-row"><button type="button" class="btn btn-primary" onClick={() => b.install()}>Restart to update</button></div>
          <p class="set-small">Matinee will close and reopen in a few seconds. If you'd rather wait, it updates next time you close it.</p>
        </>
      )}
      {s.state === 'available-portable' && <div class="set-row"><button type="button" class="btn btn-primary" onClick={() => b.openDownload()}>{s.manual === 'mac' || s.manual === 'deb' ? 'Download the update' : 'Get the installer'}</button></div>}
      {s.state === 'stalled' && <div class="set-row"><button type="button" class="btn btn-primary" onClick={() => b.retry()}>Try again</button><button type="button" class="btn" onClick={() => b.openDownload()}>{s.appImage ? 'Download the update' : 'Download the installer'}</button></div>}
      <CheckAndChannel s={s} b={b} />
    </section>
  );
}
