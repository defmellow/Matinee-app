// The tabs of Year in review. Each gets `d` (getYear), `lib` (films by key) and `film` (key → film or null).
import { useMemo, useEffect, useState } from 'preact/hooks';
import { useCall } from '../../state.js';
import { call } from '../../api.js';
import { useFeelColours, useFilmColour, filmColour, mixColours } from '../../feel-colours.js'; // TEMP feel colours
import { Poster, Stars, dateText, runtimeText } from '../../components/film.jsx';
import { href } from '../../router.js';
import { n as num, plural, MONTHS_SHORT } from '../../format.js';
import Bars from '../insights/Bars.jsx';
import { Section, Thin, Note, RankList, PosterRow, TakeList, MiniPosters } from '../insights/parts.jsx';
import { ShareBars, feelLink, genreLink, countryLink, languageLink } from '../insights/tabs.jsx';
import { yearCells } from '../diary/Heatmap.jsx';
import { dayText } from '../diary/heatmapText.js';

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LONG = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const films = c => plural(c, 'film', 'films');
const day = iso => dateText(iso, { day: 'numeric', month: 'short' });
const starText = r => (r == null ? '' : '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : ''));

/** "6 more than 2025" / "level with 2025", or nothing when there is no year before to compare with. */
function against(now, then, year, { unit = '', digits = 0 } = {}) {
  if (then == null || now == null) return null;
  const gap = now - then, shown = Math.abs(gap).toFixed(digits);
  if (Number(shown) === 0) return `level with ${year}`;
  return `${shown}${unit} ${gap > 0 ? (unit ? 'up on' : 'more than') : (unit ? 'down on' : 'fewer than')} ${year}`;
}

export function Highlights({ d, lib, film }) {
  const t = d.totals, p = d.previous;
  const top = d.topFilms.map(r => ({ ...r, f: film(r.key) })).filter(r => r.f);
  const maxMonth = Math.max(1, ...d.monthsFull.map(m => m.count));
  const facts = [];
  if (d.firstFilm) facts.push({ key: d.firstFilm.key, label: 'First film', note: day(d.firstFilm.date) });
  if (d.lastFilm && d.lastFilm.key !== d.firstFilm?.key) facts.push({ key: d.lastFilm.key, label: 'Latest film', note: day(d.lastFilm.date) });
  if (d.oldestFilm) facts.push({ key: d.oldestFilm.key, label: 'Oldest', note: String(d.oldestFilm.year) });
  if (d.newestFilm && d.newestFilm.key !== d.oldestFilm?.key) facts.push({ key: d.newestFilm.key, label: 'Newest', note: String(d.newestFilm.year) });
  if (d.runtime.longest) facts.push({ key: d.runtime.longest.key, label: 'Longest', note: runtimeText(d.runtime.longest.runtime) });
  if (d.runtime.shortest && d.runtime.shortest.key !== d.runtime.longest?.key) facts.push({ key: d.runtime.shortest.key, label: 'Shortest', note: runtimeText(d.runtime.shortest.runtime) });
  const fives = d.ratingHistogram[9].count;
  return (
    <div class="ins-grid">
      <Note lines={d.highlightParts || d.highlights}>
        In {d.year} you watched <b class="num">{films(t.films)}</b>{t.hours > 0 && <> over <b class="num">{num(Math.round(t.hours))} hours</b></>}{p ? <> ({against(t.films, p.films, p.year)})</> : null}.
        {d.ratingAverage != null && <> You rated them <b class="num">{d.ratingAverage.toFixed(2)}★</b> on average{p && p.ratingAverage != null ? <>, {against(d.ratingAverage, p.ratingAverage, p.year, { unit: '★', digits: 2 })}</> : null}.</>}
        {' '}<b class="num">{t.newToYou}</b> {t.newToYou === 1 ? 'was' : 'were'} new to you{fives ? <>, and <b class="num">{fives}</b> got five stars</> : null}.
      </Note>

      <Section title="Your top 10" hint={top.length ? 'Your highest rated films of the year; the most recent wins a tie.' : null} wide>
        {top.length ? (
          <div class="year-podium">
            <a class="year-first" href={href('film', top[0].key)} title={top[0].f.title}>
              <Poster film={top[0].f} eager />
              <span class="year-first-text">
                <span class="year-first-kicker">Your film of {d.year}</span>
                <span class="year-first-title">{top[0].f.title}</span>
                <span class="muted num">{top[0].f.year}</span>
                <Stars rating={top[0].rating} size="18px" />
              </span>
            </a>
            <ol class="year-rest" start="2">
              {top.slice(1).map((r, i) => (
                <li key={r.key} style={{ '--i': i }}>
                  <a href={href('film', r.key)} title={`${r.f.title}${r.f.year ? ` (${r.f.year})` : ''}`}>
                    <Poster film={r.f}><span class="year-rank-badge num">{i + 2}</span></Poster>
                    <span class="ins-poster-title">{r.f.title}</span>
                    <Stars rating={r.rating} size="11px" />
                  </a>
                </li>
              ))}
            </ol>
          </div>
        ) : <Thin>Rate a few films this year and your favourites line up here.</Thin>}
      </Section>

      <Section title="Month by month" hint="Under each month: the best film you watched in it." wide>
        <div class="year-months2" role="list">
          {d.monthsFull.map((m, i) => {
            const best = m.best && film(m.best.key);
            return (
              <div key={m.month} role="listitem" class={'year-m' + (m.count === maxMonth && m.count > 0 ? ' peak' : '')} style={{ '--i': i }} title={`${MONTH_LONG[i]}: ${films(m.count)}`}>
                <span class="year-m-track"><span class="num year-m-n">{m.count || ''}</span><i style={{ height: m.count ? `max(4px, calc((100% - 20px) * ${m.count / maxMonth}))` : '0' }} /></span>
                <span class="year-m-l">{MONTHS_SHORT[i]}</span>
                <span class="year-m-slot">{best && <a class="year-m-best" href={href('film', best.key)} title={`${best.title}: ${starText(m.best.rating)}`}><Poster film={best} /></a>}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {facts.length > 0 && (
        <Section title="Firsts, lasts and extremes" wide>
          <PosterRow items={facts} lib={lib} label="Firsts, lasts and extremes" />
        </Section>
      )}
    </div>
  );
}

const BANDS = [[10, 'Five stars'], [9, 'Four and a half'], [8, 'Four stars'], [7, 'Three and a half'], [6, 'Three stars'], [5, 'Two and a half'], [4, 'Two stars'], [3, 'One and a half'], [2, 'One star'], [1, 'Half a star']];

export function Films({ d, lib, film }) {
  const groups = BANDS.map(([r, name]) => ({ r, name, rows: d.films.filter(f => f.rating === r) })).filter(g => g.rows.length);
  const unrated = d.films.filter(f => f.rating == null);
  const hist = d.ratingHistogram;
  const histData = hist.map(r => ({ label: r.rating % 2 ? (r.rating === 1 ? '½' : `${(r.rating - 1) / 2}½`) : String(r.rating / 2), value: r.count, hot: r.count > 0 && r.count === Math.max(...hist.map(x => x.count)), title: `${r.rating / 2}★: ${films(r.count)}` }));
  const Group = ({ title, rows, stars }) => (
    <div class="year-group">
      <h3>{stars ? <Stars rating={stars} size="14px" /> : null}<span>{title}</span><span class="faint num">{films(rows.length)}</span></h3>
      <ul class="year-grid">
        {rows.map((r, i) => {
          const f = film(r.key);
          return f ? (
            <li key={r.key} style={{ '--i': Math.min(i, 20) }}>
              <a href={href('film', r.key)} title={`${f.title}${f.year ? ` (${f.year})` : ''}, watched ${day(r.date)}${r.rewatch ? ', a rewatch' : ''}`}>
                <Poster film={f}>{r.rewatch && <span class="year-re" aria-label="Rewatch">↻</span>}</Poster>
              </a>
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
  return (
    <div class="ins-grid">
      <Section title="Every film, best first" hint={`${films(d.films.length)} in ${d.year}. ↻ marks a rewatch.`} wide>
        {groups.map(g => <Group key={g.r} title={g.name} rows={g.rows} stars={g.r} />)}
        {unrated.length > 0 && <Group title="Not rated" rows={unrated} />}
      </Section>
      <Section title="Stars you gave" hint={d.ratingAverage != null ? `${d.ratingAverage.toFixed(2)}★ on average.` : null} wide>
        {d.films.some(f => f.rating != null) ? <Bars data={histData} height={120} /> : <Thin />}
      </Section>
      <Section title="You loved more than most"><TakeList items={d.hotTakes.higher} lib={lib} /></Section>
      <Section title="You liked less than most"><TakeList items={d.hotTakes.lower} lib={lib} /></Section>
    </div>
  );
}

export function Taste({ d, lib }) {
  const { data: yf, loading } = useCall('getYearFeel', { year: d.year }, [d.year], { refreshOn: 'library' });
  const waiting = <Thin>{loading ? 'Reading how your films feel…' : 'This couldn\'t load just now.'}</Thin>;
  const empty = <Thin>This fills in once reviews for your films have loaded.</Thin>;
  const decades = d.decades.map(g => ({ label: `${g.decade}s`, value: g.count, title: `${g.decade}s: ${films(g.count)}` }));
  return (
    <div class="ins-grid">
      <Section title={`What ${d.year} felt like`} hint={yf ? `The feelings that turn up most across ${films(yf.films)}. Click one to find more like it.` : null}>
        {!yf ? waiting : yf.feelings.length ? <ShareBars rows={yf.feelings} link={feelLink} feeling /> : empty}
      </Section>
      <Section title="What it was about" hint="The themes your films came back to.">
        {!yf ? waiting : yf.themes.length ? <ShareBars rows={yf.themes} link={feelLink} /> : empty}
      </Section>
      {yf && yf.more.length > 0 && (
        <Section title={`More than usual in ${d.year}`} hint="Feelings and themes that turned up more this year than in everything else you've watched." wide>
          <ul class="year-more">
            {yf.more.map((r, i) => (
              <li key={r.id} style={{ '--i': i }} title={`${r.label}: ${r.share}% of this year's films, ${r.otherShare}% of the rest`}>
                <a class="chip" href={feelLink(r)}>{r.label}</a>
                <MiniPosters keys={r.keys} lib={lib} max={4} />
                <span class="num year-more-n">{r.share}%</span>
                <span class="faint num">usually {r.otherShare}%</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Genres" hint="How often, and how you rated them." wide>
        {d.genresRated.length ? <RankList rows={d.genresRated} link={genreLink} lib={lib} posters /> : <Thin>Genres show up once film details have loaded.</Thin>}
      </Section>
      <Section title="Decades">
        {decades.length ? <Bars data={decades} height={110} /> : <Thin>Nothing here yet.</Thin>}
      </Section>
      <Section title="Length" hint={d.runtime.average ? `Your films ran ${runtimeText(d.runtime.average)} on average.` : null}>
        {d.runtime.longest ? <PosterRow rows={1} items={[{ key: d.runtime.longest.key, label: 'Longest', note: runtimeText(d.runtime.longest.runtime) }, ...(d.runtime.shortest && d.runtime.shortest.key !== d.runtime.longest.key ? [{ key: d.runtime.shortest.key, label: 'Shortest', note: runtimeText(d.runtime.shortest.runtime) }] : [])]} lib={lib} label="Longest and shortest" /> : <Thin>Runtimes are still arriving.</Thin>}
      </Section>
      <Section title="Countries">
        {d.countries.length ? <RankList rows={d.countries} link={countryLink} /> : <Thin>Countries show up once film details have loaded.</Thin>}
      </Section>
      <Section title="Languages">
        {d.languages.length ? <RankList rows={d.languages} link={languageLink} /> : <Thin>Languages show up once film details have loaded.</Thin>}
      </Section>
    </div>
  );
}

export function People({ d, lib }) {
  const fav = d.favouritePeopleFilms, met = d.newDirectors;
  return (
    <div class="ins-grid">
      <Section title="Favourite people" hint="Directors and top-billed cast you watched twice or more this year." wide>
        {fav.length ? (
          <ul class="year-people2">
            {fav.map((p, i) => (
              <li key={p.name + p.role} style={{ '--i': i }}>
                <MiniPosters keys={p.keys} lib={lib} max={4} />
                <span class="year-p-name"><a href={href('person', p.id || p.name, { role: p.role === 'director' ? 'director' : 'cast' })}>{p.name}</a></span>
                <span class="year-p-meta muted"><span>{p.role === 'director' ? 'Director' : 'Cast'}</span> · <span class="num">{films(p.count)}</span>{p.averageRating != null && <> · <Stars rating={Math.round(p.averageRating * 2)} size="12px" /></>}</span>
              </li>
            ))}
          </ul>
        ) : <Thin>Watch two films with the same person in a year to see them here.</Thin>}
      </Section>
      <Section title="Directors you met this year" hint={met.count ? `${plural(met.count, 'director', 'directors')} whose films you hadn't logged before. These are the ones you rated highest.` : null} wide>
        {met.best.length ? (
          <ul class="year-people2">
            {met.best.map((p, i) => (
              <li key={p.id || p.name} style={{ '--i': i }}>
                <MiniPosters keys={p.keys} lib={lib} max={4} />
                <span class="year-p-name"><a href={href('person', p.id || p.name, { role: 'director' })}>{p.name}</a></span>
                <span class="year-p-meta muted"><span class="num">{films(p.count)}</span> · <Stars rating={Math.round(p.averageRating * 2)} size="12px" /></span>
              </li>
            ))}
          </ul>
        ) : <Thin>No new directors this year yet.</Thin>}
      </Section>
    </div>
  );
}

// TEMP feel colours: a day's fill is the blend of its films' colours, or nothing (the usual pink)
const dayFill = (dayKeys, iso, n) => { const col = dayKeys && mixColours((dayKeys.get(iso) || []).map(filmColour)); return col ? { fill: col, fillOpacity: Math.max(0.75, opacityFor(n)) } : undefined; };
const CELL = 13, GAP = 3, STEP = CELL + GAP, LEFT = 30, TOP = 18;
const opacityFor = n => (n <= 0 ? 0 : n === 1 ? 0.45 : n === 2 ? 0.7 : n === 3 ? 0.88 : 1);

// TEMP feel colours: each day with films takes the blend of their colours (days to film keys come from the diary, read only while the colours are on).
function useDayKeys(year, on) {
  const [by, setBy] = useState(null);
  useFilmColour(null); // re-render when the film colours arrive
  useEffect(() => {
    if (!on) { setBy(null); return undefined; }
    let live = true;
    call('getDiary').then(r => {
      if (!live) return;
      const m = new Map();
      for (const e of r.entries) if (e.date && e.date.startsWith(year + '-')) { const k = e.date.slice(0, 10); (m.get(k) || m.set(k, []).get(k)).push(e.film.key); }
      setBy(m);
    }, () => {}); // call() reports its own failure; the days just stay pink
    return () => { live = false; };
  }, [year, on]);
  return by;
}

export function Calendar({ d }) {
  const dayKeys = useDayKeys(d.year, useFeelColours());
  const cells = useMemo(() => yearCells(d.year), [d.year]);
  const cols = cells[cells.length - 1].col + 1;
  const W = LEFT + cols * STEP, H = TOP + 7 * STEP;
  const topDay = d.weekdays.reduce((b, w) => (w.count > b.count ? w : b), d.weekdays[0]);
  const active = Object.keys(d.dayCounts).length;
  const busiest = d.months.reduce((bi, m, i) => (m.count > d.months[bi].count ? i : bi), 0);
  return (
    <div class="ins-grid">
      <Section title="Every day of the year" hint={`You watched something on ${plural(active, 'day', 'days')}. ${dayKeys ? 'Each square takes the colour of what you watched that day.' : 'Darker squares are days with more films.'}`} wide>
        <svg class="year-heat" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Films logged each day in ${d.year}`}>
          {[[0, 'Mon'], [2, 'Wed'], [4, 'Fri']].map(([r, l]) => <text key={l} x="0" y={TOP + r * STEP + CELL - 2}>{l}</text>)}
          {cells.filter(c => c.day === 1).map(c => <text key={c.month} x={LEFT + c.col * STEP} y="11">{MONTHS_SHORT[c.month]}</text>)}
          {cells.map(c => {
            const n = d.dayCounts[c.iso] || 0, x = LEFT + c.col * STEP, y = TOP + c.row * STEP;
            return (
              <g key={c.iso}>
                <rect class="year-heat-cell" x={x} y={y} width={CELL} height={CELL} rx="3" />
                {n > 0 && <rect class="year-heat-on" x={x} y={y} width={CELL} height={CELL} rx="3" fill-opacity={opacityFor(n)} style={dayFill(dayKeys, c.iso, n)} />}
                <title>{dayText(c.iso, n)}</title>
              </g>
            );
          })}
        </svg>
      </Section>
      <Section title="Days you watched" hint={topDay.count ? `${DAY_LONG[topDay.day]} was your film night: ${topDay.count} of ${plural(d.totals.entries, 'entry', 'entries')}.` : null}>
        <Bars data={d.weekdays.map(w => ({ label: w.day, value: w.count, hot: w.count > 0 && w.day === topDay.day, title: `${DAY_LONG[w.day]}: ${plural(w.count, 'entry', 'entries')}` }))} height={110} unit="entries" />
      </Section>
      <Section title="Rhythm">
        <dl class="ins-streaks two">
          <div><dt>Busiest month</dt><dd>{MONTH_LONG[busiest]} <span class="faint num">· {films(d.months[busiest].count)}</span></dd></div>
          <div><dt>Busiest day</dt><dd>{d.busiestDay ? <>{day(d.busiestDay.date)} <span class="faint num">· {films(d.busiestDay.count)}</span></> : '–'}</dd></div>
          <div><dt>Longest streak</dt><dd>{plural(d.longestStreak.days, 'day', 'days')}{d.longestStreak.days >= 2 && <span class="faint num"> · {day(d.longestStreak.from)} to {day(d.longestStreak.to)}</span>}</dd></div>
          <div><dt>A film every</dt><dd class="num">{d.totals.entries ? `${num(Math.round((10 * (d.year === new Date().getFullYear() ? Math.ceil((Date.now() - Date.UTC(d.year, 0, 1)) / 86400000) : 365)) / d.totals.entries) / 10)} days` : '–'}</dd></div>
        </dl>
      </Section>
    </div>
  );
}
