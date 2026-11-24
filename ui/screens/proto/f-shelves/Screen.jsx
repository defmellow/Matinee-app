// PROTOTYPE F: design E's sentence and picker, plus shelves. With nothing asked, the films in view are laid out first as
// shelves of the feelings most common among them, so you can browse by feel without choosing a word. A shelf's heading adds it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Icon from '../../../components/Icon.jsx';
import { n } from '../../../format.js';
import { useFetchNow } from '../../../components/fetchnow.js';
import { include, likeFilm, narrowed } from '../shared/query.js';
import { useScreen, NotReady, Extras, UniSearch, NoResults, Bulk, Views, ThinNote, Fetching, headingOf } from '../shared/parts.jsx';
import { Sentence, Picker, Wall, ViewMenu, ECard, useBriefs } from '../e-sentence/Screen.jsx';
import '../../library.css';
import '../shared/proto.css';
import '../e-sentence/e.css';
import './f.css';

export const NAME = 'F. Shelves of feelings';
export const WHY = 'E, plus shelves: before anything is asked, the films in view are grouped by the feelings most common among them.';

const SHELVES = 8, PER_SHELF = 18;

/** The feelings most common among the films in view, each with its films (in the current order). */
// Shelves are named by how a film feels (mood, tone, impact, pace), not by craft words such as "Visually striking".
const SHELF_FACETS = new Set(['mood', 'tone', 'pace', 'impact']);

function shelvesOf(results, briefs, ids) {
  const by = new Map();
  results.forEach((r, order) => {
    const b = briefs[r.film.key];
    if (!b) return;
    b.words.forEach((w, at) => {
      if (!by.has(w)) by.set(w, []);
      by.get(w).push({ r, at, order });
    });
  });
  // On a shelf, films where the feeling leads come first, then the current order.
  for (const [w, xs] of by) by.set(w, xs.sort((a, b) => a.at - b.at || a.order - b.order).map(x => x.r));
  const cap = Math.max(8, results.length * 0.45); // a word on nearly every film says nothing about this shelf
  return [...by.entries()].filter(([w, rs]) => rs.length >= 4 && rs.length <= cap && ids.has(w))
    .sort((a, b) => b[1].length - a[1].length).slice(0, SHELVES).map(([w, rs]) => ({ word: w, id: ids.get(w).id, count: ids.get(w).count, items: rs }));
}

function Shelf({ s, u, briefs, view, sel, onLike }) {
  const ref = useRef();
  useFetchNow(ref, [s.items]);
  return (
    <section class="pf-shelf">
      <h2 class="pf-shelf-h">
        <button type="button" class="pf-shelf-t" title={`Show only films that feel ${s.word.toLowerCase()}`} onClick={() => u.setQ(x => include(x, 'descriptors', s.id))}>
          {s.word}<span class="pe-run-n faint num">{n(Math.max(s.count || 0, s.items.length))}</span><Icon name="chevron" size={16} />
        </button>
      </h2>
      <div ref={ref} class="pf-row">
        {s.items.slice(0, PER_SHELF).map((it, i) => (
          <div class="pf-cell" key={it.film.key}>
            <ECard item={it} brief={briefs[it.film.key]} asked={new Set([s.word.toLowerCase()])} tierShown={false} showStatus={u.q.status === 'all' || u.q.status === 'listed' || u.q.status === 'liked'}
              pip={view.pip} eager={i < 8} selecting={sel.selecting} selected={sel.sel.has(it.film.key)} onPick={sel.pick} onLike={onLike} heading="h3" />
          </div>
        ))}
        {s.items.length > PER_SHELF && (
          <button type="button" class="pf-more" onClick={() => u.setQ(x => include(x, 'descriptors', s.id))}>All {n(Math.max(s.count || 0, s.items.length))}<Icon name="chevron" size={16} /></button>
        )}
      </div>
    </section>
  );
}

export function Shelves({ u, view, sel }) {
  const all = useBriefs(u.results.map(r => r.film.key));
  const ids = useMemo(() => {
    const m = new Map();
    for (const g of u.sections) if (SHELF_FACETS.has(g.id)) for (const it of g.items) if (!m.has(it.label)) m.set(it.label, { id: it.id, count: it.count });
    return m;
  }, [u.sections]);
  const shelves = useMemo(() => shelvesOf(u.results, all, ids), [u.results, all, ids]);
  const onLike = key => { u.setQ(x => likeFilm(x, key)); const m = document.querySelector('main'); if (m) m.scrollTop = 0; window.scrollTo({ top: 0 }); };
  if (!shelves.length) return null;
  return <div class="pf-shelves">{shelves.map(s => <Shelf key={s.word} s={s} u={u} briefs={all} view={view} sel={sel} onLike={onLike} />)}</div>;
}

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!adding) return;
    const c = e => { if (!e.target.closest('[data-pop="picker"], .pe-add')) setAdding(false); };
    const k = e => { if (e.key === 'Escape' && !e.defaultPrevented) setAdding(false); };
    addEventListener('pointerdown', c, true); addEventListener('keydown', k);
    return () => { removeEventListener('pointerdown', c, true); removeEventListener('keydown', k); };
  }, [adding]);
  if (!u.lib) return <NotReady u={u} />;
  // Shelves are for browsing: only in the default order with nothing searched. Any chosen order shows the plain wall.
  const shelving = !u.feelOn && !u.q.text.trim() && !u.q.sort && view.mode !== 'list' && u.results.length >= 12;
  return (
    <div class="screen lib pl pe pf">
      <header class="pe-head">
        <h1>Library</h1>
        <div class="pe-search"><UniSearch u={u} placeholder="Search titles and people, or describe a feeling" /></div>
      </header>
      <Extras u={u} core={core} design="F" />
      <div class="pe-bar">
        <Sentence u={u} autoLabels={autoLabels} counts={counts} adding={adding} onAdd={() => setAdding(a => !a)} />
        <div class="pe-tools">
          {narrowed(u.q) && <span class="pe-save"><Views u={u} onlySave /></span>}
          <button type="button" class="btn btn-small" aria-pressed={String(sel.selecting)} onClick={() => (sel.selecting ? sel.leave() : sel.setSelecting(true))}><Icon name={sel.selecting ? 'close' : 'check'} size={14} />{sel.selecting ? 'Done' : 'Select'}</button>
          <ViewMenu view={view} />
        </div>
        {adding && <Picker u={u} onClose={() => setAdding(false)} />}
      </div>
      <Fetching u={u} core={core} />
      {(u.lib.views || []).length > 0 && <div class="pe-views"><Views u={u} noSave /></div>}
      <ThinNote u={u} />
      {u.error && u.results.length > 0 && <p class="pl-fail">Couldn't match feelings just now, so these are from before. <button type="button" class="btn btn-small" onClick={u.retry}>Try again</button></p>}
      {shelving && <Shelves u={u} view={view} sel={sel} />}
      {shelving && <h2 class="pf-all-h">All of them<span class="pe-run-n faint num">{n(u.results.length)}</span></h2>}
      {!u.results.length && !u.busy ? <NoResults u={u} /> : <Wall u={u} view={view} sel={sel} heading={headingOf(u)} />}
      <Bulk u={u} sel={sel} byKey={byKey} />
    </div>
  );
}
