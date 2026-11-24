// More insights (Nov 2026 remake of the Insights screen): taste by genre, length and age, people beyond directors and
// actors, records, pace against last year, and the watchlist. Pure; handles empty input. Added to getInsights' answer.
//
// summaries: FULL library summaries (core/api.js summarize: user.{watched,rating,liked,watchlist}, runtime, people, ratings, score…)
// entries:   diary entries { key, date:'YYYY-MM-DD', rating, rewatch }
import { foldSearch } from './tags.js';
import { localDay } from '../util/localday.js';

const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const hasRating = s => isNum(s?.user?.rating) && s.user.rating >= 1 && s.user.rating <= 10;
const stars = s => (hasRating(s) ? s.user.rating / 2 : null);
const median = xs => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const dateOf = str => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof str === 'string' ? str : ''); return m ? { y: +m[1], m: +m[2], d: +m[3], md: m[2] + '-' + m[3] } : null; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A group needs this many rated films before "you rate it higher / lower than usual" is said about it. */
export const LEAN_MIN = 3;
/** Shrinks a group's lean towards zero so three films cannot outshout thirty: sum(stars − your mean) / (n + SHRINK). */
export const LEAN_SHRINK = 3;
/** A film under this many minutes is a short: left out of "shortest" records and watchlist quick picks. */
const FEATURE_MIN = 40;

const personKey = p => (p?.id ? `id:${p.id}` : p?.name ? `name:${foldSearch(p.name)}` : null);

/**
 * Group films under one or more keys each, keeping which films and how the user rates them against their own average.
 * @returns [{ name, id?, count, rated, averageRating, lean, keys }] (unsorted). `lean` is in stars, shrunk; null under LEAN_MIN rated films.
 */
export function groupFilms(films, keysOf, mean) {
  const map = new Map();
  for (const s of films) {
    const seen = new Set();
    for (const k of keysOf(s) || []) {
      if (!k || k.key == null || k.key === '' || seen.has(k.key)) continue;
      seen.add(k.key);
      let e = map.get(k.key);
      if (!e) { e = { name: k.name, id: k.id ?? null, count: 0, sum: 0, rated: 0, films: [] }; map.set(k.key, e); }
      e.count++;
      const st = stars(s);
      if (st != null) { e.sum += st; e.rated++; }
      e.films.push(s);
    }
  }
  return [...map.values()].map(e => ({
    name: e.name, ...(e.id != null ? { id: e.id } : {}), count: e.count, rated: e.rated,
    averageRating: e.rated ? round2(e.sum / e.rated) : null,
    lean: e.rated >= LEAN_MIN && mean != null ? round2((e.sum - mean * e.rated) / (e.rated + LEAN_SHRINK)) : null,
    keys: e.films.sort((a, b) => (b.user?.rating ?? 0) - (a.user?.rating ?? 0) || (b.score ?? 0) - (a.score ?? 0) || String(a.key).localeCompare(String(b.key))).map(s => s.key),
  }));
}
const byCount = (a, b) => b.count - a.count || (b.averageRating ?? -1) - (a.averageRating ?? -1) || String(a.name).localeCompare(String(b.name));
const byLean = (a, b) => b.lean - a.lean || b.count - a.count || String(a.name).localeCompare(String(b.name));
const top = (rows, n, keyMax = 6) => rows.slice(0, n).map(r => ({ ...r, keys: r.keys.slice(0, keyMax) }));

const RUNTIME_BANDS = [
  { id: 'short', label: 'Under 90 min', max: 90 },
  { id: 'mid', label: '90 min to 2 hours', max: 120 },
  { id: 'long', label: '2 to 2½ hours', max: 150 },
  { id: 'epic', label: 'Over 2½ hours', max: Infinity },
];
const AGE_BANDS = [
  { id: 'new', label: 'Within a year of release', max: 1 },
  { id: 'recent', label: '2 to 5 years old', max: 5 },
  { id: 'older', label: '6 to 20 years old', max: 20 },
  { id: 'classic', label: '21 to 50 years old', max: 50 },
  { id: 'vintage', label: 'Over 50 years old', max: Infinity },
];

