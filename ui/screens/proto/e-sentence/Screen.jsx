// PROTOTYPE E, "In plain words": one calm line says what you're looking at, in words you can click; one picker holds every
// feeling and filter; posters start straight under it, and each card says how its film feels.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';
import { call } from '../../../api.js';
import { href } from '../../../router.js';
import { usePref, useRestoredState } from '../../../state.js';
import { Poster, Stars, MatineePip } from '../../../components/film.jsx';
import { Chip } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import StatusBadge from '../../../components/StatusBadge.jsx';
import PickCard from '../../library/PickCard.jsx';
import LibFilters, { filmSections, RatingRange, ratingText, SCORE_STEPS } from '../shared/LibFilters.jsx';
import RuntimeSlider from '../../../components/RuntimeSlider.jsx';
import MatchList from '../shared/MatchList.jsx';
import { useFetchNow } from '../../../components/fetchnow.js';
import { STATUS_OPTIONS, SORT_OPTIONS, statusCounts } from '../../library/model.js';
import { EMPHASIS, matchTitle } from '../../feel/model.js';
import { n } from '../../../format.js';
import { include, leaveOut, likeFilm, clearAll, sortOf, dirOf, narrowed, stateOf } from '../shared/query.js';
import { useScreen, NotReady, Extras, UniSearch, NoResults, Bulk, Views, FeelChip, CycleChip, cycleQ, ThinNote, Fetching, headingOf, PAGE, SIZES } from '../shared/parts.jsx';
import { sentenceOf, pillsOf, STATUS_PHRASE, sortPhrase } from './sentence.js';
import { lessMotion } from '../../../motion.js';
import { useFeelWords, useFilmFeel } from '../shared/useUnified.js';
import '../../library.css';
import '../../feel.css';
import '../shared/proto.css';
import './e.css';

export const NAME = 'E. In plain words';
export const WHY = 'One line says what you are looking at, in words you can click; one picker holds every feeling and filter.';

/** The liked film's own feel, said once at the top of its menu (what By feel's film panel showed). */
function LikeHead({ k }) {
  const d = useFilmFeel(k);
  if (d === undefined) return <span class="pe-likehead faint">Reading how it feels…</span>;
  const head = d && d !== 'error' && d.summary && d.summary.headline;
  if (!head) return null; // nothing written about it yet, or the call failed (recorded by api.call)
  return <span class="pe-likehead">{head}</span>;
}

// ---------- small popover ----------
export function usePop() {
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!open) return;
    const c = e => { if (!e.target.closest('[data-pop="' + open + '"]')) setOpen(null); };
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); } };
    addEventListener('pointerdown', c, true); addEventListener('keydown', k);
    return () => { removeEventListener('pointerdown', c, true); removeEventListener('keydown', k); };
  }, [open]);
  return [open, setOpen];
}

