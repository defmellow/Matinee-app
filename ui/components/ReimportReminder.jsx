// The monthly re-import reminder: a small quiet card at the top of the Library once the last import is over a month old.
// The core decides when (settings.reimportReminder from getState: { due, off, snoozeUntil, days }); Import here uses the same
// call as Settings → Your Letterboxd. ReimportSetting is the Settings → Your data switch that undoes "Don't show again".
import { useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { refreshCore, toast } from '../state.js';
import Icon from './Icon.jsx';
import './reimportreminder.css';
import { pluralN as plural } from '../format.js';
import { chooseExport } from '../export-file.js';


export default function ReimportReminder({ core }) {
  const r = core && core.settings && core.settings.reimportReminder;
  const picker = useRef();
  const [busy, setBusy] = useState(false);
  if (!r || !r.due) return null;
  const change = async args => {
    try { await call('setReimportReminder', args); refreshCore(); }
    catch { toast("Couldn't change that. Try again."); } // api.call recorded why
  };
  const importFile = async file => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const s = await call('importExport', { bytes });
      toast(`Imported: ${plural(s.watched, 'film', 'films')} watched, ${plural(s.entries, 'diary entry', 'diary entries')}.`);
      refreshCore();
    } catch (err) { toast(err.message); }
    setBusy(false);
  };
  return (
    <aside class="reimport" aria-label="Re-import reminder">
      <Icon name="upload" size={18} />
      <p>It's been a month since you last imported from Letterboxd. Re-import to pick up films you've taken off your watchlist and other changes.</p>
      <div class="reimport-actions">
        <button type="button" class="btn btn-small" disabled={busy} onClick={() => chooseExport(picker.current).then(f => { if (f) importFile(f); }, err => toast(err.message))}>{busy ? 'Importing…' : 'Import'}</button>
        <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); }} />
        <button type="button" class="btn btn-ghost btn-small" onClick={() => change({ snooze: true })}>Remind me in 3 months</button>
        <button type="button" class="btn btn-ghost btn-small" onClick={() => change({ off: true })}>Don't show again</button>
      </div>
    </aside>
  );
}

/** Settings → Your data: switch the reminder back on after "Don't show again". */
export function ReimportSetting({ core }) {
  const off = !!(core && core.settings && core.settings.reimportReminder && core.settings.reimportReminder.off);
  const set = async on => {
    try { await call('setReimportReminder', { off: !on }); refreshCore(); }
    catch { toast("Couldn't change that. Try again."); }
  };
  return (
    <label class="set-check">
      <input type="checkbox" checked={!off} onChange={e => set(e.currentTarget.checked)} />
      <span>Remind me to re-import every month</span>
    </label>
  );
}
