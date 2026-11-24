// The Library's two slim rows (rebuilt 23 Nov from the approved wireframe): the heading, status tabs and a search for titles
// and people; then Feelings and filters, Length, Your rating, Matinee score, Sort, posters or list, Display, Views and Select.
// Each value button opens a small popover under itself and shows its value once set.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Icon from '../../components/Icon.jsx';
import { Dialog } from '../../components/ui.jsx';
import { call } from '../../api.js';
import { toast } from '../../state.js';
import { n } from '../../format.js';
import { STATUS_TITLES, SORT_OPTIONS, sortLabel as libSortLabel } from '../library/model.js';
// Year reads "Release date" in the Library's sort.
const sortLabel = (v, status) => (v === 'year' ? 'Release date' : libSortLabel(v, status));
import { sortOf, dirOf, ranks, narrowed, normalise, DROPPED_SORTS } from '../proto/shared/query.js';
import { SIZES } from '../proto/shared/parts.jsx';
import { STATUS_TABS, ratingValue, halfStars, lengthValue, LENGTH_PICKS, lengthCount, minutes, scoreValue, dirChoices } from './model.js';

// ---------- one popover open at a time ----------
/** [openId, setOpen]: clicking elsewhere or Escape closes it (Escape stops there, so it doesn't also close the panel). */
export function usePop() {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!e.target.closest(`[data-lxpop="${open}"]`)) setOpen(null); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(null); } };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); };
  }, [open]);
  return [open, setOpen];
}

/** A bar button with its popover. `k` is the faint name ("Length"), `v` the value ("Any"); `set` turns it pink. */
function Pop({ id, pop, k, v, set = false, align = 'left', label, children, plain = false }) {
  const [open, setOpen] = pop;
  const on = open === id;
  return (
    <span class="lx-popwrap" data-lxpop={id}>
      <button type="button" class={`btn lx-bb${set ? ' is-set' : ''}${on ? ' is-open' : ''}`} aria-haspopup="dialog" aria-expanded={String(on)} onClick={() => setOpen(on ? null : id)}>
        {k && <span class="lx-bb-k">{k}</span>}{v != null && <span class="lx-bb-v">{v}</span>}{plain && label}
        <Icon name="chevron" size={11} class="lx-bb-chev" />
      </button>
      {on && <div class={`lx-pop lx-pop-${align}`} role="dialog" aria-label={label || k}>{children}</div>}
    </span>
  );
}

// ---------- row 1 ----------
export function StatusTabs({ u, counts }) {
  return (
    <div class="lx-status" role="tablist" aria-label="Which films">
      {STATUS_TABS.map(([v, label]) => (
        <button type="button" key={v} role="tab" class="lx-st" aria-selected={String(u.q.status === v)} title={STATUS_TITLES[v]} onClick={() => u.set({ status: v })}>
          {label}{counts && counts[v] != null && <span class="lx-st-n num">{n(counts[v])}</span>}
        </button>
      ))}
    </div>
  );
}

