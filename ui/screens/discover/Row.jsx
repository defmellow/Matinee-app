// One Discover section: a header and a horizontally scrolling row of cards.
import { lessMotion } from '../../motion.js';
import { useRef } from 'preact/hooks';
import { Poster } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { rowScores } from '../../components/scores.js';

export function DiscoverCard({ item, onOpen }) {
  const score = rowScores(item.ratings, item.imdb)[0];
  return (
    <button type="button" class="disc-card" data-pop={item.id} onClick={() => onOpen(item)} title={`${item.title}${item.year ? ` (${item.year})` : ''}`}>
      <Poster film={item}>{item.kind === 'tv' && <span class="disc-tv">TV</span>}</Poster>
      <span class="disc-title">{item.title}</span>
      <span class="disc-meta faint num">
        {item.year}{score && <>{item.year ? ' · ' : ''}<span title={score.title}>{score.text}</span></>}
      </span>
      {item.reasons?.[0] && <span class="disc-reason">{item.reasons[0]}</span>}
    </button>
  );
}

export default function Row({ section, onOpen }) {
  const ref = useRef();
  const scroll = dir => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: lessMotion() ? 'auto' : 'smooth' });
  return (
    <section class="disc-section" aria-label={section.title}>
      <header class="disc-section-head">
        <h2>{section.title}</h2>
        {section.subtitle && <p class="muted">{section.subtitle}</p>}
      </header>
      <div class="disc-rowwrap">
        <button type="button" class="icon-btn disc-arrow left" onClick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevron" /></button>
        <div class="disc-row" ref={ref}>
          {section.items.map(it => <DiscoverCard key={it.id} item={it} onOpen={onOpen} />)}
        </div>
        <button type="button" class="icon-btn disc-arrow right" onClick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevron" /></button>
      </div>
    </section>
  );
}
