// Library: every film you know about as a poster wall or a table, searchable and filterable instantly.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { applyQuery } from '../../core/analysis/query.js';
import { call } from '../api.js';
import { useLibrary, usePref, useRestoredState, useLibraryError, reloadLibrary } from '../state.js';
import DebugInfo, { DebugError } from '../debug/DebugInfo.jsx';
import { FilmCard, EmptyState } from '../components/film.jsx';
import { Segmented, Loading, Chip } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import LogDrop from '../components/LogDrop.jsx';
import ReimportReminder from '../components/ReimportReminder.jsx';
import FilterPanel from './library/FilterPanel.jsx';
import ListView from './library/ListView.jsx';
import SavedViews from './library/SavedViews.jsx';
import PickCard from './library/PickCard.jsx';
import BulkBar from './library/BulkBar.jsx';
import { rangeKeys, withKeys, summarise, pruneKeys, querySignature } from './library/select.js';
import { n } from '../format.js';
import { queryFromParam, STATUS_OPTIONS, STATUS_HELP, STATUS_TITLES, emptyForStatus, SORT_OPTIONS, sortLabel, normalise, toCoreQuery, activeFilters, isNarrowed, cleared, statusCounts, effectiveSort, effectiveDir, feelKeySet, applyFeel, feelLabelMap } from './library/model.js';
import { useFetchNow } from '../components/fetchnow.js';
import './library.css';

const PAGE = 120;
const SIZES = [['112', 'Small'], ['140', 'Medium'], ['180', 'Large']];

// Links can open the Library filtered, e.g. #/library/tag:<name>, #/library/genre:<name>, #/library/status:watched (see library/model.js).

const reminderText = core => {
  const r = core && core.settings && core.settings.reimportReminder;
  if (!r) return 'no data';
  const state = r.off ? 'switched off' : r.due ? 'showing' : r.snoozeUntil && Date.parse(r.snoozeUntil) > Date.now() ? `snoozed until ${r.snoozeUntil.slice(0, 10)}` : 'not due';
  return `${state}, last import ${r.days == null ? 'never' : r.days + ' d ago'}`;
};

