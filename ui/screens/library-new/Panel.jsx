// The Library's "Feelings and filters" panel (rebuilt 23 Nov from the approved wireframe and the notes on it).
// It sits beside the films and stays open while the user clicks; the films change at once. Three tabs, each scrolling on its own;
// every group heading folds, and sticks to the top while you're inside its group so a long one is one click from hidden.
// A group longer than about 14 rows of chips stops with "Show more" (14 more rows each time). Counts are library-wide, so
// nothing moves while the user clicks.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import Icon from '../../components/Icon.jsx';
import { usePref, useRestoredState } from '../../state.js';
import { lessMotion } from '../../motion.js';
import { include, leaveOut, drop, stateOf } from '../proto/shared/query.js';
import { useFeelWords } from '../proto/shared/useUnified.js';
import { cycleQ } from '../proto/shared/parts.jsx';
import { TABS, TAB_FEEL, TAB_ABOUT, TAB_FILM, filmOn, filmToggle, findIn } from './model.js';

export const ROWS = 8; // rows of chips before "Show more" (14 at first, where the wireframe drew the line; fewer since 23 Nov)
const PER_ROW = 10; // never more chips than this fit on one row of the panel: the first draw is cut back to ROWS rows

const HINT = 'Click to look for it, again to leave it out, once more to clear';

/** One chip. Feel chips cycle (look for → leave out → clear); film chips switch on and off. Redraws only when its own state changes. */
const Tag = memo(function Tag({ item, st, onPick, cycles }) {
  return (
    <button type="button" class="chip lx-chip" data-state={st} aria-pressed={String(st === 'in')} onClick={() => onPick(item)}
      title={cycles ? `${item.label}. ${HINT}` : undefined}>
      {st === 'in' && <Icon name="check" size={13} />}
      {st === 'out' && <Icon name="ban" size={13} />}
      <span class="lx-chip-l">{item.label}</span>
      {item.count != null && <span class="lx-chip-n num">{item.count}</span>}
    </button>
  );
}, (a, b) => a.st === b.st && a.onPick === b.onPick && a.item === b.item);

/** One group: a heading that folds (and sticks while you're inside the group), then up to ROWS rows of chips and "Show more". */
function Group({ group, q, onPick, closed, onFold, scroller }) {
  const [rows, setRows] = useState(ROWS);
  const [w, setW] = useState(0);
  const sec = useRef(), box = useRef();
  const items = group.items;
  const cycles = group.kind === 'feel';
  const stOf = it => (cycles ? stateOf(q, it.id) : filmOn(q, it) ? 'in' : 'off');
  // The cut: how many chips fit in `rows` rows at this width. Measured once per width, rows and list (never on a click).
  const sig = `${rows}|${w}|${items.length}`;
  const [m, setM] = useState({ sig: null, cut: 0 });
  const measuring = m.sig !== sig;
  useLayoutEffect(() => {
    if (closed || !box.current) return undefined;
    // The new width is applied on the next frame: setting it inside the observer re-laid the chips in the same frame,
    // which made the browser report "ResizeObserver loop completed with undelivered notifications".
    let f = 0;
    const ro = new ResizeObserver(es => {
      const nw = Math.round(es[0].contentRect.width);
      cancelAnimationFrame(f);
      if (nw) f = requestAnimationFrame(() => setW(nw));
    });
    ro.observe(box.current);
    return () => { cancelAnimationFrame(f); ro.disconnect(); };
  }, [closed]);
  useLayoutEffect(() => {
    if (closed || !measuring || !box.current) return;
    const kids = box.current.children;
    let tops = 0, last = -1, cut = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const t = kids[i].offsetTop;
      if (t > last + 2) { tops++; last = t; }
      if (tops > rows) { cut = i; break; }
    }
    setM({ sig, cut });
  });
  useEffect(() => { if (closed) setRows(ROWS); }, [closed]);
  let shown;
  if (measuring) shown = items.slice(0, Math.min(items.length, rows * PER_ROW));
  else {
    // a chip picked from the find box can sit past the cut: it stays in sight, after the rest
    shown = items.slice(0, m.cut);
    for (let i = m.cut; i < items.length; i++) if (stOf(items[i]) !== 'off') shown.push(items[i]);
  }
  const more = !measuring && m.cut < items.length;
  const fold = () => {
    const el = sec.current, sc = scroller.current;
    const stuck = el && sc && el.offsetTop < sc.scrollTop;
    onFold(group.id);
    // folding a group from halfway down it: bring its heading back to where it was, so the next group follows straight on
    if (stuck) requestAnimationFrame(() => { sc.scrollTop = el.offsetTop; });
  };
  return (
    <section class="lx-group" ref={sec} data-group={group.id} data-closed={closed ? '' : undefined}>
      <h3 class="lx-gh">
        <button type="button" class="lx-gh-b" aria-expanded={String(!closed)} onClick={fold}>
          <Icon name="chevron" size={14} class="lx-gh-chev" />
          <span>{group.label}</span>
        </button>
        {!closed && rows > ROWS && <button type="button" class="btn btn-ghost btn-small lx-gh-hide" onClick={fold}>Hide</button>}
      </h3>
      {!closed && (
        <>
          <div class="chips lx-chips" ref={box}>{shown.map(it => <Tag key={it.id} item={it} st={stOf(it)} onPick={onPick} cycles={cycles} />)}</div>
          {more && <button type="button" class="btn btn-small lx-more-rows" onClick={() => setRows(r => r + ROWS)}>Show more</button>}
        </>
      )}
    </section>
  );
}

