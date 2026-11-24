// The recap card: designed for exactly 1080 px wide so "Save as image" gives a shareable picture.
import { Poster, Stars, dateText } from '../../components/film.jsx';
import { href } from '../../router.js';
import { plural } from '../../format.js';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = iso => dateText(iso, { day: 'numeric', month: 'short' });

function Block({ title, children, class: cls = '' }) {
  return <section class={'year-block ' + cls}><h2>{title}</h2>{children}</section>;
}

function Mosaic({ items, film }) {
  const n = items.length;
  const cols = n <= 12 ? Math.max(n, 1) : Math.min(12, Math.ceil(n / 2));
  return (
    <div class="year-mosaic" style={{ '--cols': cols }}>
      {items.map(m => {
        const f = film(m.key);
        return f ? <a key={m.key} href={href('film', m.key)} title={f.title}><Poster film={f} eager /></a> : null;
      })}
    </div>
  );
}

export default function Card({ data: d, film }) {
  const t = d.totals;
  const hero = `${plural(t.films, 'film', 'films')}${t.hours > 0 ? ` · ${Math.round(t.hours)} hours` : ''}`;
  const maxMonth = Math.max(1, ...d.months.map(m => m.count));
  const maxGenre = Math.max(1, ...d.genres.map(g => g.count));
  const maxDecade = Math.max(1, ...d.decades.map(g => g.count));
  const top = d.topFilms.map(r => ({ ...r, f: film(r.key) })).filter(r => r.f);
  const facts = [];
  const title = key => { const f = film(key); return f && f.title; };
  if (d.firstFilm) facts.push(['First film', title(d.firstFilm.key), day(d.firstFilm.date), d.firstFilm.key]);
  if (d.lastFilm && d.lastFilm.key !== d.firstFilm?.key) facts.push(['Latest film', title(d.lastFilm.key), day(d.lastFilm.date), d.lastFilm.key]);
  if (d.oldestFilm) facts.push(['Oldest', title(d.oldestFilm.key), String(d.oldestFilm.year), d.oldestFilm.key]);
  if (d.newestFilm && d.newestFilm.key !== d.oldestFilm?.key) facts.push(['Newest', title(d.newestFilm.key), String(d.newestFilm.year), d.newestFilm.key]);
  if (d.longestStreak.days >= 2) facts.push(['Longest streak', plural(d.longestStreak.days, 'day', 'days'), `${day(d.longestStreak.from)} to ${day(d.longestStreak.to)}`]);
  if (d.busiestDay && d.busiestDay.count >= 2) facts.push(['Busiest day', plural(d.busiestDay.count, 'film', 'films'), day(d.busiestDay.date)]);

  const shown = facts.filter(([, v]) => v);

  return (
    <>
      <header class="year-hero">
        <div class="year-numeral" aria-label={String(d.year)}>{d.year}</div>
        <div class="year-headline">
          <div class="year-headline-main num">{hero}</div>
          <div class="year-headline-sub muted num">
            {d.ratingAverage != null && <span>{d.ratingAverage.toFixed(2)}★ average</span>}
            {t.rewatches > 0 && <span>{plural(t.rewatches, 'rewatch', 'rewatches')}</span>}
            {t.reviews > 0 && <span>{plural(t.reviews, 'review', 'reviews')}</span>}
            {t.newToYou > 0 && <span>{t.newToYou} new to you</span>}
          </div>
        </div>
      </header>

      {d.mosaic.length > 0 && <Mosaic items={d.mosaic} film={film} />}

      <div class="year-cols">
        <Block title="Your top 10" class="year-top">
          {top.length ? (
            <ol>
              {top.map((r, i) => (
                <li key={r.key} class={i === 0 ? 'first' : ''}>
                  <span class="year-rank num">{i + 1}</span>
                  <a class="year-top-title" href={href('film', r.key)}>{r.f.title}{r.f.year ? <span class="faint"> {r.f.year}</span> : null}</a>
                  <Stars rating={r.rating} size="13px" />
                </li>
              ))}
            </ol>
          ) : <p class="faint">Rate a few films this year and your favourites line up here.</p>}
        </Block>

        <div class="year-side">
          <Block title="Highlights">
            <ul class="year-highlights">{d.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
          </Block>
          {shown.length > 0 && (
            <Block title="Firsts and lasts">
              <dl class="year-facts">
                {shown.map(([k, v, sub, key]) => (
                  <div key={k}><dt>{k}</dt><dd>{key && v ? <a href={href('film', key)}>{v}</a> : v}{sub && <span class="faint num"> · {sub}</span>}</dd></div>
                ))}
              </dl>
            </Block>
          )}
        </div>
      </div>

      <Block title="Month by month">
        <div class="year-months" role="img" aria-label={d.months.map((m, i) => `${MONTH_LONG[i]}: ${m.count}`).join(', ')}>
          {d.months.map((m, i) => (
            <div key={m.month} title={`${MONTH_LONG[i]}: ${plural(m.count, 'film', 'films')}`}>
              <span class="num year-month-n">{m.count || ''}</span>
              <i class={m.count === maxMonth && m.count > 0 ? 'peak' : ''} style={{ height: m.count ? `max(4px, calc((100% - 40px) * ${m.count / maxMonth}))` : '0' }} />
              <span class="year-month-l">{MONTHS[i]}</span>
            </div>
          ))}
        </div>
      </Block>

      <div class="year-cols three">
        <Block title="Favourite people">
          {d.favouritePeople.length ? (
            <ul class="year-people">
              {d.favouritePeople.map(p => (
                <li key={p.name + p.role}>
                  <span class="year-person-name">{p.id ? <a href={href('person', p.id)}>{p.name}</a> : p.name}</span>
                  <span class="faint year-person-role">{p.role === 'director' ? 'Director' : 'Cast'}</span>
                  <span class="num muted">{plural(p.count, 'film', 'films')}</span>
                </li>
              ))}
            </ul>
          ) : <p class="faint">Watch two films with the same person to see them here.</p>}
        </Block>
        <Block title="Genres">
          {d.genres.length ? (
            <ul class="year-bars">
              {d.genres.slice(0, 6).map(g => (
                <li key={g.name} title={`${g.name}: ${plural(g.count, 'film', 'films')}`}><span>{g.name}</span><span class="num muted">{g.count}</span><b style={{ width: (g.count / maxGenre) * 100 + '%' }} /></li>
              ))}
            </ul>
          ) : <p class="faint">Genres show up once film details have loaded.</p>}
        </Block>
        <Block title="Decades">
          {d.decades.length ? (
            <ul class="year-bars">
              {d.decades.map(g => (
                <li key={g.decade} title={`${g.decade}s: ${plural(g.count, 'film', 'films')}`}><span>{g.decade}s</span><span class="num muted">{g.count}</span><b style={{ width: (g.count / maxDecade) * 100 + '%' }} /></li>
              ))}
            </ul>
          ) : <p class="faint">Nothing here yet.</p>}
        </Block>
      </div>

      <footer class="year-foot"><span>Matinee</span><span class="faint">{d.year} in review</span></footer>
    </>
  );
}
