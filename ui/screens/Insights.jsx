// Insights: what your library and diary say about your taste, in seven short tabs.
import { useMemo } from 'preact/hooks';
import { useCall, useLibrary } from '../state.js';
import { Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import Tabs from '../components/Tabs.jsx';
import { href, queryOf, useRoute } from '../router.js';
import { pluralN } from '../format.js';
import { Overview, Ratings, Taste, People, World, Habits, Watchlist } from './insights/tabs.jsx';
import './insights.css';

import DebugInfo from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';

export const TABS = [
  { id: 'overview', label: 'Overview', body: Overview },
  { id: 'ratings', label: 'Ratings', body: Ratings },
  { id: 'taste', label: 'Taste', body: Taste },
  { id: 'people', label: 'People', body: People },
  { id: 'world', label: 'World', body: World },
  { id: 'habits', label: 'Habits', body: Habits },
  { id: 'watchlist', label: 'Watchlist', body: Watchlist },
];

export default function Insights() {
  const { data: d, error, loading, reload } = useCall('getInsights', {}, [], { refreshOn: 'library' });
  const library = useLibrary();
  const lib = useMemo(() => new Map(((library && library.films) || []).map(f => [f.key, f])), [library]);
  const route = useRoute();
  const want = queryOf(route.qs).t;
  const tab = TABS.find(t => t.id === want) || TABS[0];

  if (loading && !d) return <div class="screen"><Loading /></div>;
  if (error || !d) return <div class="screen"><EmptyState title="Insights didn't load" action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Something went wrong reading your library. Try again, or reopen Matinee.</EmptyState></div>;

  const t = d.totals;
  if (!t.films && !t.entries) {
    return (
      <div class="screen">
        <div class="screen-head"><h1>Insights</h1></div>
        <EmptyState title="Nothing to chart yet">Once you've watched and rated some films, your taste shows up here. Import your Letterboxd export to get started.</EmptyState>
      </div>
    );
  }

  const since = d.firstEntryDate ? new Date(d.firstEntryDate + 'T12:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : null;
  const Body = tab.body;
  return (
    <div class="screen ins">
      <DebugInfo title="Insights" rows={{ ...dataSummary(d), 'films in library': library && library.films.length }} />
      <div class="screen-head">
        <div>
          <h1>Insights</h1>
          <p class="sub">{pluralN(t.films, 'film')} watched{since ? ` · diary since ${since}` : ''}</p>
        </div>
      </div>
      <Tabs tabs={TABS} current={tab.id} label="Insights sections" hrefFor={id => href('insights', null, id === 'overview' ? null : { t: id })} />
      <div class="ins-tab" key={tab.id}><Body d={d} lib={lib} library={library} /></div>
    </div>
  );
}
