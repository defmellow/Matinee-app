// TMDB provider (optional: switches on when the user pastes a free API key).
// Adds posters, backdrops, synopsis, cast & crew, genres, keywords, collections, certification,
// recommendations and the TMDB rating.
// API: https://developer.themoviedb.org/reference/intro/getting-started — built from the documented shapes.
import { normTitle } from '../model.js';
import { clip, isMostlyEnglish } from '../parse/reviews.js';
import { defaultWants } from '../enrich.js';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const APPEND = 'credits,keywords,release_dates,recommendations,reviews,external_ids';
const CONCURRENCY = 4;

const PAUSED = 'TMDB asked us to slow down. Paused for now; the remaining films will be checked later.';
const KEY_STOPPED = 'Your TMDB key stopped working: TMDB no longer accepts it. Open Settings, check the key (or paste a new one) and try again.';

export const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

const COUNTRY_NAMES = { 'United States of America': 'USA', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE' };
const WRITER_JOBS = ['Screenplay', 'Writer', 'Story', 'Novel'];
const COMPOSER_JOBS = ['Original Music Composer', 'Music', 'Composer'];
const RELEASE_TYPE_ORDER = [3, 2, 1, 4, 5, 6]; // theatrical first, then premiere, digital, physical, TV
const MAX = { cast: 15, producer: 6, similar: 12, reviews: 8, reviewChars: 400, recommendations: 20 };

// ---------- auth ----------

/**
 * Work out how to send a key. A v3 "API Key" (32 hex characters) goes in the query string;
 * a v4 "API Read Access Token" (a long JWT starting 'eyJ') goes in an Authorization header.
 * @returns {{ params: object, headers: object }}
 */
export function authFor(key) {
  const k = String(key || '').trim();
  if (k.startsWith('eyJ')) return { params: {}, headers: { authorization: `Bearer ${k}` } };
  return { params: { api_key: k }, headers: {} };
}

const keyOf = settings => String(settings?.keys?.tmdb || '').trim();

/** Keep keys out of anything that might be shown to the user or logged. */
function scrub(e) {
  const clean = s => String(s).replace(/api_key=[^&\s"']+/gi, 'api_key=hidden');
  if (e && typeof e === 'object') {
    if (e.message) e.message = clean(e.message);
    if (e.url) e.url = clean(e.url);
  }
  return e;
}

/** @returns {(path: string, params?: object) => Promise<any>} */
function makeApi(key, http, signal, memo = null, remember = false) {
  const auth = authFor(key);
  return async (path, params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...auth.params, ...params })) if (v != null && v !== '') qs.set(k, String(v));
    // Searches made by the early guess are remembered for this run, so the id chain does not repeat an identical one.
    const memoKey = memo && path === '/search/movie' ? `search|${qs}` : null;
    if (memoKey && memo.has(memoKey)) return memo.get(memoKey);
    try { const res = await http.json(`${BASE}${path}?${qs}`, { headers: auth.headers, signal }); if (memoKey && remember) memo.set(memoKey, res); return res; }
    catch (e) { throw scrub(e); }
  };
}

/** Test a pasted key. Never throws. @returns {Promise<{ ok: boolean, message: string }>} */
export async function validateKey(key, http) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, message: 'Paste your TMDB key first.' };
  try {
    await makeApi(k, http)('/configuration');
    return { ok: true, message: 'That key works.' };
  } catch (e) {
    if (e?.status === 401) return { ok: false, message: "TMDB didn't accept that key — check you copied all of it." };
    if (e?.status) return { ok: false, message: 'TMDB had a problem answering — try again in a few minutes.' };
    return { ok: false, message: "Couldn't reach TMDB — check your internet connection." };
  }
}

// ---------- matching ----------

const yearOf = date => { const y = parseInt(String(date || '').slice(0, 4), 10); return Number.isFinite(y) ? y : null; };
const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0);

