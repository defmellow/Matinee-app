// A closed-by-default "Details" dropdown listing what Matinee is fetching, in plain words, newest at the bottom.
// Reusable: pass `get` (async since => { entries, last }) and `event` (name of the core event that says "there is more")
// to feed it from somewhere else, e.g. Discover.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, on } from '../api.js';
import { useCore } from '../state.js';
import Icon from './Icon.jsx';
import './logdrop.css';

const SOURCES = {
  discover: { get: since => call('getDiscoverLog', { since }), event: 'discoverlog', empty: 'Nothing yet. Details show up here while Matinee looks for films.' },
  fetch: { get: since => call('getFetchLog', { since }), event: 'fetchlog', empty: 'Nothing has been fetched yet. Details show up here while Matinee looks films up.' },
};
const MAX_SHOWN = 300;
const KIND_WORDS = { fetch: 'Fetching', ok: 'Found', miss: 'Nothing found', error: 'Problem', wait: 'Waiting' };

export const pad = n => String(n).padStart(2, '0');
export function clock(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
/** "Wikipedia · Paris, Texas · got poster and synopsis" */
export function lineText(e) { return [e.site, e.title, e.text].filter(Boolean).join(' · '); }

export default function LogDrop({ source = 'fetch', get, event, empty, label = 'Details', class: cls = '' }) {
  const def = SOURCES[source] || {};
  const core = useCore();
  const eta = source === 'fetch' && core && core.progress && core.progress.etaText ? `Time left: ${core.progress.etaText}` : null;
  const load = get || def.get, evName = event || def.event;
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const since = useRef(0);
  const box = useRef(null);
  const stick = useRef(true); // follow the newest line unless the user has scrolled up

  useEffect(() => {
    if (!open || !load) return undefined;
    let live = true, busy = false, again = false;
    const pull = async () => {
      if (busy) { again = true; return; } // lines logged meanwhile: go round once more when this one lands
      busy = true;
      try {
        const r = await load(since.current);
        if (!live || !r) return;
        if (r.last != null && r.last < since.current) { since.current = 0; setEntries(r.entries || []); } // the log was reset
        else if (r.entries && r.entries.length) setEntries(prev => [...prev, ...r.entries].slice(-MAX_SHOWN));
        if (r.entries && r.entries.length) since.current = r.entries[r.entries.length - 1].n;
        else if (r.last != null) since.current = Math.max(since.current, 0);
      } catch { /* recorded by api.call; the live log is a nicety, so the box just stops updating */ } finally { busy = false; }
      if (again && live) { again = false; pull(); }
    };
    since.current = 0; setEntries([]);
    pull();
    const off = evName ? on(evName, pull) : null;
    return () => { live = false; if (off) off(); };
  }, [open, load, evName]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  const onScroll = () => { const el = box.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; };
  const toggle = () => { stick.current = true; setOpen(o => !o); };

  return (
    <div class={`logdrop ${cls}`}>
      <button type="button" class="logdrop-btn" aria-expanded={String(open)} onClick={toggle}>
        <span class={`logdrop-chev${open ? ' open' : ''}`} aria-hidden="true"><Icon name="chevron" /></span>{label}
      </button>
      {open && (
        <div class="logdrop-box" ref={box} onScroll={onScroll} role="log" aria-label={label}>
          {eta && <p class="logdrop-eta">{eta}</p>}
          {entries.length === 0
            ? <p class="logdrop-empty">{empty || def.empty || 'Nothing to show yet.'}</p>
            : <ul>{entries.map(e => (
              <li key={e.n} class={`logdrop-${e.kind}`}>
                <span class="logdrop-time faint num">{clock(e.t)}</span>
                <span class="logdrop-kind">{KIND_WORDS[e.kind] || ''}: </span>
                <span>{lineText(e)}</span>
              </li>
            ))}</ul>}
        </div>
      )}
    </div>
  );
}
