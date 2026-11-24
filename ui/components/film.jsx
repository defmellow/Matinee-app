// Film building blocks shared by every screen: Poster, FilmCard, Stars, Score, RatingChips, formatting helpers.
import { imageUrl, openExternal } from '../api.js';
import { href } from '../router.js';
import './film.css';
import Icon from './Icon.jsx';
import StatusBadge from './StatusBadge.jsx';
import { orderParts, primaryScore } from './scores.js';
import { sourceLines } from './sourceNotes.js';
import { useFilmColour, colourProps, filmTip } from '../feel-colours.js'; // feel colours

// ---------- formatting ----------
/** 1–10 half-stars → "★★★★½" */
export function starText(r) {
  if (r == null) return '';
  return '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : '');
}
export function runtimeText(min) {
  if (!min) return null;
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? ` ${m} m` : ''}` : `${m} m`;
}
export function compact(n) {
  if (n == null) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(n);
}
export function dateText(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-AU', opts);
}
export const scoreBand = s => (s == null ? null : s >= 82 ? 'high' : s >= 72 ? 'mid' : 'low');

// ---------- Poster ----------
function hue(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }

// Posters fade in when they load. One already in the browser cache is complete at mount, so it is shown at once (no flash).
// Runs at ref time, before the first paint; classes are toggled directly so hundreds of cards don't re-render.
function showIfCached(img) {
  if (img && img.complete && img.naturalWidth > 0) img.classList.add('is-in', 'no-fade');
}

/** Poster with a typographic fallback card when there's no image (or it fails to load). */
export function Poster({ film, eager = false, children }) {
  const url = film && film.poster && (film.poster.thumb || film.poster.url);
  const h = hue((film && film.title) || '');
  const fc = useFilmColour(film && film.key); // TEMP feel colours: the film's own colour while F8 is on
  const cp = colourProps(film && film.key, fc); // a film torn between two feelings gets both (split ring)
  return (
    <div class="poster" {...cp.attrs} style={cp.style || undefined}>
      <div class="poster-fallback" style={{ background: `linear-gradient(160deg, hsl(${h} 35% 30%), hsl(${(h + 40) % 360} 40% 14%))` }}>
        <span class="t">{film && film.title}</span>
        {film && film.year && <span class="y">{film.year}</span>}
      </div>
      {url && <img key={url} ref={showIfCached} class="poster-img" src={imageUrl(url)} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" style={{ position: 'relative' }} onLoad={e => e.currentTarget.classList.add('is-in')} onError={e => { e.currentTarget.style.display = 'none'; }} />}
      {children}
      {/* the colour line or ring's own hover spot: pointing at it names the colour (feel-colours.css places it over the line or ring) */}
      {fc && filmTip(film.key) ? <i class="fc-hit" aria-hidden="true" data-feel-tip={filmTip(film.key)} /> : null}
    </div>
  );
}

// ---------- Stars ----------
export function Stars({ rating, size }) {
  if (rating == null) return null;
  return <span class="stars" style={size ? { fontSize: size } : null} aria-label={`${rating / 2} stars`}>{starText(rating)}</span>;
}

// ---------- Score (the blended Matinee score) ----------
export function Score({ score, title = 'Matinee score: a blend of multiple sources' }) {
  if (score == null) return <span class="score" title="Not enough ratings yet">–</span>;
  return <span class="score" data-band={scoreBand(score)} title={title || undefined}>{score}</span>;
}

/** A small, quiet Matinee score for a poster corner. Always secondary to the Letterboxd score; renders nothing without a score. */
export function MatineePip({ score }) {
  if (score == null) return null;
  return <span class="matinee-pip num" data-tip="Matinee score: a blend of multiple sources">{score}</span>;
}

/**
 * Wraps a rating so hovering or focusing it opens a short note: who rates it, how it tends to score, how to read it,
 * and how this film compares. `part` is a score part ({ source, label, value100, … }); `heading` is the first line.
 */
let popId = 0;
export function SourcePop({ part, heading, class: cls = '', children }) {
  const lines = part && sourceLines(part);
  if (!lines) return <div class={cls} title={heading}>{children}</div>;
  const id = `src-pop-${++popId}`;
  return (
    <div class={`src-pop-host ${cls}`.trim()} tabIndex={0} aria-describedby={id}>
      {children}
      <div class="src-pop" role="tooltip" id={id}>
        <p class="src-pop-head">{heading || part.label}</p>
        {lines.map(l => <p key={l.kind} class={`src-pop-${l.kind}`}>{l.text}</p>)}
      </div>
    </div>
  );
}

/** parts: [{ source, label, display, value100, weight }] from the core's matineeScore(); counts optional. */
export function RatingChips({ parts = [], ratings = {}, skip = null }) {
  parts = orderParts(parts).filter(p => p.source !== skip);
  if (!parts.length) return skip ? null : <p class="muted">No outside ratings yet.</p>; // with a lead score shown beside it, "none yet" would contradict it
  const count = src => {
    const r = { letterboxd: ratings.letterboxd?.votes, imdb: ratings.imdb?.votes, rt: ratings.rt?.criticsCount, popcorn: ratings.rt?.audienceCount, metacritic: ratings.metacritic?.criticsCount, tmdb: ratings.tmdb?.votes }[src];
    return r ? compact(r) + (src === 'rt' || src === 'metacritic' ? ' reviews' : ' votes') : null;
  };
  const chipTitle = p => { const c = count(p.source); return c ? `${p.display} (${c})` : p.display; };
  return (
    <div class="rating-chips">
      {parts.map(p => (
        <SourcePop key={p.source} part={p} heading={chipTitle(p)} class="rating-chip">
          <span class="src">{p.label}</span>
          <span class="val">{p.display.replace(/^[^\d]*/, '')}</span>
          {count(p.source) && <span class="cnt">{count(p.source)}</span>}
        </SourcePop>
      ))}
    </div>
  );
}

/** The lead outside score as a labelled tag: Letterboxd "★ 3.94", else the next source ("RT 92%"). Renders nothing if none. */
export function LeadScore({ ratings, className = 'lead-score' }) {
  const p = primaryScore(ratings);
  if (!p) return null;
  return <span class={className} title={p.title}>{p.text}</span>;
}

// ---------- FilmCard ----------
/** A poster tile linking to the film page. `show` picks the corner badge: 'rating' (yours), 'score', or null. `pip` adds the small Matinee score bottom-right. */
export function FilmCard({ film, show = 'rating', eager, pip = false }) {
  const u = film.user || {};
  return (
    <a class="film-card" href={href('film', film.key)} title={`${film.title}${film.year ? ` (${film.year})` : ''}`} style={{ textDecoration: 'none' }}>
      <Poster film={film} eager={eager}>
        {show === 'score' && (() => {
          const p = primaryScore(film.ratings);
          if (p) return <span class="badge-corner" title={p.title} role="img" aria-label={p.title}>{p.text}</span>;
          return film.score != null ? <span class="badge-corner" title="Matinee score: a blend of multiple sources">Matinee {film.score}</span> : null;
        })()}
        {pip && !(show === 'score' && !primaryScore(film.ratings)) && <MatineePip score={film.score} />}
        {show === 'rating' && u.liked && <span class="badge-heart" title="Liked"><Icon name="heart" size={13} fill="currentColor" /><span class="sr-only">Liked</span></span>}
      </Poster>
      <div class="meta">
        <span class="title">{film.title}</span>
        {film.year && <span class="faint num">{film.year}</span>}
      </div>
      {show === 'rating' && u.rating != null && <Stars rating={u.rating} size="12px" />}
      {show === 'rating' && u.rating == null && <StatusBadge user={u} />}
    </a>
  );
}

/**
 * THE tile for a film that isn't in the library ("outside film"), on every screen that shows one (person pages, series).
 * Same size and text as FilmCard; marked "Letterboxd ↗", with "Open on Letterboxd" over the poster on hover or focus.
 * `film`: { title, year, poster (url string or { url, thumb }), url } (core: letterboxdUrl in core/features/shared.js).
 * `class` adds the screen's own layout class; `badge` goes in the poster corner; children go under the tile's text.
 */
export function OutsideFilmCard({ film, class: cls = '', badge = null, children }) {
  const poster = typeof film.poster === 'string' ? { url: film.poster } : film.poster || null;
  const label = `Open ${film.title} on Letterboxd`;
  const inner = <>
    <Poster film={{ title: film.title, year: film.year, poster }}>
      {badge}
      {film.url && <span class="out-hover" aria-hidden="true"><span>Open on Letterboxd <Icon name="external" /></span></span>}
    </Poster>
    <div class="meta"><span class="title">{film.title}</span>{film.year && <span class="faint num">{film.year}</span>}</div>
    <span class="faint out-note">{film.url ? <>Letterboxd <Icon name="external" /></> : 'Not in your library'}</span>
    {children}
  </>;
  const c = `film-card out-card ${cls}`.trim();
  return film.url
    ? <a class={c} href={film.url} aria-label={label} onClick={e => { e.preventDefault(); openExternal(film.url); }}>{inner}</a>
    : <div class={c}>{inner}</div>;
}

export function EmptyState({ title, children, action }) {
  return (
    <div class="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