async function fetchDetails(api, id) {
  try { return await api(`/movie/${encodeURIComponent(id)}`, { append_to_response: APPEND, language: 'en-US' }); }
  catch (e) { if (e?.status === 404) return null; throw e; }
}

/** Candidates whose year is within ±1 of the film's (or any year, when the film has none). */
const withinYear = (results, film) => results.filter(r => film.year == null || (yearOf(r.release_date) != null && Math.abs(yearOf(r.release_date) - film.year) <= 1));

function bestExact(pool, film) {
  const want = normTitle(film.title);
  if (!want) return null;
  const exact = withinYear(pool, film).filter(r => normTitle(r.title) === want || normTitle(r.original_title) === want);
  const dist = r => (film.year == null ? 0 : Math.abs(yearOf(r.release_date) - film.year));
  return exact.sort((a, b) => dist(a) - dist(b) || byPopularity(a, b))[0] || null;
}

/**
 * Search by title and year; returns a TMDB id, or null when nothing is a confident match.
 * `strict` (the early guess made before any ids are known) accepts only an exact title with the year within one, never the most popular near miss.
 */
async function searchId(api, film, { strict = false } = {}) {
  if (!normTitle(film.title)) return null;
  const y = film.year;
  if (strict && y == null) return null;
  const attempts = y ? [{ year: y }, { primary_release_year: y }, { year: y - 1 }, { year: y + 1 }] : [{}];
  const pool = new Map();
  for (const extra of attempts) {
    const res = await api('/search/movie', { query: film.title, include_adult: 'false', language: 'en-US', ...extra });
    for (const r of res?.results || []) if (r && r.id != null) pool.set(r.id, r);
    const hit = bestExact([...pool.values()], film);
    if (hit) return hit.id;
    if (strict) break; // one search is enough for a guess; the id chain does the thorough one
  }
  if (strict || y == null) return null; // with no year to check, only an exact title is safe
  const near = withinYear([...pool.values()], film).sort(byPopularity);
  return near.length ? near[0].id : null;
}

/** film.ids.tmdb → film.ids.imdb (/find) → title + year search. Returns the full details or null. */
async function matchFilm(film, api, { skipFind = false } = {}) {
  const direct = film.ids?.tmdb;
  if (direct) {
    const d = await fetchDetails(api, direct);
    if (d) return d;
  }
  let id = null;
  const imdb = film.ids?.imdb;
  if (imdb && /^tt\d+$/.test(imdb) && !skipFind) {
    const found = await api(`/find/${imdb}`, { external_source: 'imdb_id', language: 'en-US' });
    id = found?.movie_results?.[0]?.id ?? null;
  }
  if (id == null) id = await searchId(api, film);
  if (id == null || String(id) === String(direct)) return null;
  return fetchDetails(api, id);
}

const hasImdb = film => /^tt\d+$/.test(String(film.ids?.imdb || ''));
/** True when TMDB data was stored from a title search made before ids were known (data.guessId), and an authoritative id has arrived since. */
// Stored people carry profile photos from this version on. A film whose stored TMDB data predates it is read once more whenever it is
// wanted (opened, visible, background), whatever date it was last looked at: the `since` date alone missed films read after it by an older build.
export const PEOPLE_V = 2;
export const needsPhotos = film => { const t = film.src?.tmdb; return !!t && t.guessId == null && t.peopleV !== PEOPLE_V && !!(t.people?.cast?.length || t.people?.director?.length); };
export const needsReconcile = film => film.src?.tmdb?.guessId != null && (film.ids?.tmdb != null || hasImdb(film));

/**
 * An early guess (see enrich with ctx.early): ids already known go the normal way; otherwise a strict title + year search.
 * The guess is stored with `guessId` and none of its ids, so Wikidata's tmdb/imdb ids still land when they arrive.
 * Returns the details, or null when there is no confident hit (nothing is recorded, the id chain looks again later).
 */
async function guessFilm(film, api) {
  if (film.ids?.tmdb || hasImdb(film)) return { details: await matchFilm(film, api), guess: false };
  const id = await searchId(api, film, { strict: true });
  return { details: id == null ? null : await fetchDetails(api, id), guess: true };
}