/** Titles and people only; feelings are found in the panel. Filters as you type. */
export function Search({ u }) {
  const outer = u.typed ?? u.q.text;
  const [text, setText] = useState(outer);
  useEffect(() => { if (outer !== text) setText(outer); }, [outer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (text === outer) return undefined;
    const t = setTimeout(() => u.set({ text }), 140);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label class="search lx-search">
      <Icon name="search" />
      <input class="input" data-search type="search" value={text} placeholder="Search titles and people" aria-label="Search titles and people" autocomplete="off"
        onInput={e => setText(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Escape' && text) { e.stopPropagation(); e.preventDefault(); setText(''); u.set({ text: '' }); } }} />
    </label>
  );
}

// ---------- Length ----------
const STEP = 5;
const pickFor = (min, max) => (LENGTH_PICKS.find(p => p.min === min && p.max === max) || {}).label;
function LengthBody({ u }) {
  const films = u.lib.films;
  const top = useMemo(() => { let t = 0; for (const f of films) if (f.kind !== 'tv' && f.runtime > t) t = f.runtime; return Math.max(60, Math.ceil(t / STEP) * STEP); }, [films]);
  const shortest = useMemo(() => { let s = Infinity; for (const f of films) if (f.runtime > 0 && f.runtime < s) s = f.runtime; return s === Infinity ? 0 : s; }, [films]);
  const { runtimeMin, runtimeMax } = u.q;
  const [lo, setLo] = useState(runtimeMin ?? 0), [hi, setHi] = useState(runtimeMax ?? top);
  useEffect(() => { setLo(runtimeMin ?? 0); setHi(runtimeMax ?? top); }, [runtimeMin, runtimeMax, top]);
  const commit = (a, b) => u.set({ runtimeMin: a > 0 ? a : null, runtimeMax: b < top ? b : null });
  const pct = v => `${Math.round((v / top) * 100)}%`;
  return (
    <div class="lx-len">
      <h4 class="lx-pop-h">Length</h4>
      <p class="lx-len-read"><span>{lo > 0 ? (pickFor(lo, null) || `At least ${minutes(lo)}`) : 'Shortest'}</span><span>{hi < top ? (pickFor(null, hi) || `Up to ${minutes(hi)}`) : 'Longest'}</span></p>
      <div class="lx-range" style={{ '--a': pct(lo), '--b': pct(hi) }}>
        <span class="lx-range-track" aria-hidden="true"><i /></span>
        <input type="range" min={0} max={top} step={STEP} value={lo} aria-label="Shortest length" aria-valuetext={lo > 0 ? `At least ${minutes(lo)}` : 'Any'}
          onInput={e => setLo(Math.min(Number(e.currentTarget.value), hi - STEP))} onChange={e => commit(Math.min(Number(e.currentTarget.value), hi - STEP), hi)} />
        <input type="range" min={0} max={top} step={STEP} value={hi} aria-label="Longest length" aria-valuetext={hi < top ? `Up to ${minutes(hi)}` : 'Any'}
          onInput={e => setHi(Math.max(Number(e.currentTarget.value), lo + STEP))} onChange={e => commit(lo, Math.max(Number(e.currentTarget.value), lo + STEP))} />
      </div>
      <p class="lx-len-ends faint num"><span>{minutes(shortest || STEP)}</span><span>{minutes(top)}</span></p>
      <div class="chips lx-len-picks">
        {LENGTH_PICKS.map(p => {
          const on = (runtimeMin ?? null) === p.min && (runtimeMax ?? null) === p.max;
          return (
            <button type="button" key={p.id} class="chip lx-chip" aria-pressed={String(on)} onClick={() => u.set(on ? { runtimeMin: null, runtimeMax: null } : { runtimeMin: p.min, runtimeMax: p.max })}>
              {on && <Icon name="check" size={13} />}<span class="lx-chip-l">{p.label}</span><span class="lx-chip-n num">{lengthCount(films, p.min, p.max)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Your rating: stars only (from the wireframe) ----------
const STAR = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z';
const CELL = 30; // px per star
function StarRow({ label, value, onPick }) {
  const [hover, setHover] = useState(null);
  const ref = useRef();
  const at = e => { const r = ref.current.getBoundingClientRect(); return Math.max(1, Math.min(10, Math.ceil(((e.clientX - r.left) / r.width) * 10))); };
  const shown = hover ?? value ?? 0;
  const key = e => {
    const v = value ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onPick(Math.min(10, v + 1)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onPick(v <= 1 ? null : v - 1); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); onPick(null); }
  };
  return (
    <div class="lx-stars-row">
      <span class="lx-stars-k">{label}</span>
      <div ref={ref} class="lx-stars" role="slider" tabIndex={0} aria-label={`${label}, in stars`} aria-valuemin={1} aria-valuemax={10} aria-valuenow={value ?? undefined}
        aria-valuetext={value != null ? `${halfStars(value)} stars` : 'Any'} style={{ width: `${CELL * 5}px` }}
        onPointerMove={e => setHover(at(e))} onPointerLeave={() => setHover(null)} onClick={e => { const v = at(e); onPick(v === value ? null : v); }} onKeyDown={key}>
        <span class="lx-stars-base" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <svg key={i} viewBox="0 0 24 24" width={CELL} height={CELL}><path d={STAR} /></svg>)}</span>
        <span class={`lx-stars-fill${hover != null ? ' is-hover' : ''}`} aria-hidden="true" style={{ width: `${shown * (CELL / 2)}px` }}>{[0, 1, 2, 3, 4].map(i => <svg key={i} viewBox="0 0 24 24" width={CELL} height={CELL}><path d={STAR} /></svg>)}</span>
      </div>
      <span class="lx-stars-v num">{value != null ? `${halfStars(value)}★` : 'Any'}</span>
      {value != null && <button type="button" class="icon-btn lx-stars-x" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onPick(null)}><Icon name="close" size={13} /></button>}
    </div>
  );
}
function RatingBody({ u }) {
  const { ratingMin: lo, ratingMax: hi } = u.q;
  return (
    <div class="lx-rating">
      <h4 class="lx-pop-h">Your rating</h4>
      <StarRow label="At least" value={lo} onPick={v => u.set({ ratingMin: v, ratingMax: v != null && hi != null && hi < v ? v : hi })} />
      <StarRow label="At most" value={hi} onPick={v => u.set({ ratingMax: v, ratingMin: v != null && lo != null && lo > v ? v : lo })} />
    </div>
  );
}

// ---------- Matinee score: the same layout, finer control ----------
const SCORE_PICKS = [null, 60, 70, 80];
function ScoreBody({ u }) {
  const films = u.lib.films;
  const v = u.q.scoreMin;
  const [live, setLive] = useState(v ?? 70);
  useEffect(() => { if (v != null) setLive(v); }, [v]);
  const set = x => u.set({ scoreMin: x == null ? null : Math.max(1, Math.min(99, Math.round(x))) });
  const count = useMemo(() => (v == null ? null : films.filter(f => f.score != null && f.score >= v).length), [films, v]);
  return (
    <div class="lx-score">
      <h4 class="lx-pop-h">Matinee score</h4>
      <div class="segmented lx-seg" role="group" aria-label="Matinee score at least">
        {SCORE_PICKS.map(p => <button type="button" key={String(p)} aria-pressed={String(v === p)} onClick={() => set(p)}>{p == null ? 'Any' : `${p}+`}</button>)}
      </div>
      <div class="lx-score-fine">
        <span class="lx-score-k">At least</span>
        <button type="button" class="icon-btn lx-step" aria-label="One point lower" onClick={() => set((v ?? live) - 1)}><span aria-hidden="true">−</span></button>
        <input type="range" min={30} max={95} step={1} value={live} aria-label="Matinee score at least" class="lx-score-range"
          style={{ '--p': `${Math.round(((live - 30) / 65) * 100)}%` }} data-off={String(v == null)}
          onInput={e => { const x = Number(e.currentTarget.value); setLive(x); set(x); }} />
        <button type="button" class="icon-btn lx-step" aria-label="One point higher" onClick={() => set((v ?? live) + 1)}><span aria-hidden="true">+</span></button>
        <span class="lx-score-v num">{v == null ? 'Any' : v}</span>
      </div>
      <p class="lx-pop-note faint">{v == null ? 'Every film, scored or not.' : `${n(count)} of your films score ${v} or more.`}</p>
    </div>
  );
}

// ---------- Sort ----------
function SortBody({ u, close }) {
  const { q } = u;
  const sort = sortOf(q), dir = dirOf(q);
  const base = SORT_OPTIONS.filter(([v]) => !DROPPED_SORTS.has(v)); // Your hot takes removed from the Library
  const opts = ranks(q) ? [['match', 'Best match'], ...base] : base;
  return (
    <div class="lx-sort" role="radiogroup" aria-label="Sort by">
      {opts.map(([v, l]) => (
        <button type="button" key={v} role="radio" aria-checked={String(sort === v)} class="lx-radio" onClick={() => { u.set({ sort: v, dir: null }); close(); }}>
          <span class="lx-radio-dot" aria-hidden="true" />{v === 'match' ? l : sortLabel(v, q.status)}
        </button>
      ))}
      {sort !== 'match' && (
        <div class="segmented lx-seg lx-sort-dir" role="group" aria-label="Order">
          {dirChoices(sort, q.status).map(([d, l]) => <button type="button" key={d} aria-pressed={String(dir === d)} onClick={() => u.set({ dir: d })}>{l}</button>)}
        </div>
      )}
    </div>
  );
}

// ---------- Display ----------
function Switch({ on, onChange, children }) {
  return (
    <button type="button" role="switch" aria-checked={String(!!on)} class="lx-switch-row" onClick={() => onChange(!on)}>
      <span>{children}</span><span class="lx-switch" aria-hidden="true"><i /></span>
    </button>
  );
}
function DisplayBody({ view }) {
  return (
    <div class="lx-display">
      <h4 class="lx-pop-h">Display</h4>
      {view.mode !== 'list' && <>
        <span class="lx-pop-k">Poster size</span>
        <div class="segmented lx-seg" role="group" aria-label="Poster size">
          {SIZES.map(([v, l]) => <button type="button" key={v} aria-pressed={String(view.size === v)} onClick={() => view.setSize(v)}>{l}</button>)}
        </div>
        <Switch on={view.pip} onChange={view.setPip}>Matinee score on posters</Switch>
        <Switch on={view.words} onChange={view.setWords}>How it feels under posters</Switch>
      </>}
      {view.mode === 'list' && <p class="lx-pop-note faint">The list shows every score. Switch to posters for sizes.</p>}
    </div>
  );
}

// ---------- Views (saved views) ----------
export function useSaveView(u) {
  const [naming, setNaming] = useState(false);
  const dialog = naming && <SaveDialog q={u.q} onClose={() => setNaming(false)} />;
  return [() => setNaming(true), dialog];
}
function SaveDialog({ q, onClose }) {
  const [name, setName] = useState('');
  const save = async () => {
    const nm = name.trim();
    if (!nm) return;
    try { await call('saveView', { name: nm, query: normalise(q) }); }
    catch { toast("Couldn't save that view. Try again."); return; } // recorded by api.call; the dialog stays open
    onClose(); toast(`Saved “${nm}”`);
  };
  return (
    <Dialog title="Save this view" onClose={onClose}
      footer={<><button type="button" class="btn" onClick={onClose}>Cancel</button><button type="button" class="btn btn-primary" disabled={!name.trim()} onClick={save}>Save view</button></>}>
      <label class="lx-field">
        <span class="muted">Give it a name so you can come back to it, like “Comfort films” or “Long weekend”.</span>
        <input class="input" value={name} placeholder="Name this view" maxLength={60} onInput={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
      </label>
    </Dialog>
  );
}
function ViewsBody({ u, close, onSave }) {
  const views = u.lib.views || [];
  const [undo, setUndo] = useState(null);
  const same = v => JSON.stringify(normalise(v.query)) === JSON.stringify(normalise(u.q));
  const remove = async v => {
    try { await call('deleteView', { id: v.id }); setUndo(v); }
    catch { toast("Couldn't delete that view. Try again."); } // recorded by api.call
  };
  const restore = async () => {
    try { await call('saveView', { id: undo.id, name: undo.name, query: undo.query }); setUndo(null); }
    catch { toast("Couldn't bring that view back. Try again."); } // recorded by api.call; the undo line stays
  };
  const active = views.find(same);
  return (
    <div class="lx-views">
      <h4 class="lx-pop-h">Saved views</h4>
      {views.length === 0 && !undo && <p class="lx-pop-note faint">{narrowed(u.q) ? 'Nothing saved yet.' : 'Nothing saved yet. Pick a few feelings or filters, then save them here to come back to.'}</p>}
      {views.map(v => (
        <div key={v.id} class="lx-view">
          <button type="button" class="lx-view-b" aria-current={same(v) ? 'true' : undefined} onClick={() => { u.setQ(normalise(v.query)); close(); }}>
            {same(v) && <Icon name="check" size={13} />}{v.name}
          </button>
          <button type="button" class="icon-btn lx-view-x" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => remove(v)}><Icon name="close" size={13} /></button>
        </div>
      ))}
      {undo && <p class="lx-pop-note">Removed “{undo.name}”. <button type="button" class="btn-link" onClick={restore}>Undo</button></p>}
      {narrowed(u.q) && !active && <button type="button" class="btn btn-small lx-views-save" onClick={() => { close(); onSave(); }}><Icon name="plus" size={14} />Save this view</button>}
    </div>
  );
}

// ---------- row 2 ----------
export function Bar({ u, view, sel, picked, panelOpen, onPanel, onSave }) {
  const pop = usePop();
  const close = () => pop[1](null);
  const { q } = u;
  const sort = sortOf(q), dir = dirOf(q);
  const dirs = dirChoices(sort, q.status);
  const flip = dirs.find(([d]) => d !== dir) || dirs[0];
  return (
    <div class="lx-bar">
      <div class="lx-bar-l">
        <button type="button" class={`btn lx-bb lx-fbtn${picked > 0 ? ' is-set' : ''}${panelOpen ? ' is-open' : ''}`} aria-expanded={String(panelOpen)} aria-controls="lx-panel" onClick={onPanel}>
          <Icon name="filter" size={15} />Feelings and filters{picked > 0 && <span class="lx-count-dot num">{picked}</span>}
        </button>
        <Pop id="len" pop={pop} k="Length" v={lengthValue(q)} set={q.runtimeMin != null || q.runtimeMax != null}><LengthBody u={u} /></Pop>
        <Pop id="rat" pop={pop} k="Your rating" v={ratingValue(q)} set={q.ratingMin != null || q.ratingMax != null}><RatingBody u={u} /></Pop>
        <Pop id="sco" pop={pop} k="Matinee score" v={scoreValue(q)} set={q.scoreMin != null}><ScoreBody u={u} /></Pop>
      </div>
      <div class="lx-bar-r">
        <span class="lx-sortby faint">Sort by</span>
        <Pop id="sort" pop={pop} v={sort === 'match' ? 'Best match' : sortLabel(sort, q.status)} align="right" label="Sort by"><SortBody u={u} close={close} /></Pop>
        <button type="button" class="btn lx-bb lx-sq" disabled={sort === 'match'} aria-label={sort === 'match' ? 'Best match runs closest first' : `Order: ${dirs.find(([d]) => d === dir)?.[1] || ''}. Switch to ${flip[1].toLowerCase()}`}
          title={sort === 'match' ? 'Closest first' : flip[1]} onClick={() => u.set({ dir: flip[0] })}>
          <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>
        </button>
        <div class="lx-mode" role="group" aria-label="Show as">
          <button type="button" aria-pressed={String(view.mode !== 'list')} aria-label="Posters" title="Posters" onClick={() => view.setMode('grid')}><Icon name="grid" size={16} /></button>
          <button type="button" aria-pressed={String(view.mode === 'list')} aria-label="List with scores" title="List with scores" onClick={() => view.setMode('list')}><Icon name="list" size={16} /></button>
        </div>
        <Pop id="disp" pop={pop} plain label="Display" align="right"><DisplayBody view={view} /></Pop>
        <Pop id="views" pop={pop} plain label="Views" align="right"><ViewsBody u={u} close={close} onSave={onSave} /></Pop>
        <button type="button" class={`btn lx-bb${sel.selecting ? ' is-set' : ''}`} aria-pressed={String(sel.selecting)} onClick={() => (sel.selecting ? sel.leave() : sel.setSelecting(true))}>
          {sel.selecting ? <><Icon name="close" size={14} />Done</> : 'Select'}
        </button>
      </div>
    </div>
  );
}
