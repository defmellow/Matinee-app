// Pure helpers behind error reporting and Debug mode (no Preact, so node tests can import them).

/** Technical one-liner for an error or a rejected value. Never throws. */
export function describeError(e) {
  try {
    if (e == null) return 'unknown error';
    if (typeof e === 'string') return e;
    const name = e.name && e.name !== 'Error' ? e.name + ': ' : '';
    const msg = e.message != null ? String(e.message) : String(e);
    const code = e.code ? ` [${e.code}]` : '';
    const where = typeof e.stack === 'string' ? (e.stack.split('\n').slice(1, 3).map(s => s.trim()).filter(Boolean).join(' | ')) : '';
    return (name + msg + code + (where ? ' @ ' + where : '')).slice(0, 1200);
  } catch { return 'unreadable error'; }
}

// Plain names for the core calls people trigger, used for the "area" and "message" of a problem.
const AREAS = {
  getFilm: ['Film page', 'the film'], getFeel: ['Film page', 'how the film feels'], fetchFilmAll: ['Film page', 'the film from its sources'],
  retryFilmSources: ['Film page', 'the film from its sources'], getFilmDebug: ['Film page', 'the debug details'], getSummaries: ['Library', 'some films'],
  getLibrary: ['Library', 'your library'], getState: ['Matinee', 'the app state'], getPerson: ['Person page', 'this person'], getPersonFilms: ['Person page', 'this person\'s films'],
  getDiary: ['Diary', 'your diary'], getInsights: ['Insights', 'your insights'], getTonight: ['Tonight', 'tonight\'s picks'], getDiscover: ['Discover', 'discovery'],
  getUpcoming: ['Upcoming', 'upcoming releases'], getStorage: ['Settings', 'storage details'], setUserFilm: ['Film page', 'your change'], setPoster: ['Film page', 'the poster'],
  setSettings: ['Settings', 'your settings'], importExport: ['Settings', 'your export'], refresh: ['Settings', 'your Letterboxd update'], fetchNow: ['Fetching', 'film details'],
};
// Calls that run by themselves and retry later: a failure is a warning, not something the user did wrong or must act on.
const BACKGROUND = new Set(['getSummaries', 'fetchNow', 'getState', 'getLibrary', 'getFeel', 'getStorage', 'getFetchLog', 'getLastTestReport', 'getFilm']);
export const isBackgroundCall = m => BACKGROUND.has(String(m || ''));

/** Counts by flag from a list of problems (used when the core doesn't send them). */
export function countLevels(list) {
  const c = { unseen: 0, total: 0, error: 0, warning: 0, unseenError: 0, unseenWarning: 0 };
  for (const p of list || []) {
    const w = p.level === 'warning';
    c.total += p.count || 1; c[w ? 'warning' : 'error'] += p.count || 1;
    if (p.isNew) { c.unseen++; c[w ? 'unseenWarning' : 'unseenError']++; }
  }
  return c;
}
/** "2 errors · 5 warnings" (or "No problems"). */
export function levelText(c) {
  const e = (c && c.error) || 0, w = (c && c.warning) || 0;
  const parts = [];
  if (e) parts.push(`${e} ${e === 1 ? 'error' : 'errors'}`);
  if (w) parts.push(`${w} ${w === 1 ? 'warning' : 'warnings'}`);
  return parts.join(' · ') || 'No problems';
}
export const levelLabel = l => (l === 'warning' ? 'Warning' : 'Error');

/** { area, message } for a failed core call. Unknown calls fall back to "Matinee". */
export function describeCall(method) {
  const m = String(method || '');
  const hit = AREAS[m];
  const area = hit ? hit[0] : 'Matinee';
  const what = hit ? hit[1] : 'something';
  const reading = /^(get|fetch|find|search|list|load)/i.test(m);
  return { area, message: reading ? `Couldn't load ${what}.` : `Couldn't finish ${what}.` };
}

/** Drops repeats of the same problem inside a short window so a failing loop can't flood the log. Returns (key, now) => boolean (true = send). */
export function makeGate({ windowMs = 5000, max = 500 } = {}) {
  const seen = new Map();
  return (key, now = Date.now()) => {
    const t = seen.get(key);
    if (t != null && now - t < windowMs) return false;
    seen.set(key, now);
    if (seen.size > max) for (const [k, v] of seen) if (now - v >= windowMs) seen.delete(k);
    return true;
  };
}

/** Local clock time for a problem: "3:42 pm" today, "9 Nov, 3:42 pm" before. */
export function problemTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}, ${time}`;
}

/** "3 new / 12" style text for the debug badge. */
export function countText({ unseen = 0, total = 0 } = {}) { return `${unseen}/${total}`; }

/** Short age such as "42 s", "5 min", "3 h", "2 d" from a timestamp (ms number or ISO); '' for none. */
export function ageText(t, now = Date.now()) {
  const ms = typeof t === 'number' ? t : Date.parse(t || '');
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return `${s} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 129600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

/** Entries of a plain object or [k, v] list that have something to show. */
export function debugRows(rows) {
  const list = Array.isArray(rows) ? rows : Object.entries(rows || {});
  return list.filter(([, v]) => v != null && v !== '' && v !== false && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
}

/** Link for an id when the site is obvious. */
export function idLink(kind, value) {
  const v = encodeURIComponent(String(value));
  switch (kind) {
    case 'imdb': return `https://www.imdb.com/title/${v}/`;
    case 'tmdb': return `https://www.themoviedb.org/movie/${v}`;
    case 'wikidata': return `https://www.wikidata.org/wiki/${v}`;
    case 'boxd': case 'letterboxd': return /^https?:/.test(String(value)) ? String(value) : null;
    default: return null;
  }
}

/** Group the fieldSources map by provider: [{ provider, fields: [..] }], largest first. */
export function fieldsByProvider(fieldSources) {
  const by = new Map();
  for (const [field, p] of Object.entries(fieldSources || {})) { if (!by.has(p)) by.set(p, []); by.get(p).push(field); }
  return [...by].map(([provider, fields]) => ({ provider, fields: fields.sort() })).sort((a, b) => b.fields.length - a.fields.length);
}

/** Fold repeats (same flag, area and message, different films) so thousands of "nothing found" warnings stay readable. [{ key, rows }] in list order. */
export function groupProblems(list) {
  const by = new Map();
  for (const p of list || []) {
    const k = `${p.level}|${p.area}|${p.message}`;
    if (!by.has(k)) by.set(k, { key: k, rows: [] });
    by.get(k).rows.push(p);
  }
  // an error with a single row stays a plain row; each distinct problem keeps its own id as key when alone
  return [...by.values()].map(g => (g.rows.length === 1 ? { key: g.rows[0].id || g.key, rows: g.rows } : g));
}

/** One-line view of a screen's data for Debug mode: arrays as "N items", objects as "{N keys}", scalars as they are. */
export function dataSummary(data, max = 24) {
  if (data == null || typeof data !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(data).slice(0, max)) {
    out[k] = Array.isArray(v) ? `${v.length} items` : v && typeof v === 'object' ? `{${Object.keys(v).length} keys}` : v;
  }
  return out;
}
