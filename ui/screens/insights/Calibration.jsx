// "Harsh or generous?": where your ratings sit above or below the crowd, as a diverging bar list per tab.
import { useState } from 'preact/hooks';
import { useCall } from '../../state.js';
import { Segmented } from '../../components/ui.jsx';
import { href } from '../../router.js';
import { Section, Thin } from './parts.jsx';

const TABS = [
  { value: 'byGenre', label: 'Genres' }, { value: 'byDecade', label: 'Decades' },
  { value: 'byDirector', label: 'Directors' }, { value: 'byCountry', label: 'Countries' },
];
const EMPTY = { byGenre: 'No genre has three rated films yet.', byDecade: 'No decade has three rated films yet.', byDirector: 'No director has two rated films yet.', byCountry: 'No country has three rated films yet.' };
const MAX_ROWS = 10;

const diffText = d => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(Math.round(d))}`;

function Row({ r, scale, linkPeople }) {
  const pct = Math.min(50, (Math.abs(r.diff) / scale) * 50);
  const kind = r.diff < 0 ? 'tough' : 'kind';
  const label = `${r.name}: ${diffText(r.diff)} points across ${r.count} ${r.count === 1 ? 'film' : 'films'}`;
  return (
    <li class="ins-cal-row" title={label}>
      <span class="ins-cal-name">{linkPeople && r.id ? <a href={href('person', r.id)}>{r.name}</a> : r.name}</span>
      <span class="ins-cal-track" aria-hidden="true">
        <i class={'ins-cal-bar ' + kind} style={r.diff < 0 ? { right: '50%', width: pct + '%' } : { left: '50%', width: pct + '%' }} />
      </span>
      <span class="ins-cal-diff num" data-kind={kind}>{diffText(r.diff)}</span>
      <span class="ins-cal-count faint num">{r.count} {r.count === 1 ? 'film' : 'films'}</span>
    </li>
  );
}

export default function Calibration() {
  const { data, loading } = useCall('getCalibration', {}, [], { refreshOn: 'library' });
  const [tab, setTab] = useState('byGenre');

  let body;
  if (!data) body = <Thin>{loading ? 'Working it out…' : 'This couldn\'t load just now.'}</Thin>;
  else if (data.overall.count < 3) body = <Thin>Rate at least three films that have Matinee scores and this shows where you're tougher or kinder than most.</Thin>;
  else {
    const rows = (data[tab] || []).slice(0, MAX_ROWS);
    const scale = Math.max(10, ...rows.map(r => Math.abs(r.diff)));
    body = (
      <>
        {data.notes.length > 0 && <ul class="ins-cal-notes">{data.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        <div class="ins-cal-tabs"><Segmented label="Group by" value={tab} options={TABS} onChange={setTab} /></div>
        {rows.length ? (
          <div class="ins-cal">
            <p class="ins-cal-axis faint"><span>Tougher than most</span><span>Kinder than most</span></p>
            <ul class="ins-cal-list">{rows.map(r => <Row key={r.id || r.name} r={r} scale={scale} linkPeople={tab === 'byDirector'} />)}</ul>
            <p class="faint ins-note">Points out of 100 between your rating and the Matinee score, averaged across the films in each group.</p>
          </div>
        ) : <Thin>{EMPTY[tab]}</Thin>}
      </>
    );
  }
  return <Section title="Harsh or generous?" hint="Where you rate below or above the crowd." wide>{body}</Section>;
}