/**
 * @param {{ summaries?: object[], entries?: object[], today?: string, perMonth?: number }} input  perMonth = films a month the user usually logs
 */
export function moreInsights({ summaries = [], entries = [], today, perMonth = 0 } = {}) {
  const films = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  const diary = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const now = dateOf(today) || dateOf(localDay());
  const byKey = new Map(films.map(s => [s.key, s]));
  const watched = films.filter(s => s.user?.watched);
  const rated = watched.filter(hasRating);
  const mean = rated.length ? rated.reduce((a, s) => a + s.user.rating / 2, 0) / rated.length : null;

  // ----- taste: genres, decades, length
  const genreRows = groupFilms(watched, s => (s.genres || []).filter(Boolean).map(g => ({ key: foldSearch(g), name: g })), mean);
  const genres = top([...genreRows].sort(byCount), 14);
  const leaning = rows => {
    const able = rows.filter(r => r.lean != null);
    return { higher: top(able.filter(r => r.lean > 0.05).sort(byLean), 5), lower: top(able.filter(r => r.lean < -0.05).sort((a, b) => a.lean - b.lean || byCount(a, b)), 5) };
  };
  const genreLean = leaning(genreRows);

  const decadeRows = groupFilms(watched, s => (isNum(s.year) && s.year >= 1800 ? [{ key: Math.floor(s.year / 10) * 10, name: `${Math.floor(s.year / 10) * 10}s` }] : []), mean);
  const decades = decadeRows.sort((a, b) => parseInt(a.name) - parseInt(b.name)).map(r => ({ ...r, keys: r.keys.slice(0, 6) }));
  const yearsSeen = watched.map(s => s.year).filter(y => isNum(y) && y >= 1800);

  const timed = watched.filter(s => isNum(s.runtime) && s.runtime > 0);
  const features = timed.filter(s => s.runtime >= FEATURE_MIN);
  const bandOf = (bands, v) => bands.find(b => v <= b.max) || bands[bands.length - 1];
  const runtimeRows = groupFilms(timed, s => { const b = bandOf(RUNTIME_BANDS, s.runtime - 0.5); return [{ key: b.id, name: b.label }]; }, mean);
  const pickBy = (list, better) => list.reduce((best, s) => (!best || better(s, best) ? s : best), null);
  const runtime = {
    average: timed.length ? Math.round(timed.reduce((a, s) => a + s.runtime, 0) / timed.length) : null,
    median: timed.length ? Math.round(median(timed.map(s => s.runtime))) : null,
    bands: RUNTIME_BANDS.map(b => runtimeRows.find(r => r.name === b.label) || { name: b.label, count: 0, rated: 0, averageRating: null, lean: null, keys: [] }).map(r => ({ ...r, keys: r.keys.slice(0, 6) })),
    longest: (x => x && { key: x.key, runtime: x.runtime })(pickBy(timed, (a, b) => a.runtime > b.runtime)),
    shortest: (x => x && { key: x.key, runtime: x.runtime })(pickBy(features, (a, b) => a.runtime < b.runtime)),
  };

  // ----- how old a film is when the user watches it (first watches only: a rewatch says nothing about what the user seeks out)
  const ages = [];
  for (const e of diary) {
    const d = dateOf(e.date), s = byKey.get(e.key);
    if (!d || e.rewatch || !s || !isNum(s.year) || s.year < 1800) continue;
    ages.push(Math.max(0, d.y - s.year));
  }
  const age = {
    count: ages.length,
    median: ages.length ? median(ages) : null,
    newShare: ages.length ? Math.round((100 * ages.filter(a => a <= 1).length) / ages.length) : null,
    bands: AGE_BANDS.map(b => ({ name: b.label, count: ages.filter(a => bandOf(AGE_BANDS, a) === b).length })),
  };

  // ----- ratings by diary year: is the user getting kinder or tougher?
  const byYearMap = new Map();
  for (const e of diary) {
    const d = dateOf(e.date);
    if (!d || !isNum(e.rating) || e.rating < 1 || e.rating > 10) continue;
    const r = byYearMap.get(d.y) || { year: d.y, sum: 0, count: 0 };
    r.sum += e.rating / 2; r.count++;
    byYearMap.set(d.y, r);
  }
  const ratingsByYear = [...byYearMap.values()].sort((a, b) => a.year - b.year).map(r => ({ year: r.year, count: r.count, averageRating: round2(r.sum / r.count) }));

  // ----- pace: this year so far against the same point last year
  const dated = diary.map(e => dateOf(e.date)).filter(Boolean);
  const pace = {
    year: now.y,
    thisYear: dated.filter(d => d.y === now.y).length,
    lastYearToDate: dated.filter(d => d.y === now.y - 1 && d.md <= now.md).length,
    lastYear: dated.filter(d => d.y === now.y - 1).length,
  };

  // ----- one row per diary year, for the year-in-review tiles: films, hours, a month-by-month line and the year's best film
  const yearMap = new Map();
  for (const e of diary) {
    const d = dateOf(e.date);
    if (!d) continue;
    const y = yearMap.get(d.y) || { year: d.y, count: 0, minutes: 0, months: new Array(12).fill(0), best: null, rated: new Map() };
    y.count++; y.months[d.m - 1]++;
    const s = byKey.get(e.key);
    if (s && isNum(s.runtime) && s.runtime > 0) y.minutes += s.runtime;
    const r = isNum(e.rating) ? e.rating : (s && hasRating(s) ? s.user.rating : null);
    if (s && r != null) y.rated.set(s.key, Math.max(r, y.rated.get(s.key) ?? 0));
    if (s && r != null && (!y.best || r > y.best.rating || (r === y.best.rating && (s.score ?? 0) > y.best.score))) y.best = { key: s.key, rating: r, score: s.score ?? 0 };
    yearMap.set(d.y, y);
  }
  const years = [...yearMap.values()].sort((a, b) => b.year - a.year)
    .map(y => ({ year: y.year, count: y.count, hours: Math.round(y.minutes / 60), months: y.months, best: y.best ? y.best.key : null,
      // the user's favourites of the year, for the little stack of posters on the year's tile
      top: [...y.rated.entries()].sort((a, b) => b[1] - a[1] || (byKey.get(b[0])?.score ?? 0) - (byKey.get(a[0])?.score ?? 0) || String(a[0]).localeCompare(String(b[0]))).slice(0, 5).map(([k]) => k) }));

  // ----- people beyond directors and actors
  const crewRows = role => top(groupFilms(watched, s => ((s.people && s.people[role]) || []).map(p => ({ key: personKey(p), name: p?.name, id: p?.id })), mean).filter(r => r.count >= 2).sort(byCount), 8);
  const directorRows = groupFilms(watched, s => (s.directors || []).map(p => ({ key: personKey(p), name: p?.name, id: p?.id })), mean).filter(r => r.count >= 2);
  const actorRows = groupFilms(watched, s => (s.cast || []).slice(0, 5).map(p => ({ key: personKey(p), name: p?.name, id: p?.id })), mean).filter(r => r.count >= 2);
  const people = {
    directors: top([...directorRows].sort(byCount), 12),
    actors: top([...actorRows].sort(byCount), 12),
    bestDirectors: top(directorRows.filter(r => r.rated >= 2).sort((a, b) => b.averageRating - a.averageRating || byCount(a, b)), 6),
    writers: crewRows('writer'),
    cinematographers: crewRows('cinematography'),
    composers: crewRows('composer'),
    editors: crewRows('editor'),
    directorCount: new Set(watched.flatMap(s => (s.directors || []).map(personKey).filter(Boolean))).size,
  };

  // ----- rewatches
  const rewatched = watched.filter(s => (s.timesWatched || 0) >= 2)
    .sort((a, b) => b.timesWatched - a.timesWatched || (b.user?.rating ?? 0) - (a.user?.rating ?? 0) || String(a.key).localeCompare(String(b.key)))
    .slice(0, 10).map(s => ({ key: s.key, times: s.timesWatched }));

  // ----- records among what the user has watched
  const scored = watched.filter(s => isNum(s.score));
  const votesOf = s => { const v = s.ratings?.letterboxd?.votes; return isNum(v) && v > 0 ? v : null; };
  const voted = watched.filter(s => votesOf(s) != null);
  const yeared = watched.filter(s => isNum(s.year) && s.year >= 1800);
  const rec = (label, s, value) => (s ? { label, key: s.key, value } : null);
  const records = [
    rec('Highest Matinee score', pickBy(scored, (a, b) => a.score > b.score), s => String(s.score)),
    rec('Lowest Matinee score', pickBy(scored, (a, b) => a.score < b.score), s => String(s.score)),
    rec('Oldest', pickBy(yeared, (a, b) => a.year < b.year), s => String(s.year)),
    rec('Longest', pickBy(timed, (a, b) => a.runtime > b.runtime), s => `${Math.floor(s.runtime / 60)} h ${s.runtime % 60} m`),
    rec('Shortest', pickBy(features, (a, b) => a.runtime < b.runtime), s => `${s.runtime} min`),
    rec('Most watched on Letterboxd', pickBy(voted, (a, b) => votesOf(a) > votesOf(b)), s => `${votesOf(s).toLocaleString('en-AU')} ratings`),
    rec('Least watched on Letterboxd', pickBy(voted, (a, b) => votesOf(a) < votesOf(b)), s => `${votesOf(s).toLocaleString('en-AU')} ratings`),
  ].filter(Boolean).map(r => ({ label: r.label, key: r.key, value: r.value(byKey.get(r.key)) }));

  // ----- watchlist: what is waiting
  const waiting = films.filter(s => s.user?.watchlist && !s.user?.watched);
  const wTimed = waiting.filter(s => isNum(s.runtime) && s.runtime > 0);
  const share = (rows, total) => rows.map(r => ({ name: r.name, count: r.count, share: total ? Math.round((100 * r.count) / total) : 0 }));
  const wGenres = groupFilms(waiting, s => (s.genres || []).filter(Boolean).map(g => ({ key: foldSearch(g), name: g })), null).sort(byCount);
  const watchedShare = new Map(genreRows.map(r => [foldSearch(r.name), watched.length ? Math.round((100 * r.count) / watched.length) : 0]));
  const wDecades = groupFilms(waiting, s => (isNum(s.year) && s.year >= 1800 ? [{ key: Math.floor(s.year / 10) * 10, name: `${Math.floor(s.year / 10) * 10}s` }] : []), null)
    .sort((a, b) => parseInt(a.name) - parseInt(b.name)).map(r => ({ name: r.name, count: r.count }));
  const wDirectors = groupFilms(waiting, s => (s.directors || []).map(p => ({ key: personKey(p), name: p?.name, id: p?.id })), null).filter(r => r.count >= 2).sort(byCount);
  const wHours = wTimed.reduce((a, s) => a + s.runtime, 0) / 60;
  const watchlist = {
    count: waiting.length,
    hours: Math.round(wHours),
    untimed: waiting.length - wTimed.length,
    yearsAtPace: perMonth > 0 && waiting.length ? round1(waiting.length / (perMonth * 12)) : null,
    topScored: waiting.filter(s => isNum(s.score)).sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key))).slice(0, 12).map(s => ({ key: s.key, score: s.score })),
    quick: wTimed.filter(s => s.runtime >= FEATURE_MIN && s.runtime <= 95 && isNum(s.score)).sort((a, b) => b.score - a.score || a.runtime - b.runtime).slice(0, 12).map(s => ({ key: s.key, runtime: s.runtime, score: s.score })),
    genres: share(wGenres.slice(0, 10), waiting.length).map(g => ({ ...g, watchedShare: watchedShare.get(foldSearch(g.name)) ?? 0 })),
    decades: wDecades,
    directors: wDirectors.slice(0, 8).map(r => ({ name: r.name, ...(r.id != null ? { id: r.id } : {}), count: r.count, keys: r.keys.slice(0, 6) })),
  };

  // ----- at a glance: a few plain sentences, the most telling first
  const glance = [];
  if (pace.thisYear && pace.lastYear) {
    const gap = pace.thisYear - pace.lastYearToDate;
    glance.push(gap === 0 ? `${plural(pace.thisYear, 'film', 'films')} logged in ${now.y}, level with this point last year.`
      : `${plural(pace.thisYear, 'film', 'films')} logged in ${now.y}, ${Math.abs(gap)} ${gap > 0 ? 'ahead of' : 'behind'} this point last year.`);
  }
  if (genreLean.higher.length) {
    const g = genreLean.higher[0], l = genreLean.lower[0];
    glance.push(`${g.name} gets your highest ratings (${g.averageRating.toFixed(1)}★ across ${plural(g.rated, "film", "films")})${l ? `, ${l.name} your lowest (${l.averageRating.toFixed(1)}★)` : ""}.`);
  }
  if (people.directors.length) { const p = people.directors[0]; glance.push(`${p.name} is your most watched director, with ${plural(p.count, 'film', 'films')}.`); }
  if (yearsSeen.length >= 10) {
    const recent = yearsSeen.filter(y => y >= now.y - 10).length;
    glance.push(`${Math.round((100 * recent) / yearsSeen.length)}% of what you've watched came out in the last ten years; your middle film is from ${Math.round(median(yearsSeen))}.`);
  }
  if (watchlist.count && watchlist.yearsAtPace) glance.push(`Your watchlist holds ${plural(watchlist.count, 'film', 'films')}: about ${watchlist.yearsAtPace} years at your usual pace.`);

  return {
    mean: mean != null ? round2(mean) : null,
    genres, genreLean, decades, medianYear: yearsSeen.length ? Math.round(median(yearsSeen)) : null,
    runtime, age, ratingsByYear, pace, years, people, rewatched, records, watchlist, glance,
    liked: { count: watched.filter(s => s.user?.liked).length, share: watched.length ? Math.round((100 * watched.filter(s => s.user?.liked).length) / watched.length) : 0 },
  };
}

