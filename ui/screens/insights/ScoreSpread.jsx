// "Matinee scores of what you've watched": a histogram in tens, with the range most films fall in highlighted.
import { MATINEE_TYPICAL as T } from '../../components/matineeTypical.js';
import Bars from './Bars.jsx';
import { Section, Thin } from './parts.jsx';
import { filterHref } from '../../components/chip.js';

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Counts of scores per ten points (0–9 … 90–100), as the chart's rows, trimmed of empty tens at both ends. Each bar links
 * to the Library with that range typed as a search (score:70-79): the Library's own Matinee score filter has no upper end.
 */
export function spreadBins(scores) {
  const counts = Array(10).fill(0);
  for (const s of scores) counts[Math.min(9, Math.max(0, Math.floor(s / 10)))]++;
  const first = counts.findIndex(c => c > 0);
  const last = counts.length - 1 - [...counts].reverse().findIndex(c => c > 0);
  const rows = [];
  for (let i = first; i <= last && first >= 0; i++) {
    const lo = i * 10, hi = i === 9 ? 100 : lo + 9;
    rows.push({ label: `${lo}s`, value: counts[i], hot: lo + 5 >= T.low && lo + 5 <= T.high, title: `${lo}–${hi}: ${counts[i]} ${counts[i] === 1 ? 'film' : 'films'}`, href: filterHref('text', `score:${lo}-${hi}`) });
  }
  return rows;
}

export default function ScoreSpread({ films }) {
  const scores = (films || []).filter(f => f.user && f.user.watched && Number.isFinite(f.score)).map(f => f.score);
  let body;
  if (scores.length < 5) body = <Thin>Watch a few more films with scores to see how yours compare.</Thin>;
  else {
    const med = median(scores);
    const diff = med - T.median;
    const lean = diff > 3 ? 'You tend to watch films that score above the typical film.' : diff < -3 ? 'You tend to watch films that score below the typical film.' : 'The films you watch score about the same as the typical film.';
    body = (
      <>
        <Bars data={spreadBins(scores)} height={120} />
        <p class="ins-summary">Your middle film scores {Math.round(med)}. {lean}</p>
        <p class="faint ins-note">Highlighted: the range most films fall in ({T.low}–{T.high}, centred on {T.median}), measured across a whole library. {scores.length} watched films with a score.</p>
      </>
    );
  }
  return <Section title="Matinee scores of what you've watched" wide>{body}</Section>;
}
