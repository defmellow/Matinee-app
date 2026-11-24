// A short, readable log of what the app is fetching and from where, for the "Details" dropdown.
// In memory only, bounded, and deliberately abstract: site names and film titles, never addresses or review text.

const HOSTS = {
  'query.wikidata.org': 'Wikidata', 'www.wikidata.org': 'Wikidata', 'en.wikipedia.org': 'Wikipedia',
  'upload.wikimedia.org': 'Wikipedia', 'www.rottentomatoes.com': 'Rotten Tomatoes', 'www.metacritic.com': 'Metacritic',
  'api.themoviedb.org': 'TMDB', 'www.omdbapi.com': 'OMDb', 'datasets.imdbws.com': 'IMDb', 'www.imdb.com': 'IMDb',
  'letterboxd.com': 'Letterboxd', 'boxd.it': 'Letterboxd', 'www.allmovie.com': 'AllMovie',
};
const PROVIDER_SITES = {
  boxd: 'Letterboxd', lbpage: 'Letterboxd', wikidata: 'Wikidata', wikipedia: 'Wikipedia', wikicats: 'Wikipedia',
  imdb: 'IMDb', imdbpage: 'IMDb', rt: 'Rotten Tomatoes', metacritic: 'Metacritic', mcreviews: 'Metacritic',
  allmovie: 'AllMovie', tmdb: 'TMDB', omdb: 'OMDb',
};
export const KINDS = ['fetch', 'ok', 'miss', 'error', 'wait'];

export const siteForHost = host => HOSTS[host] || String(host || '').replace(/^www\./, '');
export const siteForProvider = (id, label) => PROVIDER_SITES[id] || label || id || '';

/** Plain text only: web addresses removed, whitespace tidied, length capped. */
export function cleanText(s, max = 140) {
  const t = String(s ?? '').replace(/\bhttps?:\/\/\S*/gi, '').replace(/\bwww\.\S*/gi, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

const WORDS = [
  [['poster'], 'poster'], [['synopsis', 'extract', 'description'], 'synopsis'], [['ratings'], 'ratings'],
  [['sections', 'plot', 'reception'], 'article details'], [['keywords', 'tags', 'themes'], 'themes'],
  [['reviews', 'critics', 'users', 'audience'], 'reviews'], [['people', 'cast', 'crew'], 'cast and crew'],
  [['genres', 'subjects'], 'genres'], [['moods'], 'moods'], [['slug'], 'link'],
];
/** "poster and synopsis" from the field names of a provider's result; never includes the values. */
export function describeData(data) {
  if (!data || typeof data !== 'object') return 'details';
  const keys = new Set(Object.keys(data));
  const found = [];
  for (const [names, word] of WORDS) if (names.some(n => keys.has(n)) && !found.includes(word)) found.push(word);
  if (!found.length) return 'details';
  const list = found.slice(0, 3);
  return list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/**
 * @param {{ max?: number, flushMs?: number, onChange?: (info:{last:number}) => void, now?: () => number }} o
 * onChange is called at most once per flushMs (trailing), so a busy fetch doesn't flood the UI.
 */
export function createFetchLog({ max = 300, flushMs = 250, onChange = null, now = Date.now } = {}) {
  let entries = [], seq = 0, timer = null;
  const notify = () => {
    if (!onChange || timer) return;
    timer = setTimeout(() => { timer = null; onChange({ last: seq }); }, flushMs);
    if (timer.unref) timer.unref();
  };
  return {
    /** entry: { site, provider, title, kind, text }. Returns the stored entry. */
    add({ site = '', provider = '', title = '', kind = 'fetch', text = '' } = {}) {
      const e = { n: ++seq, t: now(), site: cleanText(site, 40), provider: String(provider || ''), title: cleanText(title, 80),
        kind: KINDS.includes(kind) ? kind : 'fetch', text: cleanText(text) };
      entries.push(e);
      if (entries.length > max) entries = entries.slice(entries.length - max);
      notify();
      return e;
    },
    /** Entries newer than `since` (an entry number), oldest first. */
    list({ since = 0 } = {}) { return entries.filter(e => e.n > since); },
    clear() { entries = []; },
    get last() { return seq; },
  };
}
