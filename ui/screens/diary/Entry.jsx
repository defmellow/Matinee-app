// One row of the timeline: day, poster, title, stars, icons, review, tags.
import { useState } from 'preact/hooks';
import { Poster, Stars, LeadScore } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { href } from '../../router.js';
import { Chip } from '../../components/ui.jsx';
import { filterHref } from '../../components/chip.js';

const LONG = 150; // characters before a review gets a "Read more"

function Review({ text, spoiler }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(!spoiler);
  if (!shown) return <button type="button" class="btn-link diary-link" onClick={() => setShown(true)}>Contains spoilers. Show</button>;
  const long = text.length > LONG || text.includes('\n');
  return (
    <div class="diary-review">
      <p class={open ? '' : 'clamp'}>{text}</p>
      {long && <button type="button" class="btn-link diary-link" aria-expanded={String(open)} onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Read more'}</button>}
    </div>
  );
}

export default function Entry({ entry }) {
  const f = entry.film;
  const day = Number(entry.date.slice(8, 10));
  const weekday = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' });
  const review = typeof entry.review === 'string' ? entry.review.trim() : '';
  return (
    <li class="diary-entry">
      <div class="diary-day"><span class="num">{day}</span><small>{weekday}</small></div>
      <a class="diary-poster" href={href('film', f.key)} tabIndex={-1} aria-hidden="true"><Poster film={f} /></a>
      <div class="diary-body">
        <div class="diary-line">
          <a class="diary-title" href={href('film', f.key)}>{f.title}</a>
          {f.year && <span class="faint num">{f.year}</span>}
        </div>
        <div class="diary-meta">
          {entry.rating != null && <Stars rating={entry.rating} />}
          {entry.liked && <span class="diary-heart"><Icon name="heart" size={15} title="Liked" fill="currentColor" /></span>}
          {entry.rewatch && <span class="diary-rewatch muted"><Icon name="rewatch" size={15} title="Rewatch" /></span>}
          <LeadScore ratings={f.ratings} className="diary-score" />
        </div>
        {review && <Review text={review} spoiler={entry.spoiler} />}
        {entry.tags && entry.tags.length > 0 && <div class="chips diary-tags">{entry.tags.map(t => <Chip key={t} href={filterHref('tag', t)} title={`Your films tagged ${t}`}>{t}</Chip>)}</div>}
      </div>
    </li>
  );
}