/** What the find box found: the words themselves first, then matching feelings, themes, places and filters. */
function Found({ u, groups, text, onDone, words = true, scoped = null, onWiden }) {
  const lex = useFeelWords(text); // core's own word matching: "scary" finds Terrifying
  const lexIds = useMemo(() => new Set(lex.map(w => w.id || w)), [lex]);
  const found = findIn(groups, text, lexIds);
  const t = text.trim();
  const look = (h) => (h.group.kind === 'film' ? u.setQ(x => filmToggle(x, h.item)) : u.setQ(x => (stateOf(x, h.item.id) === 'in' ? drop(x, h.item.id) : include(x, h.item.kind, h.item.id))));
  const out = (h) => u.setQ(x => (stateOf(x, h.item.id) === 'out' ? drop(x, h.item.id) : leaveOut(x, h.item.id)));
  return (
    <div class="lx-found">
      {words && t.length >= 3 && (
        <div class="lx-hit lx-hit-words">
          <span class="lx-hit-l">Films that feel “{t}”</span>
          <span class="lx-hit-acts"><button type="button" class="chip lx-act" aria-pressed={String(u.q.feelText.trim() === t)} onClick={() => { u.setQ(x => ({ ...x, feelText: t })); onDone(); }}>Look for</button></span>
        </div>
      )}
      {found && found.map(sec => (
        <section key={sec.tab} class="lx-found-sec">
          <h3 class="lx-found-h">{sec.label}</h3>
          {sec.hits.map(h => {
            const st = h.group.kind === 'film' ? (filmOn(u.q, h.item) ? 'in' : 'off') : stateOf(u.q, h.item.id);
            return (
              <div key={h.group.id + h.item.id} class="lx-hit">
                <span class="lx-hit-l">{h.item.label} <span class="lx-hit-k">{h.group.label} · <span class="num">{h.item.count}</span></span></span>
                <span class="lx-hit-acts">
                  <button type="button" class="chip lx-act" aria-pressed={String(st === 'in')} onClick={() => look(h)}>{st === 'in' && <Icon name="check" size={12} />}Look for</button>
                  {h.group.kind === 'feel' && <button type="button" class="chip lx-act" data-state={st === 'out' ? 'out' : undefined} aria-pressed={String(st === 'out')} onClick={() => out(h)}>{st === 'out' && <Icon name="ban" size={12} />}Leave out</button>}
                </span>
              </div>
            );
          })}
          {sec.more > 0 && <p class="lx-found-more faint">And {sec.more} more. Type a little more to narrow it down.</p>}
        </section>
      ))}
      {found && !found.length && scoped && (
        <p class="muted lx-found-none">Nothing in {scoped} is called that.{' '}
          <button type="button" class="btn btn-ghost btn-small" onClick={onWiden}>Search every tab</button></p>
      )}
      {found && !found.length && !scoped && t.length < 3 && <p class="muted lx-found-none">Nothing is called that yet. Keep typing.</p>}
      {found && !found.length && !scoped && t.length >= 3 && <p class="muted lx-found-none">No feeling, theme, place or filter is called that. Look for films that feel “{t}” instead.</p>}
    </div>
  );
}

