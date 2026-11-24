// The film data model. Shared contract for importers, providers, analysis and UI.
//
// Storage keeps what each source said, separately:
//   store.films[key] = {
//     key, lid, slug, title, year,          // identity (from the export / RSS)
//     ids: { imdb, tmdb, wikidata, rt, metacritic, enwiki, letterboxd },   // merged from every source
//     src: { <providerId>: { ...that provider's normalised fields } },
//     checked: { <providerId>: ISO time of the last attempt },
//     missed: { <providerId>: ISO time when the provider found nothing },
//   }
// `compose(film)` turns that into the single view everything else reads. Adding a source means writing a
// provider that fills `src.<id>` and adding its id to the priority lists below — nothing else changes.

/**
 * Automatic poster order (29 Oct): TMDB first when there is a key (fast, good quality), then the Letterboxd film page,
 * then Wikipedia, then OMDb's small one, then the poster the Letterboxd diary feed carried. Whichever exists wins.
 * The user can pick another source per film (library.films[key].posterPick); sources not listed here still show up as choices.
 */
export const POSTER_ORDER = ['tmdb', 'lbpage', 'wikipedia', 'omdb', 'rss'];
export const POSTER_LABELS = { tmdb: 'TMDB', lbpage: 'Letterboxd', wikipedia: 'Wikipedia', omdb: 'OMDb', rss: 'Letterboxd diary', wikidata: 'Wikidata' };

/** Provider ids in order of trust, per field. First source with a value wins. */
export const PRIORITY = {
  title: ['tmdb', 'wikidata'],
  originalTitle: ['tmdb', 'wikidata'],
  poster: [...POSTER_ORDER], // see POSTER_ORDER
  backdrop: ['tmdb'],
  synopsis: ['tmdb', 'wikipedia', 'lbpage'],
  tagline: ['tmdb'],
  runtime: ['tmdb', 'wikidata', 'omdb', 'lbpage'],
  released: ['tmdb', 'wikidata', 'lbpage'],
  ausRelease: ['lbpage'],              // {date, type}: Australian cinema date from the Letterboxd film page
  regionRelease: ['tmdb'],             // {date, type, region}: the cinema date in the user's country (Settings → Country), from TMDB
  genres: ['tmdb', 'wikidata', 'lbpage'],
  keywords: ['tmdb', 'wikidata'],
  subjects: ['wikidata'],
  countries: ['tmdb', 'wikidata', 'omdb', 'lbpage'],
  languages: ['tmdb', 'wikidata', 'lbpage'],
  studios: ['tmdb', 'wikidata', 'lbpage'],
  collection: ['tmdb', 'wikidata'],
  collectionId: ['wikidata'],          // 'wd:Q…' — the series item, for series progress
  kind: ['wikidata'],                  // 'tv' for series/specials Letterboxd lists as films; absent for films
  basedOn: ['wikidata'],
  locations: ['wikidata'],
  awards: ['wikidata'],
  boxOffice: ['tmdb', 'wikidata', 'omdb'],
  awardsText: ['omdb'],                // OMDb's one-sentence summary ("Won 2 Oscars. 40 wins & 90 nominations total")
  budget: ['tmdb', 'wikidata'],
  certification: ['tmdb', 'omdb'],
  similar: ['tmdb'],
  // people: role -> [{ name, id, role? }]; id is namespaced, e.g. 'wd:Q123' or 'tmdb:456'
  people: ['tmdb', 'wikidata', 'lbpage'],
};

/**
 * Ratings, each from its own source, normalised:
 *   imdb:        { value: 0–10, votes }
 *   letterboxd:  { value: 0–5, votes }
 *   rt:          { critics: 0–100, criticsCount, audience: 0–100, audienceCount }
 *   metacritic:  { critics: 0–100, criticsCount, users: 0–10, usersCount }
 *   tmdb:        { value: 0–10, votes }
 * A provider puts its ratings in src.<id>.ratings; compose() collects them under film.ratings.
 */
export const RATING_SOURCES = ['letterboxd', 'imdb', 'rt', 'metacritic', 'tmdb'];
/** Provider ids in the order their ratings are trusted. */
export const RATING_PROVIDER_ORDER = ['rss', 'lbpage', 'imdb', 'rt', 'metacritic', 'tmdb', 'wikidata', 'omdb'];

/**
 * Which source each score and each piece of "How it feels" text comes from, as { 'what': providerId }, for the Debug panel.
 * compose().sources lists only the basic fields, so without this a source that gives scores or review text looked like it gave nothing.
 */
