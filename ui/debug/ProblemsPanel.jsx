// Settings → Debug → Problems: everything that went wrong, newest first. Always available, never pushed at the user.
// Opening it (scrolling it into view) marks the list as seen, which clears the dot on Settings.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { useEvent, toast, throttle } from '../state.js';
import { Chip } from '../components/ui.jsx';
import { problemTime, countLevels, levelLabel, groupProblems } from './model.js';
import { reportFailure, localProblems } from './report.js';
import './debug.css';

export const Flag = ({ level }) => <span class={'flag ' + (level === 'warning' ? 'flag-warning' : 'flag-error')}>{levelLabel(level)}</span>;

export function ProblemRow({ p }) {
  return (
    <li class={'prob-row' + (p.isNew ? ' is-new' : '')}>
      <div class="prob-head">
        <Flag level={p.level} />
        <span class="num">{problemTime(p.at)}</span>
        <span class="prob-area">{p.area}</span>
        {p.film && <a href={'#/film/' + encodeURIComponent(p.film)}>{p.film}</a>}
        {p.count > 1 && <span class="num">×{p.count}</span>}
        {p.isNew && <span>New</span>}
      </div>
      <div class="prob-msg">{p.message}</div>
      {p.detail && <details class="prob-detail"><summary>Technical detail</summary><pre>{p.detail}</pre></details>}
    </li>
  );
}

/** Same kind of problem for several films, folded into one line that opens to the films. */
function ProblemGroup({ g }) {
  const films = g.rows.length, total = g.rows.reduce((n, p) => n + (p.count || 1), 0);
  return (
    <li class="prob-row">
      <details class="prob-detail">
        <summary><Flag level={g.rows[0].level} /> <span class="prob-area">{g.rows[0].area}</span> · {g.rows[0].message} · {films} {films === 1 ? 'film' : 'films'}{total > films ? ` (×${total})` : ''}</summary>
        <ul class="prob-list">{g.rows.map(p => <ProblemRow key={p.id} p={p} />)}</ul>
      </details>
    </li>
  );
}

export default function ProblemsPanel() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState(null); // null = default: Errors when there are any, else All
  const box = useRef();
  const seen = useRef(false);

  const load = useRef(null);
  if (!load.current) load.current = throttle(() => {
    call('getProblems').then(d => { setData(d); setFailed(false); }, e => { setFailed(true); reportFailure('Settings', "Couldn't load the problems list.", e, { level: 'warning' }); });
  }, 1500);
  useEffect(() => { load.current(); }, []);
  useEvent('problem', () => load.current());

  useEffect(() => { // seen once at least half of it has been on screen
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(es => {
      if (seen.current || !es.some(e => e.isIntersecting)) return;
      seen.current = true;
      call('markProblemsSeen').catch(() => {}); // recorded by api.call (and a missed "seen" just leaves the dot on)
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const list = data ? data.list : [];
  const c = data && data.error != null ? data : countLevels(list);
  const errs = list.filter(p => p.level !== 'warning').length, warns = list.length - errs;
  const filter = pick || (errs ? 'error' : 'all');
  const setFilter = setPick;
  const shown = list.filter(p => filter === 'all' || (filter === 'warning') === (p.level === 'warning'));
  const groups = groupProblems(shown);
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.text); toast('Copied.'); } catch (e) { reportFailure('Settings', "Couldn't copy the problems.", e, { level: 'warning' }); toast("Couldn't copy. Select the text instead."); }
  };
  const openLogs = async () => {
    try {
      const r = await window.matinee.openLogs();
      if (r && r.ok === false) toast(`Couldn't open the logs folder${r.error ? ': ' + r.error : '.'}`);
    } catch (e) { reportFailure('Settings', "Couldn't open the logs folder.", e); toast("Couldn't open the logs folder."); }
  };
  const clear = async () => {
    try { await call('clearProblems'); load.current(); } catch { toast("Couldn't clear the list. Try again."); } // api.call recorded why
  };
  const copyPath = async () => {
    try { await navigator.clipboard.writeText(data.folder); toast('Folder path copied.'); } catch (e) { reportFailure('Settings', "Couldn't copy the folder path.", e, { level: 'warning' }); }
  };

  return (
    <section class="panel set-panel" aria-labelledby="set-problems" ref={box}>
      <h2 id="set-problems">Problems</h2>
      <p class="muted">Anything that went wrong while Matinee was running, kept here so nothing is lost. You don't need to do anything with it. If something looks off, copy this list and send it on.</p>
      {failed && !data && <p class="set-msg" data-tone="bad">Couldn't load the list just now.{localProblems().length ? ` This window has seen ${localProblems().length} so far.` : ''}</p>}
      {data && (
        <>
          <div class="prob-filters" role="group" aria-label="Show">
            <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>All {list.length}</Chip>
            <Chip pressed={filter === 'error'} onClick={() => setFilter('error')}>Errors {errs}</Chip>
            <Chip pressed={filter === 'warning'} onClick={() => setFilter('warning')}>Warnings {warns}</Chip>
          </div>
          {shown.length ? <ul class="prob-list">{groups.map(g => g.rows.length > 1 ? <ProblemGroup key={g.key} g={g} /> : <ProblemRow key={g.key} p={g.rows[0]} />)}</ul>
            : <p class="muted">{list.length ? 'Nothing in this view.' : 'No problems recorded. Good.'}</p>}
          <div class="set-row">
            <button type="button" class="btn" onClick={copy}>Copy all</button>
            {window.matinee && window.matinee.openLogs
              ? <button type="button" class="btn" onClick={openLogs}>Open logs folder</button>
              : data.folder && <button type="button" class="btn" onClick={copyPath}>Copy logs folder path</button>}
            <button type="button" class="btn btn-ghost" disabled={!list.length} onClick={clear}>Clear</button>
          </div>
          {!(window.matinee && window.matinee.openLogs) && data.folder && <p class="set-small debug-mono">{data.folder}</p>}
        </>
      )}
    </section>
  );
}
