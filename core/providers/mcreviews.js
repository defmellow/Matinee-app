// Metacritic reviews provider (no key). Reads a few critic quotes and user reviews from a film's Metacritic pages.
// It only runs for films whose Metacritic id is already known (set by the metacritic provider): it never guesses slugs.
import { HttpError } from '../net.js';
import { getFollowing, slugYear, yearFits } from './metacritic.js';
import { parseMetacritic } from '../parse/critics.js';
import { parseMcCritics, parseMcUsers } from '../parse/reviews.js';

const BASE = 'https://www.metacritic.com/';
const NAME = 'Metacritic reviews';
const BLOCKS_IN_A_ROW = 3;
const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const CHECK_TITLE = /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i;
// A page we can trust: it has review cards, or it is clearly a Metacritic page (so an empty list is a real empty list).
const looksReadable = text => !CHECK_TITLE.test(text) && (/data-testid="review-card"|c-reviews-container/.test(text) || /<title[^>]*>[^<]*Metacritic/i.test(text));
const cleanId = id => String(id || '').trim().replace(/^\/+|\/+$/g, '');

/**
 * One reviews page: ok (parsed list), missing (404, or a redirect to some other film), or blocked (403/429).
 * A redirect to the same film's year-suffixed slug ("movie/alien" → "movie/alien-1979") is followed; the slug it landed on comes back as `id`.
 */
async function getReviews(http, id, kind, parse, signal, film) {
  const url = `${BASE}${id}/${kind}/`;
  let got;
  const year = film?.year, withYear = year && !slugYear(id) ? `${BASE}${id}-${year}/${kind}/` : undefined;
  try { got = await getFollowing(http, url, signal, withYear); }
  catch (e) {
    if (e?.code === 'aborted') throw e;
    if (e?.status === 403 || e?.status === 429) return { kind: 'blocked', status: e.status };
    throw e;
  }
  if (!got) return { kind: 'missing' };
  const { res } = got;
  if (res.status === 404 || res.status === 410) return { kind: 'missing' };
  if (res.status === 403 || res.status === 429) return { kind: 'blocked', status: res.status };
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status, url);
  let landedId = id;
  let landed = '';
  try { landed = cleanId(new URL(got.url).pathname); } catch { /* keep id */ }
  if (landed && landed !== `${id}/${kind}`) {
    const m = /^(movie\/[^/]+)\/(?:critic|user)-reviews$/.exec(landed);
    if (!m || !yearFits(film || {}, slugYear(m[1]))) return { kind: 'missing' };
    landedId = m[1];
  }
  if (!looksReadable(String(res.text || ''))) return { kind: 'blocked', status: res.status, unreadable: true };
  // Same year check as the score page, when the page shows a year (reviews pages usually do not: then it is accepted as is).
  const shown = parseMetacritic(res.text)?.year;
  if (landedId === id && film?.year && shown != null && !yearFits(film, shown)) {
    if (slugYear(id)) return { kind: 'missing' };
    return getReviews(http, `${id}-${film.year}`, kind, parse, signal, film);
  }
  return { kind: 'ok', items: parse(res.text), id: landedId };
}

export default {
  id: 'mcreviews',
  label: NAME,
  gives: ['critic quotes', 'audience reviews'],
  needsKey: false,
  needsIds: ['metacritic'],
  requires: film => !!cleanId(film.ids?.metacritic),
  refreshDays: 180,
  retryMissDays: 45,

  async enrich(films, ctx) {
    let finished = 0, streak = 0;
    for (const film of films) {
      if (ctx.signal?.aborted) throw abortError();
      if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
      const id = cleanId(film.ids?.metacritic);
      let critics, users;
      try {
        critics = await getReviews(ctx.http, id, 'critic-reviews', parseMcCritics, ctx.signal, film);
        users = critics.kind === 'blocked' ? critics : await getReviews(ctx.http, critics.id || id, 'user-reviews', parseMcUsers, ctx.signal, film);
      } catch (e) {
        if (e?.code === 'aborted') throw e;
        ctx.fail(film, e);
        ctx.progress(++finished, films.length);
        continue;
      }
      const blocked = [critics, users].find(r => r.kind === 'blocked');
      if (blocked) {
        ctx.fail(film, new Error(blocked.unreadable ? `${NAME} returned a page we could not read.` : `${NAME} turned the request away (HTTP ${blocked.status}).`));
        if (++streak >= BLOCKS_IN_A_ROW) {
          ctx.log(`Metacritic keeps turning requests away (HTTP ${blocked.status}), so we have stopped asking for reviews for now. The rest will be checked next time you refresh.`);
          return;
        }
      } else {
        streak = 0;
        // Remember the slug the pages really live at, so later reads go straight there.
        const resolved = [users.id, critics.id].find(x => x && x !== id);
        if (resolved && film.ids) film.ids.metacritic = resolved;
        const data = { critics: critics.items || [], users: users.items || [] };
        if (data.critics.length || data.users.length) ctx.done(film, data);
        else ctx.done(film, null);
      }
      ctx.progress(++finished, films.length);
    }
  },
};
