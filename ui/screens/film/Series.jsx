// "Part of <series>": how far through a series you are, in release order. Data: getSeries({ key }); renders nothing if there isn't one.
// Library films are standard film tiles with a seen tick; films outside the library are the standard OutsideFilmCard.
import { useCall } from '../../state.js';
import { href } from '../../router.js';
import { Poster, OutsideFilmCard } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';

import DebugInfo, { DebugError } from '../../debug/DebugInfo.jsx';
import { dataSummary } from '../../debug/model.js';
const seenTick = <span class="series-check" aria-label="Seen"><Icon name="check" size={12} /></span>;

function Tile({ f, current }) {
  const cls = 'series-tile' + (f.watched ? ' seen' : '') + (current ? ' current' : '');
  if (!f.key) return <OutsideFilmCard film={f} class={cls} />;
  return (
    <a class={`film-card ${cls}`} href={href('film', f.key)} title={`${f.title}${f.year ? ` (${f.year})` : ''}`}>
      <Poster film={f}>{f.watched && seenTick}</Poster>
      <div class="meta"><span class="title">{f.title}</span>{f.year && <span class="faint num">{f.year}</span>}</div>
    </a>
  );
}

export default function Series({ filmKey }) {
  const { data, error } = useCall('getSeries', { key: filmKey }, [filmKey]);
  if (error && !data) return <DebugError error={error} what="The series" />; // nothing to show normally (recorded by api.call)
  if (!data || !data.films?.length) return <DebugInfo title="Series" rows={{ 'part of a series': data ? 'no' : 'loading' }} />;
  return (
    <section class="film-section series">
      <h2>Part of {data.name}</h2>
      <DebugInfo title="Series" rows={{ ...dataSummary(data), 'film ids': data.films.map(f => f.id).join(' ') }} />
      <p class="muted">You've seen <b class="num">{data.seen}</b> of <b class="num">{data.total}</b></p>
      <div class="series-row">
        {data.films.map(f => <Tile key={f.id} f={f} current={f.key === filmKey} />)}
      </div>
    </section>
  );
}
