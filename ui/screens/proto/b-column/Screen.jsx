// PROTOTYPE B, "Side column": By feel's always-open column, holding every filter; posters on the right.
import { useRef } from 'preact/hooks';
import { useRestoredState } from '../../../state.js';
import Icon from '../../../components/Icon.jsx';
import { STATUS_OPTIONS, STATUS_TITLES, STATUS_HELP } from '../../library/model.js';
import LibFilters from '../shared/LibFilters.jsx';
import { activePills } from '../shared/query.js';
import { n } from '../../../format.js';
import { useScreen, NotReady, Extras, SortSelect, ViewControls, SelectButton, CountLine, Pills, Views, FeelGroup, UniSearch, LikePanel, ResultHeading, Results, NoResults, Bulk, ThinNote, headingOf } from '../shared/parts.jsx';
import '../../library.css';
import '../../feel.css';
import '../shared/proto.css';
import './b.css';

export const NAME = 'B. Side column';
export const WHY = 'Every filter, feelings first, in an always-open column beside the posters.';

const OPEN_FIRST = ['mood', 'tone', 'theme'];

function Section({ title, open: start, children }) {
  const [open, setOpen] = useRestoredState('proto.b.open.' + title, start);
  return (
    <section class="pl-b-sec">
      <button type="button" class="byf-group-h pl-b-sec-h" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
        <span class="byf-chev" data-open={String(open)}><Icon name="chevron" size={14} /></span><span>{title}</span>
      </button>
      {open && <div class="pl-b-sec-body">{children}</div>}
    </section>
  );
}

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [folded, setFolded] = useRestoredState('proto.b.folded', true); // narrow windows only: the column waits behind a button
  const searchRef = useRef();
  if (!u.lib) return <NotReady u={u} />;
  const { q } = u;
  const findAll = () => searchRef.current && searchRef.current.focus();
  const on = activePills(q).length;
  return (
    <div class="screen lib pl pl-b" data-folded={String(folded)}>
      <aside class="pl-b-side" aria-label="Filters">
        <h1 class="pl-b-title">Library</h1>
        <p class="sub num pl-b-sub">{n(counts.watched)} watched · {n(counts.watchlist)} on your watchlist</p>
        <UniSearch u={u} inputRef={searchRef} placeholder="Titles, people, feelings…" />
        <div class="pl-b-status" role="group" aria-label="Show">
          {STATUS_OPTIONS.map(([value, label]) => (
            <button type="button" key={value} class="pl-b-st" aria-pressed={String(q.status === value)} title={STATUS_HELP[value] || STATUS_TITLES[value]} onClick={() => u.set({ status: value })}>
              <span>{label}</span><span class="faint num">{counts[value] ? n(counts[value]) : ''}</span>
            </button>
          ))}
        </div>
        <button type="button" class="btn pl-b-fold" aria-expanded={String(!folded)} onClick={() => setFolded(!folded)}><Icon name="filter" />{folded ? 'Show feelings and filters' : 'Hide feelings and filters'}{on > 0 && <span class="lib-badge">{on}</span>}</button>
        <div class="pl-b-foldable">
        <h2 class="pl-b-h">How it feels</h2>
        {u.inView && <p class="faint pl-b-note">Counted for the films you're looking at.</p>}
        {!u.facets && <p class="muted">Loading the list of feelings…</p>}
        {u.sections.map(g => <FeelGroup key={g.id} u={u} group={g} open={OPEN_FIRST.includes(g.id)} cap={10} onFindAll={findAll} />)}
        <h2 class="pl-b-h">More filters</h2>
        <Section title="Genres, years, places and more" open={false}>
          <LibFilters q={q} set={u.set} data={u.lib} layout="column" bare />
        </Section>
        </div>
      </aside>

      <div class="pl-b-main">
        <Extras u={u} core={core} design="B" />
        <div class="lib-toolbar pl-b-bar">
          <CountLine u={u} core={core} />
          <span class="pl-b-gap" />
          <SortSelect u={u} />
          <SelectButton sel={sel} />
          <ViewControls view={view} />
        </div>
        <Pills u={u} autoLabels={autoLabels} />
        <Views u={u} />
        <LikePanel u={u} layout="row" />
        <ThinNote u={u} />
        <ResultHeading u={u} />
        <Results u={u} view={view} sel={sel} heading={headingOf(u)} emptyAction={<NoResults u={u} />} />
        <Bulk u={u} sel={sel} byKey={byKey} />
      </div>
    </div>
  );
}
