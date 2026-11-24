// The top of the film page: backdrop band, poster, title, meta, score row and links.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Poster, Stars, Score, RatingChips, SourcePop, runtimeText } from '../../components/film.jsx';
import { primaryScore } from '../../components/scores.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import Icon from '../../components/Icon.jsx';
import { Chip } from '../../components/ui.jsx';
import { filterHref } from '../../components/chip.js';
import { imageUrl, openExternal } from '../../api.js';
import { href } from '../../router.js';
import { hueOf } from './format.js';
import PosterPicker from '../../components/PosterPicker.jsx';
import CastCard, { hasCastCard } from './CastCard.jsx';
import { FetchPillButton, FetchPanel } from '../../components/FetchPill.jsx';

const MORE = [['imdb', 'IMDb'], ['wikipedia', 'Wikipedia'], ['rt', 'Rotten Tomatoes'], ['metacritic', 'Metacritic'], ['tmdb', 'TMDB']];

function MoreLinks({ links }) {
  const ref = useRef();
  const items = MORE.filter(([k]) => links[k]);
  useEffect(() => {
    const close = e => { if (ref.current && ref.current.open && !ref.current.contains(e.target)) ref.current.open = false; };
    addEventListener('mousedown', close);
    return () => removeEventListener('mousedown', close);
  }, []);
  if (!items.length) return null;
  return (
    <details class="film-more" ref={ref} onKeyDown={e => {
      if (e.key === 'Escape' && ref.current.open) { e.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus(); }
    }}>
      <summary class="btn"><Icon name="external" />More links</summary>
      <div class="film-more-menu">
        {items.map(([k, label]) => (
          <button type="button" key={k} onClick={() => { ref.current.open = false; openExternal(links[k]); }}>{label}</button>
        ))}
      </div>
    </details>
  );
}

// Long synopses (Wikipedia's can run to a paragraph of cast names) are clamped to a few lines with a toggle.
function Synopsis({ text }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 380;
  return (
    <>
      <p class={long && !open ? 'film-clamp' : ''}>{text}</p>
      {long && <button type="button" class="btn-link film-showmore" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read more'}</button>}
    </>
  );
}

export default function Hero({ film, fetch: fetchState = {} }) {
  const [picking, setPicking] = useState(false);
  const [panel, setPanel] = useState(false);
  const [posterUrl, setPosterUrl] = useState(null); // shown at once after a pick, until the refreshed film arrives
  useEffect(() => { setPosterUrl(null); }, [film.poster && film.poster.url, film.key]);
  const shown = posterUrl ? { ...film, poster: { url: posterUrl } } : film;
  const { status, running, busy, retry } = fetchState;
  const panelId = 'film-fetchpanel';
  const u = film.user || {};
  const directors = film.people?.director || [];
  const backdrop = film.backdrop && imageUrl(film.backdrop);
  const hue = hueOf(film.title);
  const lead = primaryScore(film.ratings);
  const meta = [];
  if (film.year) meta.push(<a class="film-link num" key="y" href={filterHref('text', `year:${film.year}`)} title={`Films from ${film.year} in your library`}>{film.year}</a>);
  if (film.runtime) meta.push(<span class="num" key="r">{runtimeText(film.runtime)}</span>);
  if (directors.length) meta.push(
    <span key="d">Directed by {directors.map((d, i) => <span key={d.id || d.name}>{i > 0 && ', '}<a class="film-link" href={href('person', d.id || d.name, { role: 'director' })} data-photo={d.photo || undefined} data-as="Director">{d.name}</a></span>)}</span>
  );
  if (film.certification) meta.push(<span class="film-cert" key="c">{film.certification}</span>);

  return (
    <header class="film-hero">
      <div class="film-band" style={backdrop ? null : { background: `color-mix(in srgb, hsl(${hue} 45% 45%) 22%, var(--bg))` }} aria-hidden="true">
        {backdrop && <img src={backdrop} alt="" decoding="async" onError={e => { e.currentTarget.style.display = 'none'; }} />}
      </div>
      <div class={'film-hero-body' + (hasCastCard(film.people) ? ' has-card' : '')}>
        <div class="film-poster">
          <button type="button" class="film-poster-btn" aria-label="Change poster" title="Change poster" onClick={() => setPicking(true)}><Poster film={shown} eager /></button>
        </div>
        <div class="film-head">
          <h1 class="film-title">{film.title}</h1>
          {film.originalTitle && film.originalTitle !== film.title && <p class="muted film-orig">{film.originalTitle}</p>}
          <p class="film-meta muted">{meta.map((m, i) => <span key={i} class="film-meta-item">{m}</span>)}</p>
          {film.genres?.length > 0 && <div class="chips">{film.genres.map(g => <Chip key={g} href={filterHref('genre', g)} title={`More ${g} films in your library`}>{g}</Chip>)}</div>}
          <div class="film-scores">
            {lead && (
              <SourcePop class="film-score-main" part={(film.scoreParts || []).find(p => p.source === lead.source)} heading={lead.title}>
                <span class="film-lead num">{lead.text}</span>
                <span class="eyebrow">{lead.label}</span>
              </SourcePop>
            )}
            <RatingChips parts={film.scoreParts} ratings={film.ratings} skip={lead?.source} />
            <SourcePop class="film-score-main film-score-matinee" part={film.score != null ? { source: 'matinee', value100: film.score, label: 'Matinee score' } : null} heading="Matinee score">
              <Score score={film.score} title={null} />
              <span class="eyebrow">Matinee score</span>
            </SourcePop>
          </div>
          {(u.rating != null || u.liked || u.watched || u.watchlist) && (
            <div class="film-yours">
              <span class="eyebrow">You</span>
              <StatusBadge user={u} href={filterHref('status', u.watched ? 'watched' : 'watchlist')} />
              <Stars rating={u.rating} size="20px" />
              {u.liked && <Chip class="film-liked" href={filterHref('status', 'liked')} title="Films you have liked"><Icon name="heart" size={14} />Liked</Chip>}
            </div>
          )}
          <div class="film-actions">
            {film.links?.letterboxd && <button type="button" class="btn btn-primary" onClick={() => openExternal(film.links.letterboxd)}><Icon name="external" />Open on Letterboxd</button>}
            <MoreLinks links={film.links || {}} />
            <FetchPillButton status={status} running={running} open={panel} panelId={panelId} onToggle={() => setPanel(o => !o)} />
          </div>
          {panel && <FetchPanel id={panelId} status={status} busy={busy} onRetry={retry} />}
          {!film.tagline && !film.synopsis && running && <p class="muted film-looking" aria-live="polite">Looking this up…</p>}
          {(film.tagline || film.synopsis) && (
            <div class="film-synopsis">
              {film.tagline && <p class="film-tagline">{film.tagline}</p>}
              {film.synopsis && <Synopsis text={film.synopsis} key={film.key} />}
            </div>
          )}
        </div>
        {hasCastCard(film.people) && <CastCard people={film.people} />}
      </div>
      {picking && <PosterPicker filmKey={film.key} title={film.title} onClose={() => setPicking(false)} onPick={(source, url) => url && setPosterUrl(url)} />}
    </header>
  );
}
