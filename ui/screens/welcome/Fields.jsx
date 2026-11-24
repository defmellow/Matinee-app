// Fields shared by onboarding's "About you" and Settings → Letterboxd: Country, the friend code, and the two free API keys.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call, openExternal } from '../../api.js';
import { refreshCore, toast } from '../../state.js';
import Icon from '../../components/Icon.jsx';
import { countryOptions } from './countries.js';

export const COUNTRY_HINT = 'Sets cinema release dates in Upcoming and age ratings like MA 15+.';

/** Country: every country by name, saved as settings.region (ISO-2). */
export function CountrySelect({ core, id = 'onb-country', class: cls = '' }) {
  const value = (core.settings && core.settings.region) || 'AU';
  const opts = countryOptions();
  const set = async v => {
    try { await call('setSettings', { region: v }); refreshCore(); }
    catch (err) { toast(err.message || "Couldn't change the country. Try again."); } // api.call recorded why
  };
  return (
    <select id={id} class={'select ' + cls} value={value} onChange={e => set(e.currentTarget.value)}>
      {!opts.some(o => o.code === value) && <option value={value}>{value}</option>}
      {opts.map(o => <option key={o.code} value={o.code}>{o.name}</option>)}
    </select>
  );
}

/** A small green tick with words beside it: the calm "that worked" (green is the status colour here, not a feel colour). */
export function Ok({ children }) {
  return <span class="onb-ok" role="status"><span class="onb-okc" aria-hidden="true"><Icon name="check" size={13} /></span><span>{children}</span></span>;
}

/** Waits `ms` after the last call before running `fn`; flush() runs a waiting call now. */
function useDebounced(fn, ms) {
  const t = useRef(null), last = useRef(null), f = useRef(fn);
  f.current = fn;
  useEffect(() => () => clearTimeout(t.current), []);
  const run = (...a) => { last.current = a; clearTimeout(t.current); t.current = setTimeout(() => { t.current = null; f.current(...a); }, ms); };
  run.cancel = () => { clearTimeout(t.current); t.current = null; };
  return run;
}

/**
 * The friend code. Onboarding shows a quiet "Enter friend code" link that turns into a field; Settings asks "Have a friend code?" and,
 * once the code is in, says "Dendy Newtown is on" with a Remove link. Checked about half a second after typing pauses, so "1" on the
 * way to "123" never flashes a complaint. A wrong code changes nothing.
 */
export function FriendCode({ core, variant = 'onboarding' }) {
  const on = !!(core.settings && core.settings.dendy);
  const [open, setOpen] = useState(variant === 'onboarding' && on);
  const [code, setCode] = useState(on ? (core.settings.friendCode || '') : '');
  const [state, setState] = useState(on ? 'ok' : null); // null | 'ok' | 'bad'
  const input = useRef();
  const check = useDebounced(async v => {
    const c = v.trim();
    try {
      if (!c) {
        if (core.settings && core.settings.dendy) { await call('setSettings', { friendCode: '' }); refreshCore(); }
        setState(null); return;
      }
      const r = await call('setSettings', { friendCode: c });
      setState(r && r.ok ? 'ok' : 'bad');
      if (r && r.ok) refreshCore();
    } catch (err) { setState(null); toast("Couldn't check the code just now. Try again."); } // api.call recorded why
  }, 500);
  useEffect(() => { if (open && input.current && variant === 'settings') input.current.focus(); }, [open]);
  const remove = async () => {
    try { await call('setSettings', { friendCode: '' }); setCode(''); setState(null); setOpen(false); refreshCore(); }
    catch (err) { toast("Couldn't remove the code just now. Try again."); } // api.call recorded why
  };

  if (variant === 'settings' && on && state !== 'bad' && !open) {
    return (
      <div class="onb-code-on">
        <Ok>Dendy Newtown is on</Ok>
        <button type="button" class="btn-link onb-quiet" onClick={remove}>Remove</button>
      </div>
    );
  }
  if (!open) {
    return <button type="button" class="btn-link onb-quiet" onClick={() => { setOpen(true); requestAnimationFrame(() => input.current && input.current.focus()); }}>{variant === 'settings' ? 'Have a friend code?' : 'Enter friend code'}</button>;
  }
  return (
    <div class="onb-fld">
      <label for={`fc-${variant}`}>Friend code</label>
      <div class="onb-fld-row">
        <input ref={input} id={`fc-${variant}`} class="input onb-in" value={code} autocomplete="off" spellcheck={false}
          onInput={e => { const v = e.currentTarget.value; setCode(v); setState(null); check(v); }} />
        {state === 'ok' && <Ok>Dendy Newtown is on</Ok>}
        {state === 'bad' && <span class="onb-bad" role="status">Invalid code! :c</span>}
      </div>
      {state === 'ok' && <p class="onb-hint">Find upcoming sessions.</p>}
      {state === 'bad' && <p class="onb-hint">If you don't have a code it doesn't remove any features.</p>}
    </div>
  );
}

