// The Map: every film as a dot, films that feel alike close together, joined by fine lines to their closest matches.
// Drag the background to move, scroll to zoom, drag a dot and the films linked to it follow. Click a film to see what it sits beside.
// The dots and lines are drawn on a canvas by ui/screens/map/engine.js; this file is the page around it.
import { lessMotion } from '../motion.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { useCall, useEvent, useLibrary, usePref } from '../state.js';
import { Segmented, Loading, Chip } from '../components/ui.jsx';
import { EmptyState, Poster, Stars } from '../components/film.jsx';
import Icon from '../components/Icon.jsx';
import { href } from '../router.js';
import { plural } from '../format.js';
import { reportFailure } from '../debug/report.js';
import { tierFor, reasonLines } from './feel/model.js';
import { h } from 'preact';
import { colourWords } from '../feel-colours.js'; // TEMP feel colours
import { createEngine } from './map/engine.js';
import { SCOPES, LENSES, LENS_OPTIONS, FEELING_COLOURS, SIZE_BY, SIZE_ROWS, sizeChoice, sizeTier, tierRadius, biggestRadius, scopeFilter, looseFilter, allOf, fold, LINE_STEPS } from './map/model.js';
import { aroundHere, countIds, suggest, whereItLives, livesSentence, kindOf, lowerLabel } from './map/layout.js';
import './map.css';

const FEELING_FACETS = new Set(['mood', 'tone', 'craft', 'impact']);
const SHOWN = 8, ASKED = 24;
const LOOSE_COLOUR = '#b8aaa0'; // films with nothing to go on yet (core/analysis/feel-map.js NEUTRAL)
const reducedMotion = lessMotion; // the Settings switch, or the computer asking for fewer animations

