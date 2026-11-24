// Dendy Newtown. PRIMARY path: the schedule from Dendy's own GraphQL endpoint (the one its pages call), by four fixed queries.
// FALLBACK path (used when GraphQL fails): four kinds of public page with a plain GET.
//   /sitemap.xml         every film page (the full roster)
//   /coming-soon/        film titles and slugs (a hidden link list)
//   /now-showing/        the list (JSON-LD for the films and a first batch of sessions)
//   /movie/<slug>/       one film's sessions for today and the next two days, directors, runtime, first date
// DECISION (29 Oct): robots.txt disallows /graphql, /ahoy and /checkout, but the user has ruled it does not constrain this: the app
// runs on a real computer as one user, reads public schedule data only, with polite pacing (host gap 1800 ms, one at a time) and a handful of
// requests a day. We still never touch /checkout, /ahoy, orders or users: the booking link is built only to open in the user's browser.
// Pacing comes from the host limits in core/net.js (see HOST_RECOMMENDED).
import { parseListing, parseFilmPage, parseComingSoon, parseSitemap, parseRoster, parseShowings, parseConfig } from '../parse/dendy.js';

export const DENDY_HOST = 'newtown.dendy.com.au';
export const DENDY_ORIGIN = `https://${DENDY_HOST}`;
/** Suggested line for HOST_LIMITS in core/net.js: one at a time, ~1.8 s apart. */
export const HOST_RECOMMENDED = { [DENDY_HOST]: { concurrency: 1, gap: 1800 } };

const DENY = [/^\/ahoy/i, /^\/graphql/i, /^\/checkout/i, /^\/[^/]+\/checkout/i];
const ALLOW = [/^\/now-showing\/?$/, /^\/coming-soon\/?$/, /^\/sitemap\.xml$/, /^\/movie\/[a-z0-9][a-z0-9-]*\/?$/i];

