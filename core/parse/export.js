// Letterboxd's official data export (Settings → Data → Export your data) is a ZIP of CSV files.
// This module only reads it: ZIP in, plain normalised tables out. core/import/export.js puts them in the store.
import { unzipSync, zipSync, strFromU8 } from 'fflate';

export const BAD_FILE = "That file doesn't look like a Letterboxd export.";
// A real export is a few hundred small CSVs; anything far beyond that is not one (and could be a zip bomb).
const MAX_ENTRIES = 5000, MAX_ENTRY_BYTES = 50e6, MAX_TOTAL_BYTES = 200e6, MAX_RATIO = 1000;
export const NOT_AN_EXPORT = "This file isn't a Letterboxd export. In Letterboxd, go to Settings → Data → Export your data, then drop the ZIP here.";

// ---------- CSV ----------

/**
 * RFC 4180 CSV → array of rows (arrays of strings). Quoted fields may hold commas, "" quotes and newlines.
 * Blank lines are dropped. A UTF-8 BOM is ignored. Quotes only open a field when they are its first character.
 */
export function parseCsvRows(textIn) {
  const text = String(textIn ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false, atStart = true;
  const endField = () => { row.push(field); field = ''; atStart = true; };
  const endRow = () => { endField(); if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else if (c === '\r') { if (text[i + 1] !== '\n') field += '\n'; }   // CRLF inside a quoted field becomes \n
      else field += c;
      continue;
    }
    if (c === '"' && atStart) { q = true; atStart = false; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\n') { endRow(); continue; }
    if (c === '\r') { if (text[i + 1] !== '\n') endRow(); continue; }
    field += c; atStart = false;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

/** CSV with a header row → array of { header: value } objects. Short rows are padded with ''. */
export function parseCsv(text) {
  const [header, ...body] = parseCsvRows(text);
  if (!header) return [];
  const names = header.map(h => h.trim());
  return body.map(r => Object.fromEntries(names.map((h, j) => [h, r[j] ?? ''])));
}

// ---------- short links ----------

// boxd.it/<code> is base-62 (0-9a-zA-Z) of  id × 10 + type, where type 0 = film and 1 = diary entry (a "viewing").
// Verified on a real export against the RSS feed: every diary code decodes to its RSS viewing id × 10 + 1, and film
// codes decode to the film uid × 10 (e.g. 29Ts → 514690 → film:51469).
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function decode62(code) {
  let n = 0;
  for (const ch of String(code)) {
    const d = B62.indexOf(ch);
    if (d < 0) return null;
    n = n * 62 + d;
  }
  return n;
}

function encode62(n) {
  let s = '';
  do { s = B62[n % 62] + s; n = Math.floor(n / 62); } while (n > 0);
  return s;
}

/** RSS viewing id → the entry short code used in the export (boxd.it/<code>). */
export const entryCodeFromViewingId = viewingId => encode62(Number(viewingId) * 10 + 1);

/** Entry short code → RSS viewing id, or null when the code isn't a diary entry code. */
export function viewingIdFromEntryCode(code) {
  const n = code ? decode62(code) : null;
  return n != null && n % 10 === 1 ? (n - 1) / 10 : null;
}

// ---------- the export ZIP ----------

const IGNORED_DIRS = new Set(['deleted', 'orphaned', '__macosx']);
const half = v => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 2); };
const yearOf = v => Number(v) || null;
const bool = v => /^yes$/i.test(String(v || '').trim());
const splitList = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const uriOf = r => r['Letterboxd URI'] || r.URL || '';

const filmRow = r => ({ date: r.Date || null, name: r.Name || '', year: yearOf(r.Year), uri: uriOf(r) });

/** A list export has a few metadata lines, then a table: "Letterboxd list export v7", Date/Name/Tags/URL/Description, a blank line, Position/Name/Year/URL/Description. */
export function parseListCsv(text, fallbackName = '') {
  const rows = parseCsvRows(text);
  const at = (first) => rows.findIndex(r => r[0].trim() === first);
  const metaAt = rows.findIndex(r => r[0].trim() === 'Date' && r.map(c => c.trim()).includes('Name'));
  const tableAt = at('Position');
  const toObjects = (headerRow, body) => body.map(r => Object.fromEntries(headerRow.map((h, j) => [h.trim(), r[j] ?? ''])));
  const meta = metaAt >= 0 ? toObjects(rows[metaAt], rows.slice(metaAt + 1, tableAt > metaAt ? tableAt : metaAt + 2))[0] || {} : {};
  const table = tableAt >= 0 ? toObjects(rows[tableAt], rows.slice(tableAt + 1)) : [];
  return {
    name: (meta.Name || '').trim() || fallbackName,
    description: (meta.Description || '').trim(),
    url: (meta.URL || '').trim() || null, // the list's page (often a boxd.it short link), so it can be followed
    films: table.map((r, i) => ({ position: Number(r.Position) || i + 1, name: r.Name || '', year: yearOf(r.Year), uri: uriOf(r) })).filter(f => f.name),
  };
}

/**
 * An unzipped export folder → ZIP bytes that parseExportZip reads. Macs (Safari, and Archive Utility on a double-click) unzip
 * downloads by themselves, so the user may only have the folder. Keeps the CSVs and nothing else, stored without compression.
 * @param {{ path: string, bytes: Uint8Array }[]} files  paths relative to the folder (any separator)
 * @returns {Uint8Array}
 * Throws NOT_AN_EXPORT when the folder holds no CSVs, BAD_FILE when it is far bigger than an export.
 */
export function packExportFiles(files) {
  const out = {};
  let count = 0, total = 0;
  for (const f of files || []) {
    const name = String(f.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = name.toLowerCase().split('/');
    const base = parts.at(-1);
    if (!base.endsWith('.csv') || base.startsWith('._') || parts.some(p => IGNORED_DIRS.has(p))) continue;
    total += f.bytes.length;
    if (++count > MAX_ENTRIES || f.bytes.length > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES) throw Object.assign(new Error(BAD_FILE), { code: 'bad-file' });
    out[name] = [f.bytes, { level: 0 }];
  }
  if (!count) throw new Error(NOT_AN_EXPORT);
  return zipSync(out);
}

/**
 * ZIP bytes → normalised tables. Ratings are integers 1–10 (half-stars); dates stay 'YYYY-MM-DD' strings.
 * { profile, watched[], ratings[], watchlist[], likes[], diary[], reviews[], lists[] }
 * Throws NOT_AN_EXPORT when this isn't a Letterboxd export. Ignores the deleted/ and orphaned/ folders.
 */
export function parseExportZip(bytes) {
  if (!bytes || !bytes.length) throw new Error(NOT_AN_EXPORT);
  const where = name => {
    const parts = name.replace(/\\/g, '/').toLowerCase().split('/');
    const base = parts.pop();
    if (!base.endsWith('.csv') || base.startsWith('._') || parts.some(p => IGNORED_DIRS.has(p))) return null;
    return { dir: parts.at(-1) || '', base, depth: parts.length };
  };
  let files;
  let entries = 0, total = 0;
  const bomb = () => Object.assign(new Error(BAD_FILE), { code: 'bad-file' });
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), {
      filter: f => {
        if (++entries > MAX_ENTRIES) throw bomb();
        if (!where(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_TOTAL_BYTES || f.originalSize > MAX_RATIO * Math.max(f.size, 1024)) throw bomb();
        return true;
      },
    });
  } catch (e) { throw e?.code === 'bad-file' ? e : new Error(NOT_AN_EXPORT); }

  const found = Object.keys(files).map(name => ({ name, ...where(name) }));
  // The shortest path wins, so a wrapper folder inside the ZIP is fine.
  const pick = (base, dir) => found
    .filter(f => f.base === base && (dir ? f.dir === dir : f.dir !== 'likes' && f.dir !== 'lists'))
    .sort((a, b) => a.depth - b.depth)[0];
  const table = (base, dir) => { const f = pick(base, dir); return f ? parseCsv(strFromU8(files[f.name])) : null; };

  const watched = table('watched.csv'), ratings = table('ratings.csv'), watchlist = table('watchlist.csv');
  const diary = table('diary.csv'), reviews = table('reviews.csv'), likes = table('films.csv', 'likes'), profile = table('profile.csv');
  if (!watched && !ratings && !watchlist && !diary && !profile) throw new Error(NOT_AN_EXPORT);

  const p = profile && profile[0];
  const lists = found.filter(f => f.dir === 'lists').sort((a, b) => a.name.localeCompare(b.name)).map(f => {
    const slug = f.base.replace(/\.csv$/, '');
    return { slug, ...parseListCsv(strFromU8(files[f.name]), slug) };
  });

  return {
    profile: p ? {
      username: (p.Username || '').trim(), givenName: (p['Given Name'] || '').trim(), familyName: (p['Family Name'] || '').trim(),
      joined: p['Date Joined'] || null, location: p.Location || '', website: p.Website || '', bio: p.Bio || '', pronoun: p.Pronoun || '',
      favourites: splitList(p['Favorite Films']),
    } : null,
    watched: (watched || []).map(filmRow),
    ratings: (ratings || []).map(r => ({ ...filmRow(r), rating: half(r.Rating) })),
    watchlist: (watchlist || []).map(filmRow),
    likes: (likes || []).map(filmRow),
    diary: (diary || []).map(r => ({
      ...filmRow(r), rating: half(r.Rating), rewatch: bool(r.Rewatch), tags: splitList(r.Tags), watchedDate: r['Watched Date'] || null,
    })),
    reviews: (reviews || []).map(r => ({
      ...filmRow(r), rating: half(r.Rating), rewatch: bool(r.Rewatch), tags: splitList(r.Tags), watchedDate: r['Watched Date'] || null,
      review: (r.Review || '').trim(),
    })),
    lists,
  };
}
