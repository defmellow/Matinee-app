// Insights: statistics over the library summaries and diary entries. Pure; handles empty input.
//
// summaries: library list items (see the shape in the brief: user.{watched,rating,liked,watchlist}, runtime, directors, ...)
// entries:   diary entries { id, key, date:'YYYY-MM-DD', rating, liked, rewatch, review, tags }
import { yourTake } from './scores.js';
import { localDay } from '../util/localday.js';
import { canonicalCountry, foldSearch, subjectTags } from './tags.js';

const DAY = 86400000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const hasRating = s => isNum(s?.user?.rating) && s.user.rating >= 1 && s.user.rating <= 10;
const pad = n => String(n).padStart(2, '0');

// ---------- dates ----------

/** 'YYYY-MM-DD' → { y, m, d, day } where day = whole days since 1970-01-01 (UTC), or null when not a real date. */
function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof str === 'string' ? str : '');
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, day: t / DAY, iso: `${m[1]}-${m[2]}-${m[3]}` };
}

const localToday = () => localDay();

// ---------- aggregation helpers ----------

/** Stars (0.5–5) for a film's rating, or null. */
const stars = s => (hasRating(s) ? s.user.rating / 2 : null);

/**
 * Group films under one or more keys each.
 * @param films summaries to count
 * @param keysOf s → [{ key, name, id? }] (duplicates within one film are counted once)
 * @param opts { minCount, limit, withId }
 * @returns [{ name, id?, count, averageRating }] sorted by count, then average rating, then name
 */
function aggregate(films, keysOf, { minCount = 1, limit = 10, withId = false } = {}) {
  const map = new Map();
  for (const s of films) {
    const seen = new Set();
    for (const k of keysOf(s)) {
      if (!k || k.key == null || k.key === '' || seen.has(k.key)) continue;
      seen.add(k.key);
      let e = map.get(k.key);
      if (!e) { e = { name: k.name, id: k.id, count: 0, sum: 0, rated: 0 }; map.set(k.key, e); }
      e.count++;
      const st = stars(s);
      if (st != null) { e.sum += st; e.rated++; }
    }
  }
  const rows = [...map.values()]
    .filter(e => e.count >= minCount)
    .map(e => {
      const row = { name: e.name };
      if (withId && e.id != null) row.id = e.id;
      row.count = e.count;
      row.averageRating = e.rated ? round2(e.sum / e.rated) : null;
      return row;
    });
  rows.sort(byCountThenRating);
  return rows.slice(0, limit);
}

function byCountThenRating(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  const ra = a.averageRating ?? -1, rb = b.averageRating ?? -1;
  if (rb !== ra) return rb - ra;
  return String(a.name).localeCompare(String(b.name));
}

const personKey = p => (p?.id ? `id:${p.id}` : p?.name ? `name:${foldSearch(p.name)}` : null);
const personKeys = list => (list || []).map(p => ({ key: personKey(p), name: p?.name, id: p?.id }));

// ---------- the report ----------

/**
 * @param {{ summaries?: object[], entries?: object[], today?: string }} input
 */
