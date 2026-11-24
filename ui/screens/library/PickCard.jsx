// A poster tile in Select mode: clicking toggles the film instead of opening it.
// The normal FilmCard is shown (inert) underneath; one button on top carries the checkbox behaviour.
import { memo } from 'preact/compat';
import { FilmCard } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';

function PickCard({ film, show, eager, pip, selected, onPick }) {
  const label = `${film.title}${film.year ? ` (${film.year})` : ''}${film.user && film.user.watchlist ? ', on your watchlist' : ''}`;
  return (
    <div class={`lib-pick${selected ? ' is-on' : ''}`}>
      <div class="lib-pick-card" inert aria-hidden="true"><FilmCard film={film} show={show} eager={eager} pip={pip} /></div>
      <button type="button" class="lib-pick-hit" role="checkbox" aria-checked={String(selected)} aria-label={label}
        onClick={e => onPick(film.key, e.shiftKey)} />
      <span class="lib-check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
    </div>
  );
}

export default memo(PickCard);
