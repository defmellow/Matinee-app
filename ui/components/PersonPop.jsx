import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { call, on, imageUrl } from '../api.js';
import { href } from '../router.js';
import DebugInfo from '../debug/DebugInfo.jsx';
import Icon from './Icon.jsx';
import { starText } from './film.jsx';
import Headshot from './Headshot.jsx';
import { PERSON_POP_W, PERSON_DELAY, PERSON_WARM_MS, personIdOf, prefetchPerson, libraryFacts, libraryLine, placeBeside } from './personpop.js';
import './personpop.css';

const LINK = 'a[href^="#/person/"]';
const hoverCapable = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

// What the library knows about a person: one local read (getPerson, no network), kept for the session and dropped when the library changes.
const factsCache = new Map(); // person id -> Promise<facts | null>
function factsFor(id) {
  if (!factsCache.has(id)) {
    factsCache.set(id, call('getPerson', { id, name: id }).then(p => libraryFacts(p.films), () => null));
  }
  return factsCache.get(id);
}

/**
 * A small card that appears beside a person's name after the pointer rests on it for a moment (PERSON_DELAY): headshot, name, their job on this film,
 * what you've seen of theirs, and a scrolling strip of posters of ALL their films in the library that have their own page (watched, watchlist or anything else).
 * Mounted once (app.jsx); it listens for hover on any person link, so every name in the app gets it. Links can add data-photo (TMDB path) and data-as
 * ("Director", "as Nina Sayers") for the headshot and job line. It reads local data only and is fixed-position (never shifts the page).
 * With no poster strip it ignores the pointer and closes at once on leave. With a strip it stays open while the pointer moves from the name into the card
 * (a short grace period), so the posters can be clicked. Either way it closes on click elsewhere, key press, scroll of the page, navigation or window blur.
 * Once a card has just closed, moving to the next name opens at once (no second wait).
 */
export default function PersonPop() {
  const [show, setShow] = useState(null); // { id, name, photo, as, rect, facts }
  const [pos, setPos] = useState(null);
  const [on_, setOn] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!hoverCapable()) return undefined;
    let cur = null, timer = 0, leave = 0, seq = 0, warmUntil = 0, shown = false;
    const inCard = n => !!(n && box.current && box.current.contains(n));
    const live = () => !!(box.current && box.current.classList.contains('ppl-live'));
    const hide = () => {
      clearTimeout(timer); clearTimeout(leave); seq++; cur = null;
      if (shown) { shown = false; warmUntil = Date.now() + PERSON_WARM_MS; }
      setOn(false);
    };
    const over = e => {
      if (inCard(e.target)) { clearTimeout(leave); return; }
      const a = e.target.closest && e.target.closest(LINK);
      if (a === cur) { clearTimeout(leave); return; }
      if (!a) { if (cur && !(shown && live())) hide(); return; } // a live card closes on its own timer, so the gap between name and card can be crossed
      hide(); cur = a;
      const t = a.getAttribute('title'); // the native tooltip would pop up alongside ours
      if (t) { if (!a.hasAttribute('aria-label')) a.setAttribute('aria-label', t); a.removeAttribute('title'); }
      const id = personIdOf(a.getAttribute('href'));
      if (!id) return;
      const mine = ++seq, facts = factsFor(id); // start the local read now, so it is ready when the wait is over
      const open = async () => {
        if (mine !== seq || !a.isConnected) return;
        prefetchPerson(id, call); // fire and forget: never delays the card
        const f = await facts;
        if (mine !== seq || !a.isConnected) return;
        const r = a.getBoundingClientRect();
        // inside a list card (data-pop-side), sit beside the whole card, level with the name, so no row of the list is covered
        const side = a.closest('[data-pop-side]'), sr = side && side.getBoundingClientRect();
        shown = true;
        setShow({ id, name: (a.textContent || '').trim(), photo: a.dataset.photo || null, as: a.dataset.as || '', rect: { left: sr ? sr.left : r.left, top: r.top, right: sr ? sr.right : r.right, bottom: r.bottom }, facts: f });
        setPos(null); setOn(false);
      };
      const wait = Date.now() < warmUntil ? 0 : PERSON_DELAY;
      if (wait) timer = setTimeout(open, wait); else open();
    };
    const out = e => {
      if (!cur) return;
      const to = e.relatedTarget;
      if (to && (cur.contains(to) || inCard(to))) return;
      if (!(cur.contains(e.target) || inCard(e.target))) return;
      if (shown && live()) { clearTimeout(leave); leave = setTimeout(hide, 180); } else hide();
    };
    const mousedown = e => { if (!inCard(e.target)) hide(); };
    const scroll = e => { if (!inCard(e.target)) hide(); };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('mousedown', mousedown, true);
    addEventListener('hashchange', hide);
    document.addEventListener('keydown', hide, true);
    addEventListener('scroll', scroll, true);
    addEventListener('blur', hide);
    const unsub = on('library', () => factsCache.clear());
    return () => {
      hide(); unsub && unsub();
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('mousedown', mousedown, true);
      removeEventListener('hashchange', hide);
      document.removeEventListener('keydown', hide, true);
      removeEventListener('scroll', scroll, true);
      removeEventListener('blur', hide);
    };
  }, []);

  // measure the real height off-screen, place beside the name, then reveal
  useLayoutEffect(() => {
    if (!show || !box.current) return undefined;
    setPos(placeBeside(show.rect, { w: PERSON_POP_W, h: box.current.offsetHeight }, { w: innerWidth, h: innerHeight }));
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [show]);

  if (!show) return null;
  const f = show.facts;
  const rich = f ? f.rich : [];
  const style = pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: '-9999px', top: '0' };
  return createPortal(
    <div ref={box} role="presentation" aria-hidden="true" class={`ppl${on_ && pos ? ' ppl-on' : ''}${rich.length ? ' ppl-live' : ''}`} style={{ ...style, width: `${PERSON_POP_W}px` }}>
      <div class="ppl-top">
        <Headshot photo={show.photo} name={show.name} class="ppl-photo" lazy={false} />
        <div class="ppl-who">
          <p class="ppl-name">{show.name}</p>
          {show.as && <p class="ppl-as">{show.as}</p>}
        </div>
      </div>
      {f && <p class="ppl-lib">{libraryLine(f)}</p>}
      {rich.length > 0 && (
        <div class="ppl-posters">
          {rich.map(m => <PosterLink key={m.key} m={m} />)}
        </div>
      )}
      {f && <DebugInfo title="Hover card" rows={{ 'with a page and poster': rich.length, 'in your library': f.inLibrary }} />}
    </div>,
    document.body,
  );
}

/** One small poster: opens the film page. Watched shows your stars (or a tick when unrated); the watchlist shows a clock. */
function PosterLink({ m }) {
  const u = m.user || {};
  const name = m.year ? `${m.title} (${m.year})` : m.title;
  return (
    <a class="ppl-film" href={href('film', m.key)} title={name} aria-label={name} tabIndex={-1}>
      <img class="ppl-poster" src={imageUrl(m.poster.thumb || m.poster.url)} alt="" loading="lazy" decoding="async" />
      {u.watched
        ? <span class="ppl-mark">{u.rating != null ? starText(u.rating) : <Icon name="check" size={10} />}</span>
        : u.watchlist && <span class="ppl-mark"><Icon name="clock" size={10} /></span>}
    </a>
  );
}