export function insights({ summaries = [], entries = [], today } = {}) {
  const films = Array.isArray(summaries) ? summaries.filter(Boolean) : [];
  const diary = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const todayDate = parseDate(today) || parseDate(localToday());
  const byKey = new Map(films.map(s => [s.key, s]));
  const runtimeOf = key => { const r = byKey.get(key)?.runtime; return isNum(r) && r > 0 ? r : 0; };

  const watched = films.filter(s => s.user?.watched);
  const rated = films.filter(hasRating);
  const dated = diary.map(e => ({ e, date: parseDate(e.date) })).filter(x => x.date);

  // ----- totals
  const entryKeys = new Set(diary.map(e => e.key));
  let minutes = 0;
  for (const e of diary) minutes += runtimeOf(e.key);
  for (const s of watched) if (!entryKeys.has(s.key)) minutes += runtimeOf(s.key);
  const totals = {
    films: watched.length,
    entries: diary.length,
    hours: round1(minutes / 60),
    rewatches: diary.filter(e => e.rewatch).length,
    reviews: diary.filter(e => typeof e.review === 'string' && e.review.trim()).length,
    liked: films.filter(s => s.user?.liked).length,
    watchlist: films.filter(s => s.user?.watchlist).length,
    rated: rated.length,
  };

  // ----- by year (entry date). DECISION: quiet years between the first and last are included with zeros, so charts have a steady axis.
  const yearMap = new Map();
  for (const { e, date } of dated) {
    const row = yearMap.get(date.y) || { year: date.y, count: 0, minutes: 0 };
    row.count++; row.minutes += runtimeOf(e.key);
    yearMap.set(date.y, row);
  }
  const byYear = [];
  if (yearMap.size) {
    const ys = [...yearMap.keys()];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      const row = yearMap.get(y);
      byYear.push({ year: y, count: row?.count || 0, hours: round1((row?.minutes || 0) / 60) });
    }
  }

  // ----- by month, last 24 months up to and including this one
  const monthCounts = new Map();
  for (const { date } of dated) {
    const k = `${date.y}-${pad(date.m)}`;
    monthCounts.set(k, (monthCounts.get(k) || 0) + 1);
  }
  const byMonth = [];
  for (let i = 23; i >= 0; i--) {
    const idx = todayDate.y * 12 + (todayDate.m - 1) - i;
    const k = `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
    byMonth.push({ month: k, count: monthCounts.get(k) || 0 });
  }

  // ----- ratings
  const ratingHistogram = Array.from({ length: 10 }, (_, i) => ({ rating: i + 1, count: 0 }));
  for (const s of rated) ratingHistogram[Math.round(s.user.rating) - 1].count++;
  const averageRating = rated.length ? round2(rated.reduce((a, s) => a + s.user.rating, 0) / rated.length / 2) : null;

  const diffs = films.map(s => (hasRating(s) ? yourTake(s.user.rating, s.score) : null)).filter(d => d != null);
  const vsCrowd = {
    averageDiff: diffs.length ? round1(diffs.reduce((a, b) => a + b, 0) / diffs.length) : null,
    agreeWithCrowdPct: diffs.length ? Math.round((100 * diffs.filter(d => Math.abs(d) <= 10).length) / diffs.length) : null,
    count: diffs.length,
  };

  // ----- favourites
  const topDirectors = aggregate(watched, s => personKeys(s.directors), { minCount: 2, withId: true });
  const topActors = aggregate(watched, s => personKeys((s.cast || []).slice(0, 5)), { minCount: 2, withId: true });
  const topCountries = aggregate(watched, s => (s.countries || []).map(c => {
    const k = canonicalCountry(c);
    return k && { key: k.id, name: c };
  }));
  const topLanguages = aggregate(watched, s => (s.languages || []).filter(Boolean).map(l => ({ key: foldSearch(l), name: l })));
  const topGenres = aggregate(watched, s => (s.genres || []).filter(Boolean).map(g => ({ key: foldSearch(g), name: g })));
  const topDecades = aggregate(watched, s => {
    if (!isNum(s.year) || s.year < 1800) return [];
    const d = Math.floor(s.year / 10) * 10;
    return [{ key: d, name: `${d}s` }];
  });

  const subjectStats = aggregate(rated, s => subjectTags(s, { max: Infinity }).map(t => ({ key: t.id, name: t.label })), { minCount: 3, limit: Infinity });
  const favouriteSubjects = subjectStats
    .sort((a, b) => (b.averageRating - a.averageRating) || (b.count - a.count) || a.name.localeCompare(b.name))
    .slice(0, 10);

  // ----- rhythm
  const weekdayCounts = new Array(7).fill(0);
  const dayCounts = new Map();
  for (const { date } of dated) {
    weekdayCounts[(new Date(date.day * DAY).getUTCDay() + 6) % 7]++;
    dayCounts.set(date.day, (dayCounts.get(date.day) || 0) + 1);
  }
  const weekdays = WEEKDAYS.map((day, i) => ({ day, count: weekdayCounts[i] }));

  const days = [...dayCounts.keys()].sort((a, b) => a - b);
  let longestDays = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > longestDays) longestDays = run;
  }
  // Current streak: consecutive days ending today or yesterday.
  let currentDays = 0;
  const upToToday = days.filter(d => d <= todayDate.day);
  if (upToToday.length) {
    let last = upToToday[upToToday.length - 1];
    if (last >= todayDate.day - 1) {
      currentDays = 1;
      for (let i = upToToday.length - 2; i >= 0 && upToToday[i] === last - 1; i--) { currentDays++; last = upToToday[i]; }
    }
  }

  const isoOfDay = d => new Date(d * DAY).toISOString().slice(0, 10);
  let busiestDay = null;
  for (const d of days) {
    const c = dayCounts.get(d);
    if (!busiestDay || c > busiestDay.count) busiestDay = { date: isoOfDay(d), count: c };
  }
  let busiestMonth = null;
  for (const k of [...monthCounts.keys()].sort()) {
    const c = monthCounts.get(k);
    if (!busiestMonth || c > busiestMonth.count) busiestMonth = { month: k, count: c };
  }

  const firstEntryDate = days.length ? isoOfDay(days[0]) : null;
  const lastEntryDate = days.length ? isoOfDay(days[days.length - 1]) : null;
  let filmsPerMonthAvg = 0;
  if (days.length) {
    const a = parseDate(firstEntryDate), b = parseDate(lastEntryDate);
    const months = (b.y - a.y) * 12 + (b.m - a.m) + 1;
    filmsPerMonthAvg = round1(dated.length / months);
  }

  return {
    totals, byYear, byMonth, ratingHistogram, averageRating, vsCrowd,
    topDirectors, topActors, topCountries, topLanguages, topGenres, topDecades,
    weekdays, streaks: { longestDays, currentDays, busiestDay, busiestMonth },
    firstEntryDate, lastEntryDate, filmsPerMonthAvg, favouriteSubjects,
  };
}