// ---------- feel lines for cards ----------
export function useBriefs(keys) {
  const [briefs, setBriefs] = useState({});
  const sig = keys.join('|');
  useEffect(() => {
    const want = keys.filter(k => !(k in briefs));
    if (!want.length) return;
    let live = true;
    call('getFeelBriefs', { keys: want }).then(r => live && setBriefs(b => { const nb = { ...b }; for (const k of want) nb[k] = (r && r[k]) || null; return nb; }), () => {}); // recorded by api.call
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return briefs;
}

// ---------- the sentence ----------
function Token({ item, open, setOpen, children, removable = true, onRemove, thumb }) {
  const id = item.key;
  return (
    <span class="pe-tok-wrap" data-pop={id}>
      <button type="button" class={`pe-tok pe-tok-${item.kind}`} aria-haspopup="menu" aria-expanded={String(open === id)} onClick={() => setOpen(open === id ? null : id)}>
        {thumb}{item.kind === 'avoid' ? item.text : item.text}
        <Icon name="chevron" size={12} class="pe-tok-chev" />
      </button>
      {removable && <button type="button" class="pe-tok-x" aria-label={`Remove ${item.text}`} title="Remove" onClick={onRemove}><Icon name="close" size={11} /></button>}
      {open === id && <span class="pe-menu" role="menu">{children}</span>}
    </span>
  );
}

function MenuItem({ on, onClick, children, note }) {
  return <button type="button" role="menuitemradio" aria-checked={on == null ? undefined : String(!!on)} class={`pe-mi${on ? ' is-on' : ''}`} onClick={onClick}><span>{children}</span>{note != null && <span class="faint num">{note}</span>}</button>;
}

export function Sentence({ u, autoLabels, counts, onAdd, adding, pillCount = 0 }) {
  const [open, setOpen] = usePop();
  const parts = sentenceOf(u, autoLabels, { compact: true });
  const { q } = u;
  const sort = sortOf(q), dir = dirOf(q);
  const axes = (u.facets && u.facets.axes) || [];
  const close = () => setOpen(null);
  const understood = useFeelWords(q.feelText).map(w => (u.labels.get(w.id) || '').toLowerCase()).filter(Boolean);
  return (
    <p class="pe-sentence">
      {parts.map((p, pi) => (
        <span key={pi} class="pe-part">
          {p.lead && <span class="pe-lead">{p.lead}</span>}
          {p.items.map((it, i) => {
            const sep = i > 0 ? (i === p.items.length - 1 ? (p.lead === 'but not' ? ' or ' : ' and ') : ', ') : null;
            let menu = null, removable = true, thumb = null;
            if (it.kind === 'status') {
              removable = false;
              menu = STATUS_OPTIONS.map(([v]) => <MenuItem key={v} on={q.status === v} note={counts[v]} onClick={() => { u.set({ status: v }); close(); }}>{STATUS_PHRASE[v]}</MenuItem>);
            } else if (it.kind === 'like') {
              thumb = u.likeFilm ? <span class="pe-thumb"><Poster film={u.likeFilm} /></span> : null;
              menu = (
                <>
                  <LikeHead k={q.like} />
                  <span class="pe-mh">What should count most</span>
                  {EMPHASIS.map(e => <MenuItem key={e.value} on={q.likeEmphasis === e.value && !q.likeShift} onClick={() => { u.set({ likeEmphasis: e.value, likeShift: null }); close(); }}>{e.label}</MenuItem>)}
                  <span class="pe-mh">Like it, but…</span>
                  <span class="pe-mgrid">
                    {axes.map(a => [[-1, a.low], [1, a.high]].map(([d, label]) => {
                      const on = q.likeShift && q.likeShift.axis === a.id && q.likeShift.dir === d;
                      return <MenuItem key={a.id + d} on={on} onClick={() => { u.set({ likeShift: on ? null : { axis: a.id, dir: d } }); close(); }}>{label.toLowerCase()}</MenuItem>;
                    }))}
                  </span>
                  <a class="pe-mi" href={href('film', q.like)}><span>Open the film</span></a>
                </>
              );
            } else if (it.kind === 'avoid') {
              menu = <><MenuItem onClick={() => { u.setQ(x => include(x, u.labelsKind(it.id), it.id)); close(); }}>Look for it instead</MenuItem><MenuItem onClick={() => { u.setQ(it.patch); close(); }}>Remove</MenuItem></>;
            } else if (it.id) {
              menu = <><MenuItem onClick={() => { u.setQ(x => leaveOut(x, it.id)); close(); }}>Leave it out instead</MenuItem><MenuItem onClick={() => { u.setQ(it.patch); close(); }}>Remove</MenuItem></>;
            } else {
              menu = <MenuItem onClick={() => { u.setQ(it.patch); close(); }}>Remove</MenuItem>;
            }
            return [sep && <span key={'s' + i} class="pe-lead">{sep}</span>,
              <Token key={it.key} item={it} open={open} setOpen={setOpen} removable={removable} thumb={thumb} onRemove={() => u.setQ(it.patch)}>{menu}</Token>,
              it.kind === 'feelText' && understood.length > 0 && <span key="und" class="pe-und faint" title="The feelings Matinee read in what you typed">({understood.slice(0, 4).join(', ')})</span>];
          })}
          {p.lead === 'like' && q.likeShift && (() => {
            const a = axes.find(x => x.id === q.likeShift.axis);
            if (!a) return null;
            return [<span key="but" class="pe-lead">but</span>,
              <Token key="shift" item={{ key: 'shift', kind: 'shift', text: (q.likeShift.dir < 0 ? a.low : a.high).toLowerCase() }} open={open} setOpen={setOpen} removable onRemove={() => u.set({ likeShift: null })}>
                <span class="pe-mgrid">
                  {axes.map(x => [[-1, x.low], [1, x.high]].map(([d, label]) => {
                    const on = q.likeShift.axis === x.id && q.likeShift.dir === d;
                    return <MenuItem key={x.id + d} on={on} onClick={() => { u.set({ likeShift: { axis: x.id, dir: d } }); close(); }}>{label.toLowerCase()}</MenuItem>;
                  }))}
                </span>
                <MenuItem onClick={() => { u.set({ likeShift: null }); close(); }}>Just like it</MenuItem>
              </Token>];
          })()}
        </span>
      ))}
      <span class="pe-part">
        <span class="pe-lead">shown</span>
        <Token item={{ key: 'sort', kind: 'sort', text: sortPhrase(sort, q.status, dir) }} open={open} setOpen={setOpen} removable={false}>
          {(u.ranked ? [['match']] : []).concat(SORT_OPTIONS).map(([v]) => <MenuItem key={v} on={sort === v} onClick={() => { u.set({ sort: v, dir: null }); close(); }}>{sortPhrase(v, q.status, null)}</MenuItem>)}
          {sort !== 'match' && <MenuItem onClick={() => { u.set({ dir: dir === 'asc' ? 'desc' : 'asc' }); close(); }}>Reverse the order</MenuItem>}
        </Token>
      </span>
      <span class="pe-part pe-count num">{n(u.results.length)} {u.results.length === 1 ? 'film' : 'films'}{u.busy ? '…' : ''}</span>
      <button type="button" class="btn btn-small pe-filters" aria-expanded={String(adding)} aria-controls="pe-panel" onClick={onAdd}><Icon name="filter" size={14} />Feelings and filters{pillCount > 0 && <span class="lib-badge">{pillCount}</span>}</button>
      {narrowed(q) && <button type="button" class="pe-clear" onClick={() => u.setQ(clearAll(q))}>Start over</button>}
    </p>
  );
}

// ---------- the picker ----------
const PICKER_FEEL = ['mood', 'tone', 'pace', 'craft', 'impact'];
const PICKER_ABOUT = ['theme', 'subjects', 'kinds', 'settings'];

/**
 * The feelings and filters panel (22 Nov, after testing: the floating picker was too cramped; the old Library's
 * panel let you click six things in a row). It sits in the page and stays open until closed.
 * 23 Nov: one endless scroll through everything was far too long and the side list lost its place. Now the
 * panel shows one section at a time (How it feels / What it's about / The film), each group laid out in full one under
 * another, and a group longer than about 14 rows stops there with "Show more". The side list jumps to a group.
 */
export function Picker({ u, onClose }) {
  const [find, setFind] = useState('');
  const lex = useFeelWords(find); // core's own word matching, so "scary" finds Terrifying and "gore" finds the theme
  const pane = useRef();
  const [at, setAt] = useRestoredState('proto.e.at', PICKER_FEEL[0]);
  const groups = u.allSections; // library-wide, so nothing moves under the pointer as the view narrows
  const by = id => groups.find(g => g.id === id && g.items.length);
  const film = filmSections(u.q, u.lib);
  const term = find.trim().toLowerCase();
  const lexIds = new Set(lex.map(w => w.id));
  const found = term.length >= 2 ? groups.map(g => ({ ...g, items: g.items.filter(it => it.label.toLowerCase().includes(term) || lexIds.has(it.id)).slice(0, 40) })).filter(g => g.items.length) : null;
  const BUCKETS = [
    { id: 'feel', label: 'How it feels', items: PICKER_FEEL.filter(by).map(id => ({ id, kind: 'feel' })) },
    { id: 'about', label: "What it's about", items: PICKER_ABOUT.filter(by).map(id => ({ id, kind: 'feel' })) },
    { id: 'film', label: 'The film', items: film.map(x => ({ id: 'film:' + x.id, kind: 'film', only: x.id, label: x.label, on: x.on })) },
  ].filter(b => b.items.length);
  const bucketOf = id => (BUCKETS.find(b => b.items.some(x => x.id === id)) || BUCKETS[0]);
  const bucket = bucketOf(at);
  const pinned = useRef(null); // the group just jumped to: the side list keeps it lit while the pane scrolls there
  const jump = id => {
    setFind(''); setAt(id); pinned.current = id;
    requestAnimationFrame(() => {
      const el = pane.current && pane.current.querySelector(`[data-sec="${id}"]`);
      if (!el) return;
      const first = bucketOf(id).items[0].id === id;
      pane.current.scrollTo({ top: first ? 0 : el.offsetTop - 4, behavior: lessMotion() ? 'auto' : 'smooth' });
    });
  };
  // Which group the side list lights while the user scrolls: the last one whose heading has reached the top. At the very end of
  // the pane the last groups can never reach the top, so then it's the lowest group whose heading is on screen.
  const onScroll = () => {
    const el = pane.current; if (!el || found || pinned.current) return;
    const secs = [...el.querySelectorAll('[data-sec]')];
    if (!secs.length) return;
    let cur = secs[0].dataset.sec;
    for (const sec of secs) { if (sec.offsetTop - 24 <= el.scrollTop) cur = sec.dataset.sec; else break; }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      const onScreen = secs.filter(sec => sec.offsetTop < el.scrollTop + el.clientHeight - 40);
      if (onScreen.length) cur = onScreen[onScreen.length - 1].dataset.sec;
    }
    if (cur !== at) setAt(cur);
  };
  const unpin = () => { pinned.current = null; };
  const chosenIn = g => g.items.filter(it => u.q.feel.includes(it.id) || u.q.themes.includes(it.id) || u.q.avoid.includes(it.id)).length;
  const navItem = (x, b) => {
    const g = x.kind === 'feel' ? by(x.id) : null;
    const label = x.label || (g && g.label);
    const on = x.kind === 'feel' ? (g ? chosenIn(g) : 0) : x.on;
    return <button type="button" key={x.id} class="pe-nav-i" aria-current={at === x.id && !found ? 'true' : undefined} onClick={() => jump(x.id)}>{label}{on > 0 && <span class="pe-on num">{on}</span>}</button>;
  };
  return (
    <div class="pe-picker pe-panel" id="pe-panel" data-pop="picker" role="region" aria-label="Feelings and filters">
      <nav class="pe-nav">
        {BUCKETS.map(b => [<span key={'h' + b.id} class="pe-nav-h">{b.label}</span>, ...b.items.map(x => navItem(x, b))])}
      </nav>
      <div class="pe-pane">
        <div class="pe-pane-top">
          <label class="search pe-find"><Icon name="search" /><input class="input" type="search" value={find} placeholder="Find a feeling, theme or place" onInput={e => setFind(e.currentTarget.value)} aria-label="Find a feeling, theme or place" /></label>
          <button type="button" class="btn btn-primary pe-done" onClick={onClose}>Done</button>
        </div>
        <div class="pe-pane-body" ref={pane} onScroll={onScroll} onWheel={unpin} onPointerDown={unpin} onKeyDown={unpin} onScrollEnd={() => { pinned.current = null; }}>
          {found && term.length >= 3 && <p class="pe-describe"><button type="button" class="btn btn-small" onClick={() => { u.setQ(x => ({ ...x, feelText: find.trim() })); setFind(''); }}><Icon name="sparkle" size={13} />Films that feel “{find.trim()}”</button></p>}
          {found ? (found.length ? found.map(fg => (
            <section key={fg.id} class="pe-found"><h3 class="pe-h">{fg.label}</h3><div class="chips">{fg.items.map(it => <FeelChip key={it.id} u={u} item={it} />)}</div></section>
          )) : <p class="muted">No feeling, theme or place is called that. Try another word, or type it in the search box as a feeling.</p>)
            : bucket.items.map(x => (
              <section key={x.id} class="pe-sec" data-sec={x.id}>
                {x.kind === 'film' ? <LibFilters q={u.q} set={u.set} data={u.lib} layout="column" bare only={x.only} /> : <PickerGroup u={u} group={by(x.id)} />}
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}

/** Your rating, runtime and Matinee score on the top bar (easy to reach, not buried in the panel). */
function QuickFilters({ u }) {
  const [open, setOpen] = usePop();
  const { q } = u;
  const longest = q.runtimeMax ? (q.runtimeMax % 60 === 0 ? `${q.runtimeMax / 60} h` : q.runtimeMax > 60 ? `${Math.floor(q.runtimeMax / 60)} h ${q.runtimeMax % 60} min` : `${q.runtimeMax} min`) : null;
  const pop = (id, label, on, body) => (
    <span class="pe-tok-wrap" data-pop={id}>
      <button type="button" class={`btn btn-small pe-quick${on ? ' is-on' : ''}`} aria-expanded={String(open === id)} onClick={() => setOpen(open === id ? null : id)}>{label}<Icon name="chevron" size={12} class="pe-tok-chev" /></button>
      {open === id && <span class="pe-menu pe-menu-right pe-quick-pop" role="dialog" aria-label={label}>{body}</span>}
    </span>
  );
  return (
    <span class="pe-quicks">
      {pop('runtime', longest ? `Under ${longest}` : 'Any length', !!longest, <><span class="pe-mh">Runtime under</span><RuntimeSlider label="Longest runtime" value={q.runtimeMax} zero={null} onChange={v => u.set({ runtimeMax: v })} /></>)}
      {pop('rating', ratingText(q), q.ratingMin != null || q.ratingMax != null, <><span class="pe-mh">Your rating</span><RatingRange q={q} set={u.set} /></>)}
      {pop('score', q.scoreMin != null ? `Matinee ${q.scoreMin}+` : 'Any Matinee score', q.scoreMin != null, <>
        <span class="pe-mh">Matinee score at least</span>
        <MenuItem on={q.scoreMin == null} onClick={() => { u.set({ scoreMin: null }); setOpen(null); }}>Any</MenuItem>
        {SCORE_STEPS.map(m => <MenuItem key={m} on={q.scoreMin === m} onClick={() => { u.set({ scoreMin: m }); setOpen(null); }}>{m} and up</MenuItem>)}
      </>)}
    </span>
  );
}

/** Chosen feelings and filters, each with its own ×, under the bar (the old Library's row). */
function Pills({ u, autoLabels }) {
  const pills = pillsOf(u, autoLabels);
  if (!pills.length) return null;
  return (
    <div class="lib-active pe-pills">
      {pills.map(p => <Chip key={p.key} pressed class={p.out ? 'pe-pill-out' : undefined} onClick={() => u.setQ(p.patch)} title="Remove this filter">{p.out && <Icon name="ban" size={12} />}{p.label}<span class="x" aria-hidden="true">×</span></Chip>)}
      <button type="button" class="btn btn-small btn-ghost" onClick={() => u.setQ(clearAll(u.q))}>Clear all</button>
    </div>
  );
}

const ROWS = 14; // a group longer than this many rows of chips stops with "Show more" (where the wireframe drew the line, 23 Nov)
/** One group, laid out in full up to about 14 rows; "Show more" opens the rest, drawn over a few frames when it runs to thousands. */
function PickerGroup({ u, group }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(null); // how many chips fit in ROWS rows, measured after the first draw
  const [upTo, setUpTo] = useState(open ? 300 : 250);
  const box = useRef();
  const setQ = useRef(u.setQ); setQ.current = u.setQ;
  const onCycle = useCallback(item => setQ.current(q => cycleQ(q, item)), []);
  const items = group.items;
  useLayoutEffect(() => { // measure where the 15th row starts
    if (open || !box.current) return;
    const tops = [];
    const kids = box.current.children;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i].offsetTop;
      if (!tops.length || t > tops[tops.length - 1] + 2) tops.push(t);
      if (tops.length > ROWS) { setCut(i); return; }
    }
    setCut(null);
  }, [items, open]);
  useEffect(() => {
    if (!open || upTo >= items.length) return undefined;
    const id = requestAnimationFrame(() => setUpTo(x => x + 600));
    return () => cancelAnimationFrame(id);
  }, [open, upTo, items.length]);
  const lim = cut ?? 250;
  // a chip the user picked stays in sight even when it sits past the cut
  const shown = open ? items.slice(0, upTo) : items.slice(0, lim).concat(items.slice(lim).filter(it => stateOf(u.q, it.id) !== 'off'));
  return (
    <>
      <h3 class="pe-h">{group.label}</h3>
      <div class="chips" ref={box}>{shown.map(it => <CycleChip key={it.id} item={it} st={stateOf(u.q, it.id)} onCycle={onCycle} />)}</div>
      {!open && cut != null && <p class="pe-more"><button type="button" class="feel-link" onClick={() => { setOpen(true); setUpTo(Math.max(cut, 300)); }}>Show more</button></p>}
      {open && items.length > 250 && <p class="pe-more"><button type="button" class="feel-link" onClick={() => setOpen(false)}>Show fewer</button></p>}
    </>
  );
}

// ---------- cards ----------
export const ECard = memo(function ECard({ item, best, brief, asked, tierShown, showStatus, pip, eager, selecting, selected, onPick, onLike, heading }) {
  const { film: f, match } = item;
  const u0 = f.user || {};
  const also = brief ? brief.words.filter(w => !asked.has(w.toLowerCase())) : [];
  const line = match
    ? (also.length ? `also ${also.slice(0, 2).map(w => w.toLowerCase()).join(', ')}` : '')
    : also.map((w, i) => (i ? w.toLowerCase() : w)).join(', ');
  const remember = () => { if (match) try { sessionStorage.setItem('feelWhy:' + f.key, JSON.stringify({ heading, lines: match.allLines, tier: match.tier.label })); } catch { /* the film page just won't say why */ } };
  if (selecting) return <div class="pe-card"><PickCard film={f} show="rating" eager={eager} pip={pip} selected={selected} onPick={onPick} /></div>;
  return (
    <div class="pe-card">
      <a class="film-card" href={href('film', f.key)} onClick={remember} title={`${f.title}${f.year ? ` (${f.year})` : ''}`} style={{ textDecoration: 'none' }}>
        <Poster film={f} eager={eager}>
          {pip && <MatineePip score={f.score} />}
          {u0.liked && <span class="badge-heart" title="Liked"><Icon name="heart" size={13} fill="currentColor" /><span class="sr-only">Liked</span></span>}
        </Poster>
        <div class="meta"><span class="title">{f.title}</span>{f.year && <span class="faint num">{f.year}</span>}</div>
        <div class="pe-sub">
          {u0.rating != null ? <Stars rating={u0.rating} size="12px" /> : showStatus ? <StatusBadge user={u0} /> : null}
          {match && tierShown && <span class={'byf-tier byf-tier-' + match.tier.id} title={matchTitle({ score: match.score, why: match.allLines }, match.tier, best)}><Icon name="sparkle" size={11} />{match.tier.label}</span>}
          {match && match.rough && <span class="byf-rough" title="Little has been written about this film, so how it feels is a rough guess">rough guess</span>}
        </div>
        {line && <span class="pe-feel">{line}</span>}
      </a>
      <button type="button" class="pl-more" onClick={() => onLike(f.key)} aria-label={`More films that feel like ${f.title}`}>More like this</button>
    </div>
  );
});

export function Wall({ u, view, sel, heading }) {
  const { results, ranked, q } = u;
  const sort = sortOf(q), dir = dirOf(q);
  const [shown, setShown] = useRestoredState('proto.library.shown', PAGE);
  const sig = JSON.stringify([q, view.mode]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setShown(PAGE); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const sentinel = useRef();
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= results.length) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(x => x + PAGE); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results, view.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const gridRef = useRef();
  useFetchNow(gridRef, [results, shown, view.mode, sel.selecting]);
  const slice = results.slice(0, shown);
  const briefs = useBriefs(slice.map(r => r.film.key));
  const described = useFeelWords(q.feelText); // what a typed description names, so cards don't repeat it as "also"
  const asked = useMemo(() => new Set([...q.feel, ...q.themes, ...described.map(d => d.id || d)].map(id => (u.labels.get(id) || '').toLowerCase())), [q.feel, q.themes, described, u.labels]);
  const onLike = useCallback(key => { u.setQ(x => likeFilm(x, key)); window.scrollTo({ top: 0 }); const m = document.querySelector('main'); if (m) m.scrollTop = 0; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const showStatus = q.status !== 'watched' && q.status !== 'watchlist' && q.status !== 'unrated';
  const card = (it, i, tierShown) => <ECard key={it.film.key} item={it} best={u.best} brief={briefs[it.film.key]} asked={asked} tierShown={tierShown} showStatus={showStatus} pip={view.pip}
    eager={i < 12} selecting={sel.selecting} selected={sel.sel.has(it.film.key)} onPick={sel.pick} onLike={onLike} heading={heading} />;
  if (view.mode === 'list') {
    return <div ref={gridRef}><MatchList items={slice} ranked={ranked} sort={sort} dir={dir} status={q.status} asked={asked} selectMode={sel.selecting} selected={sel.sel} onPick={sel.pick}
      onSort={s => (s === 'match' ? u.set({ sort: 'match', dir: null }) : u.set(s === sort ? { sort: s, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: s, dir: null }))} />
      {shown < results.length && <div ref={sentinel} class="lib-sentinel" aria-hidden="true" />}</div>;
  }
  const style = { '--card-min': view.size + 'px' };
  // Closeness sits on each card as By feel's small badge (the big "Very close" / "Close" headings and
  // poster-sized label tiles went).
  return (
    <div ref={gridRef} data-loading={String(!!u.stale)} class="pe-runs">
      <div class="film-grid lib-grid pe-grid" style={style}>{slice.map((it, i) => card(it, i, !!it.match))}</div>
      {shown < results.length && <div ref={sentinel} class="lib-sentinel" aria-hidden="true" />}
    </div>
  );
}

/**
 * What sets the films in view apart: feelings much commoner here than across the whole library (at least 3 films).
 * Shown only when something narrows the view; each word adds that feeling.
 */
export function Leaning({ u }) {
  const words = useMemo(() => {
    if (!u.inView || !u.facets) return [];
    const total = u.lib.films.length, here = u.results.length || 1;
    const full = new Map((u.facets.descriptors || []).map(d => [d.id, d.count]));
    const chosen = new Set([...u.q.feel, ...u.q.themes, ...u.q.avoid]);
    const out = [];
    for (const g of u.sections) {
      if (!['mood', 'tone', 'pace', 'craft', 'impact'].includes(g.id)) continue;
      for (const it of g.items) {
        if (chosen.has(it.id) || it.count < 3 || !full.get(it.id)) continue;
        const lift = (it.count / here) / (full.get(it.id) / total);
        if (lift >= 1.4) out.push({ it, lift });
      }
    }
    return out.sort((a, b) => b.lift - a.lift).slice(0, 6).map(x => x.it);
  }, [u.inView, u.sections, u.facets, u.results.length, u.q]);
  if (!words.length) return null;
  return (
    <p class="pe-lean">
      <span class="faint">These lean</span>
      {words.map(it => <button type="button" key={it.id} class="pe-lean-w" title={`Add ${it.label}`} onClick={() => u.setQ(x => include(x, it.kind, it.id))}>{it.label.toLowerCase()}</button>)}
    </p>
  );
}

export function ViewMenu({ view }) {
  const [open, setOpen] = usePop();
  return (
    <span class="pe-tok-wrap" data-pop="view">
      <button type="button" class="icon-btn pe-icon" aria-label="How the films are shown" title="How the films are shown" aria-expanded={String(open === 'view')} onClick={() => setOpen(open === 'view' ? null : 'view')}><Icon name={view.mode === 'list' ? 'list' : 'grid'} size={18} /></button>
      {open === 'view' && (
        <span class="pe-menu pe-menu-right" role="menu">
          <MenuItem on={view.mode === 'grid'} onClick={() => view.setMode('grid')}>Posters</MenuItem>
          <MenuItem on={view.mode === 'list'} onClick={() => view.setMode('list')}>List with scores</MenuItem>
          {view.mode !== 'list' && <><span class="pe-mh">Poster size</span>{SIZES.map(([v, l]) => <MenuItem key={v} on={view.size === v} onClick={() => view.setSize(v)}>{l}</MenuItem>)}
            <span class="pe-mh">On the posters</span><MenuItem on={view.pip} onClick={() => view.setPip(!view.pip)}>Matinee score</MenuItem></>}
        </span>
      )}
    </span>
  );
}

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!adding) return;
    const k = e => { if (e.key === 'Escape' && !e.defaultPrevented) setAdding(false); }; // the panel stays open while the user clicks around; Escape or Done closes it
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [adding]);
  if (!u.lib) return <NotReady u={u} />;
  return (
    <div class="screen lib pl pe">
      <header class="pe-head">
        <h1>Library</h1>
        <div class="pe-search"><UniSearch u={u} plain placeholder="Search titles, people, or try dir:wenders year:1980s" /></div>
      </header>
      <Extras u={u} core={core} design="E" />
      <div class="pe-bar">
        <Sentence u={u} autoLabels={autoLabels} counts={counts} adding={adding} pillCount={pillsOf(u, autoLabels).length} onAdd={() => setAdding(a => !a)} />
        <div class="pe-tools">
          <QuickFilters u={u} />
          {narrowed(u.q) && <span class="pe-save"><Views u={u} onlySave /></span>}
          <button type="button" class="btn btn-small" aria-pressed={String(sel.selecting)} onClick={() => (sel.selecting ? sel.leave() : sel.setSelecting(true))}><Icon name={sel.selecting ? 'close' : 'check'} size={14} />{sel.selecting ? 'Done' : 'Select'}</button>
          <ViewMenu view={view} />
        </div>
      </div>
      {adding && <Picker u={u} onClose={() => setAdding(false)} />}
      <Pills u={u} autoLabels={autoLabels} />
      <Fetching u={u} core={core} />
      {(u.lib.views || []).length > 0 && <div class="pe-views"><Views u={u} noSave /></div>}
      <ThinNote u={u} />
      {u.error && u.results.length > 0 && <p class="pl-fail">Couldn't match feelings just now, so these are from before. <button type="button" class="btn btn-small" onClick={u.retry}>Try again</button></p>}
      {/* Shelves are shelved; f-shelves/Screen.jsx keeps the code for when it is decided how they should work. */}
      {!u.results.length && !u.busy ? <NoResults u={u} /> : <Wall u={u} view={view} sel={sel} heading={headingOf(u)} />}
      <Bulk u={u} sel={sel} byKey={byKey} />
    </div>
  );
}