export function scoreAndFeelSources(film) {
  const src = film?.src || {}, out = {};
  const NAME = { letterboxd: 'Letterboxd score', imdb: 'IMDb score', rt: 'Rotten Tomatoes scores', metacritic: 'Metacritic scores', tmdb: 'TMDB score' };
  const has = v => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');
  for (const p of [...new Set([...RATING_PROVIDER_ORDER, ...Object.keys(src)])]) {
    for (const [k, v] of Object.entries(src[p]?.ratings || {})) {
      if (!v) continue;
      const name = NAME[k] || `${k} score`;
      if (!out[name]) out[name] = p;
      // The critic sites' own pages are used whole when present; say what only they add over OMDb's copy.
      if (k === 'rt' && v.audience != null) out['Rotten Tomatoes audience score'] = p;
      if (k === 'metacritic' && v.users != null) out['Metacritic user score'] = p;
    }
  }
  const feel = [['rt', 'consensus', 'feel: critics consensus'], ['mcreviews', 'critics', 'feel: critic quotes'], ['mcreviews', 'users', 'feel: Metacritic user reviews'],
    ['tmdb', 'reviews', 'feel: TMDB reviews'], ['lbpage', 'reviews', 'feel: Letterboxd reviews'], ['lbpage', 'miniThemes', 'feel: Letterboxd themes'],
    ['imdbpage', 'reviews', 'feel: IMDb reviews'], ['allmovie', 'themes', 'feel: AllMovie themes'], ['wikicats', 'categories', 'feel: article categories']];
  for (const [p, field, name] of feel) if (has(src[p]?.[field])) out[name] = p;
  if (has(src.wikipedia?.sections?.reception) || has(src.wikipedia?.sections?.themes)) out['feel: reception and themes text'] = 'wikipedia';
  return out;
}

const PEOPLE_ROLES = ['director', 'writer', 'cinematography', 'composer', 'editor', 'producer', 'cast'];
export { PEOPLE_ROLES };

// ---------- identity ----------

