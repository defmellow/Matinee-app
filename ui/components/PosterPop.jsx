import { useFilmColour, colourProps } from '../feel-colours.js'; // TEMP feel colours
import DebugInfo from '../debug/DebugInfo.jsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { call, imageUrl } from '../api.js';
import Headshot from './Headshot.jsx';
import { externalScores } from './scores.js';
import { POP_W, placePop, oneLine, directedBy } from './posterpop.js';
import './posterpop.css';

const DELAY = 350;
const LINK = 'a[href^="#/film/"]';
const filmCache = new Map(); // key -> full film (or null when it can't be had)

const hoverCapable = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
// Something laid over a film card's poster but outside its link (the Library's "More like this" and closeness badge) carries
// data-pop-over: hovering it counts as hovering the card, so the hover card neither hides nor fails to show.
const cardFor = (el, sel) => {
  if (!el || !el.closest) return null;
  const over = el.closest('[data-pop-over]');
  return over ? over.parentElement && over.parentElement.querySelector(sel) : el.closest(sel);
};
const keyOf = el => { const m = /^#\/film\/(.+)$/.exec(el.getAttribute('href') || ''); try { return m && decodeURIComponent(m[1]); } catch { return null; } };

async function fullFilm(key) {
  if (filmCache.has(key)) return filmCache.get(key);
  try { const f = await call('getFilm', { key }); filmCache.set(key, f); return f; } catch { filmCache.set(key, null); return null; } // recorded by api.call; the hover card just doesn't show
}

// Discover items only carry an IMDb number; show it in the same shape the shared score helper reads.
const ratingsOf = f => f.ratings && Object.keys(f.ratings).length ? f.ratings : (f.imdb?.value != null ? { imdb: { value: Number(f.imdb.value) } } : {});

/**
 * A card that grows out of a poster after a short hover: blurred poster backdrop, title, genres, scores, your tags, one line of synopsis.
 * Mounted once for the whole app (app.jsx), so every film poster that links to a film gets it. It listens for hover on any film link that holds a poster;
 * screens whose cards aren't film links (Discover) mark the card with data-pop="<id>" and mount their own with `lookup(id)` returning the film-like object.
 * The card ignores the pointer, so it never covers the poster's click target, and it is fixed-position, so nothing shifts.
 */
export default function PosterPop({ lookup }) {
  const [show, setShow] = useState(null); // { film, rect }
  const [pos, setPos] = useState(null);   // { left, top, side, ox, oy }
  const [on, setOn] = useState(false);
  const box = useRef(null);
  const lookupRef = useRef(lookup); lookupRef.current = lookup;
  const last = useRef(null); if (show) last.current = show.film;

  useEffect(() => {
    if (!hoverCapable()) return;
    let cur = null, timer = 0, seq = 0;
    const hide = () => { clearTimeout(timer); seq++; cur = null; setOn(false); };
    const over = e => {
      // the poster's colour line or ring names its colour instead (a small tip from Tooltip.jsx), so no card there
      if (e.target.closest?.('.fc-hit')) { if (cur) hide(); return; }
      // The app-wide card handles film links; a screen that passes `lookup` (Discover) handles its own data-pop cards.
      const card = cardFor(e.target, lookupRef.current ? '[data-pop]' : LINK);
      if (card === cur) return;
      if (!card || !card.querySelector('.poster')) { if (cur) hide(); return; }
      hide(); cur = card;
      // the browser/app title box would pop up alongside ours
      const t = card.getAttribute('title');
      if (t) { if (!card.hasAttribute('aria-label')) card.setAttribute('aria-label', t); card.removeAttribute('title'); }
      const mine = ++seq;
      timer = setTimeout(async () => {
        const id = card.dataset.pop, key = id == null ? keyOf(card) : null;
        let film = id != null ? lookupRef.current?.(id) : await fullFilm(key);
        if (mine !== seq || !film || !card.isConnected) return;
        const poster = card.querySelector('.poster').getBoundingClientRect();
        setShow({ film, rect: { left: poster.left, top: poster.top, right: poster.right, bottom: poster.bottom } });
        setPos(null); setOn(false);
      }, DELAY);
    };
    const out = e => { if (cur && cardFor(e.relatedTarget, lookupRef.current ? '[data-pop]' : LINK) !== cur) hide(); };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('keydown', hide, true);
    addEventListener('scroll', hide, true);
    addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', hide, true);
      removeEventListener('scroll', hide, true);
      removeEventListener('blur', hide);
    };
  }, []);

  // measure the real height, then place and reveal on the next frame so the grow animation runs from the poster
  useLayoutEffect(() => {
    if (!show || !box.current) return;
    const p = placePop(show.rect, { w: POP_W, h: box.current.offsetHeight }, { w: innerWidth, h: innerHeight });
    setPos(p);
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [show]);

  const f = show ? show.film : last.current;
  const fc = useFilmColour(f && f.key); // TEMP feel colours
  // once hidden, drop the card after the fade so a stale one is never left to measure
  useEffect(() => { if (!on && show) { const t = setTimeout(() => setShow(null), 220); return () => clearTimeout(t); } }, [on, show]);

  if (!f) return null;
  const url = f.poster && (f.poster.thumb || f.poster.url);
  const scores = externalScores(ratingsOf(f)).filter(s => ['letterboxd', 'rt-critics', 'imdb'].includes(s.source));
  const tags = (f.user && f.user.tags || []).slice(0, 4);
  const director = directedBy(f.people);
  const blurb = oneLine(f.synopsis) || (f.reasons && f.reasons[0]) || '';
  const style = pos ? { left: `${pos.left}px`, top: `${pos.top}px`, transformOrigin: `${pos.ox}px ${pos.oy}px` } : { left: '-9999px', top: '0' };
  return createPortal(
    <div ref={box} role="presentation" aria-hidden="true" class={`pp${on && pos ? ' pp-on' : ''}`} {...colourProps(f && f.key, fc).attrs} style={{ ...style, width: `${POP_W}px`, ...colourProps(f && f.key, fc).style }}>
      {url && <div class="pp-bg" style={{ backgroundImage: `url("${imageUrl(url)}")` }} />}
      <div class="pp-body">
        <h3 class="pp-title">{f.title}{f.year && <span class="pp-year num"> {f.year}</span>}</h3>
        {director && <p class="pp-director"><Headshot photo={f.people?.director?.[0]?.photo} name={f.people?.director?.[0]?.name} class="pp-dir-photo" lazy={false} /><span>{director}</span></p>}
        <DebugInfo title="Film" rows={{ key: f.key, score: f.score, enriched: f.enriched, sources: f.src && Object.keys(f.src).filter(k => f.src[k]) }} />
        {f.genres && f.genres.length > 0 && <p class="pp-genres">{f.genres.slice(0, 3).join(' · ')}</p>}
        {scores.length > 0 && <p class="pp-scores">{scores.map(s => <span key={s.source} class="pp-score num">{s.text}</span>)}</p>}
        {tags.length > 0 && <p class="pp-tags">{tags.map(t => <span key={t} class="pp-tag">{t}</span>)}</p>}
        {blurb && <p class="pp-blurb">{blurb}</p>}
      </div>
    </div>,
    document.body,
  );
}
