// A world map of where your films come from: grey = none yet, warmer = more. Click a country to open it in the Library.
import { useMemo } from 'preact/hooks';
import { WORLD_MAP, WORLD_VIEWBOX } from '../../data/world-map.js';
import { tallyCountries, colourStep, countText, STEPS } from './countryMap.js';
import { normalise } from '../library/model.js';
import { go } from '../../router.js';
import './countries.css';

export default function CountriesMap({ films }) {
  const t = useMemo(() => tallyCountries(films || []), [films]);
  const [w, h] = WORLD_VIEWBOX;

  const open = id => {
    const names = t.names.get(id);
    if (!names) return;
    // The Library keeps its filter in this saved preference; set it, then open the Library.
    try { localStorage.setItem('pref:library.query', JSON.stringify({ ...normalise(null), status: 'watched', countries: names })); } catch { /* ignore */ }
    go('library');
  };
  const onClick = e => { const id = e.target.getAttribute && e.target.getAttribute('data-id'); if (id) open(id); };
  const onKey = e => { if (e.key === 'Enter' || e.key === ' ') { const id = e.target.getAttribute('data-id'); if (id) { e.preventDefault(); open(id); } } };

  const missing = [...t.missing].sort((a, b) => b[1] - a[1]);
  return (
    <div class="cmap">
      <svg class="cmap-svg" viewBox={`0 0 ${w} ${h}`} role="group" aria-label="World map of countries you have watched films from" onClick={onClick} onKeyDown={onKey}>
        {WORLD_MAP.map(c => {
          const n = t.counts.get(c.id) || 0;
          return (
            <path key={c.id} d={c.d} data-id={c.id} class={'cmap-c s' + colourStep(n, t.max)}
              {...(n ? { tabIndex: 0, role: 'link', 'aria-label': countText(c.name, n) } : {})}>
              <title>{n ? countText(c.name, n) : `${c.name}: no films yet`}</title>
            </path>
          );
        })}
      </svg>
      <div class="cmap-legend faint" aria-hidden="true">
        <span>No films</span><i class="cmap-key s0" />
        <span>Fewer</span>{Array.from({ length: STEPS }, (_, i) => <i key={i} class={'cmap-key s' + (i + 1)} />)}<span>More</span>
      </div>
      {missing.length > 0 && (
        <p class="faint cmap-missing">Not on the map: {missing.map(([name, n]) => `${name} (${n})`).join(', ')}</p>
      )}
    </div>
  );
}

