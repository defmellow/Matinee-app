// "Up to N minutes" slider. The right-hand end means any length; its top is the longest film in the library.
import { useEffect, useState } from 'preact/hooks';
import { useLibrary } from '../state.js';

const MIN = 60, STEP = 5, FALLBACK_MAX = 240;

/** Longest film in the library (minutes, rounded up to a step), ignoring TV; a sensible default until it loads. */
export function useLongestRuntime() {
  const lib = useLibrary();
  let top = 0;
  for (const f of (lib && lib.films) || []) if (f.kind !== 'tv' && f.runtime > top) top = f.runtime;
  return top > MIN ? Math.ceil(top / STEP) * STEP : FALLBACK_MAX;
}

export const runtimeText = m => {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
};

/** value: minutes, or 0/null for any. onChange(minutes | 0) fires when you let go, not on every step of the drag. */
export default function RuntimeSlider({ value, onChange, label, zero = 0 }) {
  const max = useLongestRuntime();
  const current = value > 0 ? Math.min(value, max) : max;
  const [live, setLive] = useState(current);
  useEffect(() => setLive(current), [current]);
  const any = live >= max;
  const commit = v => { const m = Number(v); onChange(m >= max ? zero : m); };
  return (
    <div class="runtime-slider">
      <input type="range" min={MIN} max={max} step={STEP} value={live} aria-label={label}
        style={{ '--pct': `${max > MIN ? Math.round(((live - MIN) / (max - MIN)) * 100) : 100}%` }}
        aria-valuetext={any ? 'Any length' : `Up to ${runtimeText(live)}`}
        onInput={e => setLive(Number(e.currentTarget.value))}
        onChange={e => commit(e.currentTarget.value)} />
      <output class="runtime-out">{any ? 'Any length' : `Up to ${runtimeText(live)}`}</output>
    </div>
  );
}