// ---------- feelings: what the films the user watches and loves feel like ----------

const FEEL_FACETS = ['mood', 'tone', 'pace', 'craft', 'impact'];
/** A feeling counts for a film when Matinee is not "very unsure" about it and it clears this strength. */
export const FEEL_MIN = 0.15;

/**
 * @param {{ summaries?: object[], profileOf: (key: string) => object|null }} input
 * @returns {{ films, feelings: { common, higher, lower }, themes: { common, higher, lower }, watchlist: { films, leans } }}
 *   rows: { id, label, facet, count, share, averageRating, lean, keys }
 */
export function feelTaste({ summaries = [], profileOf } = {}) {
  const films = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  const chipsOf = s => { const p = profileOf && profileOf(s.key); return p ? (p.descriptors || []).filter(d => !d.fragile && d.score >= FEEL_MIN) : null; };
  const watched = films.filter(s => s.user?.watched);
  const rated = watched.filter(hasRating);
  const mean = rated.length ? rated.reduce((a, s) => a + s.user.rating / 2, 0) / rated.length : null;
  const chipMap = new Map();
  for (const s of films) { const c = chipsOf(s); if (c && c.length) chipMap.set(s.key, c); }
  const having = list => list.filter(s => chipMap.has(s.key));
  const rowsFor = (list, pick) => {
    const meta = new Map();
    const rows = groupFilms(list, s => (chipMap.get(s.key) || []).filter(pick).map(d => { meta.set(d.id, d); return { key: d.id, name: d.label, id: d.id }; }), mean);
    return rows.map(r => ({ ...r, facet: meta.get(r.id).facet, label: r.name, share: list.length ? Math.round((100 * r.count) / list.length) : 0 }));
  };
  const section = pick => {
    const rows = rowsFor(having(watched), pick);
    const able = rows.filter(r => r.lean != null);
    return {
      common: top([...rows].sort(byCount), 12),
      higher: top(able.filter(r => r.lean > 0.05).sort(byLean), 8),
      lower: top(able.filter(r => r.lean < -0.05).sort((a, b) => a.lean - b.lean || byCount(a, b)), 6),
    };
  };
  const isFeeling = d => FEEL_FACETS.includes(d.facet);
  const isTheme = d => d.facet === 'theme';

  // Watchlist: which feelings and themes turn up more often among films waiting than among films watched.
  const waiting = having(films.filter(s => s.user?.watchlist && !s.user?.watched));
  const seenRows = new Map(rowsFor(having(watched), () => true).map(r => [r.id, r]));
  const leans = rowsFor(waiting, () => true).filter(r => r.count >= 5)
    .map(r => ({ id: r.id, label: r.label, facet: r.facet, count: r.count, share: r.share, watchedShare: seenRows.get(r.id)?.share ?? 0, keys: r.keys.slice(0, 6) }))
    .filter(r => r.share - r.watchedShare >= 3)
    .sort((a, b) => (b.share - b.watchedShare) - (a.share - a.watchedShare) || b.count - a.count || a.label.localeCompare(b.label)).slice(0, 10);

  return {
    films: having(watched).length, rated: having(rated).length,
    feelings: section(isFeeling), themes: section(isTheme),
    watchlist: { films: waiting.length, leans, common: top(rowsFor(waiting, isFeeling).sort(byCount), 10) },
  };
}