/** One key field: checked quietly once pasting or typing pauses; a small tick when it works, plain words when it doesn't. */
function KeyField({ core, id, label }) {
  const p = (core.providers || []).find(x => x.id === id);
  const saved = !!(core.settings && core.settings.keys && core.settings.keys[id]);
  const [value, setValue] = useState('');
  const [state, setState] = useState(saved ? 'ok' : null); // null | 'checking' | 'ok' | 'bad'
  const check = useDebounced(async v => {
    const k = v.trim();
    if (!k) { setState(saved ? 'ok' : null); return; }
    setState('checking');
    try {
      const r = await call('setSettings', { keys: { [id]: k } });
      setState(r && r.ok ? 'ok' : 'bad');
      if (r && r.ok) { setValue(''); refreshCore(); }
    } catch (err) { setState('bad'); } // api.call recorded why; the words below say it didn't work
  }, 700);
  const help = (p && p.keyHelp) || {};
  const [how, setHow] = useState(false); // the steps to get a key, the same ones Settings → Sources shows
  return (
    <div class="onb-fld">
      <label for={`onb-key-${id}`}>{label} key</label>
      <div class="onb-fld-row">
        <input id={`onb-key-${id}`} class="input onb-in" type="password" autocomplete="off" spellcheck={false}
          placeholder={saved ? ((core.settings.keys || {})[id] || 'Key added') : 'Paste your key'} value={value}
          onInput={e => { const v = e.currentTarget.value; setValue(v); setState(null); check(v); }} />
        {state === 'ok' && <Ok>Working</Ok>}
        {state === 'checking' && <span class="onb-hint">Checking…</span>}
        {state === 'bad' && <span class="onb-bad" role="status">That key didn't work</span>}
      </div>
      {(help.url || (help.steps && help.steps.length > 0)) && (
        <button type="button" class="btn-link onb-lnk onb-how" aria-expanded={String(how)} onClick={() => setHow(!how)}>
          <Icon name="chevron" size={12} />How to get a free {label} key
        </button>
      )}
      {how && (
        <div class="onb-how-body">
          {help.url && <div><button type="button" class="btn btn-small" onClick={() => openExternal(help.url)}><Icon name="external" size={16} />Open the {label} page</button></div>}
          {help.steps && help.steps.length > 0 && <ol class="onb-keysteps">{help.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>}
        </div>
      )}
    </div>
  );
}

/** "Add third-party API keys": folded by default, so the step looks like two fields, not five. */
export function KeyFold({ core }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="onb-fold">
      <button type="button" class="onb-disc" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} class={open ? 'onb-disc-open' : ''} />Add third-party API keys <span>recommended, optional and free</span>
      </button>
      {open && (
        <div class="onb-fold-body">
          <p class="onb-why">These free API keys let Matinee fetch data directly, allowing posters and metadata to be fetched faster. Matinee works without them.</p>
          <KeyField core={core} id="tmdb" label="TMDB" />
          <KeyField core={core} id="omdb" label="OMDb" />
          <p class="onb-hint">You can add or change these any time in Settings → Sources.</p>
        </div>
      )}
    </div>
  );
}