/**
 * A guess is being replaced by `details` (the real film, or null when nothing matched). A different film, or no film, takes the guess's data
 * with it, so it cannot be kept by a thinner answer (keepRicher) and never stays as unflagged data; the same film just loses the flags.
 */
function settleGuess(film, details) {
  const stored = film.src?.tmdb;
  if (!stored || stored.guessId == null) return;
  if (details && String(details.id) === String(stored.guessId)) { delete stored.guessId; delete stored.guessImdb; return; }
  delete film.src.tmdb; if (film.checked) delete film.checked.tmdb;
}

/** The authoritative id for a film that was guessed: Wikidata's tmdb id, else TMDB's own lookup from the IMDb id. */
async function authoritativeId(film, api) {
  if (film.ids?.tmdb != null) return film.ids.tmdb;
  if (!hasImdb(film)) return null;
  const found = await api(`/find/${film.ids.imdb}`, { external_source: 'imdb_id', language: 'en-US' });
  return found?.movie_results?.[0]?.id ?? null;
}

// ---------- mapping ----------

const img = (size, path) => (path ? `${IMG}${size}${path}` : null);
const names = list => (Array.isArray(list) ? list.map(x => x?.name).filter(Boolean) : []);

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

function mapPeople(credits) {
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const person = (c, role) => compact({ name: c.name, id: `tmdb:${c.id}`, role, photo: c.profile_path || undefined }); // photo: TMDB image path only, the UI builds the URL
  /** People with any of these jobs, one entry each (a person can hold several jobs: roles are joined). */
  const byJobs = (jobs, withRole = false) => {
    const seen = new Map();
    for (const c of crew) {
      if (!c || c.id == null || !c.name || !jobs.includes(c.job)) continue;
      const prev = seen.get(c.id);
      if (!prev) seen.set(c.id, { c, roles: [c.job] });
      else if (!prev.roles.includes(c.job)) prev.roles.push(c.job);
    }
    return [...seen.values()].map(({ c, roles }) => person(c, withRole ? roles.join(', ') : undefined));
  };
  const cast = (Array.isArray(credits?.cast) ? credits.cast : [])
    .filter(c => c && c.id != null && c.name)
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))
    .slice(0, MAX.cast)
    .map(c => person(c, c.character || undefined));
  return {
    director: byJobs(['Director']),
    writer: byJobs(WRITER_JOBS, true),
    cinematography: byJobs(['Director of Photography']),
    composer: byJobs(COMPOSER_JOBS),
    editor: byJobs(['Editor']),
    producer: byJobs(['Producer']).slice(0, MAX.producer),
    cast,
  };
}

