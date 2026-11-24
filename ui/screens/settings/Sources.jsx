// "Sources": every place Matinee gets details from, with the optional ones that take a free key.
import { useEffect, useState } from 'preact/hooks';
import { call, openExternal } from '../../api.js';
import { refreshCore, toast } from '../../state.js';
import Icon from '../../components/Icon.jsx';
import { Dialog } from '../../components/ui.jsx';
import DebugInfo from '../../debug/DebugInfo.jsx';
import { sinceText } from '../../components/trouble.js';

const when = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };

/** Key status line: tested OK / rejected / couldn't reach, plus the last problem. */
function KeyStatus({ p, onTest, busy }) {
  const k = p.key;
  if (!k) return null;
  const rejected = k.state === 'rejected';
  const tone = rejected ? 'bad' : k.state === 'ok' ? 'good' : 'warn';
  const text = rejected ? 'Key rejected' : k.state === 'ok' ? `Key ${k.hint}, working${k.testedAt ? ` (tested ${when(k.testedAt)})` : ''}` : k.state === 'unreachable' ? `Key ${k.hint}, couldn't reach ${p.label} to test it` : `Key ${k.hint}, not tested yet`;
  return (
    <div data-testid={`keystatus-${p.id}`}>
      <div class="set-row set-between">
        <span class="set-status" data-tone={tone}>{text}</span>
        <button class="btn btn-small btn-ghost" type="button" disabled={busy} onClick={onTest}>{busy ? 'Testing…' : 'Test again'}</button>
      </div>
      {rejected && k.message && <p class="set-msg" data-tone="bad">{k.message}</p>}
      {k.lastError && !(rejected && k.message) && <p class="set-msg" data-tone="bad">{k.lastError}</p>}
    </div>
  );
}

function Status({ p }) {
  if (!p.needsKey) return <span class="set-status" data-tone="good">{p.filled ? `On: ${p.filled} ${p.filled === 1 ? 'film' : 'films'}` : 'On'}</span>;
  if (p.key && p.key.state === 'rejected') return <span class="set-status" data-tone="bad">Key rejected{p.filled ? `: ${p.filled} ${p.filled === 1 ? 'film' : 'films'} filled in` : ''}</span>;
  return p.hasKey
    ? <span class="set-status" data-tone="good"><Icon name="check" size={14} />{p.filled ? `Working: ${p.filled} ${p.filled === 1 ? 'film' : 'films'} filled in` : 'Key added, nothing filled in yet'}</span>
    : <span class="set-status" data-tone="warn">Needs a key</span>;
}