/**
 * What one diary year felt like: the feelings and themes most common among that year's films, and the ones that turn up
 * more that year than in everything else the user has watched.
 * @returns {{ films, feelings, themes, more }} rows: { id, label, facet, count, share, keys }; `more` rows add `otherShare`
 */
export function yearFeel({ summaries = [], entries = [], year, profileOf } = {}) {
  const films = (Array.isArray(summaries) ? summaries : []).filter(Boolean);
  const inYear = new Set((Array.isArray(entries) ? entries : []).filter(e => e && String(e.date).startsWith(year + '-')).map(e => e.key));
  const chipMap = new Map();
  for (const s of films) {
    const p = profileOf && profileOf(s.key);
    const c = p ? (p.descriptors || []).filter(d => !d.fragile && d.score >= FEEL_MIN) : [];
    if (c.length) chipMap.set(s.key, c);
  }
  const yearFilms = films.filter(s => inYear.has(s.key) && chipMap.has(s.key));
  const others = films.filter(s => s.user?.watched && !inYear.has(s.key) && chipMap.has(s.key));
  const rowsFor = (list, pick) => {
    const meta = new Map();
    return groupFilms(list, s => chipMap.get(s.key).filter(pick).map(d => { meta.set(d.id, d); return { key: d.id, name: d.label, id: d.id }; }), null)
      .map(r => ({ id: r.id, label: r.name, facet: meta.get(r.id).facet, count: r.count, share: list.length ? Math.round((100 * r.count) / list.length) : 0, keys: r.keys.slice(0, 6) }));
  };
  const isFeeling = d => FEEL_FACETS.includes(d.facet);
  const byCountRows = (a, b) => b.count - a.count || a.label.localeCompare(b.label);
  const otherShare = new Map(rowsFor(others, () => true).map(r => [r.id, r.share]));
  const more = others.length >= 10 ? rowsFor(yearFilms, () => true).filter(r => r.count >= 3)
    .map(r => ({ ...r, otherShare: otherShare.get(r.id) ?? 0 })).filter(r => r.share - r.otherShare >= 6)
    .sort((a, b) => (b.share - b.otherShare) - (a.share - a.otherShare) || byCountRows(a, b)).slice(0, 8) : [];
  return {
    films: yearFilms.length,
    feelings: rowsFor(yearFilms, isFeeling).sort(byCountRows).slice(0, 10),
    themes: rowsFor(yearFilms, d => d.facet === 'theme').sort(byCountRows).slice(0, 10),
    more,
  };
}
