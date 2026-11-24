// Result grid: poster cards with the reason they matched, skeletons while loading, empty states.
import { href } from '../../router.js';
import { Poster, EmptyState } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { reasonLines, tierFor, matchTitle } from './model.js';

import DebugInfo, { DebugError } from '../../debug/DebugInfo.jsx';
// The reason a film came up goes with you into its page (kept for this session), so it isn't lost when you click in.
function rememberWhy(key, heading, lines, tier) {
  try { sessionStorage.setItem('feelWhy:' + key, JSON.stringify({ heading, lines, tier })); } catch { /* ignore */ }
}

function Card({ r, best, heading }) {
  const f = r.film, u = f.user || {};
  const lines = reasonLines(r, 2);
  const allLines = reasonLines(r, 6);
  const tier = tierFor(r.score, best, r);
  return (
    <li class="byf-card">
      <a href={href('film', f.key)} onClick={() => rememberWhy(f.key, heading, allLines, tier.label)} title={`${f.title}${f.year ? ` (${f.year})` : ''}`}>
        <Poster film={f}>
          {u.watched && <span class="badge-corner byf-state" title="You've watched this"><Icon name="check" size={12} /></span>}
          {!u.watched && u.watchlist && <span class="badge-corner byf-state" title="On your watchlist"><Icon name="clock" size={12} /></span>}
        </Poster>
        <span class="byf-badges">
          <span class={'byf-tier byf-tier-' + tier.id} title={matchTitle(r, tier, best)}><Icon name="sparkle" size={11} />{tier.label}</span>
          {r.rough && <span class="byf-rough" title="Little has been written about this film, so how it feels is a rough guess">rough guess</span>}
        </span>
        <div class="meta"><span class="title">{f.title}</span>{f.year && <span class="faint num">{f.year}</span>}</div>
      </a>
      <DebugInfo title="Match" rows={{ key: f.key, score: r.score != null ? Number(r.score).toFixed(3) : '', tier: tier.label, 'of best': best ? Number(r.score / best).toFixed(2) : '' }} />
      {lines.length > 0 && <p class="byf-why">{lines.join(' · ')}</p>}
    </li>
  );
}

export function Skeleton({ n = 12 }) {
  return <ul class="film-grid byf-grid" aria-busy="true" aria-label="Looking for films">{Array.from({ length: n }, (_, i) => <li key={i} class="byf-card byf-skel"><div class="poster" /><div class="byf-skel-l" /><div class="byf-skel-l short" /></li>)}</ul>;
}

export default function Results({ results, loading, note, empty, heading, error, onRetry }) {
  if (loading && !results) return <Skeleton />;
  if (error && !results) return <EmptyState title="Couldn't look just now" action={onRetry && <button type="button" class="btn btn-primary" onClick={onRetry}>Try again</button>}>Something went wrong while looking. Try again in a moment.</EmptyState>;
  if (!results) return null;
  if (!results.length) return empty;
  const best = Math.max(0, ...results.map(r => r.score || 0));
  return (
    <div class="byf-results" data-loading={String(!!loading)}>
      <div class="byf-results-h">
        {heading && <h2 class="byf-h2">{heading}</h2>}
        <span class="faint num">{results.length} {results.length === 1 ? 'film' : 'films'}</span>
      </div>
      <DebugInfo title="Results" rows={{ films: results.length, 'best score': best.toFixed(3), loading }} />
      {note && <p class="byf-note"><Icon name="tag" size={14} />{note}</p>}
      <ul class="film-grid byf-grid">{results.map(r => <Card key={r.key} r={r} best={best} heading={heading} />)}</ul>
    </div>
  );
}

export const NoMatches = ({ onClear, children }) => (
  <EmptyState title="No films feel like that" action={onClear && <button type="button" class="btn btn-primary" onClick={onClear}>Try fewer filters</button>}>{children || 'Take a filter off, or describe it in fewer words.'}</EmptyState>
);