function KeyArea({ p, masked }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const help = p.keyHelp || { steps: [] };
  const [testing, setTesting] = useState(false);
  const retest = async () => {
    setTesting(true);
    try { const r = await call('retestKey', { provider: p.id }); setMsg({ ok: !!r.ok, text: r.ok ? 'Working.' : r.message }); refreshCore(); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    setTesting(false);
  };

  const save = async e => {
    e.preventDefault();
    if (!key.trim()) { setMsg({ ok: false, text: 'Paste your key first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await call('setSettings', { keys: { [p.id]: key } });
      setMsg({ ok: !!r.ok, text: r.message });
      if (r.ok) { setKey(''); refreshCore(); }
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try { await call('setSettings', { keys: { [p.id]: '' } }); setMsg(null); refreshCore(); toast('Key removed.'); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
    setBusy(false);
  };

  return (
    <div class="set-key">
      <KeyStatus p={p} onTest={retest} busy={testing} />
      <button type="button" class="set-key-toggle" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={16} />{p.hasKey ? 'Change or remove key' : 'Add a free key'}
      </button>
      {open && (
        <div class="set-key-body">
          {help.steps && help.steps.length > 0 && <ol class="set-steps">{help.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {help.url && <div><button type="button" class="btn btn-small" onClick={() => openExternal(help.url)}><Icon name="external" size={16} />Get a free key</button></div>}
          <form class="set-row" onSubmit={save}>
            <input class="input set-key-input" type="password" autocomplete="off" spellcheck={false} aria-label={`${p.label} key`} placeholder={p.hasKey ? (masked || 'Key added') : 'Paste your key'} value={key} onInput={e => setKey(e.currentTarget.value)} />
            <button class="btn btn-small" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check and save'}</button>
            {p.hasKey && <button class="btn btn-small btn-ghost" type="button" disabled={busy} onClick={remove}>Remove key</button>}
          </form>
          {msg && <p class="set-msg" data-tone={msg.ok ? 'good' : 'bad'} role="status">{msg.text}</p>}
        </div>
      )}
    </div>
  );
}

// Percent bars per kind of detail, and a rough time left while Matinee is working.
function Progress({ core }) {
  const pr = core.progress;
  const running = !!core.job;
  useEffect(() => { if (!running) return undefined; const t = setInterval(refreshCore, 10000); return () => clearInterval(t); }, [running]);
  // Only Covers and Details are shown, so the headline is worked out from those two (it must agree with the bars).
  const shown = pr && pr.categories ? pr.categories.filter(c => c.id === 'covers' || c.id === 'details') : [];
  if (!shown.length) return null;
  const total = shown.reduce((n, c) => n + c.total, 0), done = shown.reduce((n, c) => n + c.done, 0);
  const complete = shown.every(c => c.done >= c.total);
  const percent = total ? Math.floor((done / total) * 100) : 100;
  // Once everything is in, the bars are noise: one quiet line instead.
  if (complete && !running) return <p class="faint" style={{ margin: "var(--space-3) 0", fontSize: "var(--step--1)" }}>Everything is filled in.</p>;
  return (
    <div class="set-progress" style={{ margin: "var(--space-3) 0" }}>
      <div class="set-row set-between">
        <strong>{complete ? 'Everything is filled in' : `${percent}% filled in`}</strong>
        {pr.etaText && <span class="muted" aria-live="polite">Time left: {pr.etaText}</span>}
      </div>
      <ul class="set-list">
        {shown.map(c => (
          <li key={c.id}>
            <div class="set-row set-between"><span>{c.label}</span><span class="num muted">{c.percent}%</span></div>
            <div class="bar" role="progressbar" aria-label={c.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={c.percent}><i style={{ width: c.percent + '%' }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Notices about sources that keep failing.
function Trouble({ core }) {
  const list = core.trouble || [];
  if (!list.length) return null;
  return (
    <div class="set-trouble" role="status">
      <h3>Fetching trouble</h3>
      <ul class="set-list">
        {list.map(t => <li key={t.key}>{t.message} <span class="faint">{sinceText(t.since)}</span></li>)}
      </ul>
    </div>
  );
}

/** Debug: copies the fetch log so it can be pasted into a bug report. */
export function CopyFetchLog() {
  const [text, setText] = useState(null); // set when the clipboard is blocked: shown in a dialog to copy by hand
  const copy = async () => {
    let log = '';
    try { const r = await call('getFetchLog'); log = (r && r.text) || ''; } catch (err) { toast(err.message); return; }
    if (!log) { toast('Nothing to copy yet.'); return; }
    try { await navigator.clipboard.writeText(log); toast('Log copied.'); }
    catch { setText(log); }
  };
  return (
    <div>
      <div class="set-row"><button type="button" class="btn btn-small" onClick={copy}>Copy fetch log</button></div>
      {text != null && (
        <Dialog title="Fetch log" onClose={() => setText(null)} footer={<button type="button" class="btn" onClick={() => setText(null)}>Done</button>}>
          <p class="muted">Select all, then copy.</p>
          <textarea class="input" rows="12" readOnly aria-label="Fetch log" value={text} onFocus={e => e.currentTarget.select()} style={{ width: '100%', fontFamily: 'inherit' }} />
        </Dialog>
      )}
    </div>
  );
}

// Debug mode: every plain value the core sent for this source, plus the problems it has recorded.
const SKIP = new Set(['label', 'gives', 'adds', 'attribution', 'keyHelp', 'key', 'id']);
function sourceRows(p, core) {
  const rows = Object.entries(p).filter(([k, v]) => !SKIP.has(k) && (v == null || typeof v !== 'object')).map(([k, v]) => [k, v == null ? '' : v]);
  if (p.key) rows.push(['key state', p.key.state], ['key tested', p.key.testedAt], ['last error', p.key.lastError || p.key.message]);
  const mine = (core.sync.problems || []).filter(x => (x.provider || x.step) === p.id);
  rows.push(['recorded problems', mine.length || ''], ['last problem', mine.length ? mine[mine.length - 1].message : '']);
  return rows;
}

export default function Sources({ core }) {
  return (
    <section class="panel set-panel" aria-labelledby="set-sources">
      <h2 id="set-sources">Sources</h2>
      <p class="muted">Matinee works well without any setup. Extra sources are optional and free.</p>
      <Progress core={core} />
      <Trouble core={core} />
      <ul class="set-list">
        {core.providers.map(p => (
          <li key={p.id} class="set-source">
            <div class="set-source-head">
              <div class="set-source-name">
                <strong>{p.label}</strong>
                <span class="muted">{p.gives.length ? p.gives.join(', ') : ''}</span>
              </div>
              <Status p={p} />
            </div>
            {p.adds && <p class="set-small">{p.adds}</p>}
            {p.needsKey && <KeyArea p={p} masked={core.settings.keys[p.id]} />}
            {p.attribution && <p class="set-small">{p.attribution}</p>}
            <DebugInfo title={p.id} rows={sourceRows(p, core)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
