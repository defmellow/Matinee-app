// A person's films from TMDB's API (fast, with posters): one call to /person/{id}/movie_credits, or a name search first.
//   fetchTmdbPerson({ http, key, tmdbId, name, departments, signal }) -> { tmdbId, name, knownFor (a role key or null), photo (TMDB image path or null), films }
//   films: [{ tmdbId, title, originalTitle, year, date, poster, roles: ['director', 'cast:Travis', ...], votes }]  (one entry per film)
// Role names are Matinee's (ROLE_ORDER in ui/screens/person/model.js). Built from TMDB's documented shapes; the network path is
// fixture-tested only (no TMDB key in the cloud).
import { authFor } from '../providers/tmdb.js';
import { normTitle } from '../model.js';

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';

const ROLE_ORDER = ['director', 'writer', 'cinematography', 'composer', 'editor', 'producer', 'cast'];
const JOB_ROLE = {
  Director: 'director',
  Writer: 'writer', Screenplay: 'writer', Story: 'writer', Novel: 'writer', Teleplay: 'writer', 'Original Story': 'writer',
  'Director of Photography': 'cinematography',
  'Original Music Composer': 'composer', Music: 'composer', Composer: 'composer',
  Editor: 'editor',
  Producer: 'producer',
};
/** TMDB known_for_department for each role a person may have been opened from. */
export const DEPARTMENT = { director: 'Directing', writer: 'Writing', cast: 'Acting', cinematography: 'Camera', composer: 'Sound', editor: 'Editing', producer: 'Production' };

/** The role a TMDB known_for_department stands for, or null. */
export const roleOfDepartment = d => Object.keys(DEPARTMENT).find(k => DEPARTMENT[k] === d) || null;

const yearOf = date => { const y = parseInt(String(date || '').slice(0, 4), 10); return Number.isFinite(y) ? y : null; };
const scrub = e => {
  const clean = s => String(s).replace(/api_key=[^&\s"']+/gi, 'api_key=hidden');
  if (e && typeof e === 'object') { if (e.message) e.message = clean(e.message); if (e.url) e.url = clean(e.url); }
  return e;
};

/**
 * Turn a /person/{id}/movie_credits response into one entry per film, all of the person's jobs on it collapsed into `roles`.
 * Unreleased films are kept when they have a date; entries with no date and no votes (placeholders) are dropped.
 */
export function mapCredits(credits) {
  const films = new Map();
  const add = (c, role) => {
    if (!c || c.id == null || !c.title || c.adult || c.video) return;
    const date = c.release_date || null;
    if (!date && !(c.vote_count > 0)) return;
    const f = films.get(c.id) || { tmdbId: c.id, title: c.title, originalTitle: c.original_title || null, year: yearOf(date), date, poster: c.poster_path ? IMG + c.poster_path : null, roles: [], votes: c.vote_count || 0 };
    if (!f.roles.includes(role)) f.roles.push(role);
    films.set(c.id, f);
  };
  for (const c of Array.isArray(credits?.crew) ? credits.crew : []) { const r = JOB_ROLE[c?.job]; if (r) add(c, r); }
  for (const c of Array.isArray(credits?.cast) ? credits.cast : []) add(c, c?.character ? `cast:${String(c.character).trim().slice(0, 60)}` : 'cast');
  const rank = r => { const i = ROLE_ORDER.indexOf(r.split(':')[0]); return i < 0 ? 99 : i; };
  return [...films.values()].map(f => ({ ...f, roles: [...f.roles].sort((a, b) => rank(a) - rank(b)) }));
}

/** The best /search/person result: exact name first, then the wanted department, then popularity. Null when nothing fits. */
export function pickPerson(results, { name, departments = [] } = {}) {
  const list = (Array.isArray(results) ? results : []).filter(r => r && r.id != null);
  if (!list.length) return null;
  const want = normTitle(name);
  const exact = list.filter(r => normTitle(r.name) === want);
  const pool = exact.length ? exact : [];
  if (!pool.length) return null; // a near-miss on a name is more likely the wrong person than the right one
  const dept = r => { const i = departments.indexOf(r.known_for_department); return i < 0 ? 99 : i; };
  return [...pool].sort((a, b) => dept(a) - dept(b) || (b.popularity || 0) - (a.popularity || 0))[0];
}

export async function fetchTmdbPerson({ http, key, tmdbId = null, name = null, departments = [], signal } = {}) {
  const auth = authFor(key);
  const get = async (path, params) => {
    const qs = new URLSearchParams({ ...auth.params, ...params });
    try { return await http.json(`${BASE}${path}?${qs}`, { headers: auth.headers, signal, priority: 0 }); }
    catch (e) { throw scrub(e); }
  };
  let id = tmdbId, who = name, dept = null;
  if (!id) {
    if (!name) throw Object.assign(new Error('No name to search TMDB for.'), { code: 'not-found' });
    const found = pickPerson((await get('/search/person', { query: name, include_adult: 'false', language: 'en-US' }))?.results, { name, departments });
    if (!found) throw Object.assign(new Error('TMDB does not know this person.'), { code: 'not-found' });
    id = found.id; who = found.name || name; dept = found.known_for_department || null;
  }
  // One call gives both the credits and the department they are best known for.
  const body = await get(`/person/${encodeURIComponent(id)}`, { language: 'en-US', append_to_response: 'movie_credits' });
  const credits = body?.movie_credits || body;
  dept = body?.known_for_department || dept;
  return { tmdbId: Number(id), name: who, knownFor: roleOfDepartment(dept), photo: body?.profile_path || null, films: mapCredits(credits) };
}