/** The two strongest feelings of a profile, as plain words ("terrifying and eerie"). */
function topFeelings(profile) {
  const ds = ((profile && profile.descriptors) || []).filter(d => !d.fragile && FEELING_FACETS.has(d.facet)).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2);
  const t = ds.map(d => String(d.label).toLowerCase()).join(' and ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export default function MapScreen() {
  const [savedLens, setLens] = usePref('map.lens', 'feel');
  const lens = Object.hasOwn(LENSES, savedLens) ? savedLens : 'feel'; // ("Both" was taken away on 20 Nov: a saved choice of it opens How it feels)
  const { data: got, error, loading, reload } = useCall('getMap', { lens }, [lens]);
  // layouts already received are kept for the visit, so going back to a lens starts moving at once
  const held = useRef(new Map());
  const lastGot = useRef(null);
  if (got && got !== lastGot.current) { lastGot.current = got; held.current.set(got.lens, got); } // (a refreshed layout below must not be overwritten by the older answer)
  const [, bump] = useState(0);
  const map = held.current.get(lens) || got;
  const [scope, setScope] = usePref('map.filter', 'all');
  const [savedSize, setSizeBy] = usePref('map.size', 'mine');
  const [keySel, setKeySel] = useState(() => new Set()); // colours picked in the key: those films stay lit, the rest fade dark
  const toggleKey = id => setKeySel(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [showLoose, setShowLoose] = usePref('map.loose', false); // orphan films (nothing to place them by): hidden unless the user ticks the box
  const sizeBy = sizeChoice(savedSize); // (the older "Colour by" choice, map.colour, is simply no longer read: dots are always coloured by feel)
  const [bigR, setBigR] = useState(() => biggestRadius(900, 700)); // the biggest dot in pixels, for the key
  const library = useLibrary();
  const lib = useMemo(() => new Map(((library && library.films) || []).map(f => [f.key, f])), [library]);

  const view = useRef(null), canvas = useRef(null), card = useRef(null), engine = useRef(null);
  const live = useRef({});           // what the engine's callbacks need to see
  const laid = useRef(null);         // the layout the engine is showing
  const glided = useRef(null);       // the film the camera last moved to
  const [picked, setPicked] = useState(null);
  const [hover, setHover] = useState(null);
  const [feels, setFeels] = useState({});        // key -> "terrifying and eerie", filled as films are pointed at
  const [similar, setSimilar] = useState({});    // key -> getFeelSimilar rows
  const [find, setFind] = useState('');
  const [feeling, setFeeling] = useState(null);   // { id, label, kind }: the feeling or theme being looked for
  const [around, setAround] = useState(null);     // { x, y, text }: what is around the pointer
  const [showAllLit, setShowAllLit] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);

  const loose = map ? map.loose : null;
  const keep = useMemo(() => allOf([scopeFilter(scope, lib), looseFilter(showLoose, loose)]), [scope, lib, showLoose, loose]);
  live.current.picked = picked; live.current.map = map;

  // A saved layout is shown first; when the fresh one is ready the core says so and the films flow to their new places (no spinner, no toast).
  useEvent('map', p => {
    if (!p || p.lens !== lens) return;
    call('getMap', { lens }).then(next => {
      if (next.lens !== live.current.lens) return; // the user moved on to another lens meanwhile
      held.current.set(next.lens, next); bump(n => n + 1);
    }, err => reportFailure('Map', "Couldn't update the map.", err));
  });
  live.current.lens = lens;

  const keysSig = useMemo(() => (map ? map.nodes.map(p => p.key).join('|') : ''), [map]);
  // the engine: made once for a set of films, torn down with it (another lens flows into place instead, see below)
  useLayoutEffect(() => {
    if (!map || !map.nodes.length || !canvas.current) return undefined;
    laid.current = map;
    const e = createEngine({
      canvas: canvas.current, map, reduced: reducedMotion(),
      onHover: (i, x, y) => {
        const el = card.current;
        if (i < 0 || e.keys[i] === live.current.picked) { el && (el.hidden = true); setHover(h => (h == null ? h : null)); return; }
        if (el) {
          el.hidden = false;
          const w = view.current.clientWidth, h = view.current.clientHeight;
          el.style.transform = `translate(${Math.round(Math.max(8, Math.min(w - 268, x + 16)))}px, ${Math.round(Math.max(8, Math.min(h - 150, y + 16)))}px)`; // (moved, not re-laid-out)
        }
        const key = e.keys[i];
        setHover(h => (h === key ? h : key));
      },
      onPick: i => {
        if (i >= 0) { const el = card.current; if (el) el.hidden = true; live.current.picked = e.keys[i]; setHover(null); } // the hover card gives way to the picked film
        setPicked(i < 0 ? null : e.keys[i]);
      },
      onAround: (x, y, near) => {
        if (x == null) { setAround(a => (a == null ? a : null)); return; }
        const m = live.current.map, r = m && aroundHere(near.map(j => e.keys[j]), k => m.feel[k], m.labels);
        setAround(r ? { x, y, text: r.text } : null);
      },
      onFail: err => reportFailure('Map', "Couldn't draw the map.", err),
    });
    engine.current = e; canvas.current.__engine = e; // (read by the browser checks)
    const el = view.current;
    const blockOff = () => { // names keep clear of the buttons laid over the map
      const box = el.getBoundingClientRect();
      e.setBlocked([...el.querySelectorAll('.map-zoom, .map-whole-back')].map(b => { const r = b.getBoundingClientRect(); return { x: r.left - box.left - 6, y: r.top - box.top - 6, w: r.width + 12, h: r.height + 12 }; }));
    };
    live.current.blockOff = blockOff;
    const size = () => { e.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1); blockOff(); setBigR(biggestRadius(el.clientWidth, el.clientHeight)); };
    size();
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(size); });
    ro.observe(el);
    const theme = () => e.refreshTheme();
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', theme);
    const mo = new MutationObserver(theme); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mq.removeEventListener('change', theme); mo.disconnect(); e.destroy(); engine.current = null; };
  }, [keysSig]);

  useEffect(() => { if (live.current.blockOff) live.current.blockOff(); }, [picked]); // the back button comes and goes with a pick

  // another lens: the films flow to their new places
  useEffect(() => {
    const e = engine.current;
    if (e && map && laid.current !== map) { laid.current = map; e.setLayout(map); }
  }, [map]);

  // colours (always the general feel), sizes (the "Size by" choice) and names follow the library; a film with no details yet is still placed, just small
  useEffect(() => {
    const e = engine.current;
    if (!e || !map) return;
    e.setStyle({
      colours: map.nodes.map(p => p.colour),
      tiers: map.nodes.map(p => sizeTier(sizeBy, lib.get(p.key))), steps: SIZE_ROWS[sizeBy].length,
      watched: map.nodes.map(p => !!(lib.get(p.key) && lib.get(p.key).user && lib.get(p.key).user.watched)),
      titles: map.nodes.map(p => (lib.get(p.key) && lib.get(p.key).title) || ''),
      posterUrls: map.nodes.map(p => { const f = lib.get(p.key); return f && f.poster && (f.poster.thumb || f.poster.url) || null; }),
    });
  }, [map, sizeBy, lib, !!engine.current]);

  // the filter: films outside it leave the map and the rest rearrange (a new set only; same set does nothing)
  useEffect(() => { if (engine.current && lib.size) engine.current.setFilter(keep); }, [keep, map, lib.size]);

  // a picked film that the view leaves out (Watched, Watchlist) is let go
  useEffect(() => { if (picked && lib.size && !keep(picked)) setPicked(null); }, [picked, keep, lib.size]);

  useEffect(() => { // the key's highlight: films whose main colour was picked stay lit
    const e = engine.current;
    if (!e || !map) return;
    e.setKeyLit(keySel.size ? new Set(map.nodes.map((p, i) => (keySel.has(p.family || 'none') ? i : -1)).filter(i => i >= 0)) : null);
  }, [keySel, map, !!engine.current]);
  // a picked film: its closest films come from the feel engine (asked for more than shown, so a filter still leaves enough)
  // (also asked for a film under the pointer, so its hover lines are the same ones a click shows)
  const askSimilar = key => {
    const id = lens + '|' + key;
    if (!key || similar[id]) return;
    // kept even when the pointer has moved on (keyed by lens and film, so a late answer is still right, and pointing back is instant)
    call('getFeelSimilar', { key, limit: ASKED, emphasis: LENSES[lens].emphasis }).then(rows => setSimilar(s => ({ ...s, [id]: rows })), err => reportFailure('Map', "Couldn't find what is closest to this film.", err, { film: key }));
  };
  useEffect(() => { askSimilar(picked); }, [picked, lens]);
  useEffect(() => { askSimilar(hover); }, [hover, lens]);
  // a film's closest films on show as [[engine index, closeness 0..1]]: the feel engine's list, or the map's own until it arrives.
  // The hover lines and the picked film's lines both come from here, so clicking a film never changes its lines.
  const closestOf = key => {
    const e = engine.current, got = similar[lens + '|' + key];
    const list = got
      ? got.filter(x => x.film && keep(x.key) && e.index.has(x.key)).slice(0, SHOWN).map(r => [e.index.get(r.key), r.score])
      : (map.near[key] || []).filter(([k]) => keep(k) && e.index.has(k)).slice(0, SHOWN).map(([k, sc]) => [e.index.get(k), sc]);
    const best = Math.max(0.0001, ...list.map(l => l[1]));
    return list.map(([j, sc]) => [j, sc / best]);
  };
  const simRows = picked && similar[lens + '|' + picked];
  const rows = simRows ? simRows.filter(x => x.film && keep(x.key) && engine.current && engine.current.index.has(x.key)) : null;
  const shownRows = rows ? rows.slice(0, SHOWN) : null;
  useEffect(() => { setShowAllRows(false); }, [picked]);
  useEffect(() => { // tell the engine who is picked, and which films are closest (the map's own list until the real one arrives)
    const e = engine.current;
    if (!e || !map) return;
    if (!picked) { glided.current = null; e.setPick(-1); return; }
    const i = e.index.get(picked);
    if (i == null) return;
    e.setPick(i, closestOf(picked), { glide: glided.current !== picked });
    glided.current = picked;
  }, [picked, !!shownRows, keep, map]);
  useEffect(() => { // the hovered film's lines: the same list as a pick
    const e = engine.current;
    if (!e || !map || !hover) return;
    const i = e.index.get(hover);
    if (i != null) e.setHoverLines(i, closestOf(hover));
  }, [hover, !!(hover && similar[lens + '|' + hover]), keep, map, lens]);

  // pointing at a film: its two strongest feelings, fetched once
  useEffect(() => {
    if (!hover || feels[hover] !== undefined) return undefined;
    let ok = true;
    call('getFeel', { key: hover }).then(r => { if (ok) setFeels(f => ({ ...f, [hover]: topFeelings(r && r.profile) })); }, err => { reportFailure('Map', "Couldn't read this film's feelings.", err, { film: hover }); if (ok) setFeels(f => ({ ...f, [hover]: '' })); });
    return () => { ok = false; };
  }, [hover]);

  useEffect(() => { // Escape lets go of a picked film
    const onKey = ev => { if (ev.key === 'Escape') { if (live.current.picked) setPicked(null); else setFeeling(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // searching: matches ring up, and the map glides to the first
  const q = fold(find.trim());
  const matches = useMemo(() => (q.length >= 2 && map ? map.nodes.map((p, i) => [i, lib.get(p.key)]).filter(([, f]) => f && keep(f.key) && fold(f.title).includes(q)) : []), [q, map, lib, keep]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return undefined;
    e.setMatches(new Set(matches.map(([i]) => i)));
    if (!matches.length) return undefined;
    const t = setTimeout(() => e.show(matches[0][0]), 350);
    return () => clearTimeout(t);
  }, [matches]);

  // looking for a feeling or theme: what is on the map, where it lives, and what the box suggests
  const idCounts = useMemo(() => (map ? countIds(map.feel, keep) : new Map()), [map, keep]);
  const sugg = useMemo(() => (map && q.length >= 2 ? suggest(find, map.labels, idCounts, fold) : { feelings: [], themes: [] }), [map, idCounts, q]);
  const lives = useMemo(() => (map && feeling ? whereItLives(feeling.id, map.feel, keep, k => !!(lib.get(k) && lib.get(k).user && lib.get(k).user.watched)) : null), [map, feeling, keep, lib]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!lives || !lives.lit.size) { e.setGlow(null); return; }
    const best = lives.top[0][1];
    e.setGlow(new Map([...lives.lit].filter(([k]) => e.index.has(k)).map(([k, v]) => [e.index.get(k), Math.max(0.05, v / best)])));
  }, [lives, !!engine.current]);
  useEffect(() => { setShowAllLit(false); }, [feeling]);
  const chooseFeeling = (id, label, facet) => { setFeeling({ id, label, kind: kindOf(facet) }); setFind(''); };

  if (loading && !map) return <div class="screen"><div class="screen-head"><h1>Map</h1></div><Loading label="Laying out your films…" /></div>;
  if (error || !map) return <div class="screen"><EmptyState title="The map didn't load" action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Something went wrong laying out your films. Try again, or reopen Matinee.</EmptyState></div>;

  const rearranging = map.lens !== lens;
  const looseSet = new Set(map.loose);
  const counts = { all: 0, watched: 0, watchlist: 0 };
  let looseHere = 0; // orphan films in this view (nothing to place them by), shown or not
  const inView = scopeFilter(scope, lib);
  for (const p of map.nodes) {
    if (looseSet.has(p.key)) { if (inView(p.key)) looseHere++; if (!showLoose) continue; }
    counts.all++;
    const u = lib.get(p.key) && lib.get(p.key).user; if (u) u.watched ? counts.watched++ : counts.watchlist++;
  }
  const scopes = SCOPES.map(s => ({ ...s, label: <>{s.label}<span class="map-n num">{counts[s.value]}</span></> }));
  const inScope = counts[scope];
  const pickedFilm = picked && lib.get(picked);
  const hoverFilm = hover && lib.get(hover);
  const best = shownRows && shownRows.length ? Math.max(...shownRows.map(r => r.score || 0)) : 0;
  const unwatched = shownRows ? shownRows.filter(r => r.film.user && !r.film.user.watched).length : 0;
  const rowsAll = rows || [];
  const listed = showAllRows ? rowsAll : (shownRows || []);

  return (
    <div class="map-screen">
      <header class="map-head">
        <div>
          <h1>Map</h1>
          <p class="sub">Your <b>{plural(map.total, 'film', 'films')}</b>, each placed near the ones most like it.</p>
        </div>
        <div class="search map-find">
          <Icon name="search" />
          <div class="input map-findbox">
            {feeling && <span class="chip-split map-pill"><span class="chip">{feeling.label}</span><button type="button" class="icon-btn" onClick={() => setFeeling(null)} aria-label={`Stop looking for ${lowerLabel(feeling.label)}`} title="Remove"><Icon name="close" size={12} /></button></span>}
            <input type="search" placeholder={feeling ? '' : 'Find a film or a feeling'} value={find} onInput={e => setFind(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Backspace' && !find && feeling) setFeeling(null); }} aria-label="Find a film, a feeling or a theme on the map" />
          </div>
          {find && q.length >= 2 && (
            <ul class="map-found">
              {matches.slice(0, 5).map(([i, f]) => <li key={f.key}><button type="button" onClick={() => { engine.current.show(i); setPicked(f.key); setFind(''); }}>{f.title}{f.year ? <span class="faint num"> {f.year}</span> : null}</button></li>)}
              {sugg.feelings.length > 0 && <li class="map-found-head faint">Feelings</li>}
              {sugg.feelings.map(x => <li key={x.id}><button type="button" onClick={() => chooseFeeling(x.id, x.label, x.facet)}>{x.label}<span class="faint num"> {plural(x.count, 'film', 'films')}</span></button></li>)}
              {sugg.themes.length > 0 && <li class="map-found-head faint">Themes</li>}
              {sugg.themes.map(x => <li key={x.id}><button type="button" onClick={() => chooseFeeling(x.id, x.label, x.facet)}>{x.label}<span class="faint num"> {plural(x.count, 'film', 'films')}</span></button></li>)}
              {!matches.length && !sugg.feelings.length && !sugg.themes.length && <li class="map-found-none faint">Nothing here by that name.</li>}
            </ul>
          )}
        </div>
      </header>
      <div class="map-filters"><Segmented label="Which films" value={scope} options={scopes} onChange={setScope} /></div>

      {!map.nodes.length ? (
        <EmptyState title="Nothing to place yet">There are no films here yet. Add some from your Letterboxd export, then come back.</EmptyState>
      ) : (
        <div class="map-body">
          <div class="map-view" ref={view}>
            <canvas ref={canvas} class="map-canvas" role="img" aria-label={`A map of ${plural(map.total, 'film', 'films')}. Films that feel alike are close together.`} />
            <div class="map-card" ref={card} hidden>
              {hoverFilm && (
                <>
                  <div class="map-card-poster"><Poster film={hoverFilm} eager /></div>
                  <div class="map-card-text">
                    <strong>{hoverFilm.title}</strong>
                    <span class="muted num">{hoverFilm.year}</span>
                    {hoverFilm.user && hoverFilm.user.rating != null ? <Stars rating={hoverFilm.user.rating} size="13px" /> : <span class="faint">{hoverFilm.user && hoverFilm.user.watched ? 'Not rated' : 'On your watchlist'}</span>}
                    {feels[hover] ? <span class="map-card-feel">{colourWords(feels[hover], h)}</span> : null}
                    {!picked && <span class="faint map-card-hint">The thicker the line, the closer the film.</span>}
                  </div>
                </>
              )}
            </div>
            {around && <p class="map-around" style={{ left: Math.max(8, Math.min((view.current ? view.current.clientWidth : 600) - 236, around.x + 14)) + 'px', top: Math.max(8, Math.min((view.current ? view.current.clientHeight : 400) - 120, around.y + 14)) + 'px' }}><b>Around here</b>{around.text}</p>}
            {picked && <button type="button" class="btn btn-small map-whole-back" onClick={() => engine.current.showAll()}><Icon name="back" size={14} /> Whole map</button>}
            <div class="map-zoom" role="group" aria-label="Zoom">
              <button type="button" class="icon-btn" onClick={() => engine.current.zoomBy(1 / 1.5)} title="Further away" aria-label="Zoom out"><span aria-hidden="true">−</span></button>
              <button type="button" class="icon-btn" onClick={() => engine.current.zoomBy(1.5)} title="Closer" aria-label="Zoom in"><Icon name="plus" /></button>
              {!picked && <button type="button" class="btn btn-small" onClick={() => engine.current.showAll()}>Whole map</button>}
            </div>
          </div>

          <aside class="map-side" aria-label="Shape the map">
            <section class="map-lens">
              <h2>Shape the map</h2>
              <h3>Alike in</h3>
              <Segmented label="Alike in" value={lens} options={LENS_OPTIONS} onChange={setLens} />
              <p class="muted map-sentence">{rearranging ? 'Rearranging…' : LENSES[lens].about}</p>
            </section>
            {pickedFilm ? (
              <div class="map-pick" key={picked}>
                <div class="map-pick-top">
                  <a class="map-pick-poster" href={href('film', picked)} title="Open film"><Poster film={pickedFilm} eager /></a>
                  <div class="map-pick-text">
                    <h2>{pickedFilm.title}</h2>
                    <p class="muted num">{[pickedFilm.year, pickedFilm.director].filter(Boolean).join(' · ')}</p>
                    {pickedFilm.user && pickedFilm.user.rating != null ? <p class="muted">You gave it <Stars rating={pickedFilm.user.rating} size="14px" /></p> : <p class="faint">{pickedFilm.user && pickedFilm.user.watched ? 'Not rated' : 'On your watchlist'}</p>}
                    <a class="btn btn-primary btn-small" href={href('film', picked)}>Open film</a>
                  </div>
                  <button type="button" class="icon-btn map-let-go" onClick={() => setPicked(null)} title="Let go (Esc)" aria-label={`Let go of ${pickedFilm.title}`}><Icon name="close" size={16} /></button>
                </div>
                <h3>{lens === 'about' ? "Closest to it in what it's about" : lens === 'feel' ? 'Closest to it in feel' : 'Closest to it'}</h3>
                {!rows ? <p class="muted">Finding its closest films…</p> : !rows.length ? <p class="muted">{map.loose.includes(picked) ? "Matinee doesn't know enough about it yet to say which films it's close to." : `Nothing sits especially close to this one${scope === 'all' ? '' : ' in this group'}.`}</p> : (
                  <>
                    <p class="muted map-sentence">The thicker the line, the closer the film.</p>
                    {unwatched > 0 && scope === 'all' && <p class="muted map-sentence">{unwatched === shownRows.length ? `All ${unwatched}` : `${unwatched} of its ${shownRows.length}`} closest films {unwatched === 1 ? 'is' : 'are'} on your watchlist.</p>}
                    <ul class="map-near">
                      {listed.map(r => {
                        const t = tierFor(r.score, best), why = reasonLines(r, 2).map(x => x.replace(/\.$/, '')).join('; ');
                        return (
                          <li key={r.key}>
                            <button type="button" onClick={() => { setPicked(r.key); }} title={`Go to ${r.film.title} on the map`}>
                              <span class="map-near-poster"><Poster film={r.film} /></span>
                              <span class="map-near-text">
                                <span class="map-near-title">{r.film.title}{r.film.user && !r.film.user.watched ? <span class="faint"> · watchlist</span> : null}</span>
                                <span class="muted map-near-why"><b>{t.label}</b>{why ? [' · ', ...colourWords(why, h)] : ''}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {!showAllRows && rowsAll.length > SHOWN && <button type="button" class="btn-link" onClick={() => setShowAllRows(true)}>Show all {rowsAll.length}</button>}
                  </>
                )}
              </div>
            ) : (
              <div class="map-shape">
                {lives ? (
                  <div class="map-lives">
                    <h2>Where {lowerLabel(feeling.label)} lives</h2>
                    <p class="muted map-sentence">{livesSentence(feeling.label, feeling.kind, lives.lit.size, lives.watched, scope === 'all')} {lives.lit.size ? 'Stronger pink means it fits more.' : ''}</p>
                    {lives.top.length > 0 && (
                      <>
                        <h3>{feeling.kind === 'theme' ? `Most about ${lowerLabel(feeling.label)}` : `Most ${lowerLabel(feeling.label)}`}</h3>
                        <ul class="map-near">
                          {(showAllLit ? lives.top : lives.top.slice(0, SHOWN)).map(([key]) => { const f = lib.get(key); return f ? (
                            <li key={key}><button type="button" onClick={() => setPicked(key)} title={`Go to ${f.title} on the map`}>
                              <span class="map-near-poster"><Poster film={f} /></span>
                              <span class="map-near-text"><span class="map-near-title">{f.title}{f.user && !f.user.watched ? <span class="faint"> · watchlist</span> : null}</span><span class="muted map-near-why">{[f.year, f.director].filter(Boolean).join(' · ')}{f.user && f.user.rating != null ? <> · <Stars rating={f.user.rating} size="12px" /></> : null}</span></span>
                            </button></li>) : null; })}
                        </ul>
                        {!showAllLit && lives.top.length > SHOWN && <button type="button" class="btn-link" onClick={() => setShowAllLit(true)}>Show all {lives.top.length}</button>}
                      </>
                    )}
                    {lives.nearby.length > 0 && (
                      <>
                        <h3>Other feelings nearby</h3>
                        <div class="chips">{lives.nearby.map(id => <Chip key={id} onClick={() => chooseFeeling(id, map.labels[id][0], map.labels[id][1])} title={`Look for ${lowerLabel(map.labels[id][0])} instead`}>{map.labels[id][0]}</Chip>)}</div>
                      </>
                    )}
                    <button type="button" class="btn btn-small btn-ghost map-clear" onClick={() => setFeeling(null)}>Clear</button>
                  </div>
                ) : (
                  <>
                    <p class="muted map-sentence">{plural(inScope, 'film', 'films')}. The closer two sit, the more alike they feel.</p>
                    <h3>Size by</h3>
                    <Segmented label="Size by" value={sizeBy} options={SIZE_BY} onChange={setSizeBy} />
                    <h3>Key</h3>
                    <ul class="map-key" aria-label="What the colours mean">
                      {[...FEELING_COLOURS, ...(showLoose && looseHere > 0 ? [{ id: 'none', word: 'Grey', about: 'orphan films', colour: LOOSE_COLOUR }] : [])].map(c => (
                        <li key={c.id}><button type="button" class="map-key-pick" aria-pressed={String(keySel.has(c.id))} data-off={keySel.size > 0 && !keySel.has(c.id) ? '' : undefined} onClick={() => toggleKey(c.id)} title={keySel.has(c.id) ? 'Show every colour again' : `Pick out the ${c.word.toLowerCase()} films`}>
                          <i class="map-swatch" style={{ background: c.colour }} aria-hidden="true" /><b>{c.word}</b><span class="muted">{c.about}</span>
                        </button></li>
                      ))}
                    </ul>
                    {keySel.size > 0 && <button type="button" class="btn-link map-key-clear" onClick={() => setKeySel(new Set())}>Show every colour</button>}
                    <ul class="map-key map-key-sizes" aria-label={sizeBy === 'mine' ? 'What the dot sizes mean: your stars' : sizeBy === 'matinee' ? 'What the dot sizes mean: the Matinee score' : 'What the dot sizes mean: the Letterboxd average'}>
                      {(() => { // 22 Nov: just the smallest and the biggest dot, and what bigger means
                        const steps = SIZE_ROWS[sizeBy].length, dot = t => { const d = tierRadius(t, bigR, steps) * 2 + 'px'; return <i style={{ width: d, height: d }} />; };
                        const what = sizeBy === 'mine' ? 'your rating' : sizeBy === 'matinee' ? 'the Matinee score' : 'the Letterboxd average';
                        return <li class="map-key-size"><span class="map-key-dot" aria-hidden="true">{dot(0)}</span><span class="map-key-dot" aria-hidden="true">{dot(steps - 1)}</span><span class="muted">The bigger the dot, the higher {what}</span></li>;
                      })()}
                    </ul>
                    <ul class="map-key map-key-lines" aria-label="What the lines mean">
                      {LINE_STEPS.map(st => <li key={st.id}><span class="map-key-line" aria-hidden="true"><i style={{ height: st.width + 'px', opacity: st.alpha }} /></span><span class="muted">{st.label}</span></li>)}
                    </ul>
                    <p class="faint map-sentence">The thicker the line, the closer the film.</p>
                    {looseHere > 0 && (
                      <>
                        <label class="map-check">
                          <input type="checkbox" checked={showLoose} onChange={e => setShowLoose(e.currentTarget.checked)} />
                          <span>Show orphan films</span>
                        </label>
                        <p class="faint map-sentence">Orphan films are ones Matinee knows almost nothing about yet: no reviews, genres, director or cast, so there's nothing to place them near. Often they're TV series or films that haven't come out. {looseHere === 1 ? 'You have 1. It' : `You have ${looseHere}. They`}{showLoose ? (looseHere === 1 ? ' sits' : ' sit') + ' on a ring around the edge' : (looseHere === 1 ? "'s" : "'re") + ' hidden'} until {looseHere === 1 ? 'its' : 'their'} details arrive.</p>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
