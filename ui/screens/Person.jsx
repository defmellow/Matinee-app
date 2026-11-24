// Person page: their whole filmography (TMDB, else Wikidata, else Letterboxd) with what you have seen. Data: getPerson (your library part, quick)
// and getPersonFilms (the full list, slow: it comes from the network).
import './person.css';
import { useEffect, useMemo } from 'preact/hooks';
import { useCall, useLibrary, useRestoredState } from '../state.js';
import { back, href, go, useRoute, queryOf } from '../router.js';
import { Loading, Badge } from '../components/ui.jsx';
import { EmptyState, FilmCard, OutsideFilmCard, Stars } from '../components/film.jsx';
import Icon from '../components/Icon.jsx';
import Headshot from '../components/Headshot.jsx';
import { roleText } from './film/format.js';
import { n, pluralN as plural } from '../format.js';
import { DEFAULT_FILTERS, visibleStatuses, validStatus, SORT_CHOICES, groupItems, mergeFilms, applyFilters, sortItems, statusCounts, roleChoices, resolveRole, rolePhrase, roleLine } from './person/model.js';


import DebugInfo from '../debug/DebugInfo.jsx';
function Tile({ item }) {
  const line = roleLine(item.roles, roleText);
  const role = line && <Badge class="person-role" title={line}>{line}</Badge>;
  if (item.film) {
    return <div class="person-card"><FilmCard film={item.film} />{role}</div>;
  }
  return <div class="person-card"><OutsideFilmCard film={item} />{role}</div>;
}

