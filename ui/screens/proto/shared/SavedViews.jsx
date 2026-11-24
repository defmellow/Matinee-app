// PROTOTYPE copy of library/SavedViews.jsx that keeps the feel parts (themes, leave-out, typed feeling, feels-like).
// Saved views: a row of chips, "Save this view" (with a small name dialog) and delete-with-undo.
import { useState, useRef } from 'preact/hooks';
import { call } from '../../../api.js';
import { toast } from '../../../state.js';
import { Dialog, Chip } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import { normalise } from './query.js';

export default function SavedViews({ views, q, canSave, onApply, activeId }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [undo, setUndo] = useState(null);
  const timer = useRef();

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try { await call('saveView', { name: n, query: normalise(q) }); }
    catch { toast("Couldn't save that view. Try again."); return; } // the dialog stays open
    setNaming(false); setName(''); toast(`Saved “${n}”`);
  };
  const remove = async v => {
    try { await call('deleteView', { id: v.id }); }
    catch { toast("Couldn't delete that view. Try again."); return; }
    clearTimeout(timer.current);
    setUndo(v);
    timer.current = setTimeout(() => setUndo(null), 6000);
  };
  const restore = async () => {
    const v = undo;
    if (!v) return;
    clearTimeout(timer.current);
    try { await call('saveView', { id: v.id, name: v.name, query: v.query }); setUndo(null); }
    catch { toast("Couldn't bring that view back. Try again."); } // the undo chip stays
  };

  if (!views.length && !canSave && !undo) return null;
  return (
    <div class="lib-views" aria-label="Saved views">
      {views.length > 0 && <span class="eyebrow">Views</span>}
      {views.map(v => (
        <span class="lib-view" key={v.id}>
          <Chip pressed={activeId === v.id} onClick={() => onApply(v)}>{v.name}</Chip>
          <button type="button" class="lib-view-x" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => remove(v)}><Icon name="close" size={12} /></button>
        </span>
      ))}
      {canSave && <button type="button" class="btn btn-small btn-ghost" onClick={() => setNaming(true)}><Icon name="plus" />Save this view</button>}
      {undo && <span class="lib-undo" role="status">Removed “{undo.name}”. <button type="button" class="btn btn-small btn-ghost" onClick={restore}>Undo</button></span>}
      {naming && (
        <Dialog title="Save this view" onClose={() => setNaming(false)}
          footer={<><button type="button" class="btn" onClick={() => setNaming(false)}>Cancel</button><button type="button" class="btn btn-primary" disabled={!name.trim()} onClick={save}>Save view</button></>}>
          <label class="lib-field">
            <span class="muted">Give it a name so you can come back to it, like “Comfort films” or “Long weekend”.</span>
            <input class="input" value={name} placeholder="Name this view" maxLength={60} onInput={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
          </label>
        </Dialog>
      )}
    </div>
  );
}
