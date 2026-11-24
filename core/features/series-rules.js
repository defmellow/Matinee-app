// What counts as a series you can "finish". Pure; used on Wikidata's answer before anything is shown.
import { isCatalogueName } from '../parse/wikidata.js';

// Re-releases and other editions of the same film are not separate entries.
const EDITION = /\((3d|imax|extended|director'?s cut|unrated|remaster(ed)?|special edition|redux|final cut|theatrical|restored|re-?release|\d{4} re-?release)[^)]*\)|\b(3d|imax) (version|edition)\b/i;
export const isEdition = title => EDITION.test(String(title || ''));

const SMALL = 6; // a short run with no sequel links or numbering at all (a trilogy told only by its name) is still taken on trust

/**
 * @param {{ id, name, films: { id, title, year, ordinal, linked?: boolean|null }[] }} s  a series as read from Wikidata
 * `linked` says the film follows or is followed by another member; undefined/null means we couldn't tell.
 * @returns the series with only its real entries, or null when it isn't a genuine series (a studio or best-of list,
 * fewer than two entries, nothing but editions of one film).
 */
export function genuineSeries(s) {
  if (!s || isCatalogueName(s.name)) return null;
  const seen = new Set();
  const films = (s.films || []).filter(f => {
    if (isEdition(f.title)) return false;
    const k = `${String(f.title).toLowerCase()}|${f.year ?? ''}`;
    return !seen.has(k) && seen.add(k);
  });
  let entries = films;
  if (films.some(f => f.linked != null)) {
    entries = films.filter(f => f.linked || f.ordinal != null);
    if (!entries.length && films.length <= SMALL) entries = films;
  }
  return entries.length >= 2 ? { ...s, films: entries } : null;
}
