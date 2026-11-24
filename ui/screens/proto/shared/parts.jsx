// PROTOTYPE: building blocks every merged-Library design shares, so the designs differ in layout, not behaviour.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { FilmCard, Poster, EmptyState } from '../../../components/film.jsx';
import { Chip, Segmented, Loading, Badge } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import LogDrop from '../../../components/LogDrop.jsx';
import ReimportReminder from '../../../components/ReimportReminder.jsx';
import DebugInfo, { DebugError } from '../../../debug/DebugInfo.jsx';
import { call } from '../../../api.js';
import { href } from '../../../router.js';
import { useFetchNow } from '../../../components/fetchnow.js';
import { useRestoredState, usePref, reloadLibrary } from '../../../state.js';
import PickCard from '../../library/PickCard.jsx';
import BulkBar from '../../library/BulkBar.jsx';
import MatchList from './MatchList.jsx';
import SavedViewsRow from './SavedViews.jsx';
import { matchingTags, pickFilms, capFacets, matchTitle, EMPHASIS, voiceLabel, mostlyThin, filmHeading } from '../../feel/model.js';
import { lbPillLabel } from '../../../../core/analysis/feel/lbthemes.js';
import { STATUS_OPTIONS, STATUS_TITLES, STATUS_HELP, SORT_OPTIONS, sortLabel, statusCounts, emptyForStatus } from '../../library/model.js';
import { rangeKeys, withKeys, pruneKeys, summarise } from '../../library/select.js';
import { n } from '../../../format.js';
import { stateOf, toggle, leaveOut, include, drop, activePills, sortOf, dirOf, likeFilm, clearAll, narrowed, normalise } from './query.js';
import { useUnified, useFilmFeel, useFeelWords } from './useUnified.js';

export const PAGE = 120;
export const SIZES = [['112', 'Small'], ['140', 'Medium'], ['180', 'Large']];

// The reason a film came up goes with you into its page, as By feel did.
function rememberWhy(key, heading, lines, tier) {
  try { sessionStorage.setItem('feelWhy:' + key, JSON.stringify({ heading, lines, tier })); } catch { /* private mode: the film page just won't say why */ }
}

// ---------- how close ----------
export function MatchBadge({ match, best }) {
  if (!match) return null;
  return (
    <span class="byf-badges pl-badges">
      <span class={'byf-tier byf-tier-' + match.tier.id} title={matchTitle({ score: match.score, why: match.allLines }, match.tier, best)}>{match.tier.label}</span>
      {match.rough && <span class="byf-rough" title="Little has been written about this film, so how it feels is a rough guess">rough guess</span>}
    </span>
  );
}

/** A Library card (rating, heart, score pip, fetch-first) plus how close it is and why when ranked, and "More like this". */
export const ResultCard = memo(function ResultCard({ item, best, heading, eager, pip, show, selecting, selected, onPick, onLike, reason = true }) {
  const { film, match } = item;
  return (
    <div class="pl-card" onClickCapture={match ? () => rememberWhy(film.key, heading, match.allLines, match.tier.label) : undefined}>
      {selecting
        ? <PickCard film={film} show={show} eager={eager} pip={pip} selected={selected} onPick={onPick} />
        : <FilmCard film={film} show={show} eager={eager} pip={pip} />}
      {!selecting && onLike && <button type="button" class="pl-more" onClick={() => onLike(film.key)} title={`Films that feel like ${film.title}`}>More like this</button>}
      {match && <MatchBadge match={match} best={best} />}
      {match && reason && match.lines.length > 0 && <p class="byf-why pl-why">{match.lines.join(' · ')}</p>}
    </div>
  );
});

// ---------- view ----------
export function useView() {
  const [mode, setMode] = usePref('library.mode', 'grid');
  const [pip, setPip] = usePref('library.matineePip', true);
  const [size, setSize] = usePref('library.size', '140');
  return { mode, setMode, pip, setPip, size, setSize };
}

// ---------- selection ----------
export function useSelection(results, byKey) {
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const anchor = useRef(null);
  const live = useRef({});
  live.current = { results, sel };
  const leave = useCallback(() => { setSelecting(false); setSel(new Set()); anchor.current = null; }, []);
  const pick = useCallback((key, shift) => {
    const { results: order, sel: cur } = live.current;
    const on = !cur.has(key);
    const keys = shift && anchor.current ? rangeKeys(order.map(r => r.film.key), anchor.current, key) : [key];
    anchor.current = key;
    setSel(withKeys(cur, keys, on));
  }, []);
  useEffect(() => {
    if (!selecting) return;
    const k = e => { if (e.key === 'Escape') leave(); };
    addEventListener('keydown', k);
    document.body.classList.add('lib-selecting');
    return () => { removeEventListener('keydown', k); document.body.classList.remove('lib-selecting'); };
  }, [selecting]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (byKey.size) setSel(s => pruneKeys(s, byKey)); }, [byKey]);
  useEffect(() => leave, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { selecting, setSelecting, sel, setSel, pick, leave, live };
}

