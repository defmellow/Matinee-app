// "Start from a film": the chosen film's feel, emphasis control and direction buttons.
import { call } from '../../api.js';
import { useCall } from '../../state.js';
import { href } from '../../router.js';
import { Poster } from '../../components/film.jsx';
import { Segmented, Badge, Chip } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { EMPHASIS, SCOPES, voiceLabel } from './model.js';

export default function FilmPanel({ film, feel, axes, emphasis, onEmphasis, shift, onShift, scope, onScope, onChange }) {
  const sum = feel && feel.summary;
  return (
    <div class="byf-filters">
      <div class="byf-hero">
        <a href={href('film', film.key)} class="byf-hero-poster" aria-label={`Open ${film.title}`}><Poster film={film} eager /></a>
        <div class="byf-hero-body">
          <span class="faint byf-eyebrow">Starting from</span>
          <h2 class="byf-hero-t">{film.title}{film.year ? <span class="faint num"> {film.year}</span> : null}</h2>
          {sum && sum.headline && <p class="byf-headline">{sum.headline}</p>}
          <button type="button" class="btn btn-ghost btn-small byf-change" onClick={onChange}>Pick a different film</button>
        </div>
      </div>
      {sum && sum.chips && sum.chips.length > 0 && (
        <div class="chips byf-chips">
          {sum.chips.map((c, i) => <Badge key={i} class="byf-voice" data-voice={c.voice} title={`From ${voiceLabel(c.voice)}`}>{c.label}</Badge>)}
        </div>
      )}
      {sum && sum.chips && sum.chips.length > 0 && <p class="faint byf-legend">Brighter labels come from viewers or critics. Fainter labels come from article tags and keywords.</p>}
      {feel === null && <p class="muted">We don't have enough on this film to describe how it feels yet. Its neighbours below lean on genres and people.</p>}
      <div class="byf-ctl">
        <span class="byf-ctl-l">What should count most</span>
        <Segmented label="What should count most" value={emphasis} options={EMPHASIS.map(e => ({ value: e.value, label: e.label }))} onChange={onEmphasis} />
      </div>
      <div class="byf-ctl">
        <span class="byf-ctl-l">Like this one, but&hellip;</span>
        <div class="byf-axes">
          {(axes || []).map(a => (
            <div class="byf-axis" key={a.id} role="group" aria-label={`${a.low} or ${a.high}`}>
              {[[-1, a.low], [1, a.high]].map(([dir, label]) => {
                const on = shift && shift.axis === a.id && shift.dir === dir;
                return <Chip key={dir} class="byf-dir" pressed={!!on} onClick={() => onShift(on ? null : { axis: a.id, dir })}>{dir < 0 ? <Icon name="back" size={12} /> : null}{label}{dir > 0 ? <Icon name="chevron" size={12} /> : null}</Chip>;
              })}
            </div>
          ))}
        </div>
      </div>
      <Segmented label="Which films" value={scope} options={SCOPES} onChange={onScope} />
    </div>
  );
}