/** True only for the page kinds we read, and never for anything robots.txt disallows. */
export function isAllowedPath(path) {
  const p = String(path || '');
  if (!p.startsWith('/') || p.startsWith('//')) return false;
  const clean = p.split(/[?#]/)[0];
  return !DENY.some(r => r.test(clean)) && ALLOW.some(r => r.test(clean));
}

// ---- GraphQL: the only queries we send, all in one place ----
const GRAPHQL_PATH = '/graphql';
/** Headers the public site sends; without `site-id` the reply is an error. */
export const GRAPHQL_HEADERS = { 'content-type': 'application/json', 'site-id': '36', 'client-type': 'consumer', 'circuit-id': '15' };
const MOVIES_QUERY = `query($limit:Int,$orderBy:String,$descending:Boolean,$searchString:String,$siteIds:[ID],$type:String,$subtype:String){
  movies(limit:$limit,orderBy:$orderBy,descending:$descending,searchString:$searchString,siteIds:$siteIds,type:$type,subtype:$subtype){
    count resultVersion
    data{id name urlSlug showingStatus dateOfFirstShowing releaseDate duration rating directedBy showingCount includeInComingSoon isMarathon titleClassId}}}`;
const SHOWINGS_QUERY = `query($date:String,$movieId:ID,$movieIds:[ID],$siteIds:[ID],$resultVersion:String){
  showingsForDate(date:$date,movieId:$movieId,movieIds:$movieIds,siteIds:$siteIds,resultVersion:$resultVersion){
    count resultVersion
    data{id time screenId seatsRemaining published private isPreview showingBadgeIds past current ticketsSold displayMetaData
      movie{id name urlSlug duration rating dateOfFirstShowing directedBy showingStatus}}}}`;
const CONFIG_QUERY = `mutation($c:ClientConfigInput!){addOrUpdateClientConfig(input:{clientConfigInput:$c}){clientConfig{
  version showingBadges{id displayName type title description iconName} screens{id name number seatCount reservedSeating displayOrder}}}}`;
/** The `type` values that return a sensible list. Any other value (e.g. "now-showing") returns all 1840 films ever listed: never use. */
export const ROSTER_LISTS = ['coming-soon', 'now-playing'];
/** Keep each sessions reply under Dendy's 300-session limit: group films up to about this many sessions (by their showingCount). */
export const BATCH_SESSIONS = 250;
const MAX_SPLITS = 12; // a safety stop on halving truncated batches

function problem(message, code, status) {
  return Object.assign(new Error(message), { code, ...(status ? { status } : {}) });
}

export function createDendySource({ http, priority = 4 } = {}) {
  async function get(path, signal) {
    if (!isAllowedPath(path)) throw problem(`Not an allowed Dendy page: ${path}`, 'forbidden');
    const url = DENDY_ORIGIN + path;
    const read = typeof http.browserText === 'function' ? http.browserText : http.text;
    const res = await read.call(http, url, { signal, priority });
    if (!res || res.status < 200 || res.status >= 300) {
      throw problem(`Dendy Newtown answered ${res?.status ?? 'nothing'}.`, res?.status === 403 || res?.status === 429 ? 'blocked' : 'http', res?.status);
    }
    return String(res.text || '');
  }

  /** One GraphQL call. Only the four queries above go through here. Throws code 'blocked' | 'http' | 'changed' | 'aborted' | network errors. */
  async function post(query, variables, signal) {
    let res;
    try {
      res = await http.text(DENDY_ORIGIN + GRAPHQL_PATH, { method: 'POST', body: JSON.stringify({ query, variables }), headers: GRAPHQL_HEADERS, accept: 'application/json', browser: true, signal, priority });
    } catch (e) {
      if (e?.status === 403 || e?.status === 429) throw problem(`Dendy Newtown answered ${e.status}.`, 'blocked', e.status);
      if (e?.status) throw problem(`Dendy Newtown answered ${e.status}.`, 'http', e.status);
      throw e;
    }
    if (res.status === 403 || res.status === 429) throw problem(`Dendy Newtown answered ${res.status}.`, 'blocked', res.status);
    let json = null;
    try { json = JSON.parse(String(res.text || '')); } catch { /* handled below */ }
    if (res.status >= 400 && !json) throw problem(`Dendy Newtown answered ${res.status}.`, 'http', res.status);
    if (!json) throw problem('Dendy Newtown\'s schedule looked different from usual.', 'changed');
    return json;
  }
  const must = (parsed) => { if (!parsed.ok) throw problem(parsed.error, 'changed'); return parsed; };

  return {
    /**
     * Both film lists: coming soon (advance booking) and now playing. One request each.
     * @returns {Promise<{films:object[], requests:number}>} films carry inList 'coming-soon' | 'now-playing'; a film on both keeps both in `lists`
     */
    async fetchRoster(signal) {
      const byId = new Map();
      for (const list of ROSTER_LISTS) {
        const vars = { type: list, subtype: list === 'coming-soon' ? 'watched' : '', orderBy: 'date_of_first_showing', descending: false, limit: 500, searchString: '', siteIds: [] };
        const r = must(parseRoster(await post(MOVIES_QUERY, vars, signal), { list }));
        for (const f of r.films) {
          const o = byId.get(f.dendyId);
          byId.set(f.dendyId, o ? { ...o, ...f, lists: [...o.lists, list] } : { ...f, lists: [list] });
        }
      }
      return { films: [...byId.values()], requests: ROSTER_LISTS.length };
    },
    /** Screen and badge names (9 KB instead of the 2 MB the site downloads). @returns {Promise<{version, screens, badges}>} */
    async fetchConfig(signal) {
      const { ok, ...rest } = must(parseConfig(await post(CONFIG_QUERY, { c: { version: null, action: 'validate' } }, signal)));
      return rest;
    },
    /**
     * Every sitting in the cinema on one Sydney day, whatever the film (catches films in neither list).
     * @returns {Promise<{unchanged:true,resultVersion}|{unchanged:false,resultVersion,truncated,movies}>}
     */
    async fetchDay({ date, resultVersion, config, signal }) {
      const vars = { date, siteIds: [], ...(resultVersion ? { resultVersion } : {}) };
      const r = must(parseShowings(await post(SHOWINGS_QUERY, vars, signal), config || {}));
      return r;
    },
    /**
     * Sessions for several films, batched so each reply stays under 300 sessions (a full reply is split in half and asked again).
     * @param {{id:string, showingCount?:number}[]} films
     * @param {{versions?:Object<string,string>, config?:object, signal?:AbortSignal}} [o]  versions: resultVersion per request shape (key = sorted ids)
     * @returns {Promise<{movies:Object<string,object>, fetched:string[], unchanged:string[], versions:Object<string,string>, cut:string[], requests:number}>}
     *   fetched: film ids whose sessions are in `movies` (a film with none has an empty list); unchanged: ids Dendy said have not changed
     *   (keep the old sessions); cut: films whose reply still hit the limit and could not be split further (sessions beyond it are missing)
     */
    async fetchSessions(films, { versions = {}, config, signal } = {}) {
      const out = { movies: {}, fetched: [], unchanged: [], versions: {}, cut: [], requests: 0 };
      const sorted = [...films].sort((a, b) => (b.showingCount || 0) - (a.showingCount || 0));
      const batches = [];
      for (const f of sorted) {
        const open = batches.find(b => b.total + (f.showingCount || 1) <= BATCH_SESSIONS);
        if (open) { open.ids.push(f.id); open.total += f.showingCount || 1; } else batches.push({ ids: [f.id], total: f.showingCount || 1 });
      }
      let splits = 0;
      const queue = batches.map(b => b.ids);
      while (queue.length) {
        const ids = queue.shift();
        const key = [...ids].sort().join(',');
        const vars = { movieIds: ids, siteIds: [], ...(versions[key] ? { resultVersion: versions[key] } : {}) };
        out.requests++;
        const r = must(parseShowings(await post(SHOWINGS_QUERY, vars, signal), config || {}));
        if (r.unchanged) { out.unchanged.push(...ids); out.versions[key] = r.resultVersion; continue; }
        if (r.truncated) {
          if (ids.length > 1 && splits++ < MAX_SPLITS) { const h = Math.ceil(ids.length / 2); queue.unshift(ids.slice(0, h), ids.slice(h)); continue; }
          out.cut.push(...ids); // cannot split any further: what came back is the earliest 300
        } else if (r.resultVersion) out.versions[key] = r.resultVersion;
        for (const id of ids) { out.fetched.push(id); out.movies[id] = r.movies[id] || null; }
      }
      return out;
    },
    /** @returns {Promise<{films:object[], capped:boolean, eventCount:number}>}; throws code 'blocked' | 'http' | 'changed' */
    async fetchListing(signal) {
      const r = parseListing(await get('/now-showing/', signal));
      // A page with neither the cinema block nor any film is a challenge page or a redesign.
      if (!r.hasTheater && !r.films.length) throw problem('Dendy Newtown\'s page looked different from usual.', 'changed');
      return { films: r.films, capped: r.capped, eventCount: r.eventCount };
    },
    /** @returns {Promise<{films:{slug:string,title:string}[]}>}; throws 'changed' when neither the cinema block nor any film link is there */
    async fetchComingSoon(signal) {
      const r = parseComingSoon(await get('/coming-soon/', signal));
      if (!r.hasTheater && !r.films.length) throw problem('Dendy Newtown\'s coming-soon page looked different from usual.', 'changed');
      return { films: r.films };
    },
    /** @returns {Promise<{slugs:string[]}>}; throws 'changed' when the sitemap holds no film pages */
    async fetchSitemap(signal) {
      const slugs = parseSitemap(await get('/sitemap.xml', signal));
      if (!slugs.length) throw problem('Dendy Newtown\'s sitemap looked different from usual.', 'changed');
      return { slugs };
    },
    /** @returns {Promise<object>} the parsed film page (see parseFilmPage) */
    async fetchFilm(path, signal) {
      const f = parseFilmPage(await get(path, signal));
      if (!f) throw problem('Dendy Newtown\'s film page looked different from usual.', 'changed');
      return f;
    },
  };
}
