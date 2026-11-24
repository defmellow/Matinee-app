// Year in review: a one-page recap of one calendar year of the diary. Pure and deterministic.
//
// summaries: library list items (user.{watched,rating,...}, runtime, directors, cast, genres, year, score, title)
// entries:   diary entries { id, key, date:'YYYY-MM-DD', rating, rewatch, review }
import { yourTake } from './scores.js';
import { foldSearch } from './tags.js';
import { linkPart, partsText } from './text-parts.js';

const DAY = 86400000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const pad = n => String(n).padStart(2, '0');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 'YYYY-MM-DD' → { y, m, day (days since epoch), iso } or null. */
function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof str === 'string' ? str : '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, day: t / DAY, iso: `${m[1]}-${m[2]}-${m[3]}` };
}
const isoOfDay = d => new Date(d * DAY).toISOString().slice(0, 10);
const validRating = r => isNum(r) && r >= 1 && r <= 10;

const personKey = p => (p?.id ? `id:${p.id}` : p?.name ? `name:${foldSearch(p.name)}` : null);

/**
 * @param {{ summaries?: object[], entries?: object[], year?: number }} input
 * @returns the YearReview described in docs/briefs/wave3-contracts.md
 */
export function yearInReview({ summaries = [], entries = [], year } = {}) {
  const films = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  const byKey = new Map(films.map(s => [s.key, s]));
  const dated = (Array.isArray(entries) ? entries : []).filter(Boolean)
    .map(e => ({ e, date: parseDate(e.date) })).filter(x => x.date)
    .sort((a, b) => a.date.day - b.date.day || (Number(a.e.id) || 0) - (Number(b.e.id) || 0) || String(a.e.key).localeCompare(String(b.e.key)));

  const years = [...new Set(dated.map(x => x.date.y))].sort((a, b) => b - a);
  const Y = Number(year) || years[0] || new Date().getFullYear();

  const inYear = dated.filter(x => x.date.y === Y);
  const runtimeOf = key => { const r = byKey.get(key)?.runtime; return isNum(r) && r > 0 ? r : 0; };

  // Per film: its entries this year, and the rating to show. DECISION: the rating is on the 1–10 half-star scale (like
  // summaries) and is the latest rated entry this year, falling back to the film's current rating.
  const perFilm = new Map();
  for (const x of inYear) {
    const f = perFilm.get(x.e.key) || { key: x.e.key, first: x, last: x, rating: null };
    f.last = x;
    if (validRating(x.e.rating)) f.rating = x.e.rating;
    perFilm.set(x.e.key, f);
  }
  for (const f of perFilm.values()) {
    if (f.rating == null && validRating(byKey.get(f.key)?.user?.rating)) f.rating = byKey.get(f.key).user.rating;
  }
  const yearFilms = [...perFilm.values()];

  // New to you: nothing logged for the film before this year.
  const seenBefore = new Set(dated.filter(x => x.date.y < Y).map(x => x.e.key));
  const newToYou = yearFilms.filter(f => !seenBefore.has(f.key)).length;

  let minutes = 0;
  for (const x of inYear) minutes += runtimeOf(x.e.key);
  const totals = {
    films: yearFilms.length,
    entries: inYear.length,
    hours: round1(minutes / 60),
    rewatches: inYear.filter(x => x.e.rewatch).length,
    reviews: inYear.filter(x => typeof x.e.review === 'string' && x.e.review.trim()).length,
    firstTimes: inYear.filter(x => !x.e.rewatch).length,
    newToYou,
  };

  const recency = f => f.last.date.day;
  const topFilms = yearFilms.filter(f => f.rating != null)
    .sort((a, b) => b.rating - a.rating || recency(b) - recency(a) || String(a.key).localeCompare(String(b.key)))
    .slice(0, 10).map(f => ({ key: f.key, rating: f.rating }));

  // DECISION (additive to the contract): `mosaic` = up to 24 of the year's films for the poster wall, rated ones first
  // (highest first), then unrated ones by most recent. The contract's topFilms only holds 10.
  const mosaic = [...yearFilms]
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || recency(b) - recency(a) || String(a.key).localeCompare(String(b.key)))
    .slice(0, 24).map(f => ({ key: f.key, rating: f.rating }));

  const firstFilm = inYear.length ? { key: inYear[0].e.key, date: inYear[0].date.iso } : null;
  const lastFilm = inYear.length ? { key: inYear[inYear.length - 1].e.key, date: inYear[inYear.length - 1].date.iso } : null;

  const monthCounts = new Array(12).fill(0);
  for (const x of inYear) monthCounts[x.date.m - 1]++;
  const months = monthCounts.map((count, i) => ({ month: `${Y}-${pad(i + 1)}`, count }));

  // People: directors and the first five cast members, two or more films this year.
  const people = new Map();
  for (const f of yearFilms) {
    const s = byKey.get(f.key);
    if (!s) continue;
    const seen = new Set();
    const add = (p, role) => {
      const k = personKey(p);
      if (!k || seen.has(k)) return;
      seen.add(k);
      let e = people.get(k);
      if (!e) { e = { name: p.name, id: p.id ?? null, role, count: 0, sum: 0, rated: 0 }; people.set(k, e); }
      e.count++;
      if (f.rating != null) { e.sum += f.rating / 2; e.rated++; }
    };
    for (const p of s.directors || []) add(p, 'director');
    for (const p of (s.cast || []).slice(0, 5)) add(p, 'cast');
  }
  const favouritePeople = [...people.values()].filter(e => e.count >= 2)
    .sort((a, b) => b.count - a.count || (b.rated ? b.sum / b.rated : -1) - (a.rated ? a.sum / a.rated : -1) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 6)
    .map(e => ({ name: e.name, id: e.id, role: e.role, count: e.count, averageRating: e.rated ? round2(e.sum / e.rated) : null }));

  const tally = (keysOf) => {
    const m = new Map();
    for (const f of yearFilms) {
      const s = byKey.get(f.key);
      if (!s) continue;
      for (const k of new Set(keysOf(s))) m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const genres = [...tally(s => (s.genres || []).filter(Boolean))]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  const decades = [...tally(s => (isNum(s.year) && s.year >= 1800 ? [Math.floor(s.year / 10) * 10] : []))]
    .map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade);

  // Streaks and busiest day, within the year.
  const dayCounts = new Map();
  for (const x of inYear) dayCounts.set(x.date.day, (dayCounts.get(x.date.day) || 0) + 1);
  const days = [...dayCounts.keys()].sort((a, b) => a - b);
  let longestStreak = { days: 0, from: null, to: null };
  let runStart = 0;
  for (let i = 0; i < days.length; i++) {
    if (i > 0 && days[i] !== days[i - 1] + 1) runStart = i;
    const len = i - runStart + 1;
    if (len > longestStreak.days) longestStreak = { days: len, from: isoOfDay(days[runStart]), to: isoOfDay(days[i]) };
  }
  let busiestDay = null;
  for (const d of days) {
    const c = dayCounts.get(d);
    if (!busiestDay || c > busiestDay.count) busiestDay = { date: isoOfDay(d), count: c };
  }

  // Oldest and newest by release year (ties: the earlier watched).
  let oldestFilm = null, newestFilm = null;
  for (const f of yearFilms) {
    const fy = byKey.get(f.key)?.year;
    if (!isNum(fy) || fy < 1800) continue;
    if (!oldestFilm || fy < oldestFilm.year) oldestFilm = { key: f.key, year: fy };
    if (!newestFilm || fy > newestFilm.year) newestFilm = { key: f.key, year: fy };
  }

  const ratedStars = yearFilms.filter(f => f.rating != null).map(f => f.rating / 2);
  const ratingAverage = ratedStars.length ? round2(ratedStars.reduce((a, b) => a + b, 0) / ratedStars.length) : null;
  const diffs = yearFilms.map(f => yourTake(f.rating, byKey.get(f.key)?.score)).filter(d => d != null);
  const ratingVsCrowd = diffs.length ? round2(diffs.reduce((a, b) => a + b, 0) / diffs.length / 20) : null; // 100 points = 5 stars

  const title = key => byKey.get(key)?.title || 'a film';
  // Each highlight is kept as parts too (text-parts.js), so a film or year named in it can be a link; `highlights` is
  // the same sentences as plain text.
  const parts = [];
  if (!inYear.length) {
    parts.push([`Nothing in your diary for ${Y} yet.`]);
  } else {
    const busiest = monthCounts.reduce((bi, c, i) => (c > monthCounts[bi] ? i : bi), 0);
    if (monthCounts[busiest] > 1) parts.push([`You watched ${monthCounts[busiest]} films in ${MONTH_NAMES[busiest]}, your busiest month.`]);
    if (topFilms.length) parts.push(['Your highest rated was ', byKey.has(topFilms[0].key) ? linkPart(title(topFilms[0].key), 'film', topFilms[0].key) : title(topFilms[0].key), `, at ${topFilms[0].rating / 2} stars.`]);
    if (longestStreak.days >= 2) parts.push([`Your longest streak was ${plural(longestStreak.days, 'day', 'days')} in a row.`]);
    if (busiestDay && busiestDay.count >= 2) parts.push([`${plural(busiestDay.count, 'film', 'films')} in one day on ${new Date(busiestDay.date + 'T12:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' })}.`]);
    if (totals.rewatches) parts.push([`You rewatched ${plural(totals.rewatches, 'film', 'films')}.`]);
    if (ratingVsCrowd != null && Math.abs(ratingVsCrowd) >= 0.1) parts.push([`You rated ${Math.abs(ratingVsCrowd).toFixed(1)} stars ${ratingVsCrowd > 0 ? 'above' : 'below'} the crowd on average.`]);
    if (oldestFilm && newestFilm && newestFilm.year - oldestFilm.year >= 20) parts.push([`Your films span ${newestFilm.year - oldestFilm.year} years, from `, linkPart(oldestFilm.year, 'film', oldestFilm.key), ' to ', linkPart(newestFilm.year, 'film', newestFilm.key), '.']);
    if (parts.length < 3 && totals.newToYou) parts.push([`${plural(totals.newToYou, 'film was', 'films were')} new to you.`]);
    if (parts.length < 3) parts.push([`You logged ${plural(totals.entries, 'film', 'films')} in ${Y}.`]);
  }
  const highlights = parts.map(partsText);

  // ---------- Nov 2026 remake: everything below is additive ----------
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const scoreOf = key => byKey.get(key)?.score ?? 0;

  // Every film of the year, best first, with when it was (last) watched.
  const allFilms = [...yearFilms]
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || recency(b) - recency(a) || String(a.key).localeCompare(String(b.key)))
    .map(f => ({ key: f.key, rating: f.rating, date: f.last.date.iso, rewatch: inYear.some(x => x.e.key === f.key && x.e.rewatch) }));

  // The best film of each month (highest rating that month, then Matinee score).
  const monthBest = new Array(12).fill(null);
  for (const x of inYear) {
    const r = validRating(x.e.rating) ? x.e.rating : perFilm.get(x.e.key)?.rating;
    if (r == null) continue;
    const cur = monthBest[x.date.m - 1];
    if (!cur || r > cur.rating || (r === cur.rating && scoreOf(x.e.key) > scoreOf(cur.key))) monthBest[x.date.m - 1] = { key: x.e.key, rating: r };
  }
  const monthsFull = months.map((m, i) => ({ ...m, best: monthBest[i] }));

  const weekdayCounts = new Array(7).fill(0);
  for (const x of inYear) weekdayCounts[(new Date(x.date.day * DAY).getUTCDay() + 6) % 7]++;
  const weekdays = WEEKDAYS.map((day, i) => ({ day, count: weekdayCounts[i] }));
  const dayCountsIso = Object.fromEntries(days.map(d => [isoOfDay(d), dayCounts.get(d)]));

  // The year before, for "against last year".
  const prevEntries = dated.filter(x => x.date.y === Y - 1);
  let previous = null;
  if (prevEntries.length) {
    const pf = new Map();
    for (const x of prevEntries) { const r = validRating(x.e.rating) ? x.e.rating : pf.get(x.e.key) ?? null; pf.set(x.e.key, r); }
    const pr = [...pf.entries()].map(([k, r]) => r ?? (validRating(byKey.get(k)?.user?.rating) ? byKey.get(k).user.rating : null)).filter(r => r != null);
    previous = {
      year: Y - 1, films: pf.size, entries: prevEntries.length,
      hours: round1(prevEntries.reduce((a, x) => a + runtimeOf(x.e.key), 0) / 60),
      ratingAverage: pr.length ? round2(pr.reduce((a, b) => a + b, 0) / pr.length / 2) : null,
    };
  }

  // Genres with how the user rated them, countries and languages.
  const withRating = (keysOf, { limit = 8 } = {}) => {
    const m = new Map();
    for (const f of yearFilms) {
      const s2 = byKey.get(f.key);
      if (!s2) continue;
      for (const k of new Set(keysOf(s2))) {
        const e = m.get(k) || { name: k, count: 0, sum: 0, rated: 0, keys: [] };
        e.count++; e.keys.push(f.key);
        if (f.rating != null) { e.sum += f.rating / 2; e.rated++; }
        m.set(k, e);
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))).slice(0, limit)
      .map(e => ({ name: e.name, count: e.count, averageRating: e.rated ? round2(e.sum / e.rated) : null, keys: e.keys.slice(0, 6) }));
  };
  const genresRated = withRating(s2 => (s2.genres || []).filter(Boolean), { limit: 10 });
  const countries = withRating(s2 => (s2.countries || []).filter(Boolean), { limit: 8 });
  const languages = withRating(s2 => (s2.languages || []).filter(Boolean), { limit: 8 });

  // Length.
  const timed = yearFilms.map(f => byKey.get(f.key)).filter(s2 => s2 && isNum(s2.runtime) && s2.runtime > 0);
  const pick = (list, better) => list.reduce((best, s2) => (!best || better(s2, best) ? s2 : best), null);
  const longest = pick(timed, (a, b) => a.runtime > b.runtime), shortest = pick(timed.filter(s2 => s2.runtime >= 40), (a, b) => a.runtime < b.runtime);
  const runtime = {
    average: timed.length ? Math.round(timed.reduce((a, s2) => a + s2.runtime, 0) / timed.length) : null,
    longest: longest ? { key: longest.key, runtime: longest.runtime } : null,
    shortest: shortest ? { key: shortest.key, runtime: shortest.runtime } : null,
  };

  // Where the user and the crowd parted ways this year.
  const takes = yearFilms.map(f => ({ key: f.key, diff: yourTake(f.rating, byKey.get(f.key)?.score) })).filter(t => t.diff != null);
  const hotTakes = {
    higher: takes.filter(t => t.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5),
    lower: takes.filter(t => t.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5),
  };

  // Stars given this year.
  const ratingHistogram = Array.from({ length: 10 }, (_, i) => ({ rating: i + 1, count: 0 }));
  for (const f of yearFilms) if (f.rating != null) ratingHistogram[Math.round(f.rating) - 1].count++;

  // Directors met for the first time this year (nothing of theirs in the diary before), with their films.
  const before = new Set();
  for (const x of dated) if (x.date.y < Y) for (const p of byKey.get(x.e.key)?.directors || []) { const k = personKey(p); if (k) before.add(k); }
  const metMap = new Map();
  for (const f of yearFilms) for (const p of byKey.get(f.key)?.directors || []) {
    const k = personKey(p);
    if (!k || before.has(k)) continue;
    const e = metMap.get(k) || { name: p.name, id: p.id ?? null, keys: [], sum: 0, rated: 0 };
    e.keys.push(f.key);
    if (f.rating != null) { e.sum += f.rating / 2; e.rated++; }
    metMap.set(k, e);
  }
  const met = [...metMap.values()];
  const newDirectors = {
    count: met.length,
    best: met.filter(e => e.rated).sort((a, b) => b.sum / b.rated - a.sum / a.rated || b.keys.length - a.keys.length || String(a.name).localeCompare(String(b.name)))
      .slice(0, 6).map(e => ({ name: e.name, id: e.id, count: e.keys.length, averageRating: round2(e.sum / e.rated), keys: e.keys.slice(0, 4) })),
  };
  // People with their films, for poster strips (favouritePeople above keeps its contract shape).
  const peopleFilms = {};
  for (const f of yearFilms) {
    const s2 = byKey.get(f.key);
    for (const p of [...(s2?.directors || []), ...(s2?.cast || []).slice(0, 5)]) { const k = p?.id || p?.name; if (k) (peopleFilms[k] ||= []).push(f.key); }
  }
  const favouritePeopleFilms = favouritePeople.map(p => ({ ...p, keys: [...new Set(peopleFilms[p.id || p.name] || [])].slice(0, 4) }));

  const rewatchedFilms = [...new Set(inYear.filter(x => x.e.rewatch).map(x => x.e.key))];
  const liked = yearFilms.filter(f => byKey.get(f.key)?.user?.liked).length;

  return {
    year: Y, years, totals, topFilms, mosaic, firstFilm, lastFilm, months, favouritePeople, genres, decades,
    longestStreak, busiestDay, oldestFilm, newestFilm, ratingAverage, ratingVsCrowd, highlights: highlights.slice(0, 5), highlightParts: parts.slice(0, 5),
    films: allFilms, monthsFull, weekdays, dayCounts: dayCountsIso, previous, genresRated, countries, languages, runtime,
    hotTakes, ratingHistogram, newDirectors, favouritePeopleFilms, rewatchedFilms, liked,
  };
}