// ---------- results ----------
/** The poster wall or table, drawn 120 at a time. `groups`: split a ranked wall into Very close / Close / Some overlap sections. */
export function Results({ u, view, sel, heading, groups = false, reason = true, emptyAction }) {
  const { results, best, ranked, busy, error, q } = u;
  const { mode, size, pip } = view;
  const sort = sortOf(q), dir = dirOf(q);
  const [shown, setShown] = useRestoredState('proto.library.shown', PAGE);
  const sig = JSON.stringify([q, mode]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setShown(PAGE); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const sentinel = useRef();
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= results.length) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(x => x + PAGE); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const gridRef = useRef();
  useFetchNow(gridRef, [results, shown, mode, sel.selecting]);
  const onLike = useCallback(key => u.setQ(x => likeFilm(x, key)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const failed = error && <EmptyState title="Couldn't match feelings just now" action={<button type="button" class="btn btn-primary" onClick={u.retry}>Try again</button>}>Something went wrong while looking. Try again in a moment.</EmptyState>;
  if (failed && !results.length) return failed;
  if (busy && !results.length) return <Skeleton />;
  if (!results.length) return emptyAction;
  const show = sort === 'score' ? 'score' : 'rating';
  const grouped = groups && ranked && sort === 'match' && mode !== 'list';
  // Grouped sections draw their films whole (up to 600), so a section never grows above where the user is reading.
  const slice = grouped ? results.slice(0, 600) : results.slice(0, shown);
  const card = (item, i) => <ResultCard key={item.film.key} item={item} best={best} heading={heading} eager={i < 12} pip={pip} show={show} reason={reason}
    selecting={sel.selecting} selected={sel.sel.has(item.film.key)} onPick={sel.pick} onLike={onLike} />;
  let body;
  if (mode === 'list') {
    body = <div ref={gridRef}><MatchList items={slice} ranked={ranked} sort={sort} dir={dir} selectMode={sel.selecting} selected={sel.sel} onPick={sel.pick}
      onSort={s => (s === 'match' ? u.set({ sort: 'match', dir: null }) : u.set(s === sort ? { sort: s, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: s, dir: null }))} /></div>;
  } else if (grouped) {
    const by = { very: [], close: [], some: [] };
    slice.forEach(it => by[it.match.tier.id].push(it));
    const titles = { very: 'Very close', close: 'Close', some: 'Some overlap' };
    let i = 0;
    body = (
      <div ref={gridRef} class="pl-tiers">
        {['very', 'close', 'some'].map(t => by[t].length > 0 && (
          <section key={t} class="pl-tier">
            <h2 class="pl-tier-h">{titles[t]} <span class="faint num">{n(by[t].length)}</span></h2>
            <div class="film-grid lib-grid pl-grid" style={{ '--card-min': size + 'px' }}>{by[t].map(it => card(it, i++))}</div>
          </section>
        ))}
      </div>
    );
  } else {
    body = <div ref={gridRef} class="film-grid lib-grid pl-grid" style={{ '--card-min': size + 'px' }}>{slice.map(card)}</div>;
  }
  return (
    <div class="pl-results" data-loading={String(!!u.stale)}>
      {failed && <p class="pl-fail">Couldn't match feelings just now, so these are from before. <button type="button" class="btn btn-small" onClick={u.retry}>Try again</button></p>}
      {body}
      {!grouped && shown < results.length && <div ref={sentinel} class="lib-sentinel" aria-hidden="true" />}
    </div>
  );
}

export function Skeleton({ count = 12 }) {
  return <ul class="film-grid byf-grid" aria-busy="true" aria-label="Looking for films">{Array.from({ length: count }, (_, i) => <li key={i} class="byf-card byf-skel"><div class="poster" /><div class="byf-skel-l" /><div class="byf-skel-l short" /></li>)}</ul>;
}

/** Empty state that names the next step. */
export function NoResults({ u }) {
  const { lib, q, feelOn } = u;
  if (!lib.films.length) return <EmptyState title="Your library is empty" action={<a class="btn btn-primary" href="#/welcome" style={{ textDecoration: 'none' }}>Bring in your Letterboxd films</a>}>Add your Letterboxd export and every film you have watched or want to watch will appear here.</EmptyState>;
  if (q.like) {
    return q.status !== 'all'
      ? <EmptyState title="Nothing close to this one here" action={<button type="button" class="btn btn-primary" onClick={() => u.set({ status: 'all' })}>Look across everything</button>}>Nothing in this part of your library feels close enough.</EmptyState>
      : <EmptyState title="Nothing close to this one" action={<button type="button" class="btn btn-primary" onClick={() => u.set({ like: null, likeShift: null })}>Stop comparing with it</button>}>We need a bit more written about this film to find films like it, or a filter is keeping them out.</EmptyState>;
  }
  if (q.text.trim() && !feelOn && q.text.trim().length >= 3 && !q.text.includes(':')) {
    return <EmptyState title={`No titles or people match “${q.text.trim()}”`} action={<button type="button" class="btn btn-primary" onClick={() => u.setQ(x => ({ ...x, feelText: x.text.trim(), text: '' }))}>Find films that feel “{q.text.trim()}”</button>}>Or try a different spelling.</EmptyState>;
  }
  if (feelOn) return <EmptyState title="No films feel like that" action={<button type="button" class="btn btn-primary" onClick={() => u.setQ(clearAll(q))}>Show all films</button>}>Take a feeling or a filter off, or look across all your films instead of one part.</EmptyState>;
  const st = emptyForStatus(q.status);
  return <EmptyState title={st ? st[0] : 'No films match'} action={<button type="button" class="btn btn-primary" onClick={() => u.setQ(clearAll(q))}>Show all films</button>}>{st ? st[1] : 'Try a different search, or loosen a filter or two.'}</EmptyState>;
}

// ---------- toolbar pieces ----------
export function StatusControl({ u, counts }) {
  return (
    <div class="segmented" role="group" aria-label="Show">
      {STATUS_OPTIONS.map(([value, label]) => (
        <button type="button" key={value} aria-pressed={String(u.q.status === value)} title={STATUS_TITLES[value]} onClick={() => u.set({ status: value })}>
          {label}{counts && counts[value] ? <> <span class="lib-n">{n(counts[value])}</span></> : null}
        </button>
      ))}
    </div>
  );
}
export function StatusHelp({ u }) {
  const t = STATUS_HELP[u.q.status];
  return t ? <p title="Films that are in neither list (for example Discover results) are not shown here." class="lib-status-help faint">{t}</p> : null;
}
export const useCounts = u => useMemo(() => (u.lib ? statusCounts(u.lib.films) : null), [u.lib]);

export function SortSelect({ u, label = true }) {
  const sort = sortOf(u.q);
  const opts = u.ranked ? [['match', 'Best match'], ...SORT_OPTIONS] : SORT_OPTIONS;
  return (
    <label class="lib-sort pl-sort">
      {label ? <span class="faint pl-sort-l">Sort by</span> : <span class="sr-only">Sort by</span>}
      <select class="select" value={sort} onChange={e => u.set({ sort: e.currentTarget.value, dir: null })}>
        {opts.map(([v, l]) => <option key={v} value={v}>{v === 'match' ? l : sortLabel(v, u.q.status)}</option>)}
      </select>
    </label>
  );
}

export function ViewControls({ view }) {
  const { mode, setMode, size, setSize, pip, setPip } = view;
  return (
    <div class="lib-view-controls">
      {mode === 'grid' && <Chip pressed={pip} onClick={() => setPip(!pip)} title="Show the small Matinee score in the corner of each poster">Matinee score</Chip>}
      {mode === 'grid' && <Segmented label="Poster size" value={size} options={SIZES.map(([value, label]) => ({ value, label }))} onChange={setSize} />}
      <div class="segmented lib-mode" role="group" aria-label="View">
        <button type="button" aria-pressed={String(mode === 'grid')} onClick={() => setMode('grid')} aria-label="Posters" title="Posters"><Icon name="grid" size={18} /></button>
        <button type="button" aria-pressed={String(mode === 'list')} onClick={() => setMode('list')} aria-label="List" title="List"><Icon name="list" size={18} /></button>
      </div>
    </div>
  );
}

export function SelectButton({ sel }) {
  return (
    <button type="button" class="btn" aria-pressed={String(sel.selecting)} onClick={() => (sel.selecting ? sel.leave() : sel.setSelecting(true))}>
      <Icon name={sel.selecting ? 'close' : 'check'} size={16} />{sel.selecting ? 'Done' : 'Select'}
    </button>
  );
}

/** "Showing 40 of 691 · closest first", plus the Library's fetching line. */
export function CountLine({ u, core }) {
  const total = u.lib.films.length, k = u.results.length;
  const pending = u.lib.films.filter(f => !f.enriched).length;
  return (
    <div class="lib-count faint num pl-count" aria-live="polite">
      Showing {k === total ? n(k) : `${n(k)} of ${n(total)}`}
      {u.ranked && sortOf(u.q) === 'match' && <span> · closest first</span>}
      {u.busy && <span> · matching…</span>}
      {core && core.job && pending > 0 && <span class="lib-fetching"> · Still fetching details for {n(pending)} film{pending === 1 ? '' : 's'}…</span>}
      {core && core.job && pending > 0 && <LogDrop class="lib-logdrop" />}
    </div>
  );
}

/** "Still fetching details for N films…" with the fetch log, while a fetch job runs (for designs whose count sits elsewhere). */
export function Fetching({ u, core }) {
  const pending = core && core.job ? u.lib.films.filter(f => !f.enriched).length : 0;
  if (!pending) return null;
  return <p class="lib-count faint num pl-count pe-fetching" aria-live="polite"><span class="lib-fetching">Still fetching details for {n(pending)} film{pending === 1 ? '' : 's'}…</span><LogDrop class="lib-logdrop" /></p>;
}

/** What the ranked list is: "Films that feel like Paris, Texas, but lighter" (feels-like only; pills say the rest). */
export function ResultHeading({ u }) {
  if (!u.likeFilm) return null;
  return <h2 class="pl-heading">{filmHeading(u.likeFilm.title, u.q.likeShift, u.facets && u.facets.axes)}</h2>;
}

// ---------- pills ----------
const pillLabel = (u, id) => u.labels.get(id) || (id.startsWith('lb:') ? lbPillLabel(id.slice(3)) : id.replace(/^set:/, ''));

/** Active filters, feelings first. Every pill has ×; a feeling's own label offers "leave it out instead" in words. */
export function Pills({ u, autoLabels, children }) {
  const pills = activePills(u.q, { labels: { get: id => pillLabel(u, id) }, autoLabels, filmTitle: () => u.likeFilm && u.likeFilm.title });
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return;
    const c = e => { if (!e.target.closest('.pl-pillmenu, .pl-pill-menuable')) setMenu(null); };
    const k = e => { if (e.key === 'Escape') setMenu(null); };
    addEventListener('pointerdown', c); addEventListener('keydown', k);
    return () => { removeEventListener('pointerdown', c); removeEventListener('keydown', k); };
  }, [menu]);
  const canClear = pills.length > 0 || u.q.text.trim();
  if (!pills.length && !children) return null;
  return (
    <div class="lib-active pl-pills">
      {children}
      {pills.map(p => {
        const feelish = p.kind === 'feel' || p.kind === 'theme' || p.kind === 'avoid';
        return (
          <span key={p.kind + p.id} class="pl-pill" data-kind={p.kind}>
            {feelish ? (
              <Chip pressed class={`pl-pill-menuable${p.kind === 'avoid' ? ' pl-pill-out' : ''}`} onClick={() => setMenu(menu === p.id ? null : p.id)}
                aria-haspopup="menu" aria-expanded={String(menu === p.id)}>
                <span class="pl-pill-l">{p.kind === 'avoid' && <span class="byf-not">not</span>}{p.label}</span>
              </Chip>
            ) : (
              <Chip pressed class="pl-pill-plain" onClick={() => u.setQ(p.patch)} title="Remove this filter"><span class="pl-pill-l">{p.label}</span></Chip>
            )}
            <button type="button" class="pl-pill-x" aria-label={`Remove ${p.label}`} title="Remove" onClick={() => u.setQ(p.patch)}><Icon name="close" size={12} /></button>
            {menu === p.id && (
              <span class="pl-pillmenu" role="menu">
                {p.kind === 'avoid'
                  ? <button type="button" role="menuitem" onClick={() => { u.setQ(x => include(x, u.labelsKind(p.id), p.id)); setMenu(null); }}>Look for it instead</button>
                  : <button type="button" role="menuitem" onClick={() => { u.setQ(x => leaveOut(x, p.id)); setMenu(null); }}>Leave it out instead</button>}
                <button type="button" role="menuitem" onClick={() => { u.setQ(p.patch); setMenu(null); }}>Remove</button>
              </span>
            )}
          </span>
        );
      })}
      {canClear && <button type="button" class="btn btn-small btn-ghost" onClick={() => u.setQ(clearAll(u.q))}>Clear all</button>}
    </div>
  );
}

/** Saved views that keep feelings; "Save this view" only when something is chosen; the matching view is highlighted. */
export function Views({ u, onlySave = false, noSave = false }) {
  const same = v => JSON.stringify(normalise(v.query)) === JSON.stringify(normalise(u.q));
  const active = (u.lib.views || []).find(same);
  return <SavedViewsRow views={onlySave ? [] : u.lib.views || []} q={u.q} canSave={!noSave && narrowed(u.q) && !active} activeId={active && active.id} onApply={v => u.setQ(normalise(v.query))} />;
}

// ---------- feeling chips ----------
/** A feeling to look for. Click: look for it / stop. The small "not" beside it (on hover or focus) leaves it out. */
/** By feel's chip (22 Nov, over the separate "not" button and Look for / Leave out switch): click to look for it,
 * click again to leave it out, once more to clear. */
const CHIP_HINT = 'Click to include, click again to leave out, once more to clear';
export function FeelChip({ u, item, count = true }) {
  const st = stateOf(u.q, item.id);
  return (
    <Chip class="byf-chip pl-chip" data-state={st} pressed={st === 'in'} title={`${item.label}. ${CHIP_HINT}`}
      onClick={() => u.setQ(q => cycleQ(q, item))}>
      {st === 'out' && <Icon name="ban" size={12} />}
      <span class="byf-chip-l">{item.label}</span>
      {count && <span class="byf-chip-n num">{item.count}</span>}
    </Chip>
  );
}

/** The same chip for long lists (thousands of Subjects): redraws only when its own label, count or state changes.
 * `onCycle(item)` must be stable. */
export const CycleChip = memo(function CycleChip({ item, st, onCycle }) {
  return (
    <Chip class="byf-chip pl-chip" data-state={st} pressed={st === 'in'} title={`${item.label}. ${CHIP_HINT}`} onClick={() => onCycle(item)}>
      {st === 'out' && <Icon name="ban" size={12} />}
      <span class="byf-chip-l">{item.label}</span>
      <span class="byf-chip-n num">{item.count}</span>
    </Chip>
  );
}, (a, b) => a.st === b.st && a.onCycle === b.onCycle && a.item.id === b.item.id && a.item.count === b.item.count && a.item.label === b.item.label);
export const cycleQ = (q, item) => { const now = stateOf(q, item.id); return now === 'off' ? include(q, item.kind, item.id) : now === 'in' ? leaveOut(q, item.id) : drop(q, item.id); };

/** One facet group (Mood, Themes, Set in…), By feel's rules: biggest first, capped, long lists browse tags on 2+ films. */
export function FeelGroup({ u, group, open: startOpen = true, collapsible = true, cap = 12, onFindAll }) {
  const [open, setOpen] = useState(startOpen);
  const [all, setAll] = useState(false);
  const items = group.items || [];
  const chosen = [...u.q.feel, ...u.q.themes, ...u.q.avoid];
  const picked = items.filter(it => chosen.includes(it.id)).length;
  if (!items.length) return null;
  const long = items.length > 40;
  const browse = long ? items.filter(it => it.count >= 2 || chosen.includes(it.id)) : items;
  const { shown, hidden } = capFacets(browse, { expanded: all, chosen, cap });
  return (
    <section class="byf-group pl-group">
      {collapsible ? (
        <button type="button" class="byf-group-h" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
          <span class="byf-chev" data-open={String(open)}><Icon name="chevron" size={14} /></span>
          <span>{group.label}</span>
          {picked > 0 ? <span class="pl-picked num">{picked} on</span> : <span class="faint num">{items.length}</span>}
        </button>
      ) : null}
      {open && (
        <>
          <div class={`chips byf-chips${all && long ? ' byf-scroll' : ''}`}>
            {shown.map(it => <FeelChip key={it.id} u={u} item={it} />)}
            {hidden > 0 && <Chip class="byf-more" onClick={() => setAll(true)}>Show {hidden} more</Chip>}
            {all && browse.length > cap && <Chip class="byf-more" onClick={() => setAll(false)}>Show fewer</Chip>}
          </div>
          {long && (all || hidden > 0) && onFindAll && <p class="byf-findall faint">Showing tags on 2 or more films. <button type="button" class="feel-link" onClick={onFindAll}>Search all {items.length}</button></p>}
        </>
      )}
    </section>
  );
}

// ---------- one search box ----------
/**
 * The Library's search box, now also the way in to feelings: typing still filters titles and people at once; the dropdown
 * offers feelings and themes whose names match, feelings the words describe ("quietly sad" → Melancholic…), "films that feel
 * '<text>'", genres, and "feels like <film>" for title matches. Enter with nothing picked and no title match searches by feeling.
 */
/** `plain`: titles and people only, no feeling or tag suggestions (the Library's box since 22 Nov). */
export function UniSearch({ u, placeholder = 'Search titles, people, feelings or themes', big = false, inputRef: outerRef, plain = false }) {
  const { q } = u;
  const qText = u.typed ?? q.text; // what the user typed, even when the screen reads it as a feeling
  const [text, setText] = useState(qText);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const innerRef = useRef(null);
  const ref = outerRef || innerRef;
  const box = useRef(null);
  useEffect(() => { if (qText !== text) setText(qText); }, [qText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (text === qText) return;
    const t = setTimeout(() => u.set({ text }), 140);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = [...q.feel, ...q.themes, ...q.avoid];
  const typed = text.trim();
  const operator = typed.includes(':');
  // "not gory", "no horror", "without violence": the rest of the phrase is something to leave out
  const neg = (typed.match(/^(?:not|no|without)\s+(.{2,})$/i) || [])[1] || '';
  const negWords = useFeelWords(neg);
  const outs = useMemo(() => {
    if (!neg) return [];
    const index = new Map();
    for (const sec of u.sections) for (const it of sec.items) if (!index.has(it.id)) index.set(it.id, { ...it, section: sec.label });
    const byLabel = matchingTags(u.sections, neg, { exclude: chosen, limit: 5 }).tags;
    const have = new Set(byLabel.map(t => t.id));
    return byLabel.concat(negWords.filter(w => !have.has(w.id) && index.has(w.id) && !chosen.includes(w.id)).map(w => index.get(w.id))).slice(0, 6);
  }, [neg, negWords, u.sections, chosen.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => (operator || neg ? [] : matchingTags(u.sections, text, { exclude: chosen, limit: 8 }).tags), [u.sections, text, neg, chosen.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useFeelWords(text);
  const described = useMemo(() => {
    const have = new Set([...tags.map(t => t.id), ...chosen]);
    const index = new Map();
    for (const sec of u.sections) for (const it of sec.items) if (!index.has(it.id)) index.set(it.id, { ...it, section: sec.label });
    return words.filter(w => !have.has(w.id) && index.has(w.id)).slice(0, 5).map(w => index.get(w.id));
  }, [words, tags, chosen.join('|'), u.sections]); // eslint-disable-line react-hooks/exhaustive-deps
  const genres = useMemo(() => {
    if (operator || typed.length < 3 || !u.lib) return [];
    const t = typed.toLowerCase();
    return ((u.lib.facets && u.lib.facets.genres) || []).filter(g => g.name.toLowerCase().startsWith(t) && !q.genres.includes(g.name)).slice(0, 2);
  }, [u.lib, typed, q.genres]); // eslint-disable-line react-hooks/exhaustive-deps
  const films = useMemo(() => (typed.length >= 2 && !operator && u.lib ? pickFilms(u.lib.films, text, 3) : []), [u.lib, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [];
  for (const t of outs) rows.push({ kind: 'out', sec: 'Leave out', t });
  const desc = described.map(t => ({ kind: 'tag', sec: 'What you described', t }));
  if (typed.length >= 3 && !operator && !neg) desc.push({ kind: 'text', sec: 'What you described' });
  const named = tags.map(t => ({ kind: 'tag', sec: 'Feelings and themes', t }));
  // a phrase ("quietly sad") is mostly a description; a single word ("sad") is mostly a name
  rows.push(...(/\s/.test(typed) ? [...desc, ...named] : [...named, ...desc]));
  for (const g of genres) rows.push({ kind: 'genre', sec: 'Genres', g });
  for (const f of films) rows.push({ kind: 'like', sec: 'Films that feel like…', f });
  if (plain) rows.length = 0;
  const showing = open && rows.length > 0;
  useEffect(() => setActive(-1), [text]);
  const done = () => { setText(''); if (ref.current) ref.current.focus(); setOpen(false); };
  const choose = row => {
    if (row.kind === 'tag') u.setQ(x => ({ ...include(x, row.t.kind, row.t.id), text: '' }));
    else if (row.kind === 'out') u.setQ(x => ({ ...leaveOut(x, row.t.id), text: '' }));
    else if (row.kind === 'text') u.setQ(x => ({ ...x, feelText: typed, text: '' }));
    else if (row.kind === 'genre') u.setQ(x => ({ ...x, genres: [...x.genres, row.g.name], text: '' }));
    else if (row.kind === 'like') u.setQ(x => ({ ...likeFilm(x, row.f.key), text: '' }));
    done();
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') {
      if (showing) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
      if (text) { e.stopPropagation(); setText(''); u.set({ text: '' }); }
      return;
    }
    if (e.key === 'Enter' && active < 0) {
      // Nothing picked: a phrase no title matches is a feeling ("quietly sad"); otherwise Enter just keeps the title search.
      if (!plain && typed.length >= 3 && !operator && !films.length) { e.preventDefault(); choose({ kind: 'text' }); }
      return;
    }
    if (!showing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a <= 0 ? rows.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(rows[active]); }
  };
  let head = null;
  return (
    <div class={`pl-uni${big ? ' pl-uni-big' : ''}`} ref={box} onFocusIn={() => setOpen(true)}
      onFocusOut={e => { if (!box.current || !box.current.contains(e.relatedTarget)) setOpen(false); }}>
      <label class="search lib-search pl-uni-box">
        <Icon name="search" />
        <input class="input" data-search type="search" aria-label="Search your library" value={text} placeholder={placeholder} ref={ref} autocomplete="off"
          role="combobox" aria-expanded={String(showing)} aria-controls={showing ? 'pl-uni-list' : undefined}
          aria-activedescendant={showing && active >= 0 ? `pl-uni-${active}` : undefined}
          onClick={() => setOpen(true)} onKeyDown={onKeyDown}
          onInput={e => { setOpen(true); setText(e.currentTarget.value); }} />
      </label>
      {showing && (
        <div class="byf-drop pl-drop" onMouseDown={e => e.preventDefault()}>
          <ul class="byf-drop-list" role="listbox" id="pl-uni-list" aria-label="Suggestions">
            {rows.map((r, i) => {
              const h = r.sec !== head ? (head = r.sec) : null;
              return [
                h && <li key={'h' + i} class="pl-drop-h" role="presentation">{h}</li>,
                <li key={i} id={`pl-uni-${i}`} role="option" aria-selected={String(i === active)} data-active={String(i === active)}
                  onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                  {r.kind === 'tag' && <><span class="byf-drop-l">{r.t.label}</span><span class="byf-drop-s">{r.t.section}</span>{r.t.count > 0 && <span class="byf-drop-n num">{r.t.count}</span>}</>}
                  {r.kind === 'out' && <><span class="byf-drop-l">Not {r.t.label.toLowerCase()}</span><span class="byf-drop-s">{r.t.section}</span>{r.t.count > 0 && <span class="byf-drop-n num">{r.t.count}</span>}</>}
                  {r.kind === 'text' && <span class="byf-drop-l">Films that feel “{typed}”</span>}
                  {r.kind === 'genre' && <><span class="byf-drop-l">{r.g.name}</span><span class="byf-drop-s">Genre</span><span class="byf-drop-n num">{r.g.count}</span></>}
                  {r.kind === 'like' && <><span class="pl-drop-thumb"><Poster film={r.f} /></span><span class="byf-drop-l">{r.f.title}</span>{r.f.year && <span class="byf-drop-s num">{r.f.year}</span>}</>}
                </li>,
              ];
            })}
          </ul>
          <p class="pl-drop-foot faint">Titles and people filter as you type.</p>
        </div>
      )}
    </div>
  );
}

// ---------- feels like a film ----------
/** The film everything is compared with, what counts most, and "like this one, but…". `layout`: 'row' or 'column'. */
export function LikePanel({ u, layout = 'row' }) {
  const film = u.likeFilm;
  const feel = useFilmFeel(film && film.key);
  if (!film) return null;
  const sum = feel && feel !== 'error' ? feel.summary : null;
  const axes = (u.facets && u.facets.axes) || [];
  const { q } = u;
  return (
    <section class={`pl-like pl-like-${layout} panel`} aria-label={`Films that feel like ${film.title}`}>
      <a href={href('film', film.key)} class="pl-like-poster" aria-label={`Open ${film.title}`}><Poster film={film} eager /></a>
      <div class="pl-like-body">
        <span class="faint">Comparing with</span>
        <h2 class="pl-like-t">{film.title}{film.year ? <span class="faint num"> {film.year}</span> : null}</h2>
        {sum && sum.headline && <p class="byf-headline pl-like-head">{sum.headline}</p>}
        {feel === null && <p class="muted">There isn't enough written about this film to say how it feels, so its matches lean on genres and people.</p>}
        {feel === 'error' && <p class="muted">Couldn't load how this film feels just now. Its matches below are still right.</p>}
        {sum && sum.chips && sum.chips.length > 0 && (
          <div class="chips pl-like-chips">{sum.chips.slice(0, 6).map((c, i) => <Badge key={i} title={`From ${voiceLabel(c.voice)}`}>{c.label}</Badge>)}</div>
        )}
      </div>
      <div class="pl-like-ctl">
        <div class="byf-ctl">
          <span class="byf-ctl-l">What should count most</span>
          <Segmented label="What should count most" value={q.likeEmphasis} options={EMPHASIS.map(e => ({ value: e.value, label: e.label }))} onChange={v => u.set({ likeEmphasis: v, likeShift: null })} />
        </div>
        <div class="byf-ctl">
          <span class="byf-ctl-l">Like this one, but…</span>
          <div class="chips">
            {axes.map(a => [[-1, a.low], [1, a.high]].map(([dir, label]) => {
              const on = q.likeShift && q.likeShift.axis === a.id && q.likeShift.dir === dir;
              return <Chip key={a.id + dir} pressed={!!on} onClick={() => u.set({ likeShift: on ? null : { axis: a.id, dir } })}>{label}</Chip>;
            }))}
          </div>
        </div>
      </div>
      <button type="button" class="icon-btn pl-like-x" aria-label="Stop comparing with this film" title="Stop comparing" onClick={() => u.set({ like: null, likeShift: null })}><Icon name="close" size={16} /></button>
    </section>
  );
}

/** One quiet line when most of the closest films lean on article tags and keywords (By feel's sample of five summaries). */
export function ThinNote({ u }) {
  const keys = u.ranked ? u.results.slice(0, 5).map(r => r.film.key) : [];
  const sig = keys.join('|');
  const [thin, setThin] = useState(false);
  useEffect(() => {
    if (!keys.length) { setThin(false); return; }
    let live = true;
    Promise.all(keys.map(k => call('getFeel', { key: k }).catch(() => null /* recorded by api.call; that film just isn't sampled */)))
      .then(got => live && setThin(mostlyThin(got.map(g => g && g.summary))));
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!thin || !keys.length) return null;
  return <p class="byf-note"><Icon name="tag" size={14} />Most of these matches lean on article tags and keywords, not viewer reviews. They'll get better as more reviews come in.</p>;
}

/** Heading text carried into the film page ("Why it came up under …"). */
export function headingOf(u) {
  const pills = activePills(u.q, { labels: { get: id => pillLabel(u, id) }, filmTitle: () => u.likeFilm && u.likeFilm.title }).filter(p => p.kind !== 'lib');
  return pills.length ? pills.map(p => (p.kind === 'avoid' ? 'not ' : '') + p.label).join(', ') : '';
}

// ---------- screen glue ----------
/** Everything a design needs: the merged state, view prefs, selection, counts. */
export function useScreen(link, onLinkUsed) {
  const u = useUnified(link, onLinkUsed);
  const view = useView();
  const byKey = useMemo(() => new Map(((u.lib && u.lib.films) || []).map(f => [f.key, f])), [u.lib]);
  const sel = useSelection(u.results, byKey);
  const counts = useCounts(u);
  const autoLabels = useMemo(() => Object.fromEntries(((u.lib && u.lib.autoTags) || []).map(t => [t.id, t.label])), [u.lib]);
  return { u, view, sel, counts, byKey, autoLabels };
}

/** Before the library is there: loading, or its load error with Try again (never a spinner for ever). */
export function NotReady({ u }) {
  if (u.libError) {
    return (
      <div class="screen">
        <EmptyState title="Your library didn't load" action={<button type="button" class="btn btn-primary" onClick={reloadLibrary}>Try again</button>}>Something went wrong while opening it. Your films are safe.</EmptyState>
        <DebugError error={u.libError} what="getLibrary" />
      </div>
    );
  }
  return <div class="screen"><Loading label="Opening your library…" /></div>;
}

/** The Library's own extras: the re-import reminder and the Debug panel. */
export function Extras({ u, core, design }) {
  return (
    <>
      <DebugInfo title={`Library (${design})`} rows={{ 'films in library': u.lib.films.length, 'matching now': u.results.length, ranked: String(u.ranked), 'best score': u.best ? u.best.toFixed(3) : '', 'chips counted for': u.inView ? 'films in view' : 'every film', 'feel answer': u.busy ? 'waiting' : u.error ? 'failed' : 'ready' }} />
      <ReimportReminder core={core} />
    </>
  );
}

/** The Library's bulk bar (add to list, add or remove tags), unchanged. */
export function Bulk({ u, sel, byKey }) {
  const summary = useMemo(() => summarise(byKey, sel.sel), [byKey, sel.sel]);
  const shownKeys = useMemo(() => new Set(u.results.map(r => r.film.key)), [u.results]);
  if (!sel.selecting) return null;
  let hidden = 0; for (const k of sel.sel) if (byKey.has(k) && !shownKeys.has(k)) hidden++;
  return (
    <BulkBar summary={summary} hidden={hidden} shownCount={u.results.length} allShown={u.results.length > 0 && u.results.every(r => sel.sel.has(r.film.key))}
      tagNames={u.lib.tags.map(t => t.name)} getKeys={() => [...pruneKeys(sel.live.current.sel, byKey)]}
      onSelectAll={() => sel.setSel(withKeys(sel.live.current.sel, u.results.map(r => r.film.key), true))}
      onClear={() => sel.setSel(new Set())} onWatchlistOnly={() => u.set({ status: 'watchlist' })} />
  );
}

export { Loading };
