// Pure parsers for AllMovie. parseAllMovieSearch reads the search results list; parseAllMovie reads the descriptor
// groups ("Moods", "Themes", "Flags", "Tone") on a film page. Verified on the live server-rendered page (22 Oct 2026):
// each group is <div class="themes"><div class="sub-headline"><h4>Themes</h4></div><div class="charactList"><a …>X</a></div></div>.
// Only Themes were present on the pages checked; Moods/Flags/Tone use the same layout and are matched by heading text.
import { decodeEntities } from './critics.js';

const MAX = 20;
const clean = s => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function terms(inner) {
  const links = [...inner.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(m => clean(m[1]));
  const list = links.length ? links : clean(inner).split(',');
  const out = [];
  for (const t of list.map(x => x.trim().toLowerCase())) if (t && t.length <= 60 && !out.includes(t)) out.push(t);
  return out.slice(0, MAX);
}

/** @returns {{moods:string[],themes:string[],tone:string[],flags:string[]}|null} lowercase terms, null when none found */
export function parseAllMovie(html) {
  if (typeof html !== 'string' || !html) return null;
  const res = { moods: [], themes: [], tone: [], flags: [] };
  const re = /<h4[^>]*>\s*(Moods?|Themes?|Flags?|Tones?)\s*<\/h4>\s*<\/div>\s*<div class="charactList">([\s\S]*?)<\/div>/gi;
  for (const m of html.matchAll(re)) {
    const k = m[1].toLowerCase();
    const key = k.startsWith('mood') ? 'moods' : k.startsWith('theme') ? 'themes' : k.startsWith('flag') ? 'flags' : 'tone';
    if (!res[key].length) res[key] = terms(m[2]);
  }
  return Object.values(res).some(a => a.length) ? res : null;
}

/** @returns {{ id: string, slug: string, title: string, year: number|null }[]} movie results in page order */
export function parseAllMovieSearch(html) {
  if (typeof html !== 'string') return [];
  const out = [];
  for (const m of html.matchAll(/<div class="title"[^>]*>\s*<a href="[^"]*\/movie\/([^"\/]*-(am\d+))"[^>]*>([\s\S]*?)<\/a>\s*(?:\((\d{4})\))?/gi)) {
    out.push({ id: m[2], slug: m[1], title: clean(m[3]), year: m[4] ? Number(m[4]) : null });
  }
  return out;
}
