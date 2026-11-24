// By feel: find films by how they feel. Two ways in: describe a feeling (filters), or start from a film.
import './feel.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { useCall, useLibrary, usePref, useRestoredState } from '../state.js';
import { go } from '../router.js';
import { Segmented } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import Filters from './feel/Filters.jsx';
import FilmPanel from './feel/FilmPanel.jsx';
import FilmPicker from './feel/FilmPicker.jsx';
import Results, { NoMatches, Skeleton } from './feel/Results.jsx';
import { parseParam, filmParam, searchArgs, applyScope, apiScope, apiLimit, emphasisFor, hasFilters, emptyFilters, filmHeading, mostlyThin, MAX_RESULTS } from './feel/model.js';

import DebugInfo from '../debug/DebugInfo.jsx';
const THIN_NOTE = "Most of these matches lean on article tags and keywords, not viewer reviews. They'll get better as more reviews come in.";

/** Run an async loader whenever `deps` change; stale answers are dropped. */
function useLatest(load, deps, delay = 0) {
  const [state, set] = useState({ data: null, loading: true, error: null });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    set(s => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      Promise.resolve().then(load).then(
        data => { if (id === seq.current) set({ data, loading: false, error: null }); },
        error => { if (id === seq.current) set({ data: null, loading: false, error }); });
    }, delay);
    return () => clearTimeout(t);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export default function Feel({ param }) {
  const parsed = parseParam(param);
  const lib = useLibrary();
  const [scope, setScope] = usePref('feel.scope', 'all');
  // Kept for the session, so Back from a film finds the filters, emphasis and nudge as you left them.
  const [mode, setMode] = useState(parsed.mode);
  const [savedFilters, setFilters] = useRestoredState('feel.filters', null);
  const filters = savedFilters || parsed.filters;
  const [emphasis, setEmphasis] = useRestoredState('feel.emphasis', 'overall');
  const [savedShift, setSavedShift] = useRestoredState('feel.shift', null);
  const filmKeyNow = parsed.mode === 'film' ? parsed.key : null;
  const shift = savedShift && savedShift.film === filmKeyNow ? savedShift : null;
  const setShift = v => setSavedShift(v && { ...v, film: filmKeyNow });
  const [retry, setRetry] = useState(0); // bumped by Try again
  const facets = useCall('getFeelFacets', {}, []).data;

  // Deep links: follow the route when it changes.
  const first = useRef(true);
  useEffect(() => {
    const p = parseParam(param);
    setMode(p.mode);
    if (first.current) { first.current = false; if (p.mode === 'describe' && param) setFilters(p.filters); return; }
    if (p.mode === 'describe' && param) setFilters(p.filters);
    setSavedShift(null);
  }, [param]);

  const filmKey = mode === 'film' ? parsed.key : null;
  const film = filmKey && lib ? lib.films.find(f => f.key === filmKey) : null;

  // ---- describe mode
  const searching = mode === 'describe';
  const search = useLatest(async () => {
    if (!searching) return null;
    if (!hasFilters(filters)) {
      // Nothing chosen yet: show a gentle starting set (the library's strongest feel matches for a broad query).
      return [];
    }
    return applyScope(await call('searchFeel', searchArgs(filters, scope)), scope);
  }, [searching, JSON.stringify(filters), scope, retry], filters.text ? 250 : 0);

  // ---- film mode
  const feel = useLatest(() => (filmKey ? call('getFeel', { key: filmKey }) : null), [filmKey]);
  const near = useLatest(async () => {
    if (!filmKey) return null;
    const base = { key: filmKey, limit: apiLimit(), scope: apiScope(scope) };
    const r = shift ? await call('shiftFeel', { ...base, axis: shift.axis, dir: shift.dir }) : await call('getFeelSimilar', { ...base, emphasis: emphasisFor(emphasis) });
    return applyScope(r, scope);
  }, [filmKey, shift && shift.axis + shift.dir, emphasis, scope, retry]);

  // Is the picture thin? Sample the top results' summaries.
  const sampleKeys = ((searching ? search.data : near.data) || []).slice(0, 5).map(r => r.key);
  const thin = useLatest(async () => {
    if (!sampleKeys.length) return null;
    const got = await Promise.all(sampleKeys.map(k => call('getFeel', { key: k }).catch(() => null) /* recorded by api.call; that film just isn't sampled */));
    return mostlyThin(got.map(g => g && g.summary));
  }, [sampleKeys.join('|')]);
  const note = thin.data ? THIN_NOTE : null;

  const head = (
    <header class="screen-head byf-head">
      <div>
        <h1>By feel</h1>
        <p class="muted">Find films by how they feel, not just their genre</p>
      </div>
      <Segmented label="How to look" value={mode} options={[{ value: 'describe', label: 'Describe a feeling' }, { value: 'film', label: 'Start from a film' }]}
        onChange={v => { if (v === 'describe') { setMode('describe'); if (parsed.mode === 'film') go('feel'); } else { setMode('film'); } }} />
    </header>
  );

  if (mode === 'film') {
    const picking = !filmKey || (lib && !film);
    return (
      <div class="screen byf">
        {head}
        <DebugInfo title="By feel" rows={{ mode: 'from a film', film: filmKey, scope, results: near.data && near.data.length, 'load error': near.error && near.error.message }} />
        {picking ? (
          <div class="byf-start">
            <h2>Pick a film to start from</h2>
            <p class="muted">We'll find films in your library that feel like it, and show you why. You can then nudge the result lighter, slower or stranger.</p>
            <FilmPicker films={lib && lib.films} autoFocus onPick={f => go('feel', filmParam(f.key))} />
            {filmKey && lib && !film && <p class="muted">That film isn't in your library any more. Pick another.</p>}
          </div>
        ) : !film ? <Skeleton /> : (
          <div class="byf-layout">
            <aside class="byf-side panel">
              <FilmPanel film={film} feel={feel.data} axes={facets && facets.axes} emphasis={emphasis} onEmphasis={v => { setShift(null); setEmphasis(v); }}
                shift={shift} onShift={setShift} scope={scope} onScope={setScope} onChange={() => go('feel', 'film:')} />
            </aside>
            <main class="byf-main">
              <Results results={near.data} loading={near.loading} error={near.error} onRetry={() => setRetry(n => n + 1)} note={note} heading={filmHeading(film.title, shift, facets && facets.axes)}
                empty={<EmptyState title="Nothing close to this one" action={scope !== 'all' ? <button type="button" class="btn btn-primary" onClick={() => setScope('all')}>Look across everything</button> : <button type="button" class="btn btn-primary" onClick={() => go('feel', 'film:')}>Pick a different film</button>}>
                  {scope !== 'all' ? 'Nothing in this part of your library feels close enough.' : 'We need a bit more detail on this film to find neighbours.'}</EmptyState>} />
            </main>
          </div>
        )}
      </div>
    );
  }

  const none = !hasFilters(filters);
  return (
    <div class="screen byf">
      {head}
      <DebugInfo title="By feel" rows={{ mode: 'describe', 'films in library': lib && lib.films.length, results: search.data && search.data.length, scope, 'load error': search.error && search.error.message }} />
      <div class="byf-layout">
        <aside class="byf-side panel">
          <Filters facets={facets} filters={filters} onChange={setFilters} scope={scope} onScope={setScope} />
        </aside>
        <main class="byf-main">
          {none ? (
            <EmptyState title="What are you in the mood for?" action={<button type="button" class="btn btn-primary" onClick={() => setMode('film')}>Start from a film instead</button>}>
              Describe a feeling in the box, or choose a few moods, themes or places on the left. Matches appear here with the reason for each.
            </EmptyState>
          ) : (
            <Results results={search.data} loading={search.loading} error={search.error} onRetry={() => setRetry(n => n + 1)} note={note}
              empty={<NoMatches onClear={() => setFilters(emptyFilters())}>{filters.text ? 'Try fewer words, or take a filter off.' : 'Take a filter off, or widen the films you are looking in.'}</NoMatches>} />
          )}
        </main>
      </div>
    </div>
  );
}
