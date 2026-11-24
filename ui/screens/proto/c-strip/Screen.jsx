// PROTOTYPE C, "Feel strip": the full-width poster wall, with feelings in front as one row of tabs; one band of chips at a time.
import { useRef } from 'preact/hooks';
import { usePref } from '../../../state.js';
import Icon from '../../../components/Icon.jsx';
import LibFilters from '../shared/LibFilters.jsx';
import { activePills } from '../shared/query.js';
import { n } from '../../../format.js';
import { useScreen, NotReady, Extras, StatusControl, StatusHelp, SortSelect, ViewControls, SelectButton, CountLine, Pills, Views, FeelGroup, UniSearch, LikePanel, ResultHeading, Results, NoResults, Bulk, ThinNote, headingOf } from '../shared/parts.jsx';
import '../../library.css';
import '../../feel.css';
import '../shared/proto.css';
import './c.css';

export const NAME = 'C. Feel strip';
export const WHY = 'Full-width posters; feelings in front as tabs, one tidy band of chips at a time.';

export default function Screen({ core, link, onLinkUsed }) {
  const { u, view, sel, counts, byKey, autoLabels } = useScreen(link, onLinkUsed);
  const [tab, setTab] = usePref('proto.c.tab', 'mood');
  const searchRef = useRef();
  if (!u.lib) return <NotReady u={u} />;
  const { q } = u;
  const chosen = new Set([...q.feel, ...q.themes, ...q.avoid]);
  const libOn = activePills({ ...q, feel: [], themes: [], avoid: [], feelText: '', like: null }).length;
  const tabs = [...u.sections.filter(g => g.items.length).map(g => ({ id: g.id, label: g.label, on: g.items.filter(it => chosen.has(it.id)).length })), { id: 'more', label: 'More filters', on: libOn }];
  const group = u.sections.find(g => g.id === tab);
  return (
    <div class="screen lib pl pl-c">
      <header class="screen-head">
        <div>
          <h1>Library</h1>
          <p class="sub num">{n(counts.watched)} watched · {n(counts.watchlist)} on your watchlist</p>
        </div>
        <div class="pl-c-search"><UniSearch u={u} inputRef={searchRef} /></div>
      </header>
      <Extras u={u} core={core} design="C" />

      <div class="lib-toolbar">
        <StatusControl u={u} counts={counts} />
        <SortSelect u={u} />
        <SelectButton sel={sel} />
        <ViewControls view={view} />
      </div>
      <StatusHelp u={u} />

      <div class="pl-c-strip">
        <div class="pl-c-tabs" role="tablist" aria-label="Filter by">
          {tabs.map(t => (
            <button type="button" role="tab" key={t.id} class="pl-c-tab" aria-selected={String(tab === t.id)} onClick={() => setTab(tab === t.id ? null : t.id)}>
              {t.label}{t.on > 0 && <span class="pl-c-on num">{t.on}</span>}
            </button>
          ))}
          {tab && <button type="button" class="icon-btn pl-c-close" aria-label="Hide the chips" title="Hide" onClick={() => setTab(null)}><Icon name="close" size={14} /></button>}
        </div>
        {tab && tab !== 'more' && group && (
          <div class="pl-c-band" role="tabpanel">
            <FeelGroup key={tab} u={u} group={group} collapsible={false} cap={24} onFindAll={() => searchRef.current && searchRef.current.focus()} />
          </div>
        )}
        {tab === 'more' && <div class="pl-c-band" role="tabpanel"><LibFilters q={q} set={u.set} data={u.lib} bare /></div>}
      </div>

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
