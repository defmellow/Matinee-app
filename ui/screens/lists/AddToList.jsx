// "Add to list": a small popover listing your own lists (tick to add or remove) and a "New list" field.
// Used on the film page (one film, ticks reflect where it is now) and in the Library's Select bar (many films, add only).
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast, useCall } from '../../state.js';
import Icon from '../../components/Icon.jsx';

const fail = e => toast((e && e.message) || 'Something went wrong. Please try again.');

export function AddToListPop({ keys, inLists = [], onClose, onChanged, up = false }) {
  const { data: lists } = useCall('getLists', {}, [], { refreshOn: 'library' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [here, setHere] = useState(() => new Set(inLists));
  const ref = useRef();
  const single = keys.length === 1;
  useEffect(() => {
    const el = ref.current;
    const away = e => { if (el && !el.contains(e.target) && !e.target.closest('[data-pop-btn]')) onClose(); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);
  const mine = (lists || []).filter(l => l.source === 'matinee');

  const toggle = async l => {
    setBusy(true);
    try {
      if (single) {
        const on = !here.has(l.id);
        await call('setInList', { id: l.id, key: keys[0], on });
        setHere(s => { const n = new Set(s); if (on) n.add(l.id); else n.delete(l.id); return n; });
        toast(on ? `Added to “${l.name}”.` : `Removed from “${l.name}”.`);
      } else {
        const r = await call('addToList', { id: l.id, keys });
        toast(r.added ? `Added ${r.added} ${r.added === 1 ? 'film' : 'films'} to “${l.name}”.` : `They're all on “${l.name}” already.`);
        onClose();
      }
      onChanged && onChanged();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const r = await call('saveList', { name: n, films: keys });
      toast(`Made “${r.name}”${keys.length ? ` with ${keys.length === 1 ? 'this film' : `${keys.length} films`}` : ''}.`);
      onChanged && onChanged();
      onClose();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <div class={'lib-pop ls-pop' + (up ? ' ls-pop-up' : ' ls-pop-down')} role="dialog" aria-label="Add to list" ref={ref}>
      {lists && mine.length > 0 && (
        <ul class="ls-pop-list">
          {mine.map(l => (
            <li key={l.id}>
              <button type="button" class="ls-pop-item" disabled={busy} aria-pressed={single ? String(here.has(l.id)) : undefined} onClick={() => toggle(l)}>
                {single && <span class="ls-tick" aria-hidden="true">{here.has(l.id) ? <Icon name="check" size={14} /> : null}</span>}
                <span class="ls-pop-name">{l.name}</span><span class="faint num">{l.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lists && mine.length === 0 && <p class="lib-pop-note">You haven't made a list yet. Name one below.</p>}
      <div class="lib-pop-row">
        <input class="input" value={name} maxLength={80} placeholder="New list, like rainy day" aria-label="Name for a new list"
          onInput={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} />
        <button type="button" class="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>Make list</button>
      </div>
    </div>
  );
}

/** The button + popover pair. */
export default function AddToList({ keys, inLists, onChanged, up = false, label = 'Add to list', small = false }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="lib-bar-slot ls-slot">
      <button type="button" class={'btn' + (small ? ' btn-small' : '')} data-pop-btn aria-expanded={String(open)} disabled={!keys.length} onClick={() => setOpen(o => !o)}><Icon name="list" size={16} />{label}</button>
      {open && <AddToListPop keys={keys} inLists={inLists} up={up} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </span>
  );
}
