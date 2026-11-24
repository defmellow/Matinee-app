// Diary: a year heatmap on top, then every entry grouped by month, newest first.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCall, useRestoredState } from '../state.js';
import { Loading, ChipToggle } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import { n as num } from '../format.js';
import Icon from '../components/Icon.jsx';
import Heatmap from './diary/Heatmap.jsx';
import Entry from './diary/Entry.jsx';
import './diary.css';

import DebugInfo, { DebugError } from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';
const PAGE = 60;
const monthName = ym => new Date(ym + '-01T12:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Diary() {
  // Re-pull on a keyless event (an import, an edit, the end of a run) or when a film shown here is still waiting for its poster;
  // other films filling in make no difference to the diary rows.
  const noPoster = useRef(null);
  const { data, error, loading, reload } = useCall('getDiary', {}, [], { refreshOn: { event: 'library', when: p => !p || !Array.isArray(p.keys) || p.keys.some(k => !noPoster.current || noPoster.current.has(k)) } });
  const [q, setQ] = useRestoredState('diary.q', '');
  const [reviewsOnly, setReviewsOnly] = useRestoredState('diary.reviews', false);
  const [rewatches, setRewatches] = useRestoredState('diary.rewatches', false);
  const [high, setHigh] = useRestoredState('diary.high', false);
  const [year, setYear] = useRestoredState('diary.year', null);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef();

  const all = useMemo(() => (data ? data.entries.filter(e => e.film && e.date) : []), [data]);
  noPoster.current = useMemo(() => new Set(all.filter(e => !(e.film.poster && e.film.poster.thumb)).map(e => e.film.key)), [all]);
  const years = useMemo(() => [...new Set(all.map(e => Number(e.date.slice(0, 4))))].sort((a, b) => b - a), [all]);
  const shownYear = year && years.includes(year) ? year : years[0];

  const list = useMemo(() => {
    const needle = fold(q.trim());
    return all.filter(e =>
      (!needle || fold(e.film.title).includes(needle)) &&
      (!reviewsOnly || (e.review && e.review.trim())) &&
      (!rewatches || e.rewatch) &&
      (!high || (e.rating != null && e.rating >= 8)));
  }, [all, q, reviewsOnly, rewatches, high]);

  useEffect(() => setLimit(PAGE), [q, reviewsOnly, rewatches, high]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setLimit(n => n + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length > limit, data]);

  if (loading && !data) return <div class="screen"><Loading /></div>;
  if (error) return <div class="screen"><EmptyState title="The diary didn't load" action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Something went wrong reading your library. Try again, or reopen Matinee.</EmptyState></div>;

  const since = all.length ? new Date(all[all.length - 1].date + 'T12:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) : null;

  if (!all.length) {
    return (
      <div class="screen diary">
        <div class="screen-head"><h1>Diary</h1></div>
        <EmptyState title="Your diary is empty" action={<a class="btn btn-primary" href="#/welcome">Import your Letterboxd export</a>}>Log films on Letterboxd and they'll show up here after the next refresh.</EmptyState>
      </div>
    );
  }

  const visible = list.slice(0, limit);
  const groups = [];
  for (const e of visible) {
    const ym = e.date.slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.ym === ym) g.items.push(e); else groups.push({ ym, items: [e] });
  }
  const filtered = q || reviewsOnly || rewatches || high;

  return (
    <div class="screen diary">
      <div class="screen-head">
        <div>
          <h1>Diary</h1>
          <p class="sub num">{num(all.length)} {all.length === 1 ? 'entry' : 'entries'} since {since}</p>
        </div>
        <div class="search diary-search">
          <Icon name="search" />
          <input class="input" data-search type="search" placeholder="Search your diary" aria-label="Search your diary" value={q} onInput={e => setQ(e.currentTarget.value)} />
        </div>
      </div>

      <DebugInfo title="Diary" rows={{ entries: all.length, shown: visible.length, filtered, ...dataSummary(data) }} />
      <Heatmap entries={all} years={years} year={shownYear} onYear={setYear} />

      <div class="chips diary-filters" role="group" aria-label="Filters">
        <ChipToggle on={reviewsOnly} onClick={() => setReviewsOnly(!reviewsOnly)}>Reviews only</ChipToggle>
        <ChipToggle on={rewatches} onClick={() => setRewatches(!rewatches)}>Rewatches</ChipToggle>
        <ChipToggle on={high} onClick={() => setHigh(!high)}>★4 and up</ChipToggle>
        {filtered && <span class="muted num diary-count">{num(list.length)} {list.length === 1 ? 'entry' : 'entries'}</span>}
      </div>

      {!list.length ? (
        <EmptyState title="Nothing matches those filters" action={<button type="button" class="btn" onClick={() => { setQ(''); setReviewsOnly(false); setRewatches(false); setHigh(false); }}>Clear filters</button>}>
          Try a different title, or turn a filter off.
        </EmptyState>
      ) : (
        <div class="diary-timeline">
          {groups.map(g => (
            <section key={g.ym}>
              <h2 class="diary-month">{monthName(g.ym)}</h2>
              <ul class="diary-list">{g.items.map(e => <Entry key={e.id} entry={e} />)}</ul>
            </section>
          ))}
          {list.length > limit && <div ref={sentinel} class="diary-more"><button type="button" class="btn btn-small" onClick={() => setLimit(n => n + PAGE)}>Show more</button></div>}
        </div>
      )}
    </div>
  );
}
