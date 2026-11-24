// OMDb provider (optional: switches on when the user pastes a free API key).
// A backup source for IMDb / Rotten Tomatoes / Metacritic scores, plus runtime and age rating. Looks films up by IMDb id.
// API: https://www.omdbapi.com/ — free keys allow 1,000 requests a day.
import { HttpError } from '../net.js';

const BASE = 'https://www.omdbapi.com/';
const CONCURRENCY = 2;
const PROBE_ID = 'tt0111161'; // any real IMDb id works for testing a key

const KEY_STOPPED = 'Your OMDb key stopped working: OMDb no longer accepts it. Open Settings, check the key (or paste a new one) and try again.';
const LIMIT_MESSAGE = "OMDb's free daily limit (1,000 lookups) has been reached. Paused until tomorrow; the remaining films will be checked next time, after it resets.";
const SELF_LIMIT_MESSAGE = 'Matinee has used its share of today\'s free OMDb lookups (it keeps some back). Paused until tomorrow; the remaining films will be checked then.';
const PAUSED_MESSAGE = 'OMDb asked us to slow down. Paused for now; the remaining films will be checked later.';

// Free keys get 1,000 requests a day (omdbapi.com/apikey.aspx). Matinee stops itself earlier so opened films still work later in the day.
export const DAILY_CAP = 900;
export const QUIET_CAP = 500; // the silent background re-read never spends more than this much of a day

