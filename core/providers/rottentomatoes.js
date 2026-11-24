// Rotten Tomatoes provider (no key). Reads the Tomatometer and Popcornmeter from the film's page, which embeds
// them as JSON. The page id (e.g. "m/paris_texas") normally comes from Wikidata; when it is missing we try the
// slugs RT usually uses and only accept a page whose year and title match the film.
import { HttpError } from '../net.js';
import { normTitle } from '../model.js';
import { isNonFilmPage, parseRottenTomatoes } from '../parse/critics.js';

const BASE = 'https://www.rottentomatoes.com/';
const NAME = 'Rotten Tomatoes';
const BLOCKS_IN_A_ROW = 3;
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

/** "Paris, Texas" → "paris_texas" (RT drops punctuation and accents, joins words with underscores). */
export const rtSlug = title => normTitle(title).replace(/ /g, '_');

/** The slugs to try, in order, for a film with no known id. */
export function rtGuesses(film) {
  const base = rtSlug(film.title);
  if (!base || !film.year) return [];
  return [`m/${base}`, `m/${base}_${film.year}`];
}

const cleanId = id => String(id || '').trim().replace(/^\/+|\/+$/g, '');

/** A page is the right film when its year is within a year of ours and its title reads the same. */
export function matchesFilm(film, parsed) {
  if (!parsed || parsed.year == null || !film.year) return false;
  return Math.abs(parsed.year - film.year) <= 1 && normTitle(parsed.title) === normTitle(film.title);
}

/** What goes into src.rt: only the scores (and Critics Consensus) the page really had. null when it had none. */
export function toData(parsed) {
  if (!parsed) return null;
  const rt = {};
  for (const k of ['critics', 'criticsCount', 'certified', 'audience', 'audienceCount']) if (parsed[k] != null) rt[k] = parsed[k];
  const hasScore = rt.critics != null || rt.audience != null;
  const consensus = typeof parsed.consensus === 'string' && parsed.consensus ? parsed.consensus : null;
  if (!hasScore && !consensus) return null;
  const out = {};
  if (hasScore) out.ratings = { rt };
  if (consensus) out.consensus = consensus;
  return out;
}

/** One page request, sorted into: ok (parsed), missing (404), blocked (403/429), unreadable (not a film page we understand). */
async function getPage(http, id, signal) {
  const url = BASE + id;
  let res;
  try { res = await http.text(url, { browser: true, signal }); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status };
    throw e;
  }
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 403 || res.status === 429) return { kind: 'blocked', status: res.status };
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
  const parsed = parseRottenTomatoes(res.text);
  // A loaded page about something else (a TV series) is a miss, not a failure; only unreadable pages are failures.
  if (!parsed) return isNonFilmPage(res.text) ? { kind: 'missing' } : { kind: 'unreadable' };
  // A guess can redirect (e.g. m/the_mandalorian_and_grogu → m/star_wars_the_mandalorian_and_grogu): keep where it landed.
  let landed = id;
  try { const p = cleanId(new URL(res.url || url).pathname); if (/^m\/[^/]+$/.test(p)) landed = p; } catch { /* keep id */ }
  return { kind: 'ok', parsed, id: landed };
}

/** Find a film's page: its known id, or the first guess that checks out. */
async function lookup(film, ctx) {
  // A stored id (often from Wikidata) can be out of date: when its page is gone, fall back to the guesses
  // (The Moon 2023: Wikidata's movie/the-moon-2023 is a 404, the real page is movie/the-moon).
  const known = cleanId(film.ids?.rt);
  if (known) {
    const page = await getPage(ctx.http, known, ctx.signal);
    if (page.kind !== 'missing') return page;
  }
  for (const guess of rtGuesses(film)) {
    if (guess === known) continue;
    const page = await getPage(ctx.http, guess, ctx.signal);
    if (page.kind === 'blocked' || page.kind === 'unreadable') return page;
    if (page.kind === 'ok' && matchesFilm(film, page.parsed)) return page;
  }
  return { kind: 'missing' };
}

export default {
  id: 'rt',
  label: NAME,
  gives: ['Tomatometer', 'Popcornmeter'],
  needsKey: false,
  refreshDays: 14,
  since: '2026-10-22', // critics consensus added
  retryMissDays: 30,
  retryMissSince: '2026-11-10', // RT moved scores to `scorePercent` ("35%"); films that came back empty before the fix are read again once
  // Not out yet: neither counted nor pending; re-evaluated each run, so it enters on 1 January.
  requires: film => !(film.year && film.year > new Date().getFullYear()),
  needsIds: ['rt'], // the Rotten Tomatoes id (Wikidata has it); without it the film waits for its id chain, then the page is searched for

  async enrich(films, ctx) {
    const thisYear = new Date().getFullYear();
    let finished = 0, streak = 0;
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      // Not out yet (requires() normally filters these): record nothing, so it is looked at again later.
      if (film.year && film.year > thisYear) { ctx.progress(++finished, films.length); continue; }
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      let page;
      try { page = await lookup(film, ctx); }
      catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      if (page.kind === 'blocked' || page.kind === 'unreadable') {
        const why = page.kind === 'blocked'
          ? new Error(`${NAME} turned the request away (HTTP ${page.status}).`)
          : new Error(`${NAME} sent back a page that could not be read.`);
        ctx.fail(film, why);
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log(page.kind === 'blocked'
            ? `${NAME} keeps turning requests away (HTTP ${page.status}), so we have stopped asking for now. The rest will be checked next time you refresh.`
            : `${NAME} sent back pages we could not read ${BLOCKS_IN_A_ROW} times in a row, so we have stopped asking for now. The rest will be checked next time you refresh.`);
          return;
        }
      } else {
        streak = 0;
        if (page.kind === 'ok') {
          // Record the id when we had to guess it, even if the page has no scores yet.
          // A stored id that was dead or moved is replaced in place (the store only fills empty ids), so later reads go straight there.
          if (film.ids?.rt && cleanId(film.ids.rt) !== page.id) film.ids.rt = page.id;
          const ids = cleanId(film.ids?.rt) === page.id ? undefined : { rt: page.id }; // a guessed or corrected id is kept
          const data = toData(page.parsed);
          // A released film whose page loads but shows no scores at all may mean the site changed its pages (counted by the trouble notice).
          if (!data && film.year && film.year <= thisYear - 1) ctx.done(film, null, ids, { hollow: 'no scores on the page' });
          else ctx.done(film, data, ids);
        } else ctx.done(film, null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
