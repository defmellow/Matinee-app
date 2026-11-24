// "Share data": builds the export of the real library data (one zip, read by troubleshooting scripts such as scripts/load-share.mjs).
// Nothing is trimmed: every film's full stored record, the library and diary, feel profiles, the whole fetch log and the last Test fetch.
// Size comes only from compression (one compact JSON line per film, deflate level 9).
// Pure: callers pass the data in. Secrets (API keys, tokens), file paths and account details are never included.

export const SHARE_VERSION = 2;
export const SHARE_FILENAME = 'matinee-share.zip';
/** The log files that go in the zip (under logs/), looked for in the logs folder and in the app's data-parent folder (matinee.log lives there). */
export const SHARE_LOG_FILES = ['problems.json', 'problems.log', 'problems.old.log', 'matinee.log', 'matinee.log.old'];

// Property names dropped wherever they turn up inside stored film data (defence in depth: film records hold none today).
const SECRET_NAMES = new Set(['keys', 'apikey', 'api_key', 'token', 'secret', 'password', 'authorization', 'cookie', 'cookies', 'safestorage']);

export function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!SECRET_NAMES.has(k.toLowerCase())) out[k] = scrub(x);
    return out;
  }
  return v;
}

/** Per-source "filled" counts, the same way Settings counts them. */
export function filledCounts(films) {
  const filled = {};
  for (const f of Object.values(films || {})) for (const [id, v] of Object.entries(f.src || {})) if (v) filled[id] = (filled[id] || 0) + 1;
  return filled;
}

function profileView(feel) {
  if (!feel || !feel.profile) return null;
  const p = feel.profile;
  return {
    h: feel.summary ? feel.summary.headline : null,
    d: (p.descriptors || []).map(d => [d.id, d.label, d.facet, d.score, d.voices]),
    t: (p.themes || []).map(t => [t.id, t.label, t.centrality, t.tier, t.why]),
    s: (p.settings || []).map(s => [s.id, s.label, s.kind]),
    c: p.coverage || null,
  };
}

/** One film's line in films.ndjson: { k: key, f: the full stored record (scrubbed), p: feel profile view | omitted }. */
export function filmRow(key, f, feel = null) {
  const row = { k: key, f: scrub(f) };
  const p = profileView(feel);
  if (p) row.p = p;
  return row;
}

/** library.json as shared: all of it except the account details (user) and anything secret (keys, tokens). */
export function libraryView(library) {
  const lib = scrub(library || {});
  const s = lib.settings || {};
  return { ...lib, user: null, settings: { theme: s.theme || 'system', region: s.region || 'AU' } };
}

/**
 * The files inside the zip: [{ name, chunks }]. films.ndjson is produced lazily, one line per film.
 * input: { logs: { fileName: text } (the problem log and app log files, see SHARE_LOG_FILES), library, films, feelOf(key) -> { profile, summary } | null, fetchLog, lastTest: { text, startedAt } | null, appVersion, now }
 */
export function shareEntries({ library, films, feelOf = () => null, fetchLog = '', lastTest = null, appVersion = null, now = new Date(), logs = {} }) {
  const lib = library || {};
  const all = films || {};
  const uf = Object.values(lib.films || {});
  const header = {
    version: SHARE_VERSION,
    createdAt: new Date(now).toISOString(),
    appVersion,
    counts: { films: Object.keys(all).length, watched: uf.filter(f => f.watched).length, watchlist: uf.filter(f => f.watchlist).length, diaryEntries: Object.keys(lib.entries || {}).length },
    settings: { theme: (lib.settings && lib.settings.theme) || 'system', region: (lib.settings && lib.settings.region) || 'AU' },
    filled: filledCounts(all),
    logFiles: Object.keys(logs),
    lastTestFetchAt: lastTest && lastTest.text ? lastTest.startedAt || null : null,
  };
  function* lines() {
    for (const key of Object.keys(all)) yield JSON.stringify(filmRow(key, all[key], feelOf(key))) + '\n';
  }
  return [
    { name: 'header.json', chunks: [JSON.stringify(header)] },
    { name: 'library.json', chunks: [JSON.stringify(libraryView(lib))] },
    { name: 'films.ndjson', chunks: lines() },
    { name: 'fetch-log.txt', chunks: [String(fetchLog || '')] },
    { name: 'test-fetch.txt', chunks: [lastTest && lastTest.text ? String(lastTest.text) : ''] },
    ...Object.entries(logs).map(([name, text]) => ({ name: 'logs/' + name, chunks: [String(text)] })),
  ];
}

/** Every file as a string (tests and small libraries). */
export function shareFiles(input) { return Object.fromEntries(shareEntries(input).map(e => [e.name, [...e.chunks].join('')])); }
