// PROTOTYPE copy of library/ListView.jsx with a Match column (how close, by feel) when the Library is ranked.
import { href } from '../../../router.js';
import { memo } from 'preact/compat';
import StatusBadge from '../../../components/StatusBadge.jsx';
import { Poster, Stars, Score, runtimeText, dateText } from '../../../components/film.jsx';

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

const Row = memo(function Row({ film: f, match, ranked, selectMode, selected, onPick, hide, asked }) {
  // a reason that only repeats what was asked ("eerie" under an eerie search) says nothing
  const why = match && match.lines[0] && !(asked && asked.has(match.lines[0].toLowerCase())) ? match.lines[0] : null;
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
      {ranked && <td class="pl-match-col">{match ? <span class={'byf-tier byf-tier-' + match.tier.id}>{match.tier.label}</span> : null}{why && <span class="pl-match-why faint">{why}</span>}</td>}
      <td class="lib-dir" title={d}>{d || <span class="faint">–</span>}</td>
      {!hide.has('rating') && <td>{f.user?.rating != null ? <Stars rating={f.user.rating} size="13px" /> : (StatusBadge({ user: f.user }) || <span class="faint">–</span>)}</td>}
      <td class="num-col num">{lb(f)}</td>
      <td class="num-col num">{rt(f)}</td>
      <td class="num-col num">{imdb(f)}</td>
      <td class="num-col num">{mc(f)}</td>
      <td class="num-col"><Score score={f.score} /></td>
      <td class="num-col num">{runtimeText(f.runtime) || '–'}</td>
      {!hide.has('last') && <td class="num-col num">{f.lastWatched ? dateText(f.lastWatched, { day: 'numeric', month: 'short', year: 'numeric' }) : <span class="faint">–</span>}</td>}
    </tr>
  );
});

// status: the view's status; on the watchlist the You and Last watched columns would be the same on every row, so they go.
export default function MatchList({ items, ranked = false, sort, dir, onSort, selectMode = false, selected, onPick, status = 'all', asked = null }) {
  const hide = new Set(status === 'watchlist' ? ['rating', 'last'] : []);
  return (
    <div class="lib-table-wrap">
      <table class="lib-table">
        <thead>
          <tr>
            {(ranked ? [COLS[0], { id: 'match', label: 'How close', sort: 'match' }, ...COLS.slice(1)] : COLS).filter(c => !hide.has(c.id)).map(c => {
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
          {items.map(({ film: f, match }) => <Row key={f.key} film={f} match={match} ranked={ranked} selectMode={selectMode} selected={selectMode && selected.has(f.key)} onPick={onPick} hide={hide} asked={asked} />)}
        </tbody>
      </table>
    </div>
  );
}