const FIND_HINT = { [TAB_FEEL]: 'Find a feeling', [TAB_ABOUT]: 'Find a theme, subject or place', [TAB_FILM]: 'Find a genre, country, language or tag' };
const TAB_NAME = Object.fromEntries(TABS.map(([id, label]) => [id, label]));

/** The panel. `groups`: feelGroups + filmGroups; `counts`: pickedCounts. */
export default function Panel({ u, groups, counts, onClose }) {
  const [tab, setTab] = useRestoredState('library.panel.tab', TAB_FEEL);
  const [find, setFind] = useState('');
  const searching = find.trim().length >= 2;
  // The find box searches the tab you're on; "Search every tab" looks through everything, as before.
  const [findAll, setFindAll] = usePref('library.panel.findAll', false);
  const [closedList, setClosedList] = usePref('library.panel.folded', []);
  const closed = useMemo(() => new Set(closedList), [closedList]);
  const onFold = useCallback(id => setClosedList(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id])), [setClosedList]);
  const body = useRef();
  const tops = useRef({}); // each tab keeps its own scroll place
  const setQ = useRef(u.setQ); setQ.current = u.setQ;
  const onPick = useCallback(item => setQ.current(q => (item.field ? filmToggle(q, item) : cycleQ(q, item))), []);
  const mine = groups.filter(g => g.tab === tab);
  const switchTo = t => {
    if (body.current) tops.current[tab] = body.current.scrollTop;
    if (findAll) setFind('');
    setTab(t);
  };
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = tops.current[tab] || 0; }, [tab]);
  // Collapse all / Expand all: for the groups on this tab only.
  const ids = mine.map(g => g.id);
  const anyOpen = ids.some(id => !closed.has(id)), anyClosed = ids.some(id => closed.has(id));
  const foldAll = shut => {
    setClosedList(l => (shut ? [...new Set([...l, ...ids])] : l.filter(x => !ids.includes(x))));
    if (body.current) body.current.scrollTop = 0;
  };
  // A heading stuck to the top while you scroll its group gets a hairline under it, so chips sliding under it read as
  // scrolling past an edge instead of being cut off.
  // Jump to lights the group you are in (wireframe "Filter panel top", 23 Nov).
  const [here, setHere] = useState(null);
  const markStuck = useCallback(() => {
    const sc = body.current; if (!sc) return;
    const top = sc.scrollTop;
    let cur = null;
    for (const sec of sc.querySelectorAll('.lx-group')) {
      const h = sec.firstElementChild;
      const stuck = sec.offsetTop < top && sec.offsetTop + sec.offsetHeight > top + h.offsetHeight;
      if (h.hasAttribute('data-stuck') !== stuck) h.toggleAttribute('data-stuck', stuck);
      if (cur == null || sec.offsetTop <= top + 4) cur = sec.getAttribute('data-group');
    }
    setHere(cur);
  }, []);
  // The panel sticks beside the films, but at the top of the page it starts below the top bar: size it to the space
  // really left under it, so its bottom (and the last groups) never sit off screen.
  const aside = useRef();
  useLayoutEffect(() => {
    const el = aside.current; if (!el) return;
    let f = 0;
    const fit = () => {
      cancelAnimationFrame(f);
      f = requestAnimationFrame(() => {
        if (getComputedStyle(el).position !== 'sticky') { el.style.height = ''; return; } // narrow window: the panel sits above the films at its CSS height
        const top = Math.max(0, el.getBoundingClientRect().top);
        el.style.height = `${Math.max(240, window.innerHeight - top - 16)}px`;
      });
    };
    fit();
    document.addEventListener('scroll', fit, { capture: true, passive: true });
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(f); document.removeEventListener('scroll', fit, { capture: true }); window.removeEventListener('resize', fit); };
  }, []);
  const raf = useRef(0);
  const onScroll = () => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(markStuck); };
  useEffect(() => { markStuck(); return () => cancelAnimationFrame(raf.current); }, [tab, closedList, find, markStuck]);
  const jump = id => {
    if (closed.has(id)) onFold(id);
    requestAnimationFrame(() => {
      const el = body.current && body.current.querySelector(`[data-group="${id}"]`);
      if (el) body.current.scrollTo({ top: el.offsetTop, behavior: lessMotion() ? 'auto' : 'smooth' });
    });
  };
  return (
    <aside class="lx-panel" id="lx-panel" ref={aside} aria-label="Feelings and filters">
      {/* The fixed top, laid out from the approved wireframe "Filter panel top" (23 Nov): one left edge, Done beside the
          tabs, the switch and the fold buttons on one row, then Jump to. A hairline ends it; the groups scroll under it. */}
      <div class="lx-phd">
        <div class="lx-panel-top">
          <div class="lx-tabs" role="tablist" aria-label="Feelings and filters">
            {TABS.map(([id, label]) => (
              <button type="button" key={id} role="tab" aria-selected={String(tab === id && !(findAll && searching))} class="lx-tab" onClick={() => switchTo(id)}>
                {label}{counts[id] > 0 && <span class="lx-count-dot num">{counts[id]}</span>}
              </button>
            ))}
          </div>
          <button type="button" class="btn lx-done" onClick={onClose}>Done</button>
        </div>
        <label class="search lx-find">
          <Icon name="search" />
          <input class="input" type="search" value={find} placeholder={findAll ? 'Find a feeling, theme, genre or place' : FIND_HINT[tab]} aria-label={findAll ? 'Find a feeling, theme, genre or place' : FIND_HINT[tab]}
            onInput={e => setFind(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Escape' && find) { e.stopPropagation(); e.preventDefault(); setFind(''); } }} />
        </label>
        <div class="lx-tools">
          <button type="button" role="switch" aria-checked={String(!!findAll)} class="lx-findall" onClick={() => setFindAll(!findAll)}>
            <span class="lx-switch" aria-hidden="true"><i /></span><span>Search every tab</span>
          </button>
          {/* The fold buttons and Jump to step aside while you search: they would do nothing on a list of matches. */}
          {!searching && mine.length > 1 && (
            <div class="lx-folds">
              <button type="button" class="lx-tl" disabled={!anyOpen} onClick={() => foldAll(true)}><Icon name="collapse" size={14} />Collapse all</button>
              <button type="button" class="lx-tl" disabled={!anyClosed} onClick={() => foldAll(false)}><Icon name="expand" size={14} />Expand all</button>
            </div>
          )}
        </div>
        {!searching && mine.length > 1 && (
          <nav class="lx-jump" aria-label="Jump to a group">
            <span class="lx-jump-l">Jump to</span>
            <span class="lx-jump-list">
              {mine.map(g => <button type="button" key={g.id} class="lx-jump-a" aria-current={here === g.id ? 'true' : undefined} onClick={() => jump(g.id)}>{g.label}</button>)}
            </span>
          </nav>
        )}
      </div>
      <div class="lx-panel-body" ref={body} onScroll={onScroll}>
        {searching ? (
          <Found u={u} groups={findAll ? groups : mine} text={find} onDone={() => setFind('')}
            words={findAll || tab === TAB_FEEL} scoped={findAll ? null : TAB_NAME[tab]} onWiden={() => setFindAll(true)} />
        ) : (
          <>
            {mine.map(g => <Group key={g.id} group={g} q={u.q} onPick={onPick} closed={closed.has(g.id)} onFold={onFold} scroller={body} />)}
            {!mine.length && <p class="muted lx-found-none">Nothing here yet. These fill in as Matinee reads about your films.</p>}
          </>
        )}
      </div>
    </aside>
  );
}