export default function Library({ core, param }) {
  const lib = useLibrary();
  const libError = useLibraryError();
  const [stored, setStored] = usePref('library.query', null);
  useEffect(() => {
    const fromLink = queryFromParam(param);
    if (!fromLink) return;
    setStored(fromLink);
    history.replaceState(null, '', '#/library'); // the filter now lives in the Library; Back skips the link form
  }, [param]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = usePref('library.mode', 'grid');
  const [pip, setPip] = usePref('library.matineePip', true);
  const [size, setSize] = usePref('library.size', '140');
  const [open, setOpen] = useRestoredState('library.filtersOpen', false);
  const q = useMemo(() => normalise(stored), [stored]);
  const set = patch => setStored(prev => ({ ...normalise(prev), ...patch }));

  // Search box: typing is instant, the (heavier) filtering follows shortly after.
  const [text, setText] = useState(q.text);
  const searchRef = useRef();
  const filtersBtn = useRef();
  useEffect(() => { if (q.text !== text) setText(q.text); }, [q.text]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (text === q.text) return;
    const t = setTimeout(() => set({ text }), 140);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes the Filters panel and hands focus back to its button.
  useEffect(() => {
    if (!open) return;
    const k = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setOpen(false);
      if (filtersBtn.current) filtersBtn.current.focus();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const films = lib ? lib.films : null;

  // Feel: the facet list loads once the panel is opened (or a feel is already chosen); matches come from the existing feel search.
  const wantFeel = open || q.feel.length > 0;
  const [feelFacets, setFeelFacets] = useState(null);
  useEffect(() => {
    if (!wantFeel || feelFacets) return;
    let live = true;
    call('getFeelFacets').then(f => live && setFeelFacets(f), () => live && setFeelFacets({ descriptors: [] }));
    return () => { live = false; };
  }, [wantFeel]); // eslint-disable-line react-hooks/exhaustive-deps
  // Matches per feel are kept per session; they are fetched again when more films have been enriched.
  const enrichedN = films ? films.reduce((n, f) => n + (f.enriched ? 1 : 0), 0) : 0;
  const feelCache = useRef({ n: -1, by: new Map() });
  const feelWanted = q.feel.join('|');
  const [feelKeys, setFeelKeys] = useState(null); // null = no feel filter (or still loading, see feelBusy)
  const [feelBusy, setFeelBusy] = useState(false);
  useEffect(() => {
    if (!q.feel.length || !films) { setFeelKeys(null); setFeelBusy(false); return; }
    const c = feelCache.current;
    if (c.n !== enrichedN) { c.n = enrichedN; c.by = new Map(); }
    let live = true;
    setFeelBusy(true);
    Promise.all(q.feel.map(id => {
      if (!c.by.has(id)) c.by.set(id, call('searchFeel', { descriptors: [id], limit: 100000 }).then(r => r.map(x => ({ key: x.key, score: x.score })), () => []));
      return c.by.get(id);
    })).then(per => { if (live) { setFeelKeys(feelKeySet(per)); setFeelBusy(false); } });
    return () => { live = false; };
  }, [feelWanted, enrichedN, !!films]); // eslint-disable-line react-hooks/exhaustive-deps
  const feelLabels = useMemo(() => feelLabelMap(feelFacets), [feelFacets]);

  const results = useMemo(() => {
    if (!films) return [];
    const base = applyQuery(films, toCoreQuery(q));
    if (!q.feel.length) return base;
    return feelBusy && !feelKeys ? [] : applyFeel(base, feelKeys || new Set());
  }, [films, q, feelKeys, feelBusy]);

  // Select mode: a Set of film keys. `pick` is stable so memoised cards don't all re-render on each toggle.
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const anchor = useRef(null);
  const live = useRef({});
  live.current = { results, sel };
  const byKey = useMemo(() => new Map((films || []).map(f => [f.key, f])), [films]);
  const summary = useMemo(() => summarise(byKey, sel), [byKey, sel]);
  const resultKeys = useMemo(() => new Set(results.map(f => f.key)), [results]);
  const hidden = useMemo(() => { let n = 0; for (const k of sel) if (byKey.has(k) && !resultKeys.has(k)) n++; return n; }, [sel, byKey, resultKeys]);
  const leaveSelect = useCallback(() => { setSelecting(false); setSel(new Set()); anchor.current = null; }, []);
  const pick = useCallback((key, shift) => {
    const { results: order, sel: cur } = live.current;
    const on = !cur.has(key);
    const keys = shift && anchor.current ? rangeKeys(order.map(f => f.key), anchor.current, key) : [key];
    anchor.current = key;
    setSel(withKeys(cur, keys, on));
  }, []);
  useEffect(() => {
    if (!selecting) return;
    const k = e => { if (e.key === 'Escape') leaveSelect(); };
    addEventListener('keydown', k);
    document.body.classList.add('lib-selecting');
    return () => { removeEventListener('keydown', k); document.body.classList.remove('lib-selecting'); };
  }, [selecting]);
  useEffect(() => { if (films) setSel(s => pruneKeys(s, byKey)); }, [byKey]); // films that left the library drop out of the selection
  useEffect(() => leaveSelect, []); // leaving the screen ends select mode
  const counts = useMemo(() => (films ? statusCounts(films) : null), [films]);
  const autoLabels = useMemo(() => Object.fromEntries((lib ? lib.autoTags : []).map(t => [t.id, t.label])), [lib]);

  // Progressive rendering
  // (kept for the session so Back to a long scroll finds the posters already drawn)
  const [shown, setShown] = useRestoredState('library.shown', PAGE);
  const firstRun = useRef(true);
  // Only a real change of query or view resets the window; keyed library patches while fetching must not collapse a deep scroll.
  const sig = querySignature(q, mode);
  useEffect(() => { if (firstRun.current) { firstRun.current = false; return; } setShown(PAGE); }, [sig]);
  const sentinel = useRef();
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= results.length) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(n => n + PAGE); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results, mode]);

  const gridRef = useRef();
  useFetchNow(gridRef, [results, shown, mode, selecting]);

  if (!lib && libError) {
    return (
      <div class="screen">
        <EmptyState title="Your library didn't load" action={<button type="button" class="btn btn-primary" onClick={reloadLibrary}>Try again</button>}>Something went wrong while opening it. Your films are safe.</EmptyState>
        <DebugError error={libError} what="getLibrary" />
      </div>
    );
  }
  if (!lib) return <div class="screen"><Loading label="Opening your library…" /></div>;

  const sort = effectiveSort(q), dir = effectiveDir(q);
  const chips = activeFilters(q, autoLabels, feelLabels);
  const narrowed = isNarrowed(q);
  const pending = films.filter(f => !f.enriched).length;
  const matchedView = lib.views.find(v => JSON.stringify(normalise(v.query)) === JSON.stringify(q));

  const onSort = s => set(s === sort ? { sort: s, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: s, dir: null });
  const clearAll = () => { setText(''); setStored(prev => cleared(prev)); };
  const watched = counts.watched, listed = counts.watchlist;

  const statusEmpty = emptyForStatus(q.status);
  const statusOptions = STATUS_OPTIONS.map(([value, label]) => ({ value, label: counts[value] ? <>{label} <span class="lib-n">{n(counts[value])}</span></> : label }));

  return (
    <div class="screen lib">
      <header class="screen-head">
        <div>
          <h1>Library</h1>
          <p class="sub num">{n(watched)} watched · {n(listed)} on your watchlist</p>
        </div>
        <div class="search lib-search">
          <Icon name="search" />
          <input class="input" data-search type="search" aria-label="Search your library" value={text} placeholder="Search titles, people, or try dir:wenders year:1980s"
            onInput={e => setText(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); set({ text: '' }); } }}
            ref={searchRef} />
        </div>
      </header>

      <DebugInfo title="Library" rows={{ 'films in library': lib.films.length, 'matching now': results.length, shown, 'still filling in': pending, sort: `${sort} ${dir}`, mode, 'active filters': chips.length, tags: (lib.tags || []).length, 'saved views': (lib.views || []).length, 'last load error': libError && libError.message, 'import reminder': reminderText(core) }} />
      <ReimportReminder core={core} />

      <div class="lib-toolbar">
        <div class="segmented" role="group" aria-label="Show">
          {statusOptions.map(o => <button type="button" key={o.value} aria-pressed={String(q.status === o.value)} title={STATUS_TITLES[o.value]} onClick={() => set({ status: o.value })}>{o.label}</button>)}
        </div>
        <label class="lib-sort">
          <span class="sr-only">Sort by</span>
          <select class="select" value={sort} onChange={e => set({ sort: e.currentTarget.value, dir: null })}>
            {SORT_OPTIONS.map(([v]) => <option key={v} value={v}>{sortLabel(v, q.status)}</option>)}
          </select>
        </label>
        <button type="button" class="btn" ref={filtersBtn} aria-expanded={String(open)} aria-controls="lib-filters" onClick={() => setOpen(o => !o)}>
          <Icon name="filter" />Filters{chips.length > 0 && <span class="lib-badge">{chips.length}</span>}
        </button>
        <button type="button" class="btn" aria-pressed={String(selecting)} onClick={() => (selecting ? leaveSelect() : setSelecting(true))}>
          <Icon name={selecting ? 'close' : 'check'} size={16} />{selecting ? 'Done' : 'Select'}
        </button>
        <div class="lib-view-controls">
        {mode === 'grid' && <Chip pressed={pip} onClick={() => setPip(!pip)} title="Show the small Matinee score in the corner of each poster">Matinee score</Chip>}
        {mode === 'grid' && <Segmented label="Poster size" value={size} options={SIZES.map(([value, label]) => ({ value, label }))} onChange={setSize} />}
        <div class="segmented lib-mode" role="group" aria-label="View">
          <button type="button" aria-pressed={String(mode === 'grid')} onClick={() => setMode('grid')} aria-label="Posters" title="Posters"><Icon name="grid" size={18} /></button>
          <button type="button" aria-pressed={String(mode === 'list')} onClick={() => setMode('list')} aria-label="List" title="List"><Icon name="list" size={18} /></button>
        </div>
        </div>
      </div>

      {STATUS_HELP[q.status] && <p title="Films that are in neither list (for example Discover results) are not shown here." class="lib-status-help faint">{STATUS_HELP[q.status]}</p>}

      {open && <FilterPanel q={q} set={set} data={lib} feelFacets={feelFacets} />}

      {(chips.length > 0 || narrowed) && (
        <div class="lib-active">
          {chips.map(c => <Chip key={c.id} pressed onClick={() => set(c.patch)} title="Remove this filter">{c.label}<span class="x" aria-hidden="true">×</span></Chip>)}
          {results.length > 0 && <button type="button" class="btn btn-small btn-ghost" onClick={clearAll}>Clear all</button>}
        </div>
      )}

      <SavedViews views={lib.views} q={q} canSave={narrowed} activeId={matchedView && matchedView.id}
        onApply={v => { const n = normalise(v.query); setText(n.text); setStored(n); }} />

      <div class="lib-count faint num" aria-live="polite">
        Showing {results.length === films.length ? n(results.length) : `${n(results.length)} of ${n(films.length)}`}
        {core && core.job && pending > 0 && <span class="lib-fetching"> · Still fetching details for {n(pending)} film{pending === 1 ? '' : 's'}…</span>}
        {core && core.job && pending > 0 && <LogDrop class="lib-logdrop" />}
      </div>

      {results.length === 0 && q.feel.length > 0 && feelBusy && !feelKeys ? (
        <Loading label="Finding films that feel like that…" />
      ) : results.length === 0 ? (
        <EmptyState title={films.length ? (statusEmpty ? statusEmpty[0] : 'No films match') : 'Your library is empty'}
          action={films.length
            ? <button type="button" class="btn btn-primary" onClick={clearAll}>Show all films</button>
            : <a class="btn btn-primary" href="#/welcome" style={{ textDecoration: 'none' }}>Bring in your Letterboxd films</a>}>
          {films.length ? (statusEmpty ? statusEmpty[1] : (q.feel.length ? 'Nothing here matches that feel yet. Feel profiles fill in as films are fetched, so try fewer feelings or loosen a filter.' : 'Try a different search, or loosen a filter or two.')) : 'Add your Letterboxd export and every film you have watched or want to watch will appear here.'}
        </EmptyState>
      ) : mode === 'grid' ? (
        <div ref={gridRef} class="film-grid lib-grid" style={{ '--card-min': size + 'px' }}>
          {results.slice(0, shown).map((f, i) => selecting
            ? <PickCard key={f.key} film={f} show={sort === 'score' ? 'score' : 'rating'} eager={i < 12} pip={pip} selected={sel.has(f.key)} onPick={pick} />
            : <FilmCard key={f.key} film={f} show={sort === 'score' ? 'score' : 'rating'} eager={i < 12} pip={pip} />)}
        </div>
      ) : (
        <ListView films={results.slice(0, shown)} sort={sort} dir={dir} onSort={onSort} selectMode={selecting} selected={sel} onPick={pick} />
      )}
      {shown < results.length && <div ref={sentinel} class="lib-sentinel" aria-hidden="true" />}
      {selecting && (
        <BulkBar summary={summary} hidden={hidden} shownCount={results.length} allShown={results.length > 0 && results.every(f => sel.has(f.key))}
          tagNames={lib.tags.map(t => t.name)} getKeys={() => [...pruneKeys(live.current.sel, byKey)]}
          onSelectAll={() => setSel(withKeys(live.current.sel, live.current.results.map(f => f.key), true))}
          onClear={() => setSel(new Set())} onWatchlistOnly={() => set({ status: 'watchlist' })} />
      )}
    </div>
  );
}
