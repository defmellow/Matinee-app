// The seven tabs of Insights. Each gets `d` (getInsights), `lib` (films by key), `library` and reads what it needs.
import { useCall } from '../../state.js';
import { Loading } from '../../components/ui.jsx';
import { Poster, Stars, dateText, runtimeText } from '../../components/film.jsx';
import { href } from '../../router.js';
import { filterHref } from '../../components/chip.js';
import { n as num, plural, pluralN, MONTHS_SHORT } from '../../format.js';
import Bars from './Bars.jsx';
import Calibration from './Calibration.jsx';
import ScoreSpread from './ScoreSpread.jsx';
import CountriesMap from './CountriesMap.jsx';
import { tallyCountries } from './countryMap.js';
import { famOf } from '../../feel-colours.js'; // TEMP feel colours
import { Section, Thin, Note, Stack, RankList, LeanList, PosterRow, TakeList, MiniPosters, TextLink } from './parts.jsx';

const monthLabel = ym => MONTHS_SHORT[+ym.slice(5) - 1];
const monthLong = ym => new Date(ym + '-01T12:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const films = c => plural(c, 'film', 'films');
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const starsText = v => `${v.toFixed(1)}★`;

// Where a row or bar leads: the Library filtered by the thing it names.
export const genreLink = r => filterHref('genre', r.name);
export const countryLink = r => filterHref('country', r.name);
export const languageLink = r => filterHref('language', r.name);
export const decadeLink = name => filterHref('decade', parseInt(name, 10));
/** A runtime band (insights-more RUNTIME_BANDS: a band holds runtimes up to its limit) as the Library's Length range. */
const LENGTH_RANGES = { 'Under 90 min': '-90', '90 min to 2 hours': '91-120', '2 to 2½ hours': '121-150', 'Over 2½ hours': '151-' };
const lengthLink = b => (LENGTH_RANGES[b.name] ? filterHref('runtime', LENGTH_RANGES[b.name]) : null);
/** A star-rating histogram row (1–10) as Library links: films you rated exactly that. */
export const ratingLink = r => filterHref('rating', r);

function crowdLine(v) {
  if (v.averageDiff == null) return 'Once ratings from other sites arrive, you\'ll see how you compare with the crowd.';
  const stars = Math.round((Math.abs(v.averageDiff) / 20) * 10) / 10; // 100 points = 5 stars
  const where = stars === 0 ? 'right in line with the crowd on average' : `${stars}★ ${v.averageDiff > 0 ? 'above' : 'below'} the crowd on average`;
  return `You rate ${where}; you agree with the crowd on ${v.agreeWithCrowdPct}% of films.`;
}

function MonthChart({ d }) {
  const data = d.byMonth.map((m, i) => ({ label: monthLabel(m.month), sub: i === 0 || m.month.endsWith('-01') ? m.month.slice(0, 4) : null, hot: i === d.byMonth.length - 1, value: m.count, title: `${monthLong(m.month)}: ${films(m.count)}` }));
  return (
    <Section title="Films per month" hint="The last 24 months; this month is highlighted." wide>
      {d.byMonth.some(m => m.count) ? <Bars data={data} height={130} /> : <Thin>Log a few films in your diary to see this.</Thin>}
    </Section>
  );
}

/** One tile per diary year: the way into Year in review. The newest year is the big one. */
function YearTiles({ years, lib }) {
  if (!years.length) return null;
  const thisYear = new Date().getFullYear();
  return (
    <section class="ins-years wide" aria-label="Your years in review">
      {years.map((y, i) => (
        <a key={y.year} class={'ins-year' + (i === 0 ? ' latest' : '')} href={href('year', y.year)}>
          <Stack keys={y.top && y.top.length ? y.top : (y.best ? [y.best] : [])} lib={lib} max={i === 0 ? 5 : 3} />
          <span class="ins-year-body">
            <span class="ins-year-num num">{y.year}</span>
            <span class="ins-year-meta muted num">{films(y.count)}{y.year === thisYear ? ' so far' : ''}{y.hours > 0 ? `, ${num(y.hours)} hours` : ''}</span>
            <span class="ins-year-open">{i === 0 ? 'Open your year in review' : 'Look back'} <span aria-hidden="true">→</span></span>
          </span>
        </a>
      ))}
    </section>
  );
}

export function Overview({ d, lib, library }) {
  const t = d.totals;
  const days = t.hours / 24;
  return (
    <div class="ins-grid">
      <Note lines={d.glanceParts || d.glance}>
        You've watched <b class="num"><TextLink to={filterHref('status', 'watched')}>{pluralN(t.films, 'film')}</TextLink></b>{t.hours > 0 && <>, <b class="num">{num(Math.round(t.hours))} hours</b> of them{days >= 2 ? `, or about ${Math.round(days)} days end to end` : ''}</>}.
        {t.entries > 0 && <> Your diary holds <b class="num"><TextLink to={href('diary')}>{pluralN(t.entries, 'entry', 'entries')}</TextLink></b>{t.reviews ? <>, {pluralN(t.reviews, 'review')} among them</> : null}.</>}
        {d.averageRating != null && <> You give <b class="num">{d.averageRating.toFixed(2)}★</b> on average{d.liked.count ? <>, and a heart to <b class="num"><TextLink to={filterHref('status', 'liked')}>{pluralN(d.liked.count, 'film')}</TextLink></b></> : null}.</>}
      </Note>

      <YearTiles years={d.years} lib={lib} />

      <MonthChart d={d} />

      {d.records.length > 0 && (
        <Section title="Records" hint="The outliers among everything you've watched." wide>
          {library ? <PosterRow items={d.records.map(r => ({ key: r.key, label: r.label, note: r.value }))} lib={lib} label="Records" /> : <Loading />}
        </Section>
      )}
    </div>
  );
}

export function Ratings({ d, lib, library }) {
  const t = d.totals;
  const hist = d.ratingHistogram;
  const top = hist.reduce((b, r) => (r.count > b.count ? r : b), hist[0]);
  const histData = hist.map(r => ({ label: r.rating % 2 ? (r.rating === 1 ? '½' : `${(r.rating - 1) / 2}½`) : String(r.rating / 2), value: r.count, hot: r === top && r.count > 0, title: `${r.rating / 2}★: ${films(r.count)}`, href: ratingLink(r.rating) }));
  const hot = d.hotTakes || { higher: [], lower: [] };
  const by = d.ratingsByYear;
  const trend = by.length >= 2 ? by[by.length - 1].averageRating - by[0].averageRating : 0;
  return (
    <div class="ins-grid">
      <Section title="Your ratings" hint={t.rated ? `${films(t.rated)} rated, ${d.averageRating.toFixed(2)}★ on average. You give ${top.rating / 2}★ most often.` : null}>
        {t.rated >= 3 ? <Bars data={histData} height={130} /> : <Thin />}
      </Section>

      <Section title="Kinder or tougher over time?" hint="Your average rating in each diary year.">
        {by.length >= 2 ? (
          <>
            <Bars data={by.map((y, i) => ({ label: String(y.year), value: y.averageRating, note: films(y.count), hot: i === by.length - 1, title: `${y.year}: ${y.averageRating.toFixed(2)}★ across ${films(y.count)}`, href: href('year', y.year) }))} height={110} />
            <p class="ins-summary">{Math.abs(trend) < 0.1 ? 'Your ratings have stayed about the same.' : `You've grown ${trend > 0 ? 'kinder' : 'tougher'} by ${Math.abs(trend).toFixed(1)}★ since ${by[0].year}.`}</p>
          </>
        ) : <Thin>This shows once your diary spans two years.</Thin>}
      </Section>

      <Section title="How you rate against the crowd" wide>
        {t.rated >= 5 ? <p class="ins-summary">{crowdLine(d.vsCrowd)}</p> : <Thin />}
      </Section>

      <ScoreSpread films={library && library.films} />
      <Calibration />

      <Section title="You loved more than most"><TakeList items={hot.higher} lib={lib} ready={!!library} /></Section>
      <Section title="You liked less than most"><TakeList items={hot.lower} lib={lib} ready={!!library} /></Section>
    </div>
  );
}

export const feelLink = r => href('feel', r.facet ? `d:${r.id}` : r.id);

export function ShareBars({ rows, link, feeling = false }) {
  const max = Math.max(1, ...rows.map(r => r.share));
  return (
    <ul class="ins-share">
      {rows.map((r, i) => (
        <li key={r.id || r.name} style={{ '--i': i }} title={`${r.label || r.name}: ${films(r.count)} (${r.share}%)`}>
          <span class="ins-share-name">{link ? <a class="chip" href={link(r)}>{r.label || r.name}</a> : (r.label || r.name)}</span>
          <span class="ins-share-track" aria-hidden="true"><i data-fam={feeling ? famOf(r.label, r.id) : undefined} style={{ width: (r.share / max) * 100 + '%' }} /></span>
          <span class="ins-share-n num">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function Taste({ d, lib }) {
  const { data: ft, loading } = useCall('getFeelTaste', {}, [], { refreshOn: 'library' });
  const mean = d.mean;
  const waiting = <Thin>{loading ? 'Reading how your films feel…' : 'This couldn\'t load just now.'}</Thin>;
  const none = <Thin>Rate a few more films and this shows which feelings go with your highest ratings.</Thin>;
  const decades = d.decades.map(x => ({ label: x.name, value: x.count, note: x.averageRating != null ? starsText(x.averageRating) : null, title: `${x.name}: ${films(x.count)}${x.averageRating != null ? `, ${x.averageRating.toFixed(2)}★ on average` : ''}`, href: decadeLink(x.name) }));
  const rt = d.runtime;
  const bestBand = rt.bands.filter(b => b.lean != null).sort((a, b) => b.lean - a.lean)[0];
  const lenMax = Math.max(1, ...rt.bands.map(b => b.count));
  return (
    <div class="ins-grid">
      <Section title="Feelings you rate highest" hint={mean != null ? `Against your own average of ${mean.toFixed(2)}★. Click one to find more films like it.` : null}>
        {!ft ? waiting : ft.feelings.higher.length ? <LeanList rows={ft.feelings.higher} mean={mean} link={feelLink} lib={lib} /> : none}
      </Section>
      <Section title="Feelings you rate lower" hint="Films that feel like this get your lower ratings.">
        {!ft ? waiting : ft.feelings.lower.length ? <LeanList rows={ft.feelings.lower} mean={mean} link={feelLink} lib={lib} /> : none}
      </Section>

      <Section title="What your films feel like" hint={ft ? `The feelings that turn up most across ${films(ft.films)} you've watched.` : null}>
        {!ft ? waiting : ft.feelings.common.length ? <ShareBars rows={ft.feelings.common} link={feelLink} feeling /> : <Thin>This fills in once reviews for your films have loaded.</Thin>}
      </Section>
      <Section title="Themes you return to" hint="The big ideas your films are most often about.">
        {!ft ? waiting : ft.themes.common.length ? <ShareBars rows={ft.themes.common} link={feelLink} /> : <Thin>This fills in once reviews for your films have loaded.</Thin>}
      </Section>

      <Section title="Themes you rate highest">
        {!ft ? waiting : ft.themes.higher.length ? <LeanList rows={ft.themes.higher} mean={mean} link={feelLink} lib={lib} /> : none}
      </Section>
      <Section title="Themes you rate lower">
        {!ft ? waiting : ft.themes.lower.length ? <LeanList rows={ft.themes.lower} mean={mean} link={feelLink} lib={lib} /> : none}
      </Section>

      <Section title="Genres" hint="How often you watch each, and how you rate it." wide>
        {d.genres.length ? <RankList rows={d.genres} link={genreLink} lib={lib} posters /> : <Thin>Genres appear once film details have loaded.</Thin>}
      </Section>

      <Section title="Decades" hint={d.medianYear ? `Your middle film is from ${d.medianYear}. Under each decade: your average rating.` : null}>
        {decades.length ? <Bars data={decades} height={120} /> : <Thin>Watch a few more films to see this.</Thin>}
      </Section>
      <Section title="Length" hint={rt.average ? `Your films run ${runtimeText(rt.average)} on average.${bestBand && bestBand.lean > 0.05 ? ` You rate films ${bestBand.name.toLowerCase().replace(/^(\d)/, 'of $1')} highest.` : ''}` : null}>
        {rt.average ? (
          <ul class="ins-len">
            {rt.bands.map((b, i) => (
              <li key={b.name} style={{ '--i': i }} title={`${b.name}: ${films(b.count)}${b.averageRating != null ? `, ${b.averageRating.toFixed(2)}★ on average` : ''}`}>
                <span class="ins-len-name">{b.count && lengthLink(b) ? <a href={lengthLink(b)}>{b.name}</a> : b.name}</span>
                <span class="ins-share-track" aria-hidden="true"><i style={{ width: (b.count / lenMax) * 100 + '%' }} /></span>
                <span class="ins-len-avg num">{b.averageRating != null ? <>{b.averageRating.toFixed(1)}<span class="ins-star">★</span></> : '–'}</span>
                <span class="ins-share-n num">{b.count}</span>
              </li>
            ))}
          </ul>
        ) : <Thin>Runtimes are still arriving.</Thin>}
      </Section>

      {d.favouriteSubjects.length > 0 && (
        <Section title="Favourite subjects" hint="What you rate highest, three films or more." wide>
          <RankList rows={d.favouriteSubjects} />
        </Section>
      )}
    </div>
  );
}

export function People({ d, lib }) {
  const p = d.people;
  const crew = [['Writers', p.writers, 'writer'], ['Cinematographers', p.cinematographers, 'cinematography'], ['Composers', p.composers, 'composer'], ['Editors', p.editors, 'editor']].filter(([, rows]) => rows.length);
  return (
    <div class="ins-grid">
      <Section title="Your directors" hint={`Two or more films watched, out of ${pluralN(p.directorCount, 'director')} in all.`}>
        {p.directors.length ? <RankList rows={p.directors} linkPeople role="director" lib={lib} posters /> : <Thin>Watch two films by the same director to see them here.</Thin>}
      </Section>
      <Section title="Your actors" hint="Two or more films, among the top-billed cast.">
        {p.actors.length ? <RankList rows={p.actors} linkPeople role="cast" lib={lib} posters /> : <Thin>Watch two films with the same actor to see them here.</Thin>}
      </Section>
      {p.bestDirectors.length > 0 && (
        <Section title="Directors you rate highest" hint="By your average rating, two rated films or more." wide>
          <ul class="ins-best">
            {p.bestDirectors.map((r, i) => (
              <li key={r.id || r.name} style={{ '--i': i }}>
                <MiniPosters keys={r.keys} lib={lib} max={3} />
                <span class="ins-best-name"><a href={href('person', r.id || r.name, { role: 'director' })}>{r.name}</a></span>
                <span class="ins-best-meta muted"><Stars rating={Math.round(r.averageRating * 2)} size="12px" /> <span class="num">{films(r.count)}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {crew.map(([title, rows, role]) => (
        <Section key={title} title={title} hint="Two or more films watched.">
          <RankList rows={rows} linkPeople role={role} />
        </Section>
      ))}
    </div>
  );
}

export function World({ d, library }) {
  const watched = d.totals.films;
  const english = d.topLanguages.find(l => /^english$/i.test(l.name));
  const countries = library ? tallyCountries(library.films).counts.size : 0;
  const abroad = d.topCountries.length && watched ? watched - (d.topCountries.find(c => /^(usa|united states)/i.test(c.name))?.count || 0) : 0;
  return (
    <div class="ins-grid">
      {countries > 0 && (
        <Note>
          Your films come from <b class="num">{plural(countries, 'country', 'countries')}</b>.
          {' '}<b class="num">{films(abroad)}</b> ({pct(abroad, watched)}%) were made outside the USA{english ? <>, and <b class="num">{films(watched - english.count)}</b> ({pct(watched - english.count, watched)}%) have no English in them</> : null}.
        </Note>
      )}
      <Section title="Countries" hint="Where the films you've watched were made. Click a country to see them." wide>
        {d.topCountries.length ? <CountriesMap films={library && library.films} /> : <Thin>Countries appear once film details have loaded.</Thin>}
      </Section>
      <Section title="Most watched countries">
        {d.topCountries.length ? <RankList rows={d.topCountries} link={countryLink} /> : <Thin>Countries appear once film details have loaded.</Thin>}
      </Section>
      <Section title="Languages">
        {d.topLanguages.length ? <RankList rows={d.topLanguages} link={languageLink} /> : <Thin>Languages appear once film details have loaded.</Thin>}
      </Section>
    </div>
  );
}

export function Habits({ d, lib, library }) {
  const t = d.totals, s = d.streaks, a = d.age;
  const weekdays = d.weekdays.map(w => ({ label: w.day, value: w.count, title: `${w.day}: ${plural(w.count, 'entry', 'entries')}` }));
  const topDay = d.weekdays.reduce((b, w) => (w.count > b.count ? w : b), d.weekdays[0]);
  const DAY_LONG = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  const ageMax = Math.max(1, ...a.bands.map(b => b.count));
  const gap = d.pace.thisYear - d.pace.lastYearToDate;
  return (
    <div class="ins-grid">
      <MonthChart d={d} />

      <Section title="Days you watch" hint={topDay && topDay.count ? `${DAY_LONG[topDay.day]} is your film night: ${topDay.count} of ${plural(t.entries, 'entry', 'entries')}.` : null}>
        {d.weekdays.some(w => w.count) ? <Bars data={weekdays.map(w => ({ ...w, hot: w.label === topDay.day }))} height={110} unit="entries" /> : <Thin>Log a few films in your diary to see this.</Thin>}
      </Section>

      <Section title="This year against last" hint={d.pace.lastYear ? `Last year you logged ${films(d.pace.lastYear)} in all.` : null}>
        {d.pace.thisYear || d.pace.lastYear ? (
          <div class="ins-pace">
            <div><span class="ins-pace-n num">{d.pace.thisYear}</span><span class="muted">{d.pace.year} so far</span></div>
            <div><span class="ins-pace-n num dim">{d.pace.lastYearToDate}</span><span class="muted">by this day in {d.pace.year - 1}</span></div>
            <p class="ins-summary">{!d.pace.lastYear ? 'Next year this compares the two.' : gap === 0 ? 'Level with last year.' : `${Math.abs(gap)} ${gap > 0 ? 'ahead of' : 'behind'} last year's pace.`}</p>
          </div>
        ) : <Thin>Log a few films in your diary to see this.</Thin>}
      </Section>

      <Section title="Streaks and busy days" wide>
        {t.entries ? (
          <dl class="ins-streaks">
            <div><dt>Longest streak</dt><dd class="num">{plural(s.longestDays, 'day', 'days')}</dd></div>
            <div><dt>Current streak</dt><dd class="num">{s.currentDays ? plural(s.currentDays, 'day', 'days') : 'None right now'}</dd></div>
            <div><dt>Typical month</dt><dd class="num">{plural(d.filmsPerMonthAvg, 'film', 'films')}</dd></div>
            <div><dt>Busiest day</dt><dd>{s.busiestDay ? <>{dateText(s.busiestDay.date)} <span class="faint num">· {films(s.busiestDay.count)}</span></> : '–'}</dd></div>
            <div><dt>Busiest month</dt><dd>{s.busiestMonth ? <>{monthLong(s.busiestMonth.month)} <span class="faint num">· {films(s.busiestMonth.count)}</span></> : '–'}</dd></div>
            <div><dt>Rewatches</dt><dd class="num">{t.rewatches ? <TextLink to={filterHref('text', 'is:rewatched')}>{num(t.rewatches)}</TextLink> : num(t.rewatches)}</dd></div>
          </dl>
        ) : <Thin>Log a few films in your diary to see this.</Thin>}
      </Section>

      <Section title="How new are the films you watch?" hint={a.count ? `${a.newShare}% within a year of release. Your middle first watch is ${a.median < 1 ? 'brand new' : `${plural(Math.round(a.median), 'year', 'years')} old`}.` : null}>
        {a.count ? (
          <ul class="ins-share">
            {a.bands.map((b, i) => (
              <li key={b.name} style={{ '--i': i }} title={`${b.name}: ${films(b.count)}`}>
                <span class="ins-share-name">{b.name}</span>
                <span class="ins-share-track" aria-hidden="true"><i style={{ width: (b.count / ageMax) * 100 + '%' }} /></span>
                <span class="ins-share-n num">{b.count}</span>
              </li>
            ))}
          </ul>
        ) : <Thin>Log a few films in your diary to see this.</Thin>}
      </Section>

      <Section title="Most rewatched" hint="Films you've logged more than once.">
        {d.rewatched.length ? (library ? <PosterRow items={d.rewatched.map(r => ({ key: r.key, note: `${r.times} times` }))} lib={lib} label="Most rewatched" rows={2} /> : <Loading />) : <Thin>Nothing logged twice yet.</Thin>}
      </Section>
    </div>
  );
}

export function Watchlist({ d, lib, library }) {
  const { data: ft, loading } = useCall('getFeelTaste', {}, [], { refreshOn: 'library' });
  const w = d.watchlist;
  if (!w.count) return <div class="ins-grid"><Section title="Your watchlist" wide><Thin>Nothing is waiting on your watchlist. Add films on Letterboxd and they show up here.</Thin></Section></div>;
  const gMax = Math.max(1, ...w.genres.flatMap(g => [g.share, g.watchedShare]));
  const decades = w.decades.map(x => ({ label: x.name, value: x.count, title: `${x.name}: ${films(x.count)}`, href: decadeLink(x.name) }));
  return (
    <div class="ins-grid">
      <Note>
        <b class="num"><TextLink to={filterHref('status', 'watchlist')}>{pluralN(w.count, 'film')}</TextLink></b> {w.count === 1 ? 'is' : 'are'} waiting on your watchlist{w.hours > 0 && <>: about <b class="num">{num(w.hours)} hours</b>{w.hours >= 48 ? `, or ${Math.round(w.hours / 24)} days end to end` : ''}</>}.
        {w.yearsAtPace != null && <> At your usual {plural(d.filmsPerMonthAvg, 'film', 'films')} a month, that's <b class="num">{w.yearsAtPace >= 1 ? `${w.yearsAtPace.toFixed(1)} years` : `${Math.round(w.yearsAtPace * 12)} months`}</b> of evenings.</>}
      </Note>

      <Section title="The best waiting for you" hint="The highest Matinee scores on your watchlist." wide>
        {library ? <PosterRow items={w.topScored.map(x => ({ key: x.key, note: `Matinee ${x.score}` }))} lib={lib} label="Highest scores on your watchlist" /> : <Loading />}
      </Section>

      {w.quick.length > 0 && (
        <Section title="Short and good" hint="Well-scored films of about an hour and a half or less." wide>
          {library ? <PosterRow items={w.quick.map(x => ({ key: x.key, note: `${runtimeText(x.runtime)} · ${x.score}` }))} lib={lib} label="Short films on your watchlist" /> : <Loading />}
        </Section>
      )}

      <Section title="What's waiting, against what you watch" hint="Share of your watchlist in each genre, with the share of what you've watched under it.">
        <ul class="ins-pair">
          {w.genres.map((g, i) => (
            <li key={g.name} style={{ '--i': i }} title={`${g.name}: ${g.share}% of your watchlist (${films(g.count)}), ${g.watchedShare}% of what you've watched`}>
              <span class="ins-pair-name"><a href={genreLink(g)}>{g.name}</a></span>
              <span class="ins-pair-bars" aria-hidden="true"><i class="wl" style={{ width: (g.share / gMax) * 100 + '%' }} /><i class="seen" style={{ width: (g.watchedShare / gMax) * 100 + '%' }} /></span>
              <span class="ins-pair-n num">{g.share}%<span class="faint"> {g.watchedShare}%</span></span>
            </li>
          ))}
        </ul>
        <p class="ins-key faint" aria-hidden="true"><i class="wl" /> Watchlist <i class="seen" /> Watched</p>
      </Section>

      <Section title="Feelings your watchlist leans towards" hint="More common among films waiting than among films you've watched.">
        {!ft ? <Thin>{loading ? 'Reading how your films feel…' : 'This couldn\'t load just now.'}</Thin> : ft.watchlist.leans.length ? (
          <ul class="ins-leans">
            {ft.watchlist.leans.map((r, i) => (
              <li key={r.id} style={{ '--i': i }} title={`${r.label}: ${r.share}% of your watchlist, ${r.watchedShare}% of what you've watched`}>
                <a class="chip" href={feelLink(r)}>{r.label}</a>
                <span class="num">{r.share}%</span><span class="faint num">against {r.watchedShare}%</span>
              </li>
            ))}
          </ul>
        ) : <Thin>Your watchlist feels much like what you already watch.</Thin>}
      </Section>

      <Section title="Directors waiting" hint="Two or more of their films on your watchlist.">
        {w.directors.length ? <RankList rows={w.directors} linkPeople role="director" lib={lib} posters /> : <Thin>No director has two films waiting.</Thin>}
      </Section>
      <Section title="Decades waiting">
        {decades.length ? <Bars data={decades} height={120} /> : <Thin>Nothing here yet.</Thin>}
      </Section>
    </div>
  );
}
