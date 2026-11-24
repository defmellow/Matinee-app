// Settings: your Letterboxd account, sources and keys, appearance, backup / start over, problems, about.
import { lessMotion } from '../motion.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { go, href, parse, queryOf } from '../router.js';
import { refreshCore, toast } from '../state.js';
import { setDebugMap, useDebugMap, setDebugDiscover, useDebugDiscover } from '../debug/switches.js';
import { Dialog, Loading } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import ProblemsPanel from '../debug/ProblemsPanel.jsx';
import { SettingsDot } from '../debug/NavBits.jsx';
import LogDrop from '../components/LogDrop.jsx';
import { ReimportSetting } from '../components/ReimportReminder.jsx';
import Sources, { CopyFetchLog } from './settings/Sources.jsx';
import TestFetch from './settings/TestFetch.jsx';
import ShareCard from './settings/ShareCard.jsx';
import Updates, { useUpdates } from './settings/Updates.jsx';
import { ThemePicker } from './settings/ThemePicker.jsx';
import { CountrySelect, COUNTRY_HINT, FriendCode } from './welcome/Fields.jsx';
import { STARTED_OVER_KEY } from './Welcome.jsx';
import './welcome.css'; // the shared fields (country, friend code) are styled with the onboarding's
import { ago, problemLines, download, formatBytes } from './settings/format.js';
import './settings.css';
import { pluralN as plural } from '../format.js';
import { chooseExport } from '../export-file.js';

function Letterboxd({ core }) {
  const saved = (core.user && core.user.username) || '';
  const [name, setName] = useState(null); // null = untouched
  const picker = useRef();
  const [busy, setBusy] = useState(false);
  const job = core.job;
  const pct = job && job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;
  const shown = name == null ? saved : name;

  const saveName = async e => {
    e.preventDefault();
    try { await call('setSettings', { username: shown }); setName(null); refreshCore(); toast('Username saved.'); }
    catch (err) { toast(err.message); }
  };
  const refresh = async () => { try { await call('refresh', {}); refreshCore(); } catch (err) { toast(err.message); } };
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
    <section class="panel set-panel" aria-labelledby="set-lb">
      <h2 id="set-lb">Your Letterboxd</h2>
      <form class="set-field" onSubmit={saveName}>
        <label for="set-user">Username</label>
        <div class="set-row">
          <input id="set-user" class="input" value={shown} placeholder="your-username" autocomplete="off" spellcheck={false} onInput={e => setName(e.currentTarget.value)} />
          {name != null && name !== saved && <button class="btn btn-small" type="submit">Save</button>}
        </div>
        <p class="set-small">Used to pick up new diary entries and watchlist additions between exports.</p>
      </form>
      <div class="set-field">
        <label for="set-country">Country</label>
        <div class="set-row"><CountrySelect core={core} id="set-country" class="set-country" /></div>
        <p class="set-small">{COUNTRY_HINT}</p>
      </div>
      <div class="set-field set-code"><FriendCode core={core} variant="settings" /></div>
      <dl class="set-times">
        <div><dt>Last import</dt><dd>{ago(core.sync.lastImport)}</dd></div>
        <div><dt>Last refresh</dt><dd>{ago(core.sync.lastRefresh)}</dd></div>
      </dl>
      {job ? (
        <div class="set-job" aria-live="polite">
          <div class="set-row set-between"><span class="num">{job.label}{pct != null ? ` — ${pct}%` : ''}</span><button type="button" class="btn btn-small" onClick={() => call('cancel')}>Stop</button></div>
          <div class="bar"><i style={{ width: (pct ?? 4) + '%' }} /></div>
          <LogDrop />
        </div>
      ) : (
        <div class="set-row">
          <button type="button" class="btn btn-primary" onClick={refresh}><Icon name="refresh" />Refresh now</button>
          <button type="button" class="btn" disabled={busy} onClick={() => chooseExport(picker.current).then(f => { if (f) importFile(f); }, err => toast(err.message))}><Icon name="upload" />{busy ? 'Importing…' : 'Import a newer export'}</button>
          <input ref={picker} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); }} />
        </div>
      )}
    </section>
  );
}

