// One month (or the "Just opened" group) of the Upcoming screen: a heading and poster cards with a date line.
import { FilmCard, dateText } from '../../components/film.jsx';

export const dayLabel = iso => dateText(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');

export function UpcomingCard({ item, eager }) {
  return (
    <div class="upc-card">
      <FilmCard film={item.film} show="score" eager={eager} pip />
      <div class="upc-when">
        <span class="upc-date num">{dayLabel(item.date)}</span>
        {item.type === 'Theatrical (limited)' && <span class="faint"> · limited release</span>}
      </div>
      {item.onWatchlist && <span class="upc-badge">On your watchlist</span>}
    </div>
  );
}

export default function Group({ title, subtitle, items }) {
  return (
    <section class="upc-group" aria-label={title}>
      <header class="upc-group-head">
        <h2>{title}</h2>
        {subtitle && <p class="muted">{subtitle}</p>}
      </header>
      <div class="film-grid">
        {items.map(it => <UpcomingCard key={it.film.key} item={it} />)}
      </div>
    </section>
  );
}
