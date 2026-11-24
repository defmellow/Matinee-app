// Matinee backups (Settings → Your data → "Download a backup"): one JSON file with the library (ratings, diary, tags, notes,
// lists, views, settings without keys) and, since 23 Nov, a small card per film (ids, title, year) so a backup restored on a new
// computer has something to show and look up straight away. Older backups have no cards: films are then rebuilt from their keys.
import { SCHEMA } from './store.js';
import { emptyFilm } from './model.js';

export const BACKUP_VERSION = 1;
const bad = message => Object.assign(new Error(message), { code: 'bad-request' });
const NOT_BACKUP = "That file isn't a Matinee backup. Choose the matinee-backup file you downloaded from Settings → Your data.";

/** The small per-film card kept in a backup: only what finding the film again needs. */
export function filmCards(store) {
  const out = {};
  for (const key of Object.keys(store.library.films || {})) {
    const f = store.films[key];
    if (!f) continue;
    const ids = {};
    for (const [k, v] of Object.entries(f.ids || {})) if (v != null && v !== '' && typeof v !== 'object') ids[k] = v;
    out[key] = { lid: f.lid || null, slug: f.slug || null, title: f.title || null, year: f.year ?? null, ids };
  }
  return out;
}

/** The backup file's contents. API keys stay out: the file is meant to be kept and may be shared. */
export function makeBackup(store) {
  const { keys, keyStatus, ...settings } = store.library.settings || {};
  return { app: 'Matinee', version: BACKUP_VERSION, library: { ...store.library, settings }, films: filmCards(store) };
}

/** A film record from its key alone (backups made before film cards): 'lid:<id>', 'slug:<slug>' or 'ty:<title>|<year>'. */
function filmFromKey(key) {
  const [kind, ...rest] = String(key).split(':');
  const v = rest.join(':');
  if (kind === 'lid' && v) return emptyFilm({ key, lid: v, title: null });
  if (kind === 'slug' && v) return emptyFilm({ key, slug: v, title: v.replace(/-\d{4}$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) });
  if (kind === 'ty' && v) {
    const [t, y] = v.split('|');
    return emptyFilm({ key, title: t ? t.replace(/\b\w/g, c => c.toUpperCase()) : null, year: Number(y) || null });
  }
  return null;
}

/**
 * Read a backup's text: throws a friendly bad-request error for anything that isn't one.
 * @returns {{ library: object, films: object }}
 */
export function parseBackup(json) {
  if (typeof json !== 'string' || !json.trim()) throw bad(NOT_BACKUP);
  let data;
  try { data = JSON.parse(json); } catch { throw bad(NOT_BACKUP); }
  if (!data || typeof data !== 'object' || data.app !== 'Matinee') throw bad(NOT_BACKUP);
  if (data.version !== BACKUP_VERSION) throw bad('That backup was made by a different version of Matinee, so it can\'t be read here.');
  const lib = data.library;
  if (!lib || typeof lib !== 'object' || !lib.films || typeof lib.films !== 'object' || Array.isArray(lib.films)) throw bad(NOT_BACKUP);
  if (lib.schema != null && lib.schema !== SCHEMA) throw bad('That backup was made by a different version of Matinee, so it can\'t be read here.');
  if (!Object.keys(lib.films).length) throw bad('That backup has no films in it.');
  return { library: lib, films: data.films && typeof data.films === 'object' && !Array.isArray(data.films) ? data.films : {} };
}

/**
 * Put a parsed backup in place of the library. Keys and their status on this computer are kept (a backup has none); a friend code
 * and Dendy setting are taken from the backup only when it has them. Film records that already exist keep their details; missing
 * ones are made from the backup's cards (or their keys) and fill in as usual.
 * @returns {{ films: number, watched: number, watchlist: number, entries: number, newFilmKeys: string[] }}
 */
export function restoreBackup(store, { library, films: cards }) {
  const cur = store.library.settings || {};
  const from = library.settings && typeof library.settings === 'object' ? library.settings : {};
  const settings = { ...from, keys: { ...(cur.keys || {}) } };
  if (cur.keyStatus) settings.keyStatus = { ...cur.keyStatus }; else delete settings.keyStatus;
  for (const k of ['dendy', 'friendCode']) if (from[k] === undefined) { if (cur[k] === undefined) delete settings[k]; else settings[k] = cur[k]; }
  if (!settings.region) settings.region = cur.region || 'AU';
  const lib = store.library;
  for (const k of Object.keys(lib)) delete lib[k];
  Object.assign(lib, {
    schema: SCHEMA, user: null, films: {}, entries: {}, lists: {}, tags: {}, views: {},
    ...library,
    sync: { lastImport: null, lastRefresh: null, lastFull: null, problems: [], ...(library.sync || {}) },
    settings,
  });
  lib.schema = SCHEMA;
  for (const k of ['films', 'entries', 'lists', 'tags', 'views']) if (!lib[k] || typeof lib[k] !== 'object') lib[k] = {};
  const newFilmKeys = [];
  for (const key of Object.keys(lib.films)) {
    if (store.films[key]) continue;
    const c = cards[key];
    const f = c && typeof c === 'object'
      ? { ...emptyFilm({ key, lid: c.lid || null, slug: c.slug || null, title: c.title || null, year: c.year ?? null }), ids: { ...(c.ids || {}) } }
      : filmFromKey(key);
    if (!f) continue;
    f.key = key;
    store.films[key] = f;
    newFilmKeys.push(key);
  }
  store.touch('library'); store.touch('films');
  const uf = Object.values(lib.films);
  return { films: uf.length, watched: uf.filter(f => f && f.watched).length, watchlist: uf.filter(f => f && f.watchlist).length, entries: Object.keys(lib.entries).length, newFilmKeys };
}