/** "Less motion": stills the app's animations, smooth scrolling and moving effects. Off still follows the computer's own animation setting. */
function LessMotion({ core }) {
  const on = core.settings.motion === 'less';
  const set = async v => { try { await call('setSettings', { motion: v ? 'less' : 'system' }); refreshCore(); } catch (err) { toast("Couldn't change Less motion. Try again."); } }; // api.call recorded why
  return (
    <label class="set-check set-motion">
      <input type="checkbox" checked={on} onChange={e => set(e.currentTarget.checked)} />
      <span>Less motion<span class="muted set-help"> · Stops animations, smooth scrolling and things that slide or grow. Matinee also does this when your computer is set to reduce animations.</span></span>
    </label>
  );
}

/** Feel colours: each film's colour from how it feels, on posters, film pages, Insights and Year in review. The Map keeps its own. */
function FeelColours({ core }) {
  const on = core.settings.feelColours !== false;
  const set = async v => { try { await call('setSettings', { feelColours: v }); refreshCore(); } catch (err) { toast("Couldn't change Feel colours. Try again."); } }; // api.call recorded why
  return (
    <label class="set-check set-motion">
      <input type="checkbox" checked={on} onChange={e => set(e.currentTarget.checked)} />
      <span>Feel colours<span class="muted set-help"> · Colours each film by how it feels, on posters, film pages and Insights. Hover on a colour to see what it means. The Map always shows its colours.</span></span>
    </label>
  );
}

function Appearance({ core }) {
  const set = async theme => { try { await call('setSettings', { theme }); refreshCore(); } catch (err) { toast(err.message); } };
  return (
    <section class="panel set-panel" aria-labelledby="set-look">
      <h2 id="set-look">Appearance</h2>
      <ThemePicker value={core.settings.theme || 'system'} onChange={set} />
      <LessMotion core={core} />
      <FeelColours core={core} />
    </section>
  );
}

function Experimental() {
  const map = useDebugMap();
  const discover = useDebugDiscover();
  return (
    <section class="panel set-panel" aria-labelledby="set-exp">
      <h2 id="set-exp">Archived</h2>
      <label class="set-check">
        <input type="checkbox" checked={map} onChange={e => setDebugMap(e.currentTarget.checked)} />
        <span>Show the Map in the sidebar</span>
      </label>
      <label class="set-check">
        <input type="checkbox" checked={discover} onChange={e => setDebugDiscover(e.currentTarget.checked)} />
        <span>Show Discover in the sidebar (archived)</span>
      </label>
    </section>
  );
}

// Shades of the one accent, darkest = biggest share.
const shade = rank => `color-mix(in srgb, var(--accent) ${Math.max(28, 100 - rank * 18)}%, var(--surface))`;

/** Disk space, shown inside "Your data": one line, one stacked bar split by what uses it, a legend, and a button that clears what can be fetched again. */
function Storage() {
  const [info, setInfo] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call('getStorage').then(r => { if (live) setInfo(r); }).catch(() => { if (live) setInfo({ total: 0, parts: [], failed: true }); }); // recorded by api.call
    return () => { live = false; };
  }, []);
  const clear = async () => {
    setBusy(true);
    try {
      const r = await call('clearCache');
      if (r && r.storage) setInfo(r.storage);
      toast('Cache cleared.');
    } catch (err) { toast(err.message); }
    setBusy(false); setConfirm(false);
  };
  const parts = info ? info.parts.filter(p => p.bytes > 0) : [];
  const ranked = [...parts].sort((x, y) => y.bytes - x.bytes);
  const colour = p => shade(ranked.indexOf(p));
  const pct = p => Math.round((p.bytes / info.total) * 100);
  const tip = p => `${p.label} · ${formatBytes(p.bytes)} · ${pct(p)}%`;
  return (
    <div class="set-space" role="group" aria-labelledby="set-storage">
      <h3 id="set-storage">Space on this computer</h3>
      {!info ? <Loading label="Measuring…" /> : info.failed ? <p class="set-msg" data-tone="bad">Couldn't measure the space just now. Open Settings again to retry.</p> : (
        <>
          <p>Matinee uses <span class="num">{formatBytes(info.total)}</span></p>
          {parts.length > 0 && (
            <>
              <div class="set-bar" role="list" aria-label="What uses the space">
                {parts.map(p => (
                  <span key={p.id} role="listitem" class="set-bar-seg" tabIndex={0} data-tip={tip(p)} aria-label={tip(p)}
                    style={{ flexGrow: p.bytes, background: colour(p) }} />
                ))}
              </div>
              <ul class="set-legend">
                {parts.map(p => (
                  <li key={p.id}><i class="set-swatch" style={{ background: colour(p) }} /><span>{p.label}</span><span class="num faint">{formatBytes(p.bytes)}</span></li>
                ))}
              </ul>
            </>
          )}
          <div class="set-row"><button type="button" class="btn" onClick={() => setConfirm(true)}>Clear cache</button></div>
        </>
      )}
      {confirm && (
        <Dialog title="Clear the cache?" onClose={() => !busy && setConfirm(false)}
          footer={<><button type="button" class="btn" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" class="btn btn-primary" disabled={busy} onClick={clear}>{busy ? 'Clearing…' : 'Clear'}</button></>}>
          <p>This clears saved lookups, images and the built-in browser's cache. Your library, ratings, tags, settings and site sign-in checks stay. Matinee fetches what it needs again.</p>
        </Dialog>
      )}
    </div>
  );
}

