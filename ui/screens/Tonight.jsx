// Tonight: three picks from your watchlist (a safe bet plus two from a rotating set of categories), dials to steer them, then more like these.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useCall, useRestoredState, toast } from '../state.js';
import { call } from '../api.js';
import { Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import Icon from '../components/Icon.jsx';
import { href } from '../router.js';
import Dials from './tonight/Dials.jsx';
import PickCard from './tonight/PickCard.jsx';
import More from './tonight/More.jsx';
import Choose from './tonight/Choose.jsx';
import RuntimeSlider from '../components/RuntimeSlider.jsx';
import './tonight.css';

import DebugInfo, { DebugError } from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';
import { LISTS_ARCHIVED } from '../archive.js';
const HISTORY = 30;        // screens of picks kept for "Back"
const RECENT_SCREENS = 4;  // a shuffle avoids films from this many screens
const FRESH = { maxMinutes: 0, mood: null, weight: 0 };

// "Not tonight" lasts for the session, even if you wander off to another screen and come back.
// The core will remember it between sessions once it stores `snoozedUntil` on a film (not built yet).
const snoozed = new Set();

export default function Tonight() {
  const [dials, setDials] = useRestoredState('tonight.dials', FRESH);
  const [shuffle, setShuffle] = useState({ seed: 0, avoid: [] }); // avoid: films from the last few screens, so a shuffle shows new ones
  const seed = shuffle.seed;
  const [hist, setHist] = useState([]);     // every screen of picks shown, oldest first, so an accidental shuffle can be undone
  const [pos, setPos] = useState(-1);       // which one is on screen (the last, unless the user has gone back)
  const [skips, setSkips] = useState(0);
  const [swaps, setSwaps] = useState({});   // role -> replacement pick, after a nudge
  const [notes, setNotes] = useState({});   // role -> "nothing lighter fits" and the like
  const [busy, setBusy] = useState(null);   // role being replaced
  const [choosing, setChoosing] = useState(false); // "Choose for me" replaces the picks with one film

  const args = { dials: { ...dials, maxMinutes: dials.maxMinutes || null, ...(LISTS_ARCHIVED ? { includeLists: false } : null) }, exclude: [...snoozed], seed, avoid: shuffle.avoid };
  const { data, error, loading, reload } = useCall('getPicks', args, [dials.maxMinutes, dials.mood, dials.weight, dials.includeLists, seed, skips]);
  const current = hist.length ? hist[pos < 0 ? hist.length - 1 : pos] : null;
  const live = pos < 0 || pos === hist.length - 1;
  const gen = useRef(0); // bumps whenever the picks change, so a slow nudge for the old picks is dropped
  useEffect(() => { gen.current++; setSwaps({}); setNotes({}); }, [data, pos]);
  useEffect(() => {
    if (!data || data.empty || !data.picks.length) return;
    setHist(h => [...h, { picks: data.picks, more: data.more, counts: data.counts }].slice(-HISTORY));
    setPos(-1);
  }, [data]);
  // The picks are all near the top of the screen, so fetch their details now rather than waiting for the background crawl.
  // (Tonight's cards aren't `a.film-card`, so this asks the core directly instead of using useFetchNow.)
  const shownKeys = data && data.picks ? [...data.picks, ...data.more].map(p => p.key).slice(0, 24) : [];
  const shownId = shownKeys.join('|');
  useEffect(() => { if (shownId) call('fetchNow', { keys: shownKeys, tier: 'quick', slot: 'visible' }).catch(() => {}); /* recorded by api.call */ }, [shownId]);

  const shown = current && !data?.empty ? current : data;
  const picks = shown ? shown.picks.map(p => (live && swaps[p.role]) || p) : [];
  const onScreen = new Set(picks.map(p => p.key));
  const more = shown ? shown.more.filter(p => !onScreen.has(p.key)) : [];
  const idx = pos < 0 ? hist.length - 1 : pos;
  // Everything seen in the last few screens (and this one) is steered away from by the next shuffle.
  const recentKeys = () => hist.slice(-RECENT_SCREENS).flatMap(h => [...h.picks, ...h.more].map(p => p.key));
  const doShuffle = () => setShuffle(sh => ({ seed: sh.seed + 1, avoid: recentKeys() }));
  const earlier = [];
  { const seen = new Set(onScreen); for (const h of [...hist].reverse()) for (const p of h.picks) if (!seen.has(p.key)) { seen.add(p.key); earlier.push(p); } }

  const nudge = async (pick, kind) => {
    setBusy(pick.role); setNotes(n => ({ ...n, [pick.role]: null }));
    const at = gen.current;
    try {
      const r = await call('getPicks', { ...args, exclude: [...snoozed, ...onScreen], nudge: { role: pick.role, key: pick.key, kind } });
      if (at !== gen.current) return setBusy(null);
      if (r && r.pick) setSwaps(s => ({ ...s, [pick.role]: r.pick }));
      else setNotes(n => ({ ...n, [pick.role]: (r && r.miss) || 'Nothing else fits right now.' }));
    } catch { if (at === gen.current) toast("Couldn't change that pick. Try again in a moment."); }
    setBusy(null);
  };
  const snooze = pick => { snoozed.add(pick.key); nudge(pick, 'else'); };
  const reset = () => { snoozed.clear(); setDials(FRESH); setShuffle({ seed: 0, avoid: [] }); setSkips(n => n + 1); };
  const set = patch => setDials({ ...dials, ...patch });

  let body;
  if (choosing) body = <Choose args={{ dials: { maxMinutes: args.dials.maxMinutes, mood: null, weight: 0, includeLists: dials.includeLists }, exclude: args.exclude }} onExit={() => setChoosing(false)} />;
  else if (error) body = <EmptyState title="Tonight couldn't load" action={<button type="button" class="btn" onClick={reload}>Try again</button>}>Something went wrong while choosing. Try again in a moment.</EmptyState>;
  else if (!data) body = <Loading label="Choosing…" />;
  else if (data.empty) body = <Empty why={data.empty.why} onSet={set} onReset={reset} skipped={snoozed.size} />;
  else body = (
    <div class={loading ? 'tn-result tn-busy' : 'tn-result'}>
      <div class="tn-picks">
        {picks.map(p => <PickCard key={p.role} pick={p} busy={busy === p.role} miss={notes[p.role]} onNudge={k => nudge(p, k)} onSnooze={() => snooze(p)} />)}
      </div>
      <More items={more} />
      {earlier.length > 0 && <Earlier items={earlier.slice(0, 24)} />}
    </div>
  );

  return (
    <div class="screen tn">
      <div class="screen-head">
        <div>
          <h1>Tonight</h1>
          <p class="sub">{choosing ? 'One film, chosen for you' : (data && data.listsPool && data.listsPool.on ? 'Three picks from your watchlist and lists' : 'Three picks from your watchlist')}{data && data.counts.watchlist > 0 ? <> <span class="faint">·</span> <span class="num">{data.counts.watchlist}</span> films on it</> : null}</p>
        </div>
        {choosing
          ? <div class="tn-shuffle"><button type="button" class="btn" onClick={() => setChoosing(false)}>Back to Tonight</button></div>
          : (
          <div class="tn-shuffle">
            <button type="button" class="btn" onClick={() => setChoosing(c => !c)} aria-pressed={choosing}>Choose for me</button>
            <button type="button" class="btn" onClick={() => setPos(idx - 1)} disabled={idx < 1} title="Back to the previous picks" aria-label="Previous picks">Back</button>
            {!live && <button type="button" class="btn" onClick={() => setPos(idx + 1)} aria-label="Next picks">Forward</button>}
            <button type="button" class="btn" onClick={doShuffle} disabled={!data || !!data.empty}><Icon name="shuffle" />Shuffle</button>
          </div>
          )}
      </div>
      {choosing
        ? <div class="tn-controls"><div class="tn-control"><span class="tn-label">How long have you got?</span><RuntimeSlider label="How long have you got?" value={dials.maxMinutes} onChange={v => set({ maxMinutes: v })} /></div></div>
        : <Dials dials={dials} onChange={setDials} moodCounts={data ? data.moodCounts : null} listsPool={data ? data.listsPool : null} />}
      <DebugInfo title="Tonight" rows={{ ...dataSummary(data), 'history screens': hist.length, snoozed: snoozed.size, seed, skips, 'load error': error && error.message }} />
      {body}
    </div>
  );
}

function Earlier({ items }) {
  return (
    <section class="tn-earlier" aria-label="Shown earlier">
      <h2>Shown earlier</h2>
      <p class="muted">Picks you've been offered tonight, newest first, in case you shuffled past one.</p>
      <ul class="tn-earlier-list">
        {items.map(p => <li key={p.key}><a href={href('film', p.key)}>{p.film.title}</a> <span class="faint">{p.roleLabel}</span></li>)}
      </ul>
    </section>
  );
}

function Empty({ why, onSet, onReset, skipped }) {
  const again = <button type="button" class="btn btn-primary" onClick={onReset}>{skipped ? 'Start again and bring back skipped films' : 'Start again'}</button>;
  if (why === 'watchlist') return <EmptyState title="Your watchlist is empty" action={<a class="btn btn-primary" href={href('settings')}>Refresh from Letterboxd</a>}>Add films to your watchlist on Letterboxd, then refresh. Tonight picks from it.</EmptyState>;
  if (why === 'eligible') return <EmptyState title="Nothing is out yet" action={<a class="btn btn-primary" href={href('settings')}>Refresh from Letterboxd</a>}>Nothing on your watchlist is out yet. Add something that's already released, or refresh to catch up.</EmptyState>;
  if (why === 'skipped') return <EmptyState title="You've passed on everything" action={again}>You've passed on everything that fits. Start again to bring them back.</EmptyState>;
  if (why === 'time') return <EmptyState title="Nothing fits that much time" action={<button type="button" class="btn btn-primary" onClick={() => onSet({ maxMinutes: 0 })}>Allow any length</button>}>Films with no known length can't be sure to fit, so they're left out when you set a time.</EmptyState>;
  if (why === 'mood') return <EmptyState title="Nothing on your watchlist feels like that yet" action={<button type="button" class="btn btn-primary" onClick={() => onSet({ mood: null })}>Clear the mood</button>}>Try another mood, or let Matinee fetch more about your watchlist.</EmptyState>;
  if (why === 'weight') return <EmptyState title="Nothing leans that way" action={<button type="button" class="btn btn-primary" onClick={() => onSet({ weight: 0 })}>Set it to Either</button>}>Nothing on your watchlist is clearly lighter or heavier right now.</EmptyState>;
  return <EmptyState title="Not enough to go on yet" action={skipped ? again : <a class="btn btn-primary" href={href('settings')}>Fetch more details</a>}>We don't know enough about these films yet to pick one with confidence.</EmptyState>;
}
