// PROTOTYPE D, "Ask one box": one wide box for everything (titles, people, feelings, a film to compare with), what you asked
// sits inside it as pills, and ranked results read as Very close / Close / Some overlap sections.
import { useRef, useMemo } from 'preact/hooks';
import { useRestoredState } from '../../../state.js';
import { Chip } from '../../../components/ui.jsx';
import Icon from '../../../components/Icon.jsx';
import LibFilters from '../shared/LibFilters.jsx';
import { include } from '../shared/query.js';
import { n } from '../../../format.js';
import { useScreen, NotReady, Extras, StatusControl, StatusHelp, SortSelect, ViewControls, SelectButton, CountLine, Pills, Views, FeelGroup, UniSearch, LikePanel, ResultHeading, Results, NoResults, Bulk, ThinNote, headingOf } from '../shared/parts.jsx';
import '../../library.css';
import '../../feel.css';
import '../shared/proto.css';
import './d.css';

export const NAME = 'D. Ask one box';
export const WHY = 'One box for everything, pills inside it; results grouped by how close they are.';

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [browse, setBrowse] = useRestoredState('proto.d.browse', false);
  const [more, setMore] = useRestoredState('proto.d.more', false);
  const searchRef = useRef();
  // A few starting points, one from each kind of feeling (mood, tone, pace, craft, impact, theme), skipping the most
  // common word of each (generic words like Moving over-fire) for the next one down.
  const starters = useMemo(() => ['mood', 'tone', 'pace', 'craft', 'impact', 'theme'].map(id => {
    const g = u.sections.find(x => x.id === id);
    const items = g ? [...g.items].sort((a, b) => b.count - a.count) : [];
    return items[1] || items[0];
  }).filter(Boolean), [u.sections]);
  if (!u.lib) return <NotReady u={u} />;
  const { q } = u;
  const chosen = new Set([...q.feel, ...q.themes, ...q.avoid]);
  return (
    <div class="screen lib pl pl-d">
      <header class="pl-d-head">
        <h1>Library</h1>
        <p class="sub num">{n(counts.watched)} watched · {n(counts.watchlist)} on your watchlist</p>
      </header>
      <Extras u={u} core={core} design="D" />

      <div class="pl-d-ask" onClick={e => { if (e.target === e.currentTarget && searchRef.current) searchRef.current.focus(); }}>
        <Pills u={u} autoLabels={autoLabels} />
        <UniSearch u={u} inputRef={searchRef} placeholder={chosen.size || q.like ? 'Add more…' : 'Search your films, or describe how you want one to feel'} />
      </div>
      {!u.feelOn && starters.length > 0 && (
        <div class="pl-d-try">
          <span class="faint">Try</span>
          {starters.map(it => <Chip key={it.id} onClick={() => u.setQ(x => include(x, it.kind, it.id))}>{it.label}</Chip>)}
          <button type="button" class="btn btn-link" onClick={() => setBrowse(!browse)}>{browse ? 'Hide feelings' : 'Browse all feelings'}</button>
        </div>
      )}
      {u.feelOn && <div class="pl-d-try"><button type="button" class="btn btn-link" onClick={() => setBrowse(!browse)}>{browse ? 'Hide feelings' : 'Browse all feelings'}</button></div>}
      {browse && (
        <div class="panel pl-d-browse">
          {u.sections.map((g, i) => <FeelGroup key={g.id} u={u} group={g} open={i < 2} cap={14} onFindAll={() => searchRef.current && searchRef.current.focus()} />)}
        </div>
      )}

      <div class="lib-toolbar">
        <StatusControl u={u} counts={counts} />
        <SortSelect u={u} />
        <button type="button" class="btn" aria-expanded={String(more)} onClick={() => setMore(!more)}><Icon name="filter" />More filters</button>
        <SelectButton sel={sel} />
        <ViewControls view={view} />
      </div>
      <StatusHelp u={u} />
      {more && <LibFilters q={q} set={u.set} data={u.lib} />}
      <Views u={u} />
      <LikePanel u={u} layout="row" />
      <ThinNote u={u} />
      <CountLine u={u} core={core} />
      <ResultHeading u={u} />
      <Results u={u} view={view} sel={sel} groups reason heading={headingOf(u)} emptyAction={<NoResults u={u} />} />
      <Bulk u={u} sel={sel} byKey={byKey} />
    </div>
  );
}