function Data({ core }) {
  const [confirm, setConfirm] = useState(false);
  const backup = async () => {
    try { const b = await call('exportBackup'); download(b.filename, b.json); toast('Backup downloaded.'); }
    catch (err) { toast(err.message); }
  };
  const reset = async () => {
    try {
      await call('resetAll');
      try { localStorage.setItem(STARTED_OVER_KEY, '1'); } catch { /* no storage: the import then offers the optional steps again, which is harmless */ }
      setConfirm(false); await refreshCore(); go('welcome');
    }
    catch (err) { toast(err.message); }
  };
  return (
    <section class="panel set-panel" aria-labelledby="set-data">
      <h2 id="set-data">Your data</h2>
      <p class="muted">Everything is kept on this computer. A backup is a single file you can keep somewhere safe.</p>
      <ReimportSetting core={core} />
      <div class="set-row">
        <button type="button" class="btn" onClick={backup}>Download a backup</button>
        {window.matinee?.openDataFolder && <button type="button" class="btn" onClick={() => window.matinee.openDataFolder()}>Open data folder</button>}
        <button type="button" class="btn btn-ghost set-danger" onClick={() => setConfirm(true)}>Start over</button>
      </div>
      <Storage />
      {confirm && (
        <Dialog title="Start over?" onClose={() => setConfirm(false)}
          footer={<><button type="button" class="btn" onClick={() => setConfirm(false)}>Keep my library</button><button type="button" class="btn set-danger-solid" onClick={reset}>Start over</button></>}>
          <p>This deletes your films, ratings, diary entries, tags and notes from this computer. Your look, country, username, friend code and keys are kept.</p>
          <p class="muted">Your Letterboxd account isn't touched. You can import your export again afterwards. Download a backup first if you'd like to keep a copy.</p>
        </Dialog>
      )}
    </section>
  );
}