const COUNTRY_NAMES = { 'United States': 'USA', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE' };

const keyOf = settings => String(settings?.keys?.omdb || '').trim();

const clean = s => String(s).replace(/apikey=[^&\s"']+/gi, 'apikey=hidden');

/** Ask OMDb about one IMDb id. Returns { status, body } and never throws for HTTP errors (OMDb explains itself in the body). */
async function lookup(http, key, imdbId, signal) {
  // DECISION: no `tomatoes=true`: OMDb's current docs no longer list it, and Rotten Tomatoes arrives in the Ratings array anyway.
  const url = `${BASE}?${new URLSearchParams({ i: imdbId, apikey: key, r: 'json' })}`;
  let res;
  try { res = await http.text(url, { signal, accept: 'application/json' }); }
  catch (e) {
    if (e && typeof e === 'object') { if (e.message) e.message = clean(e.message); if (e.url) e.url = clean(e.url); }
    throw e;
  }
  let body = null;
  try { body = JSON.parse(res.text); } catch { /* not JSON */ }
  if (!body || typeof body !== 'object') throw new HttpError(res.status || 0, clean(url), 'OMDb sent back something unexpected.');
  return { status: res.status, body };
}

/** What kind of "Response: False" is this? */
function failureKind(body, film) {
  const e = String(body?.Error || '');
  if (/api key/i.test(e)) return 'key';
  if (/limit/i.test(e)) return 'limit';
  if (/not found|incorrect imdb id/i.test(e)) return 'missing';
  // "Error getting data." for an announced or untitled film (no OMDb entry yet) is a miss; for an ordinary film it may be a hiccup.
  if (/error getting data/i.test(e) && film && (/^untitled\b/i.test(film.title || '') || !film.year || film.year > new Date().getFullYear())) return 'missing';
  return 'other';
}

/** Test a pasted key. Never throws. @returns {Promise<{ ok: boolean, message: string }>} */
export async function validateKey(key, http) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, message: 'Paste your OMDb key first.' };
  try {
    const { body } = await lookup(http, k, PROBE_ID);
    if (body.Response !== 'False') return { ok: true, message: 'That key works.' };
    const kind = failureKind(body);
    if (kind === 'key') return { ok: false, message: "OMDb didn't accept that key — check you copied all of it, and that you clicked the activation link in the email OMDb sent you." };
    if (kind === 'limit') return { ok: true, message: "That key works, but today's free limit has been used up. It resets overnight." };
    return { ok: false, message: 'OMDb had a problem answering — try again in a few minutes.' };
  } catch (e) {
    if (e?.status) return { ok: false, message: 'OMDb had a problem answering — try again in a few minutes.' };
    return { ok: false, message: "Couldn't reach OMDb — check your internet connection." };
  }
}

// ---------- mapping ----------

const isNA = v => v == null || String(v).trim() === '' || /^n\/a$/i.test(String(v).trim());
const toNumber = v => { if (isNA(v)) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const inRange = (n, lo, hi) => (n != null && n >= lo && n <= hi ? n : null);
const ratingValue = (body, source) => (Array.isArray(body.Ratings) ? body.Ratings.find(r => r?.Source === source)?.Value : null);
const NOT_A_RATING = /^(n\/a|not rated|unrated)$/i;

/** OMDb's JSON → Matinee's normalised data (only fields OMDb actually had; "N/A" means missing). */
export function mapOmdb(body) {
  const data = {};
  const ratings = {};

  const imdbRaw = ratingValue(body, 'Internet Movie Database');
  const imdb = inRange(isNA(imdbRaw) ? null : parseFloat(imdbRaw), 0, 10) ?? inRange(toNumber(body.imdbRating), 0, 10);
  if (imdb != null) {
    ratings.imdb = { value: imdb };
    const votes = toNumber(body.imdbVotes);
    if (votes != null) ratings.imdb.votes = votes;
  }

  const rtRaw = ratingValue(body, 'Rotten Tomatoes');
  const rt = inRange(isNA(rtRaw) ? null : Number(/(\d+)\s*%/.exec(rtRaw)?.[1]), 0, 100);
  if (rt != null) ratings.rt = { critics: rt };

  const mcRaw = ratingValue(body, 'Metacritic');
  const mc = inRange(isNA(mcRaw) ? null : Number(/(\d+)\s*\/\s*100/.exec(mcRaw)?.[1]), 0, 100) ?? inRange(toNumber(body.Metascore), 0, 100);
  if (mc != null) ratings.metacritic = { critics: mc };

  if (Object.keys(ratings).length) data.ratings = ratings;

  const runtime = isNA(body.Runtime) ? null : Number(/(\d+)\s*min/i.exec(body.Runtime)?.[1]);
  if (runtime) data.runtime = runtime;

  // DECISION: "Not Rated" / "Unrated" say nothing about the film, so they are treated like "N/A".
  const rated = String(body.Rated ?? '').trim();
  if (rated && !NOT_A_RATING.test(rated)) data.certification = rated;

  if (!isNA(body.Poster)) data.poster = { url: body.Poster };

  // Extras only OMDb has in one place. `awardsText` is OMDb's sentence ("Won 2 Oscars. 40 wins & 90 nominations total").
  if (!isNA(body.Awards)) data.awardsText = String(body.Awards).trim();
  const box = isNA(body.BoxOffice) ? null : toNumber(String(body.BoxOffice).replace(/[^0-9.,]/g, ''));
  if (box) data.boxOffice = box;
  if (!isNA(body.Country)) {
    const countries = String(body.Country).split(',').map(c => c.trim()).filter(Boolean).map(c => COUNTRY_NAMES[c] || c);
    if (countries.length) data.countries = countries;
  }
  return data;
}

// ---------- daily allowance ----------

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10); // UTC day; OMDb does not say when its day rolls over
const memory = { day: '', n: 0 };

/**
 * How many lookups Matinee has made today. Kept in the library settings (settings.omdbUsage), so it survives a restart once the library is saved (memory only when there are no settings). ctx.quota ({ get(), add(n) }) wins if given.
 */
function usage(ctx, now) {
  const day = today(now);
  if (ctx.quota) {
    return { used: () => Number(ctx.quota.get()) || 0, add: n => ctx.quota.add(n) };
  }
  const s = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : null;
  const read = () => (s ? (s.omdbUsage?.day === day ? Number(s.omdbUsage.n) || 0 : 0) : (memory.day === day ? memory.n : 0));
  return {
    used: read,
    add(n) {
      const total = read() + n;
      if (s) s.omdbUsage = { day, n: total }; else { memory.day = day; memory.n = total; }
    },
  };
}

// ---------- provider ----------

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

export default {
  validateKey,
  id: 'omdb',
  label: 'OMDb',
  gives: ['ratings', 'runtime', 'certification', 'awards', 'box office'],
  needsKey: true,
  adds: 'Backs up the IMDb, Rotten Tomatoes and Metacritic scores, plus runtime and age rating, for films the other sources missed.',
  keyHelp: {
    url: 'https://www.omdbapi.com/apikey.aspx',
    steps: [
      'Open the link above and choose the free plan (1,000 lookups a day is plenty).',
      'Type in your email address and your name, say it is for personal use, and submit the form.',
      'OMDb emails you a key. Click the activation link in that email, because the key will not work until you do.',
      'Copy the key from the email and paste it here.',
    ],
  },
  refreshDays: 30,
  requires: film => Boolean(film.ids?.imdb),
  needsIds: ['imdb'], // enrich.js releases a film to this source once it has this id (or its id chain is over)
  enabled: settings => keyOf(settings) !== '',

  async enrich(films, ctx) {
    const key = keyOf(ctx.settings);
    if (!key) return;
    let next = 0, finished = 0, fatal = null, limited = false, selfLimited = false, slowDown = false;
    const allowance = usage(ctx, Date.now());
    const cap = ctx.silent ? QUIET_CAP : DAILY_CAP;

    const worker = async () => {
      while (!fatal && !limited && !selfLimited && !slowDown && next < films.length) {
        if (ctx.signal?.aborted) { fatal = fatal || abortError(); return; }
        if (allowance.used() >= cap) { selfLimited = true; return; }
        const film = films[next++];
        if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
        try {
          allowance.add(1);
          const { status, body } = await lookup(ctx.http, key, film.ids.imdb, ctx.signal);
          if (body.Response === 'False') {
            const kind = failureKind(body, film);
            if (kind === 'key') { fatal = fatal || new Error(KEY_STOPPED); return; }
            if (kind === 'limit') { limited = true; allowance.add(Math.max(0, 1000 - allowance.used())); return; } // record nothing: this film is retried next time
            if (kind === 'missing') { ctx.done(film, null); }
            else { ctx.fail(film, new Error(`OMDb said: ${body.Error || `error ${status}`}`)); }
          } else if (status === 401) {
            fatal = fatal || new Error(KEY_STOPPED); return;
          } else {
            const data = mapOmdb(body);
            ctx.done(film, Object.keys(data).length ? data : null);
          }
        } catch (e) {
          if (e?.code === 'aborted') { fatal = fatal || e; return; }
          if (e?.status === 429 || e?.code === 'host-paused') { slowDown = true; ctx.fail(film, e); return; } // net.js has already paused the site
          ctx.fail(film, e);
        }
        ctx.progress(++finished, films.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, films.length) }, worker));
    if (fatal) throw fatal;
    // DECISION: hitting the daily limit is not an error (no problem is raised); it is logged, and the films not reached stay unchecked.
    if (limited) ctx.log(LIMIT_MESSAGE);
    else if (selfLimited) ctx.log(SELF_LIMIT_MESSAGE);
    else if (slowDown) ctx.log(PAUSED_MESSAGE);
  },
};
