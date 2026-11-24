// List view: a sortable table. Header clicks mirror the sort select.
import { href } from '../../router.js';
import { memo } from 'preact/compat';
import StatusBadge from '../../components/StatusBadge.jsx';
import { Poster, Stars, Score, runtimeText, dateText } from '../../components/film.jsx';

const COLS = [
  { id: 'title', label: 'Film', sort: 'title' },
  { id: 'director', label: 'Director' },
  { id: 'rating', label: 'You', sort: 'rating' },
  { id: 'lb', label: 'Letterboxd', sort: 'letterboxd', num: true },
  { id: 'rt', label: 'RT critics', num: true },
  { id: 'imdb', label: 'IMDb', num: true },
  { id: 'mc', label: 'Metacritic', num: true },
  { id: 'score', label: 'Matinee', sort: 'score', num: true },
  { id: 'runtime', label: 'Runtime', sort: 'runtime', num: true },
  { id: 'last', label: 'Last watched', sort: 'recent', num: true },
];

const lb = f => { const v = f.ratings?.letterboxd?.value; return v ? '★ ' + v.toFixed(2) : '–'; };
const imdb = f => { const v = f.ratings?.imdb?.value; return v ? v.toFixed(1) : '–'; };
const rt = f => { const v = f.ratings?.rt?.critics; return v ? Math.round(v) + '%' : '–'; };
const mc = f => { const v = f.ratings?.metacritic?.critics; return v ? Math.round(v) : '–'; };

const Row = memo(function Row({ film: f, selectMode, selected, onPick }) {
  const d = (f.directors || []).map(p => p.name).join(', ');
  return (
    <tr class={selected ? 'is-on' : undefined} onClick={selectMode ? e => onPick(f.key, e.shiftKey) : undefined}>
      <td class="lib-film">
        <a href={href('film', f.key)} class="lib-film-link" tabIndex={selectMode ? -1 : undefined} onClick={selectMode ? e => e.preventDefault() : undefined}>
          {selectMode && <input type="checkbox" class="lib-rowcheck" checked={selected} aria-label={f.title} onClick={e => { e.stopPropagation(); onPick(f.key, e.shiftKey); }} onChange={() => {}} />}
          <span class="lib-thumb"><Poster film={f} /></span>
          <span class="lib-film-text"><span class="lib-film-title">{f.title}</span>{f.year && <span class="faint num"> {f.year}</span>}</span>
        </a>
      </td>
      <td class="lib-dir" title={d}>{d || <span class="faint">–</span>}</td>
      <td>{f.user?.rating != null ? <Stars rating={f.user.rating} size="13px" /> : (StatusBadge({ user: f.user }) || <span class="faint">–</span>)}</td>
      <td class="num-col num">{lb(f)}</td>
      <td class="num-col num">{rt(f)}</td>
      <td class="num-col num">{imdb(f)}</td>
      <td class="num-col num">{mc(f)}</td>
      <td class="num-col"><Score score={f.score} /></td>
      <td class="num-col num">{runtimeText(f.runtime) || '–'}</td>
      <td class="num-col num">{f.lastWatched ? dateText(f.lastWatched, { day: 'numeric', month: 'short', year: 'numeric' }) : <span class="faint">–</span>}</td>
    </tr>
  );
});

export default function ListView({ films, sort, dir, onSort, selectMode = false, selected, onPick }) {
  return (
    <div class="lib-table-wrap">
      <table class="lib-table">
        <thead>
          <tr>
            {COLS.map(c => {
              const active = c.sort && c.sort === sort;
              return (
                <th key={c.id} class={c.num ? 'num-col' : ''} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sort
                    ? <button type="button" class="lib-th" onClick={() => onSort(c.sort)}>{c.label}{active && <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}</button>
                    : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {films.map(f => <Row key={f.key} film={f} selectMode={selectMode} selected={selectMode && selected.has(f.key)} onPick={onPick} />)}
        </tbody>
      </table>
    </div>
  );
}