/** Debug mode: one switch that adds extra detail on every screen. Off by default; nothing technical shows without it. */
function DebugMode({ core }) {
  const on = !!(core.settings && core.settings.debug);
  const set = async v => { try { await call('setSettings', { debug: v }); refreshCore(); } catch (err) { toast("Couldn't change Debug mode. Try again."); } }; // api.call recorded why
  const lines = problemLines(core.sync.problems, core.providers);
  return (
    <section class="panel set-panel" aria-labelledby="set-debugmode">
      <h2 id="set-debugmode">Debug mode</h2>
      <label class="set-check">
        <input type="checkbox" checked={on} onChange={e => set(e.currentTarget.checked)} />
        <span>Debug mode · Shows extra detail everywhere, for finding problems</span>
      </label>
      <p class="set-small">Adds small grey detail to each screen, a problem count in the sidebar and a pop-up for each new error. Everything is recorded either way; this only shows it.</p>
      {on && lines.length > 0 && <><h3>Sources that didn't answer</h3><ul class="set-problems">{lines.map(l => <li key={l.id}>{l.text}</li>)}</ul></>}
    </section>
  );
}

/** Letterboxd, under the first panel: the welcome and setup steps again, without deleting anything (the Guide section it replaced was removed, 24 Nov). */
function BackToOnboarding() {
  return (
    <section class="panel set-panel" aria-labelledby="set-onb">
      <h2 id="set-onb">Onboarding</h2>
      <div class="set-row"><button type="button" class="btn" onClick={() => go('welcome', 'again')}>Show onboarding again</button></div>
      <p class="set-small">Opens the welcome and setup steps again. Your library is kept.</p>
    </section>
  );
}

function About() {
  const upd = useUpdates();
  return (
    <section class="panel set-panel" aria-labelledby="set-about">
      <h2 id="set-about">About</h2>
      {upd && upd.current && <p class="muted">Matinee <span class="num">{String(upd.current).replace(/\.0$/, '')}</span></p>}
      <p class="set-small">Film data from Wikidata and Wikipedia (CC BY-SA), ratings from IMDb, Rotten Tomatoes and Metacritic. Not affiliated with Letterboxd.</p>
    </section>
  );
}

// Settings: a list of sections on the left, one section at a time on the right.
const SECTIONS = [
  { id: 'letterboxd', label: 'Letterboxd', icon: 'person', body: core => <><Letterboxd core={core} /><BackToOnboarding /></> },
  { id: 'sources', label: 'Sources', icon: 'grid', body: core => <Sources core={core} /> },
  { id: 'appearance', label: 'Appearance', icon: 'eye', body: core => <Appearance core={core} /> },
  { id: 'updates', label: 'Updates', icon: 'refresh', body: () => <><Updates /><About /></> },
  { id: 'data', label: 'Your data', icon: 'upload', body: core => <Data core={core} /> },
  { id: 'debug', label: 'Debug', icon: 'settings', body: core => <><DebugMode core={core} />{core.settings && core.settings.debug && <><ProblemsPanel /><ShareCard /><section class="panel set-panel" aria-labelledby="set-fetchdbg"><h2 id="set-fetchdbg">Fetching</h2><CopyFetchLog /><TestFetch core={core} /></section><Experimental /></>}</> }, // the tools only show with Debug mode on
];

const reducedMotion = lessMotion;

// One continuous page: every section is rendered in order, the list on the left only jumps to one and shows where you are.
function Sections({ core }) {
  const items = SECTIONS;
  const ids = items.map(s => s.id).join('|');
  const [current, setCurrent] = useState(() => {
    const want = queryOf(parse().qs).s;
    return items.some(s => s.id === want) ? want : items[0].id;
  });
  const holdSpy = useRef(0); // while a click-scroll is under way, the spy must not fight the clicked item

  useEffect(() => { // open at ?s=<id>
    const want = queryOf(parse().qs).s;
    if (!want || !items.some(s => s.id === want)) return undefined;
    const t = setTimeout(() => { const el = document.getElementById('set-sec-' + want); if (el) el.scrollIntoView({ block: 'start' }); }, 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => { // scroll-spy: the section crossing the band near the top of the page is the current one
    const root = document.getElementById('main');
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => seen.set(e.target.dataset.sec, e.isIntersecting));
      if (Date.now() < holdSpy.current) return;
      const first = ids.split('|').find(id => seen.get(id));
      if (first) setCurrent(first);
    }, { root, rootMargin: '-8% 0px -80% 0px' });
    ids.split('|').forEach(id => { const el = document.getElementById('set-sec-' + id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [ids]);

  const pick = id => {
    const el = document.getElementById('set-sec-' + id);
    if (!el) return;
    setCurrent(id);
    holdSpy.current = Date.now() + 900;
    el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    history.replaceState(null, '', href('settings', null, { s: id }));
  };
  return (
    <div class="set-sections">
      <nav class="set-nav" aria-label="Settings sections">
        {items.map(s => (
          <button key={s.id} type="button" class="set-nav-item" aria-current={s.id === current ? 'true' : undefined} onClick={() => pick(s.id)}>
            <Icon name={s.icon} size={18} />
            <span>{s.label}</span>
            {s.id === 'debug' && <SettingsDot />}
          </button>
        ))}
      </nav>
      <div class="set-content">
        {items.map(s => <div key={s.id} id={'set-sec-' + s.id} data-sec={s.id} class="set-sec">{s.body(core)}</div>)}
      </div>
    </div>
  );
}

export default function Settings({ core }) {
  if (!core) return <Loading />;
  return (
    <div class="screen set">
      <div class="screen-head"><h1>Settings</h1></div>
      <Sections core={core} />
    </div>
  );
}
