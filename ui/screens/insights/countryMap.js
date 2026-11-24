// Pure helpers for the countries map: match a film's country name to a map shape, tally films, pick a colour step.
import { foldSearch } from '../../../core/analysis/tags.js';
import { WORLD_MAP } from '../../data/world-map.js';

// Other spellings and older countries → the closest modern shape (folded names, see foldSearch).
const ALIASES = {
  'united states of america': 'US', usa: 'US', us: 'US', 'u s a': 'US', 'u s': 'US', america: 'US',
  uk: 'GB', 'u k': 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  'russian federation': 'RU', 'soviet union': 'RU', ussr: 'RU', 'u s s r': 'RU',
  'west germany': 'DE', 'east germany': 'DE', 'german democratic republic': 'DE', 'federal republic of germany': 'DE',
  czechia: 'CZ', czechoslovakia: 'CZ', yugoslavia: 'RS', 'serbia and montenegro': 'RS', 'fr yugoslavia': 'RS',
  'republic of korea': 'KR', 'korea south': 'KR', 'korea': 'KR', 'democratic peoples republic of korea': 'KP', 'korea north': 'KP',
  'peoples republic of china': 'CN', 'republic of china': 'TW', 'republic of ireland': 'IE', eire: 'IE',
  uae: 'AE', 'cote divoire': 'CI', 'cote d ivoire': 'CI', 'ivory coast': 'CI', burma: 'MM', persia: 'IR', 'viet nam': 'VN', vietnam: 'VN',
  'north macedonia': 'MK', macedonia: 'MK', 'republic of macedonia': 'MK', swaziland: 'SZ', 'east timor': 'TL',
  'palestinian territories': 'PS', 'state of palestine': 'PS', 'occupied palestinian territory': 'PS',
  'congo kinshasa': 'CD', 'dr congo': 'CD', 'dem rep congo': 'CD', 'democratic republic of congo': 'CD', zaire: 'CD',
  'congo brazzaville': 'CG', 'republic of congo': 'CG', congo: 'CG', 'bosnia': 'BA', 'turkiye': 'TR', 'holland': 'NL',
  'the netherlands': 'NL', 'the bahamas': 'BS', 'the gambia': 'GM', 'lao pdr': 'LA', 'russia': 'RU', 'kosovo': 'XK',
};

const BY_NAME = new Map(WORLD_MAP.map(c => [foldSearch(c.name), c.id]));
const NAMES = new Map(WORLD_MAP.map(c => [c.id, c.name]));

/** Map shape id (ISO alpha-2) for a country name from the library, or null when it is not on the map. */
export function shapeId(name) {
  const k = foldSearch(typeof name === 'object' && name ? name.name : name);
  if (!k) return null;
  return ALIASES[k] || BY_NAME.get(k) || BY_NAME.get(k.replace(/^the /, '')) || null;
}

/**
 * Count watched films per map shape (a film counts once per shape).
 * @returns {{ counts: Map<string, number>, names: Map<string, string[]>, missing: Map<string, number>, max: number }}
 *   `names` = the library's own spellings per shape (used to filter the Library); `missing` = unmatched names with counts.
 */
export function tallyCountries(films) {
  const counts = new Map(), names = new Map(), missing = new Map();
  for (const f of films) {
    if (!f.user || !f.user.watched) continue;
    const seen = new Set();
    for (const c of f.countries || []) {
      const raw = (typeof c === 'object' && c ? c.name : c || '').toString().trim();
      if (!raw) continue;
      const id = shapeId(raw);
      if (!id) { missing.set(raw, (missing.get(raw) || 0) + 1); continue; }
      const list = names.get(id) || names.set(id, []).get(id);
      if (!list.includes(raw)) list.push(raw);
      if (seen.has(id)) continue;
      seen.add(id);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return { counts, names, missing, max: Math.max(0, ...counts.values()) };
}

export const STEPS = 5;

/** Colour step 0 (no films) to STEPS. Square-root scale so one big country doesn't wash out the rest. */
export function colourStep(count, max) {
  if (!count || count < 1 || !max) return 0;
  return Math.max(1, Math.min(STEPS, Math.ceil(Math.sqrt(count / max) * STEPS)));
}

export const countText = (name, n) => `${name}: ${n} ${n === 1 ? 'film' : 'films'}`;