export default function Person({ param }) {
  const lib = useLibrary();
  const mine = useCall('getPerson', { id: param, name: param }, [param], { refreshOn: 'library' });
  const all = useCall('getPersonFilms', { id: param, name: param }, [param]);
  const [f, setF] = useRestoredState('person.filters.' + param, DEFAULT_FILTERS);
  const set = patch => setF({ ...f, ...patch });
  const requested = queryOf(useRoute().qs).role || null; // the role the link came from: ?role=director, ?role=cast, or all
  const backBtn = <button type="button" class="btn btn-ghost person-back" onClick={back}><Icon name="back" />Back</button>;

  const remote = all.data;
  // The core may still be fetching ("loading"): ask again a few times, calmly.
  const pending = all.loading || remote?.status === 'loading';
  useEffect(() => {
    if (remote?.status !== 'loading') return undefined;
    const t = setTimeout(all.reload, 4000);
    return () => clearTimeout(t);
  }, [remote]);

  const byKey = useMemo(() => new Map((lib?.films || []).map(x => [x.key, x])), [lib]);
  const items = useMemo(
    () => mergeFilms(mine.data?.films || [], remote?.status === 'ok' ? remote.films || [] : [], byKey),
    [mine.data, remote, byKey]);

  const name = mine.data?.name || (remote && remote.name) || param;
  if (mine.loading && !mine.data && all.loading) return <div class="screen">{backBtn}<Loading /></div>;
  if (!items.length && !pending) {
    const failed = remote?.status === 'failed' || all.error;
    return (
      <div class="screen">
        {backBtn}
        <h1 class="person-name-only">{name}</h1>
        <EmptyState
          title={failed ? "We couldn't get their films just now." : "We couldn't find any films for that person."}
          action={failed
            ? <button type="button" class="btn btn-primary" onClick={all.reload}>Try again</button>
            : <a class="btn btn-primary" href={href('library')}>Back to Library</a>}>
          {failed ? 'The film sites may be busy. Your own films are not affected.' : 'They show up when one of your films lists them, or when a film site lists them.'}
        </EmptyState>
      </div>
    );
  }

  const shownRemote = remote?.status === 'ok';
  const roles = roleChoices(items);
  const role = resolveRole(requested, items, shownRemote ? remote.mainRole : null, pending) || 'all';
  const inRole = applyFilters(items, { ...DEFAULT_FILTERS, role }); // everything the numbers below are about
  const inLib = inRole.filter(i => i.film);
  const seen = inLib.filter(i => i.user?.watched).length;
  const onList = inLib.filter(i => i.user?.watchlist && !i.user?.watched).length;
  const rated = inLib.map(i => i.user?.rating).filter(r => r != null);
  const avg = rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length / 2 : null;
  const status = validStatus(f.status);
  const sort = SORT_CHOICES.some(([v]) => v === f.sort) ? f.sort : 'newest'; // a saved sort that is no longer offered falls back
  const ff = { ...f, status, role, decade: null }; // no decade filter on person pages (an old saved one is ignored)
  const counts = statusCounts(items, ff);
  const shown = applyFilters(items, ff);
  const { mine: groupMine, more: groupMore } = groupItems(shown, sort);
  const narrowed = status !== 'all' || f.text.trim();
  const clear = () => setF({ ...DEFAULT_FILTERS, sort: f.sort });
  const statuses = visibleStatuses(counts, status);
  const roleName = roles.find(r => r.value === role)?.label;
  const switchRole = value => go('person', param, { role: value });

  return (
    <div class="screen">
      {backBtn}
      <DebugInfo title="Person" rows={{ id: param, 'resolved id': mine.data && mine.data.id, 'in library': mine.data && mine.data.films.length, 'all credits': all.data && (all.data.films ? all.data.films.length : ''), 'remote status': remote && remote.status, 'remote source': remote && (remote.source || remote.from), 'merged rows': items.length, role, 'load error': (mine.error || all.error) && (mine.error || all.error).message }} />
      <header class="person-head">
        <Headshot photo={remote?.photo} name={name} size="h632" class="person-portrait" lazy={false} />
        <div class="person-head-body">
        <h1>{name}</h1>
        {roles.length > 1 ? (
          <select class="select person-roleswitch" aria-label="Their role" value={role} onChange={e => switchRole(e.currentTarget.value)}>
            {roles.map(r => <option key={r.value} value={r.value}>{r.label} ({n(r.count)})</option>)}
            <option value="all">All roles ({n(items.length)})</option>
          </select>
        ) : roleName && <p class="person-roles">{roleName}</p>}
        <p class="sub num person-stats">
          {shownRemote
            ? <span>You've seen <b>{n(seen)}</b> of their {plural(inRole.length, 'film', 'films')} {rolePhrase(role)} <span class="faint">({n(inLib.length)} in your library)</span></span>
            : <span>You've seen <b>{n(seen)}</b> of their {plural(inLib.length, 'film', 'films')} {rolePhrase(role)} in your library</span>}
          <span><b>{n(onList)}</b> on your watchlist</span>
          {avg != null && <span>Your average rating <b>{avg.toFixed(1)}</b></span>}
        </p>
        </div>
      </header>

      <div class="person-toolbar">
        <div class="segmented" role="group" aria-label="Show">
          {statuses.map(([value, label]) => (
            <button type="button" key={value} aria-pressed={String(status === value)} onClick={() => set({ status: value })}>
              {label}{counts[value] ? <span class="person-n">{n(counts[value])}</span> : null}
            </button>
          ))}
        </div>
        <div class="search person-search">
          <Icon name="search" />
          <input class="input" type="search" aria-label="Search their films by title" placeholder="Search their films" value={f.text} onInput={e => set({ text: e.currentTarget.value })} />
        </div>
        <label class="person-sort">
          <span class="faint">Sort by</span>
          <select class="select" value={sort} onChange={e => set({ sort: e.currentTarget.value })}>
            {SORT_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      {pending && !shownRemote && (
        <p class="muted person-note" role="status" aria-live="polite"><span class="spinner person-spin" />Getting their films…</p>
      )}
      {!pending && remote?.status === 'failed' && (
        <p class="muted person-note" role="status">We couldn't get their full list just now, so this shows only the films in your library. <button type="button" class="btn" onClick={all.reload}>Try again</button></p>
      )}
      {!pending && remote?.status === 'none' && (
        <p class="muted person-note">No other films are listed for them.</p>
      )}

      {shown.length === 0 ? (
        <EmptyState title={narrowed ? 'None of their films match' : role === 'all' ? 'No films to show yet' : `No films to show ${rolePhrase(role)} yet`}
          action={narrowed ? <button type="button" class="btn" onClick={clear}>Clear filters</button> : null}>
          {narrowed ? 'Try a different status, or clear the search.' : null}
        </EmptyState>
      ) : (
        <>
          {groupMore.length > 0 && <h2 class="person-group">In your library</h2>}
          {groupMine.length > 0 && (
            <div class="film-grid person-grid">
              {groupMine.map(item => <Tile key={item.id} item={item} />)}
            </div>
          )}
          {groupMore.length > 0 && <>
            <h2 class="person-group person-group-more">More of their films</h2>
            <p class="faint person-group-note">Opens on Letterboxd</p>
            <div class="film-grid person-grid">
              {groupMore.map(item => <Tile key={item.id} item={item} />)}
            </div>
          </>}
        </>
      )}
    </div>
  );
}
