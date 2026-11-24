// A small hovering pill at the bottom right, like a browser's status line ("Transferring data from…"). Shown only while the
// app is fetching: an on-demand request (films on screen, hovered or opened) or the visible refresh job.
// A thin line along the pill's bottom edge eases towards 80% while working, then jumps to 100% and the pill fades.
// aria-hidden: JobPill already carries the status label.
import { useEffect, useState } from 'preact/hooks';
import { useCore } from '../state.js';
import { useFetching } from './fetchnow.js';
import './loadbar.css';

export default function LoadBar() {
  const core = useCore();
  const active = useFetching() || !!(core && core.job);
  const [phase, setPhase] = useState('idle'); // idle | run | done
  const [p, setP] = useState(0.04);            // 0..1 fill
  useEffect(() => {
    if (active) {
      setPhase('run'); setP(0.08);
      // Each tick closes a slice of the gap to 80%: quick at first, then crawling, never reaching it.
      const t = setInterval(() => setP(x => x + (0.8 - x) * 0.1), 250);
      return () => clearInterval(t);
    }
    let t;
    setPhase(ph => { if (ph !== 'idle') { setP(1); t = setTimeout(() => setPhase('idle'), 500); return 'done'; } return ph; });
    return () => clearTimeout(t);
  }, [active]);
  if (phase === 'idle') return null;
  const job = core && core.job;
  const text = job && job.label ? String(job.label).replace(/\s+—\s+\d+%$/, '') : 'Loading film details…';
  return (
    <div class={`loadbar loadbar-${phase}`} aria-hidden="true">
      <span class="loadbar-text">{text}</span>
      <i style={{ transform: `scaleX(${p})` }} />
    </div>
  );
}
