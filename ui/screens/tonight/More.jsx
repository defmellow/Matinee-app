// "More like these": nine more from your watchlist, spread across different feels.
import { Poster, MatineePip, LeadScore, runtimeText } from '../../components/film.jsx';
import Why from '../../components/Why.jsx';
import { href } from '../../router.js';

export default function More({ items }) {
  if (!items.length) return null;
  return (
    <section class="tn-more" aria-label="More like these">
      <h2>More like these</h2>
      <p class="muted tn-more-sub">A mix of films.</p>
      <div class="tn-grid">
        {items.map(p => (
          <a key={p.key} class="tn-card" href={href('film', p.key)} title={p.film.title}>
            <Poster film={p.film}><MatineePip score={p.film.score} /></Poster>
            <span class="tn-card-title">{p.film.title}</span>
            <span class="faint num tn-card-meta">{[runtimeText(p.film.runtime)].filter(Boolean).join(' · ')}<LeadScore ratings={p.film.ratings} className="tn-card-score" /></span>
            <Why pick={p} compact />
          </a>
        ))}
      </div>
    </section>
  );
}
