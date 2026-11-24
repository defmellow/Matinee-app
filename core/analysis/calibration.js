// Taste calibration: where you rate harsher or kinder than the crowd (the Matinee score).
// Pure functions over summaries. diff = mean of (your rating × 10 − score), in points on the 0–100 scale.
import { yourTake } from './scores.js';
import { canonicalCountry } from './tags.js';
import { linkPart, personPart, partsText } from './text-parts.js';

const MIN_COUNT = 3;
const MIN_DIRECTOR = 2;
const round1 = x => Math.round(x * 10) / 10;

class Bucket {
  constructor(name, id) { this.name = name; this.id = id; this.sum = 0; this.count = 0; }
  add(d) { this.sum += d; this.count++; }
}

function addTo(map, key, name, id, d) {
  if (!key) return;
  let b = map.get(key);
  if (!b) map.set(key, b = new Bucket(name, id));
  b.add(d);
}

function rows(map, min) {
  return [...map.values()]
    .filter(b => b.count >= min)
    .map(b => { const r = { name: b.name, diff: round1(b.sum / b.count), count: b.count }; if (b.id) r.id = b.id; return r; })
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.count - a.count || a.name.localeCompare(b.name));
}

/** Points on the 0–100 scale as a short phrase with stars: "14 points (about ¾★)". */
export function pointsText(points) {
  const p = Math.round(Math.abs(points));
  const quarters = Math.round((Math.abs(points) / 20) * 4); // 100 points = 5 stars
  const frac = ['', '¼', '½', '¾'][quarters % 4];
  const stars = quarters === 0 ? 'under ¼★' : `about ${Math.floor(quarters / 4) || ''}${frac}★`;
  return `${p} ${p === 1 ? 'point' : 'points'} (${stars})`;
}

const sign = d => (d < 0 ? '−' : '+');

/** The notes as text parts (text-parts.js), so the genre, decade, director or country named can be a link. */
function notes(overall, groups) {
  const out = [];
  if (overall.count >= MIN_COUNT) {
    if (Math.abs(overall.diff) < 3) out.push([`Overall you rate right in line with the crowd (${overall.count} films compared).`]);
    else out.push([`Overall you're ${overall.diff < 0 ? 'tougher' : 'kinder'} than most, by ${pointsText(overall.diff)} on average.`]);
  }
  const used = new Set();
  const say = (r, phrase) => {
    if (!r || used.has(r) || Math.abs(r.diff) < 5) return;
    used.add(r);
    const how = r.diff < 0 ? 'tougher' : 'kinder';
    out.push([`You're ${how} than most `, ...phrase(r), ` (${sign(r.diff)}${pointsText(r.diff).replace(' (', ', ').replace(')', '')}, across ${r.count} films).`]);
  };
  const first = (list, dir) => list.find(r => dir < 0 ? r.diff < 0 : r.diff > 0);
  const [genres, decades, directors, countries] = groups;
  const genre = r => ['on ', linkPart(r.name.toLowerCase(), 'genre', r.name), ' films'];
  say(genres[0], genre);
  say(first(genres, genres[0] ? -Math.sign(genres[0].diff) : 1), genre);
  say(decades[0], r => ['on films from the ', linkPart(r.name, 'decade', parseInt(r.name, 10))]);
  say(directors[0], r => ['on ', personPart(r, 'director')]);
  say(countries[0], r => ['on films from ', linkPart(r.label, 'country', r.name)]);
  return out.slice(0, 4);
}

/**
 * @param {Array} summaries
 * @returns {{ overall:{diff:number,count:number}, byGenre:Row[], byDecade:Row[], byDirector:Row[], byCountry:Row[], notes:string[], noteParts:TextPart[][] }}
 *   Row = { name, id?, diff, count }
 */
export function calibration(summaries) {
  const genres = new Map(), decades = new Map(), directors = new Map(), countries = new Map();
  let sum = 0, count = 0;
  const labels = new Map();
  for (const s of summaries || []) {
    if (!s?.user?.watched && s?.user?.rating == null) continue;
    const d = yourTake(s.user?.rating, s.score);
    if (d == null) continue;
    sum += d; count++;
    for (const g of new Set(s.genres || [])) addTo(genres, g, g, null, d);
    if (s.year) { const dec = `${Math.floor(s.year / 10) * 10}s`; addTo(decades, dec, dec, null, d); }
    const seen = new Set();
    for (const p of s.directors || []) {
      const name = typeof p === 'string' ? p : p?.name;
      const id = typeof p === 'string' ? null : p?.id;
      const key = id || name;
      if (!name || seen.has(key)) continue;
      seen.add(key);
      addTo(directors, key, name, id, d);
    }
    const cs = new Set();
    for (const c of s.countries || []) {
      const cc = canonicalCountry(typeof c === 'string' ? c : c?.name);
      if (!cc || cs.has(cc.id)) continue;
      cs.add(cc.id);
      const display = cc.label.replace(/^the /, '');
      labels.set(display, cc.label);
      addTo(countries, cc.id, display, null, d);
    }
  }
  const overall = { diff: count ? round1(sum / count) : 0, count };
  const byGenre = rows(genres, MIN_COUNT), byDecade = rows(decades, MIN_COUNT);
  const byDirector = rows(directors, MIN_DIRECTOR), byCountry = rows(countries, MIN_COUNT);
  const noteCountries = byCountry.map(r => ({ ...r, label: labels.get(r.name) || r.name }));
  const noteParts = notes(overall, [byGenre, byDecade, byDirector, noteCountries]);
  return { overall, byGenre, byDecade, byDirector, byCountry, notes: noteParts.map(partsText), noteParts };
}
