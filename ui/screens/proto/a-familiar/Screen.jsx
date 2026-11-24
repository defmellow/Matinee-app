// PROTOTYPE A, "Familiar Library": today's Library, with every By feel filter folded into Filters and the search box.
import { useEffect, useRef } from 'preact/hooks';
import { useRestoredState } from '../../../state.js';
import Icon from '../../../components/Icon.jsx';
import LibFilters from '../shared/LibFilters.jsx';
import { activePills } from '../shared/query.js';
import { n } from '../../../format.js';
import { useScreen, NotReady, Extras, StatusControl, StatusHelp, SortSelect, ViewControls, SelectButton, CountLine, Pills, Views, FeelGroup, UniSearch, LikePanel, ResultHeading, Results, NoResults, Bulk, ThinNote, headingOf } from '../shared/parts.jsx';
import '../../library.css';
import '../../feel.css';
import '../shared/proto.css';
import './a.css';

export const NAME = 'A. Familiar Library';
export const WHY = "Today's Library; feelings join Filters and the search box.";

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [open, setOpen] = useRestoredState('proto.a.filtersOpen', false);
  const searchRef = useRef();
  const btnRef = useRef();
  useEffect(() => {
    if (!open) return;
    const k = e => { if (e.key === 'Escape' && !e.defaultPrevented) { setOpen(false); if (btnRef.current) btnRef.current.focus(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!u.lib) return <NotReady u={u} />;
  const { q } = u;
  const on = activePills(q).length;
  const findAll = () => searchRef.current && searchRef.current.focus();
  return (
    <div class="screen lib pl pl-a">
      <header class="screen-head">
        <div>
          <h1>Library</h1>
          <p class="sub num">{n(counts.watched)} watched · {n(counts.watchlist)} on your watchlist</p>
        </div>
        <div class="pl-a-search"><UniSearch u={u} inputRef={searchRef} /></div>
      </header>
      <Extras u={u} core={core} design="A" />

      <div class="lib-toolbar">
        <StatusControl u={u} counts={counts} />
        <SortSelect u={u} />
        <button type="button" class="btn" ref={btnRef} aria-expanded={String(open)} onClick={() => setOpen(o => !o)}>
          <Icon name="filter" />Filters{on > 0 && <span class="lib-badge">{on}</span>}
        </button>
        <SelectButton sel={sel} />
        <ViewControls view={view} />
      </div>
      <StatusHelp u={u} />

      {open && (
        <div class="lib-filters panel pl-a-panel">
          <div class="pl-a-feel">
            <h3 class="pl-a-h">How it feels{u.inView && <span class="faint pl-a-note"> · counted for the films in view</span>}</h3>
            {u.sections.map((g, i) => (
              <div key={g.id} class="pl-a-row">
                <span class="pl-a-rowh">{g.label}</span>
                <FeelGroup u={u} group={g} collapsible={false} cap={i < 5 ? 8 : 10} onFindAll={findAll} />
              </div>
            ))}
            {!u.facets && <p class="muted">Loading the list of feelings…</p>}
          </div>
          <div class="pl-a-rest">
            <h3 class="pl-a-h">Everything else</h3>
            <LibFilters q={q} set={u.set} data={u.lib} layout="column" bare />
          </div>
        </div>
      )}

      <Pills u={u} autoLabels={autoLabels} />
      <Views u={u} />
      <LikePanel u={u} layout="row" />
      <ThinNote u={u} />
      <CountLine u={u} core={core} />
      <ResultHeading u={u} />
      <Results u={u} view={view} sel={sel} heading={headingOf(u)} emptyAction={<NoResults u={u} />} />
      <Bulk u={u} sel={sel} byKey={byKey} />
    </div>
  );
}