/** Viewer reviews: short English excerpts with the reviewer's 0–10 rating when given. Authors are never kept. */
function mapReviews(block) {
  const out = [], seen = new Set();
  for (const r of Array.isArray(block?.results) ? block.results : []) {
    const text = clip(String(r?.content ?? '')
      .replace(/<[^>]*>/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ').replace(/[*_#>`]+/g, ''), MAX.reviewChars);
    if (!text || !isMostlyEnglish(text) || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const rating = Number(r?.author_details?.rating);
    out.push(r?.author_details?.rating != null && Number.isFinite(rating) && rating >= 0 && rating <= 10 ? { text, rating } : { text });
    if (out.length >= MAX.reviews) break;
  }
  return out;
}

/** Age certification: the user's country first (Settings → Letterboxd → Country), then the US. Prefers the cinema release over home-video re-ratings. */
export function mapCertification(releaseDates, region = 'AU') {
  const results = Array.isArray(releaseDates?.results) ? releaseDates.results : [];
  const rank = t => { const i = RELEASE_TYPE_ORDER.indexOf(t); return i === -1 ? 99 : i; };
  for (const country of [...new Set([String(region || 'AU').toUpperCase(), 'US'])]) {
    const entry = results.find(r => r.iso_3166_1 === country);
    const rated = (entry?.release_dates || []).filter(x => x?.certification && x.certification.trim());
    if (!rated.length) continue;
    return [...rated].sort((a, b) => rank(a.type) - rank(b.type))[0].certification.trim();
  }
  return null;
}

/** The user's country's cinema date from TMDB: Theatrical beats Theatrical (limited); the earliest date within a type. null when TMDB has none. */
export function mapRegionRelease(releaseDates, region = 'AU') {
  const results = Array.isArray(releaseDates?.results) ? releaseDates.results : [];
  const country = String(region || 'AU').toUpperCase();
  const entry = results.find(r => r.iso_3166_1 === country);
  for (const [type, label] of [[3, 'Theatrical'], [2, 'Theatrical (limited)']]) {
    const dates = (entry?.release_dates || []).filter(x => x?.type === type && typeof x.release_date === 'string').map(x => x.release_date.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dates.length) return { date: dates[0], type: label, region: country };
  }
  return null;
}

function mapLanguages(d) {
  const spoken = (d.spoken_languages || []).filter(Boolean);
  const first = spoken.findIndex(l => l.iso_639_1 === d.original_language);
  const ordered = first > 0 ? [spoken[first], ...spoken.slice(0, first), ...spoken.slice(first + 1)] : spoken;
  return ordered.map(l => l.english_name || l.name).filter(Boolean);
}

/**
 * Turn TMDB's /movie/{id} response (with the appended sections) into Matinee's normalised data.
 * @returns {{ data: object, ids: object }}
 */
export function mapMovie(d, { region = 'AU' } = {}) {
  const ext = d.external_ids || {};
  const data = compact({
    title: d.title,
    originalTitle: d.original_title,
    // DECISION: the details response has no image sizes, so width/height assume TMDB's standard 2:3 poster at w500.
    poster: d.poster_path ? { url: img('w500', d.poster_path), thumb: img('w342', d.poster_path), width: 500, height: 750 } : null,
    backdrop: img('w1280', d.backdrop_path),
    synopsis: d.overview,
    tagline: d.tagline,
    runtime: d.runtime || null,
    released: d.release_date,
    genres: names(d.genres),
    keywords: names(d.keywords?.keywords || d.keywords?.results),
    countries: names(d.production_countries).map(n => COUNTRY_NAMES[n] || n),
    languages: mapLanguages(d),
    studios: names(d.production_companies),
    collection: d.belongs_to_collection?.name,
    collectionId: d.belongs_to_collection?.id ?? null,
    boxOffice: d.revenue || null,
    budget: d.budget || null,
    certification: mapCertification(d.release_dates, region),
    regionRelease: mapRegionRelease(d.release_dates, region),
    similar: (d.recommendations?.results || []).filter(r => r?.id != null && r.title).slice(0, MAX.similar)
      .map(r => ({ title: r.title, year: yearOf(r.release_date), ids: { tmdb: r.id } })),
    reviews: mapReviews(d.reviews),
    recommendations: [...new Set((d.recommendations?.results || []).map(r => r?.id).filter(id => Number.isInteger(id)))].slice(0, MAX.recommendations),
    people: mapPeople(d.credits), peopleV: PEOPLE_V, // always an object with every role (lists may be empty)
    ratings: d.vote_count > 0 ? { tmdb: { value: d.vote_average, votes: d.vote_count } } : null,
  });
  const ids = { tmdb: d.id, imdb: ext.imdb_id || d.imdb_id || null, wikidata: ext.wikidata_id || null };
  return { data, ids };
}

// ---------- provider ----------

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

export default {
  validateKey,
  id: 'tmdb',
  label: 'TMDB',
  gives: ['posters', 'backdrops', 'synopsis', 'people', 'genres', 'keywords', 'age ratings', 'similar', 'viewer reviews', 'ratings'],
  needsKey: true,
  adds: 'Adds the TMDB rating, posters, keywords, age ratings and viewer reviews to each film.',
  keyHelp: {
    url: 'https://www.themoviedb.org/settings/api',
    steps: [
      'Make a free account at themoviedb.org (click "Join TMDB") and confirm your email.',
      'Open the API page (the link above) and ask for a key. When it asks, choose "Developer" and say it is for personal use.',
      'Fill in the short form: "Matinee" as the app name and "My own film library" as the summary is fine.',
      'Copy the "API Key" (the short one, 32 letters and numbers) and paste it here.',
    ],
  },
  attribution: ATTRIBUTION,
  refreshDays: 21,
  since: '2026-11-10', // re-read once for cast photos (10 Nov); before: reviews and recommendations (22 Oct)
  enabled: settings => keyOf(settings) !== '',
  earlyStart: true, // enrich.js may run this at once, alongside the id chain (ctx.early), instead of waiting for it
  wants(film, opts = {}) { return defaultWants(this, film, opts) || needsReconcile(film) || needsPhotos(film); },
  unsettled: needsReconcile, // enrich.js settles such a film in the run that made the guess, though it was "checked" a moment ago

  async enrich(films, ctx) {
    const key = keyOf(ctx.settings);
    if (!key) return;
    const api = makeApi(key, ctx.http, ctx.signal, ctx.memo, !!ctx.early);
    const region = String(ctx.settings?.region || 'AU').toUpperCase();
    let next = 0, finished = 0, fatal = null, paused = false;

    const worker = async () => {
      while (!fatal && !paused && next < films.length) {
        if (ctx.signal?.aborted) { fatal = fatal || abortError(); return; }
        const film = films[next++];
        if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
        try {
          const stored = film.src?.tmdb;
          if (needsReconcile(film)) {
            // Settle a guess against the authoritative id. Nothing of the guess is touched until the answer is in hand, so a failed
            // request leaves it as it was (and still flagged) for the next run.
            const guess = stored.guessId, guessImdb = stored.guessImdb;
            const id = await authoritativeId(film, api);
            // An empty /find means the guessed film does not carry this IMDb id, unless the guess itself reported that very id.
            const same = id != null ? String(id) === String(guess) : !!guessImdb && guessImdb === film.ids?.imdb;
            if (same) {
              delete stored.guessId; delete stored.guessImdb;
              film.ids = film.ids || {}; if (film.ids.tmdb == null) film.ids.tmdb = guess;
              ctx.done(film, null);
            } else {
              const details = id != null ? await fetchDetails(api, id) : await matchFilm(film, api, { skipFind: true });
              settleGuess(film, details);
              if (details) { const { data, ids } = mapMovie(details, { region }); ctx.done(film, data, ids); } else ctx.done(film, null);
            }
          } else if (ctx.early) {
            const { details, guess } = await guessFilm(film, api);
            if (details) {
              const { data, ids } = mapMovie(details, { region });
              if (guess) ctx.done(film, { ...data, guessId: details.id, guessImdb: ids.imdb || undefined }, {}); else ctx.done(film, data, ids);
            } else if (!guess) ctx.done(film, null);
            // a failed guess records nothing, so the id chain still looks this film up once its ids are known
          } else {
            const details = await matchFilm(film, api);
            if (stored?.guessId != null) settleGuess(film, details); // a full lookup replaces the guess, once it has an answer
            if (details) { const { data, ids } = mapMovie(details, { region }); ctx.done(film, data, ids); }
            else ctx.done(film, null);
          }
        } catch (e) {
          if (e?.code === 'aborted') { fatal = fatal || e; return; }
          if (e?.status === 401) { fatal = fatal || new Error(KEY_STOPPED); return; }
          // 429 (after net.js has waited and retried) or a paused host: stop asking instead of failing every film in turn.
          if (e?.status === 429 || e?.code === 'host-paused') { paused = true; ctx.fail(film, e); return; }
          ctx.fail(film, e);
        }
        ctx.progress(++finished, films.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, films.length) }, worker));
    if (fatal) throw fatal;
    if (paused) ctx.log(PAUSED);
  },
};
