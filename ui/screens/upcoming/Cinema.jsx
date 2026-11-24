// "At Dendy Newtown": what is on or coming to the cinema, with library films shown as poster cards. Data: getCinema().
import { useState } from 'preact/hooks';
import { call, openExternal } from '../../api.js';
import { useCall } from '../../state.js';
import { FilmCard } from '../../components/film.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { Badge, ChipToggle, Loading } from '../../components/ui.jsx';
import { checkedText, filterGroups, refreshMessage, whenText } from './cinema.js';

function Meta({ item }) {
  return (
    <>
      <div class="upc-when">
        <span class="upc-date num">{whenText(item)}</span>
        {item.label && <> <Badge>{item.label}</Badge></>}
      </div>
      <button type="button" class="btn-link upc-row-link" onClick={() => openExternal(item.url)}>View at Dendy</button>
    </>
  );
}

function MatchedCard({ item }) {
  return (
    <div class="upc-card">
      <FilmCard film={item.film} show="score" pip />
      <Meta item={item} />
      <StatusBadge user={{ watched: item.watched, watchlist: item.onWatchlist }} />
    </div>
  );
}

function TextRow({ item }) {
  return (
    <li class="upc-row">
      <div class="upc-row-main">
        <strong class="upc-row-title">{item.title}</strong>
        {item.label && <Badge>{item.label}</Badge>}
        <span class="muted num">{whenText(item)}</span>
      </div>
      <button type="button" class="btn-link upc-row-link" onClick={() => openExternal(item.url)}>View at Dendy</button>
    </li>
  );
}

function CinemaGroup({ group }) {
  const matched = group.items.filter(it => it.film);
  const others = group.items.filter(it => !it.film);
  return (
    <section class="upc-group" aria-label={group.label}>
      <header class="upc-group-head"><h3>{group.label}</h3></header>
      {matched.length > 0 && <div class="film-grid">{matched.map(it => <MatchedCard key={it.slug} item={it} />)}</div>}
      {others.length > 0 && <ul class="upc-rows">{others.map(it => <TextRow key={it.slug} item={it} />)}</ul>}
    </section>
  );
}

export default function Cinema() {
  const { data, error, loading, reload } = useCall('getCinema', {}, [], { refreshOn: 'cinema' });
  const [libraryOnly, setLibraryOnly] = useState(false);
  const [events, setEvents] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const check = async () => {
    setBusy(true); setMsg(null);
    try { setMsg(refreshMessage(await call('refreshCinema', { force: true }))); }
    catch { setMsg(refreshMessage(null)); }
    setBusy(false);
    reload();
  };
  const button = (primary = false, label = 'Check again') => (
    <button type="button" class={`btn btn-small${primary ? ' btn-primary' : ''}`} disabled={busy} onClick={check}>{busy ? 'Checking…' : label}</button>
  );

  const name = (data && data.cinema && data.cinema.name) || 'Dendy Newtown';
  let body;
  if (loading && !data) body = <Loading label="Loading…" />;
  else if (!data) {
    body = (
      <div class="upc-never">
        <p class="muted">{error ? `Matinee couldn't load the ${name} list just now.` : `Matinee hasn't checked ${name} yet.`}</p>
        {button(true, 'Check now')}
      </div>
    );
  } else {
    const groups = filterGroups(data.groups, { libraryOnly, events });
    body = (
      <>
        <div class="upc-filters" role="group" aria-label="Show">
          <ChipToggle on={!libraryOnly} onClick={() => setLibraryOnly(false)}>All films</ChipToggle>
          <ChipToggle on={libraryOnly} onClick={() => setLibraryOnly(true)}>Films in my library</ChipToggle>
          <ChipToggle on={events} onClick={() => setEvents(!events)}>Include events</ChipToggle>
        </div>
        {groups.length === 0 && (
          <p class="muted">{libraryOnly ? `None of your library films are listed at ${name} right now. Switch to All films to see everything.` : `Nothing is listed at ${name} right now.`}</p>
        )}
        {groups.map(g => <CinemaGroup key={g.id} group={g} />)}
        <div class="upc-foot">
          <span class="faint">{checkedText(data.fetchedAt)}</span>
          {button()}
        </div>
      </>
    );
  }

  return (
    <section class="upc-cinema" aria-labelledby="upc-cinema-h">
      <header class="upc-cinema-head">
        <h2 id="upc-cinema-h">At {name}</h2>
      </header>
      {body}
      {msg && <p class="upc-msg" role="status">{msg}</p>}
      <p class="faint upc-note">Each film shows its first session date. Tap “View at Dendy” for times and booking.</p>
    </section>
  );
}