/** Normalise a title for matching: lowercase, no accents/punctuation, '&' → 'and', single spaces. */
export function normTitle(t) {
  return String(t || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export const titleYearKey = (title, year) => `${normTitle(title)}|${year || ''}`;

/** Film keys: 'lid:<letterboxd short id>' when known (from the export), else 'slug:<letterboxd slug>'. */
export function filmKey({ lid, slug, title, year }) {
  if (lid) return `lid:${lid}`;
  if (slug) return `slug:${slug}`;
  return `ty:${titleYearKey(title, year)}`;
}

/** boxd.it/<code> → code. Film links have 3–5 char codes; diary/review links are longer. */
export function lidFromUri(uri) {
  const m = /boxd\.it\/([A-Za-z0-9]+)/.exec(uri || '');
  return m ? m[1] : null;
}

export function emptyFilm({ key, lid = null, slug = null, title, year = null }) {
  return { key: key || filmKey({ lid, slug, title, year }), lid, slug, title, year, ids: {}, src: {}, checked: {}, missed: {} };
}

// ---------- composition ----------

function pick(film, field) {
  for (const p of PRIORITY[field] || []) {
    const v = film.src?.[p]?.[field];
    if (v != null && !(Array.isArray(v) && v.length === 0) && v !== '') return { value: v, source: p };
  }
  return { value: null, source: null };
}

/** A poster as { url, thumb, ... }: some sources store a bare URL string (lbpage), others an object. null when there is no usable URL. */
export function normPoster(v) {
  if (typeof v === 'string') return v.trim() ? { url: v.trim(), thumb: v.trim() } : null;
  if (v && typeof v === 'object' && typeof v.url === 'string' && v.url) return v.thumb ? v : { ...v, thumb: v.url };
  return null;
}

/** Every source that holds a poster for this film, automatic order first: [{ source, label, poster }]. */
export function posterCandidates(film) {
  const src = film.src || {};
  const ids = [...POSTER_ORDER, ...Object.keys(src).filter(k => !POSTER_ORDER.includes(k))];
  const out = [];
  for (const id of ids) {
    const poster = normPoster(src[id]?.poster);
    if (poster) out.push({ source: id, label: POSTER_LABELS[id] || id, poster });
  }
  return out;
}

/**
 * The single view of a film used by analysis and UI.
 * `posterPick` (a source id, from library.films[key].posterPick) chooses the poster; if that source no longer has one, the automatic choice is used.
 * Shape: { key, lid, slug, title, year, ids, poster, backdrop, synopsis, tagline, runtime, released, genres,
 *          keywords, subjects, countries, languages, studios, collection, basedOn, locations, awards, boxOffice,
 *          budget, certification, similar, people:{role:[…]}, ratings:{source:{…}}, sources:{field:providerId} }
 */
// Language names as people say them: sources spell some differently ("American English", "Standard Chinese"), and TMDB marks films
// without speech "No Language" — a film from before 1930 is Silent, a later one has No dialogue (Koyaanisqatsi).
const LANGUAGE_ALIASES = {
  'american english': 'English', 'british english': 'English', 'australian english': 'English',
  'standard chinese': 'Mandarin', 'mandarin chinese': 'Mandarin', 'standard taiwanese mandarin': 'Mandarin', 'taiwanese mandarin': 'Mandarin',
  'modern greek': 'Greek', 'brazilian portuguese': 'Portuguese', 'european portuguese': 'Portuguese', 'european spanish': 'Spanish', 'mexican spanish': 'Spanish',
  'canadian french': 'French', 'quebec french': 'French', 'yue chinese': 'Cantonese', 'swiss german': 'German',
};
const SILENT_BEFORE = 1930;
/** ['No Language'] (1927) → ['Silent']; ['American English', 'English'] → ['English']. Order kept, duplicates dropped. */
export function normLanguages(langs, year = null) {
  if (!Array.isArray(langs)) return langs ?? null;
  const out = [];
  for (const raw of langs) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const name = /^(no language|no linguistic content|none)$/i.test(t) ? (year && year < SILENT_BEFORE ? 'Silent' : 'No dialogue')
      : /^silent( film)?$/i.test(t) ? 'Silent' : LANGUAGE_ALIASES[t.toLowerCase()] || t;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function compose(film, { posterPick = null } = {}) {
  const out = { key: film.key, lid: film.lid, slug: film.slug || film.ids?.letterboxd || null, ids: { ...film.ids }, sources: {} };
  for (const field of Object.keys(PRIORITY)) {
    if (field === 'people') continue;
    const { value, source } = pick(film, field);
    out[field] = value;
    if (source) out.sources[field] = source;
  }
  const cands = posterCandidates(film);
  const chosen = (posterPick && cands.find(c => c.source === posterPick)) || cands[0] || null;
  out.poster = chosen ? chosen.poster : null;
  if (chosen) out.sources.poster = chosen.source; else delete out.sources.poster;
  const t = pick(film, 'title');
  out.title = film.title || t.value;
  out.year = film.year ?? (out.released ? Number(String(out.released).slice(0, 4)) : null) ?? film.src?.lbpage?.year ?? null;
  out.languages = normLanguages(out.languages, out.year);
  // Ids: lbpage's imdb/tmdb ids only fill a gap; any id another source stored (Wikidata etc.) always wins, even if it disagrees.
  for (const k of ['imdb', 'tmdb']) {
    const v = film.src?.lbpage?.ids?.[k];
    if (out.ids[k] == null && v != null && v !== '') out.ids[k] = v;
  }
  out.genres = out.genres || [];
  for (const k of ['keywords', 'subjects', 'countries', 'languages', 'studios', 'basedOn', 'locations', 'awards', 'similar']) out[k] = out[k] || [];
  // People: per role, first source that has that role.
  out.people = {};
  for (const role of PEOPLE_ROLES) {
    for (const p of PRIORITY.people) {
      const list = film.src?.[p]?.people?.[role];
      if (list && list.length) { out.people[role] = list; break; }
    }
    out.people[role] = out.people[role] || [];
  }
  // Ratings: a source's own provider beats copies relayed by aggregators (OMDb last).
  out.ratings = {};
  const order = [...new Set([...RATING_PROVIDER_ORDER, ...Object.keys(film.src || {})])];
  for (const p of order) {
    const data = film.src?.[p];
    if (data && data.ratings) for (const [k, v] of Object.entries(data.ratings)) if (v && out.ratings[k] == null) out.ratings[k] = v;
  }
  return out;
}

/** Merge ids found by a provider without overwriting existing ones. */
export function addIds(film, ids) {
  film.ids = film.ids || {};
  for (const [k, v] of Object.entries(ids || {})) if (v != null && v !== '' && film.ids[k] == null) film.ids[k] = v;
}
