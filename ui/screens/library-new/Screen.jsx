// THE Library (rebuilt 23 Nov from the approved wireframe, after the last one looked slapped on).
// Library and By feel in one: two slim rows on top, the Feelings and filters panel beside the films, chosen things as pills
// above them, and the closeness badge on each poster when feelings are asked. The engine (ranking, link handling, saved
// views, bulk tagging) is the shared one in ../proto/shared; everything you see here is this folder's own.
import { useEffect, useMemo } from 'preact/hooks';
import { usePref, useRestoredState } from '../../state.js';
import Icon from '../../components/Icon.jsx';
import LogDrop from '../../components/LogDrop.jsx';
import ReimportReminder from '../../components/ReimportReminder.jsx';
import DebugInfo from '../../debug/DebugInfo.jsx';
import { n } from '../../format.js';
import { narrowed, clearAll, normalise } from '../proto/shared/query.js';
import { useScreen, NotReady, Bulk, headingOf } from '../proto/shared/parts.jsx';
import { StatusTabs, Search, Bar, useSaveView } from './TopBar.jsx';
import Panel from './Panel.jsx';
import { Films, Skeleton, LikeBand, ThinNote, Nothing } from './Results.jsx';
import { feelGroups, filmGroups, pickedCounts, pillsOf } from './model.js';
import '../library.css'; // the Select bar (BulkBar) is the old Library's
import './library-new.css';

/** The chosen things as pills above the films, with the count first, Clear all, and Save this view. */
function Chosen({ u, pills, core, onSave }) {
  const k = u.results.length;
  const pending = core && core.job ? u.lib.films.filter(f => !f.enriched).length : 0;
  const same = v => JSON.stringify(normalise(v.query)) === JSON.stringify(normalise(u.q));
  const saved = (u.lib.views || []).some(same);
  return (
    <div class="lx-chosen" aria-live="polite">
      <span class="lx-n"><b class="num">{n(k)}</b> {k === 1 ? 'film' : 'films'}{u.busy && k > 0 ? '…' : ''}</span>
      {pills.map(p => (
        <button type="button" key={p.key} class="chip lx-pill" data-state={p.out ? 'out' : 'in'} aria-pressed="true" title={`Remove ${p.label}`} onClick={() => u.setQ(p.patch)}>
          {p.out && <Icon name="ban" size={13} />}<span class="lx-chip-l">{p.label}</span><Icon name="close" size={12} class="lx-x" />
        </button>
      ))}
      {(pills.length > 0 || u.q.like || u.q.text.trim()) && <button type="button" class="btn-link lx-clear" onClick={() => u.setQ(clearAll(u.q))}>Clear all</button>}
      {pending > 0 && <span class="lx-fetching faint num">Still fetching details for {n(pending)} {pending === 1 ? 'film' : 'films'}<LogDrop class="lx-logdrop" /></span>}
      <span class="lx-spacer" />
      {narrowed(u.q) && !saved && <button type="button" class="btn btn-ghost btn-small" onClick={onSave}><Icon name="plus" size={14} />Save this view</button>}
    </div>
  );
}

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view: v0, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [words, setWords] = usePref('library.feelWords', false); // DECISION: off by default, as in the approved wireframe
  const view = { ...v0, words, setWords };
  const [open, setOpen] = useRestoredState('library.panel.open', false);
  const [save, saveDialog] = useSaveView(u);

  useEffect(() => {
    if (!open) return undefined;
    // the panel stays open while the user clicks around; Escape (once nothing smaller is open) or Done closes it
    const k = e => { if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => [...feelGroups(u.allSections, u.facets), ...filmGroups(u.lib)], [u.allSections, u.facets, u.lib]);
  const where = useMemo(() => { const m = new Map(); for (const g of groups) if (g.kind === 'feel') for (const it of g.items) if (!m.has(it.id)) m.set(it.id, g.id); return m; }, [groups]);
  if (!u.lib) return <NotReady u={u} />;
  const pills = pillsOf(u.q, { labels: u.labels, where, autoLabels });
  const picked = pickedCounts(u.q, groups);
  const heading = headingOf(u);
  const empty = !u.results.length && !u.busy;

  return (
    <div class={`screen lx${open ? ' lx-open' : ''}`}>
      <header class="lx-head">
        <h1 class="lx-title">Library</h1>
        <StatusTabs u={u} counts={counts} />
        <Search u={u} />
      </header>
      <DebugInfo title="Library" rows={{ 'films in library': u.lib.films.length, 'matching now': u.results.length, ranked: String(u.ranked), 'best score': u.best ? u.best.toFixed(3) : '', 'feel answer': u.busy ? 'waiting' : u.error ? 'failed' : 'ready' }} />
      <ReimportReminder core={core} />
      <Bar u={u} view={view} sel={sel} picked={picked.total} panelOpen={open} onPanel={() => setOpen(!open)} onSave={save} />
      <div class="lx-body">
        {open && <Panel u={u} groups={groups} counts={picked} onClose={() => setOpen(false)} />}
        <div class="lx-results">
          <LikeBand u={u} />
          <Chosen u={u} pills={pills} core={core} onSave={save} />
          <ThinNote u={u} />
          {u.error && u.results.length > 0 && <p class="lx-note">Couldn't match feelings just now, so these are from before. <button type="button" class="btn btn-small" onClick={u.retry}>Try again</button></p>}
          {u.error && !u.results.length
            ? <div class="lx-nothing"><h2 class="lx-nothing-h">Couldn't match feelings just now</h2><p>Something went wrong while looking. Try again in a moment.</p><p class="lx-nothing-acts"><button type="button" class="btn btn-primary" onClick={u.retry}>Try again</button></p></div>
            : u.busy && !u.results.length ? <Skeleton />
              : empty ? <Nothing u={u} pills={pills} />
                : <Films u={u} view={view} sel={sel} heading={heading} />}
        </div>
      </div>
      <Bulk u={u} sel={sel} byKey={byKey} />
      {saveDialog}
    </div>
  );
}
