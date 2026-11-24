// Upcoming: films in your library opening in cinemas in the chosen country (Settings → Letterboxd → Country) over the next six months.
// Data: getUpcoming(). The Dendy Newtown tab only exists with the friend code (settings.dendy); without it Dendy is never named.
import './upcoming.css';
import { useState } from 'preact/hooks';
import { useCall, useCoreSelect } from '../state.js';
import { countryInSentence } from './welcome/countries.js';
import { href, parse, queryOf } from '../router.js';
import { EmptyState } from '../components/film.jsx';
import { Loading, Segmented } from '../components/ui.jsx';
import Group from './upcoming/Group.jsx';
import Cinema from './upcoming/Cinema.jsx';

import DebugInfo, { DebugError } from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';
const ALL_TABS = [{ value: 'opening', label: 'Opening soon' }, { value: 'dendy', label: 'Dendy Newtown' }];
const TAB_KEY = 'matinee.upcomingTab';
const tabsFor = dendy => ALL_TABS.filter(t => dendy || t.value !== 'dendy');
const validTab = (v, tabs) => tabs.some(t => t.value === v) ? v : null;
const readTab = tabs => { try { return validTab(localStorage.getItem(TAB_KEY), tabs); } catch { return null; } };

export default function Upcoming({ core }) {
  const dendy = !!(core && core.settings && core.settings.dendy);
  const region = useCoreSelect(s => (s.settings && s.settings.region) || 'AU') || 'AU';
  const country = countryInSentence(region) || 'your country';
  const TABS = tabsFor(dendy);
  const [picked, setTab] = useState(() => validTab(queryOf(parse().qs).tab, ALL_TABS) || readTab(ALL_TABS) || 'opening');
  const tab = validTab(picked, TABS) || 'opening';
  const pickTab = v => {
    setTab(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* private mode */ }
    history.replaceState(null, '', href('upcoming', null, { tab: v }));
  };
  const { data, error, loading, reload } = useCall('getUpcoming', {}, [region], { refreshOn: 'library' });
  const noDates = data && region !== 'AU' && !data.hasTmdb;

  let body;
  if (error && !data) {
    body = <EmptyState title="We couldn't load the cinema dates just now." action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Nothing is wrong with your library. Give it another go in a moment.</EmptyState>;
  } else if (!data || (loading && !data)) {
    body = <Loading label="Checking cinema dates…" />;
  } else {
    const empty = !data.groups.length;
    body = (
      <>
        {data.justOpened.length > 0 && <Group title="Just opened" subtitle="Opened in the last three weeks" items={data.justOpened} />}
        {data.groups.map(g => <Group key={g.id} title={g.label} items={g.items} />)}
        {empty && (
          <EmptyState title="Nothing coming up yet" action={<a class="btn btn-primary" href={href('library')}>Go to your library</a>}>
            {noDates
              ? <>Cinema dates for {country} come from TMDB. Add a free TMDB key in Settings → Sources and they fill in as Matinee looks up your films.</>
              : <>Nothing on your watchlist is opening in {country} in the next six months. Dates fill in as Matinee looks up your films, so check back after your next refresh.</>}
          </EmptyState>
        )}
      </>
    );
  }

  return (
    <div class="screen upc">
      <header class="screen-head">
        <div><h1>Upcoming</h1>
        <p class="muted">Films from your library opening in cinemas in {country}</p></div>
      </header>
      {TABS.length > 1 && <Segmented label="Upcoming" value={tab} options={TABS} onChange={pickTab} />}
      {tab === 'opening' ? (
        <>
          <DebugInfo title="Upcoming" rows={{ ...dataSummary(data), loading, 'load error': error && error.message }} />
          {body}
          <p class="faint upc-note">{region !== 'AU' ? 'Dates come from TMDB' : data && data.hasTmdb ? 'Dates come from Letterboxd and TMDB' : 'Dates come from Letterboxd'}, and only films already in your library are shown for now.</p>
        </>
      ) : <Cinema />}
    </div>
  );
}
