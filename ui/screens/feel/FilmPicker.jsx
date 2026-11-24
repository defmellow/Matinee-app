// "Pick a film" box: searches the library locally, shows a short list.
import { useState } from 'preact/hooks';
import Icon from '../../components/Icon.jsx';
import { pickFilms } from './model.js';

export default function FilmPicker({ films, onPick, autoFocus }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const found = pickFilms(films, q);
  const key = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(found.length - 1, hi + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(0, hi - 1)); }
    else if (e.key === 'Enter' && found[hi]) onPick(found[hi]);
  };
  return (
    <div class="byf-picker">
      <label class="search">
        <Icon name="search" />
        <input class="input" data-search type="search" value={q} autoFocus={autoFocus} placeholder="Search your library for a film"
          aria-label="Pick a film to start from" role="combobox" aria-autocomplete="list" aria-expanded={String(found.length > 0)}
          aria-controls="byf-picker-list" aria-activedescendant={found.length ? `byf-opt-${Math.min(hi, found.length - 1)}` : undefined} onInput={e => { setQ(e.currentTarget.value); setHi(0); }} onKeyDown={key} />
      </label>
      {q && !found.length && <p class="muted byf-picker-none">Nothing in your library matches "{q}". Try another title.</p>}
      {found.length > 0 && (
        <ul class="byf-picker-list" id="byf-picker-list" role="listbox" aria-label="Matching films">
          {found.map((f, i) => (
            <li key={f.key} role="presentation">
              <button type="button" role="option" id={`byf-opt-${i}`} tabIndex={-1} aria-selected={String(i === hi)} data-hi={String(i === hi)} onMouseEnter={() => setHi(i)} onClick={() => onPick(f)}>
                <span class="byf-pick-t">{f.title}</span>
                {f.year && <span class="faint num">{f.year}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
