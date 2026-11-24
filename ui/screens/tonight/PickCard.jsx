// One of tonight's three picks: role, film, scores, why, and the nudges.
import { Poster, RatingChips, runtimeText } from '../../components/film.jsx';
import Why from '../../components/Why.jsx';
import { href } from '../../router.js';
import { NUDGES } from './moods.js';

import DebugInfo, { DebugError } from '../../debug/DebugInfo.jsx';
export default function PickCard({ pick, busy, miss, onNudge, onSnooze }) {
  const f = pick.film;
  const meta = [runtimeText(f.runtime), (f.genres || []).slice(0, 3).join(', ')].filter(Boolean);
  return (
    <article class={busy ? 'tn-pick tn-busy' : 'tn-pick'} aria-label={`${pick.roleLabel}: ${f.title}`}>
      <a class="tn-pick-poster" href={href('film', f.key)} tabIndex={-1} aria-hidden="true"><Poster film={f} eager /></a>
      <div class="tn-pick-body">
        <p class="tn-role"><span class="tn-kicker">{pick.roleLabel}</span><span class="muted">{pick.roleNote}</span></p>
        <h2 class="tn-pick-title"><a href={href('film', f.key)}>{f.title}</a></h2>
        {meta.length > 0 && <p class="muted num tn-pick-meta">{meta.join(' · ')}</p>}
        {pick.nudgeNote && <p class="tn-nudge-note">{pick.nudgeNote}</p>}
        <RatingChips parts={f.scoreParts} ratings={f.ratings} />
        <Why pick={pick} />
        <DebugInfo title="Pick" rows={{ key: f.key, role: pick.role, score: f.score, 'pick score': pick.score, 'why values': pick.why && JSON.stringify(pick.why), 'score parts': f.scoreParts && JSON.stringify(f.scoreParts) }} />
        <div class="tn-actions">
          <a class="btn btn-primary" href={href('film', f.key)}>Open film</a>
          {NUDGES.map(([kind, label]) => <button type="button" key={kind} class="btn btn-small" disabled={busy} onClick={() => onNudge(kind)}>{label}</button>)}
          <button type="button" class="btn btn-small btn-ghost tn-snooze" disabled={busy} onClick={onSnooze} title="Hide it for the rest of this session">Not tonight</button>
        </div>
        {miss && <p class="tn-miss" role="status">{miss}</p>}
      </div>
    </article>
  );
}
