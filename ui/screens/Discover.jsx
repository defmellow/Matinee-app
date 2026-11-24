// Discover: films by the people you love that you haven't logged yet. Data: getDiscover({ refresh }).
import './discover.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { useEvent, usePref } from '../state.js';
import { href } from '../router.js';
import { ChipToggle, Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import Icon from '../components/Icon.jsx';
import LogDrop from '../components/LogDrop.jsx';
import PosterPop from '../components/PosterPop.jsx';
import Row from './discover/Row.jsx';
import Details from './discover/Details.jsx';

import DebugInfo, { DebugError } from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';
// Last result, kept while the app is open: coming Back from a film shows it at once instead of waiting again.
let lastData = null;
const WAIT_MS = 60000; // how long to wait for the core to finish before saying so

export default function Discover() {
  const [data, setData] = useState(lastData);       // a Discover result
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [open, setOpen] = useState(null);
  const [showTv, setShowTv] = usePref('discover.showTv', false);
  const [showDocs, setShowDocs] = usePref('discover.showDocs', true);
  const tvRef = useRef(showTv); tvRef.current = showTv; // the core serves series TV entries only when asked
  const alive = useRef(true);
  const seq = useRef(0);       // only the newest load may change the screen
  const giveUp = useRef(null); // fallback if the 'discover' event never arrives
  const clearGiveUp = () => { clearTimeout(giveUp.current); giveUp.current = null; };
  useEffect(() => () => { alive.current = false; clearGiveUp(); }, []);
  const fail = msg => { clearGiveUp(); setUpdating(false); setError(msg || "Couldn't look for films just now."); };

  const load = async refresh => {
    const id = ++seq.current;
    setError(null);
    try {
      const r = await call('getDiscover', { refresh, includeTV: tvRef.current });
      if (!alive.current || id !== seq.current) return;
      if (r && r.sections) { lastData = r; setData(r); setUpdating(!!r.refreshing); } else setUpdating(true);
      clearGiveUp();
      if (!r || !r.sections || r.refreshing) giveUp.current = setTimeout(() => { if (alive.current) fail(); }, WAIT_MS);
    } catch (e) { if (alive.current && id === seq.current) fail(e.message); }
  };
  useEffect(() => { load(false); }, [showTv]);
  useEvent('discover', p => {
    if (p && p.ok === false) { seq.current++; fail(p.message); return; }
    load(false);
  });
  const refresh = () => { setUpdating(true); setError(null); load(true); };

  const head = (
    <header class="screen-head disc-head">
      <div>
        <h1>Discover</h1>
        <p class="muted">Films by the people you love that you haven't logged yet</p>
      </div>
      <div class="disc-actions">
        {updating && data && <span class="muted disc-updating" aria-live="polite">Updating…</span>}
        <button type="button" class="btn btn-ghost" onClick={refresh} disabled={updating}><Icon name="refresh" />Refresh suggestions</button>
      </div>
    </header>
  );

  let body;
  if (error && !data) {
    body = <EmptyState title="We couldn't find suggestions just now." action={<button type="button" class="btn btn-primary" onClick={refresh}>Try again</button>}>{error}</EmptyState>;
  } else if (!data) {
    body = <Loading label="Finding films for you…" />;
  } else if (!data.sections.length) {
    body = <EmptyState title="Nothing to suggest yet" action={<a class="btn btn-primary" href={href('library')}>Go to your library</a>}>Rate a few more films and Discover will find more by the people you love.</EmptyState>;
  } else {
    const keep = (sec, i) => (showTv || i.kind !== 'tv') && (showDocs || !(i.genres || []).includes('Documentary'));
    const sections = data.sections.map(sec => ({ ...sec, items: sec.items.filter(i => keep(sec, i)) })).filter(sec => sec.items.length);
    body = sections.length
      ? sections.map(sec => <Row key={sec.id} section={sec} onOpen={setOpen} />)
      : <EmptyState title="Nothing left with those choices" action={<button type="button" class="btn btn-primary" onClick={() => { setShowTv(true); setShowDocs(true); }}>Show everything</button>}>Turn on TV or documentaries above to see more suggestions.</EmptyState>;
  }

  const itemById = new Map(((data && data.sections) || []).flatMap(sec => sec.items.map(i => [i.id, i])));

  const filters = data && data.sections.length > 0 && (
    <div class="disc-filters" role="group" aria-label="What to include">
      <ChipToggle on={showTv} onClick={() => setShowTv(!showTv)} title="TV series and specials that Letterboxd lists as films">Include TV</ChipToggle>
      <ChipToggle on={showDocs} onClick={() => setShowDocs(!showDocs)}>Include documentaries</ChipToggle>
    </div>
  );

  return (
    <div class="screen disc">
      {head}
      {(updating || !data) && <LogDrop source="discover" />}
      {filters}
      {error && data && <p class="muted disc-error" role="alert">{error} <button type="button" class="btn btn-ghost" onClick={refresh}>Try again</button></p>}
      <DebugInfo title="Discover" rows={{ ...dataSummary(data), updating, 'load error': error }} />
      {body}
      <PosterPop lookup={id => itemById.get(id)} />
      {open && <Details item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
