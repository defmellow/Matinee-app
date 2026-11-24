// "Awards": wins first, then newest. Shows five, with the rest behind a toggle.
import { useState } from 'preact/hooks';

const CAP = 5;

export default function Awards({ awards }) {
  const [all, setAll] = useState(false);
  if (!awards || !awards.length) return null;
  const sorted = [...awards].sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0) || (b.year || 0) - (a.year || 0));
  const shown = all ? sorted : sorted.slice(0, CAP);
  return (
    <section class="film-section film-awards">
      <h2>Awards</h2>
      <ul>
        {shown.map((a, i) => (
          <li key={i}>
            <span class={'film-badge' + (a.won ? ' won' : '')}>{a.won ? 'Won' : 'Nominated'}</span>
            <span>{a.name}{a.year ? <span class="faint num"> · {a.year}</span> : null}</span>
          </li>
        ))}
      </ul>
      {sorted.length > CAP && <button type="button" class="btn-link film-showmore" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sorted.length}`}</button>}
    </section>
  );
}
