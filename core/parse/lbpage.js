// Pure parser for a public Letterboxd film page (as a browser sees it). Reads the genre / theme / mini-theme links,
// the tagline, the aggregate rating in the JSON-LD and the "popular reviews" bodies. Reviewer names, handles and
// profile links are never read: only the review text and its star rating.
import { decodeEntities } from './critics.js';
import { clip, isMostlyEnglish } from './reviews.js';

const MAX_REVIEWS = 10;
const MAX_MINI = 6;
const MAX_KEYWORDS = 8;
const MAX_CAST = 8;
const MAX_DIRECTORS = 4;
const MAX_WRITERS = 4;

const inline = html => decodeEntities(String(html ?? '')
  .replace(/<(?:p|br|div|blockquote|li)\b[^>]*>/gi, ' ')
  .replace(/<[^>]*>/g, ''))
  .replace(/[\s ]+/g, ' ').trim();

const deslug = s => s.replace(/-/g, ' ').trim();

/** All links whose href contains /films/<kind>/<slug>/ → [{slug, label}] */
function links(html, kind) {
  const re = new RegExp(`<a\\b[^>]*href="/films/${kind}/([^/"]+)/[^"]*"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  const out = [];
  for (const m of html.matchAll(re)) out.push({ slug: m[1].toLowerCase(), label: inline(m[2]) });
  return out;
}

const uniq = list => [...new Set(list)];

/** Stars in the rating glyph's aria-label ("★★★½") → 0–10, or null. */
function starsToTen(label) {
  const full = (label.match(/★/g) || []).length;
  const half = /½/.test(label) ? 1 : 0;
  const n = full * 2 + half;
  return n > 0 && n <= 10 ? n : null;
}

function parseReviews(html) {
  const start = html.search(/class="[^"]*\bjs-popular-reviews\b/);
  const scope = start >= 0 ? html.slice(start) : html;
  const out = [], seen = new Set();
  for (const chunk of scope.split(/<article\b[^>]*production-viewing/).slice(1)) {
    const card = chunk.split('</article>')[0]; // the last chunk would otherwise run on into the page's forms
    const body = /class="[^"]*\bjs-review-body\b[^"]*"[^>]*>([\s\S]*?)<div class="viewing-actions"/.exec(card);
    if (!body) continue;
    if (/contains-spoilers|may contain spoilers|-spoiler/i.test(card)) continue;
    const raw = inline(body[1].replace(/<a\b[^>]*class="[^"]*\breveal\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi, ''));
    if (!raw || !isMostlyEnglish(raw)) continue;
    const text = clip(raw);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = /class="[^"]*\bglyph -rating\b[^"]*"[^>]*aria-label="([^"]*)"/.exec(card);
    const rating = label ? starsToTen(decodeEntities(label[1])) : null;
    out.push(rating != null ? { text, rating } : { text });
    if (out.length >= MAX_REVIEWS) break;
  }
  return out;
}

function parseAggregate(html) {
  const out = {};
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const json = m[1].replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\/\s*$/, '').trim();
    try {
      const ag = JSON.parse(json)?.aggregateRating;
      if (!ag) continue;
      const avg = Number(ag.ratingValue), count = Number(ag.ratingCount ?? ag.reviewCount);
      if (Number.isFinite(avg) && avg > 0) out.average = avg;
      if (Number.isFinite(count) && count > 0) out.ratingCount = Math.round(count);
      break;
    } catch { /* not the film block */ }
  }
  return out;
}

// ---------- film facts from the JSON-LD block and the page (all optional; a missing field is simply left out) ----------

/** The page's Movie JSON-LD object, or null. */
function movieLd(html) {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const json = m[1].replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\/\s*$/, '').trim();
    try {
      const o = JSON.parse(json);
      if (o && typeof o === 'object' && !Array.isArray(o) && /Movie/.test(String(o['@type']))) return o;
    } catch { /* not the film block */ }
  }
  return null;
}

const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nameOf = v => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.name : '');
const names = (v, max = 50) => uniq(asList(v).map(x => String(nameOf(x) ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean)).slice(0, max);
const httpsUrl = u => {
  const s = decodeEntities(String(u ?? '')).trim();
  return /^https:\/\/[^\s"<>]+$/i.test(s) ? s : null;
};

/** ISO duration "PT2H25M" → minutes, or null. */
export function isoMinutes(d) {
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)$/i.exec(String(d ?? '').trim());
  if (!m || (m[1] == null && m[2] == null)) return null;
  const n = Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return n > 0 ? n : null;
}

/** Runtime: the JSON-LD duration, else the page's "145 mins" text. */
function runtimeOf(ld, html) {
  const a = isoMinutes(ld?.duration);
  if (a) return a;
  const m = /(\d{2,3})(?:&nbsp;|\s|\u00a0)+mins?\b/i.exec(html);
  const n = m ? Number(m[1]) : 0;
  return n >= 20 && n <= 900 ? n : null;
}

/** Poster: JSON-LD image (the largest, listed or sized), else a film-poster og:image. */
function posterOf(ld, html) {
  const fromLd = asList(ld?.image).map(x => httpsUrl(typeof x === 'string' ? x : x?.url)).filter(Boolean);
  if (fromLd.length) return fromLd[0];
  const og = /<meta[^>]*property="og:image"[^>]*content="([^"]*)"/i.exec(html) || /<meta[^>]*content="([^"]*)"[^>]*property="og:image"/i.exec(html);
  const u = og && httpsUrl(og[1]);
  return u && /film-poster/.test(u) ? u : null; // DECISION: the og:image on most pages is a square backdrop crop, not a poster, so only film-poster URLs count
}

/** Letterboxd person slug from a profile URL ("https://letterboxd.com/director/sean-baker/" → "sean-baker"). */
const PERSON_URL = /(?:letterboxd\.com)?\/(director|actor|writer)\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i;
const personSlug = (u, kind) => {
  const m = PERSON_URL.exec(String(u ?? '').trim());
  return m && m[1].toLowerCase() === kind ? m[2].toLowerCase() : null;
};
/** Anchors to /<kind>/<slug>/ on the page → [{name, slug}] (unique by slug). */
function linkPeople(html, kind, max) {
  const re = new RegExp(`<a\\b[^>]*href="(?:https://letterboxd\\.com)?/${kind}/([a-z0-9][a-z0-9-]*)/?"[^>]*>([\\s\\S]*?)</a>`, 'gi');
  const out = [], seen = new Set();
  for (const m of html.matchAll(re)) {
    const slug = m[1].toLowerCase(), name = inline(m[2]);
    if (!name || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug });
    if (out.length >= max) break;
  }
  return out;
}
/** People from a JSON-LD field (sameAs, else url, carries the slug); names the JSON-LD gave without one are matched to the page's links by name. */
function people(field, kind, html, max) {
  const byName = new Map(linkPeople(html, kind, 200).map(p => [p.name.toLowerCase(), p.slug]));
  const out = [], seen = new Set();
  for (const x of asList(field)) {
    const name = String(nameOf(x) ?? '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const slug = (x && typeof x === 'object' && (personSlug(x.sameAs, kind) || personSlug(x.url, kind))) || byName.get(name.toLowerCase()) || null;
    out.push(slug ? { name, slug } : { name });
    if (out.length >= max) break;
  }
  return out;
}

function factsOf(html) {
  const ld = movieLd(html) || {};
  const out = {};
  const poster = posterOf(ld, html);
  if (poster) out.poster = poster;
  const desc = ld.description != null ? inline(ld.description) : '';
  if (desc) out.synopsis = desc;
  const runtime = runtimeOf(ld, html);
  if (runtime) out.runtime = runtime;
  const created = String(ld.dateCreated ?? ld.datePublished ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(created)) out.released = created.slice(0, 10);
  const yr = /^(\d{4})/.exec(created);
  if (yr) out.year = Number(yr[1]);
  for (const [key, field] of [['countries', 'countryOfOrigin'], ['languages', 'inLanguage'], ['studios', 'productionCompany']]) {
    const list = names(ld[field], 12);
    if (list.length) out[key] = list;
  }
  // People: names (and, when the page names them, their Letterboxd person slug, e.g. "sean-baker" for /director/sean-baker/).
  const directors = people(ld.director, 'director', html, MAX_DIRECTORS), cast = people(ld.actor, 'actor', html, MAX_CAST);
  const writers = linkPeople(html, 'writer', MAX_WRITERS);
  if (directors.length || cast.length || writers.length) {
    out.people = {};
    if (directors.length) out.people.director = directors;
    if (writers.length) out.people.writer = writers;
    if (cast.length) out.people.cast = cast;
  }
  const imdb = /imdb\.com\/title\/(tt\d{5,10})/i.exec(html)?.[1];
  const tmdb = /data-tmdb-id="(\d+)"/.exec(html)?.[1];
  const tmdbTv = /data-tmdb-type="tv"/i.test(html); // a TV id would point at the wrong thing in the film namespace
  const ids = {};
  if (imdb) ids.imdb = imdb.toLowerCase();
  if (tmdb && !tmdbTv) ids.tmdb = tmdb;
  if (Object.keys(ids).length) out.ids = ids;
  return out;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "28 Feb 1985" → "1985-02-28", or null. */
function releaseDate(text) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(String(text).trim());
  const mon = m && MONTHS[m[2].toLowerCase()];
  return mon ? `${m[3]}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

const RELEASE_TYPES = { premiere: 'Premiere', 'theatrical limited': 'Theatrical (limited)', theatrical: 'Theatrical', digital: 'Digital', physical: 'Physical', tv: 'TV' };

/**
 * The "Releases" tab: one "release-table -bydate" per type (Premiere, Theatrical limited, Theatrical, Digital…),
 * each a list of date rows naming countries. Returns every row as {country, date, type}; the caller trims it.
 */
export function parseReleases(html) {
  const start = html.search(/id="tab-panel-releases"/);
  if (start < 0) return [];
  let scope = html.slice(start);
  const end = scope.search(/class="release-table -bycountry"/);
  if (end >= 0) scope = scope.slice(0, end);
  const out = [];
  for (const block of scope.split(/<h3[^>]*class="[^"]*\brelease-table-title\b[^"]*"[^>]*>/).slice(1)) {
    const type = RELEASE_TYPES[inline(block.slice(0, block.indexOf('</h3>'))).toLowerCase()];
    if (!type) continue;
    for (const row of block.split(/<h5[^>]*class="[^"]*\bdate\b[^"]*"[^>]*>/).slice(1)) {
      const date = releaseDate(inline(row.slice(0, row.indexOf('</h5>'))));
      if (!date) continue;
      for (const m of row.matchAll(/<span class="name">([\s\S]*?)<\/span>/g)) {
        const country = inline(m[1]);
        if (country) out.push({ country, date, type });
      }
    }
  }
  return out;
}

/** Australia's cinema date: Theatrical beats Theatrical (limited); within a type the earliest date. Digital/TV/etc. never count. */
export function ausRelease(releases) {
  for (const type of ['Theatrical', 'Theatrical (limited)']) {
    const dates = releases.filter(r => r.country === 'Australia' && r.type === type).map(r => r.date).sort();
    if (dates.length) return { date: dates[0], type };
  }
  return null;
}

/** Compact list kept in the store: every Australian row plus the earliest premiere anywhere. */
function compactReleases(releases) {
  const premiere = releases.filter(r => r.type === 'Premiere').sort((a, b) => a.date.localeCompare(b.date))[0];
  const aus = releases.filter(r => r.country === 'Australia');
  return premiere && !aus.includes(premiere) ? [premiere, ...aus] : aus;
}

/** Also returns, when the page has them: poster, synopsis, runtime, released, year, countries, languages, studios, people{director,cast} (names only) and ids{imdb,tmdb}.
 * @returns {{themes:string[], miniThemes:string[][], genres:string[], reviews:{text:string,rating?:number}[], releases?:{country:string,date:string,type:string}[], ausRelease?:{date:string,type:string}, tagline?:string, average?:number, ratingCount?:number}|null} */
export function parseLetterboxdFilm(html) {
  if (typeof html !== 'string' || !html) return null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
  if (!/letterboxd/i.test(title)) return null;
  if (!/"@type"\s*:\s*"Movie"/.test(html) && !/production-synopsis|js-popular-reviews/.test(html)) return null;

  const genres = uniq(links(html, 'genre').map(l => l.label || deslug(l.slug)).filter(Boolean));
  const themes = uniq(links(html, 'theme').map(l => l.label || deslug(l.slug)).filter(Boolean));
  const seenMini = new Set(), miniThemes = [];
  for (const l of links(html, 'mini-theme')) {
    const words = l.slug.split('-').filter(Boolean).slice(0, MAX_KEYWORDS);
    const key = words.join('-');
    if (!words.length || seenMini.has(key)) continue;
    seenMini.add(key);
    miniThemes.push(words);
    if (miniThemes.length >= MAX_MINI) break;
  }
  const tag = /<h4[^>]*class="[^"]*\btagline\b[^"]*"[^>]*>([\s\S]*?)<\/h4>/i.exec(html);
  const tagline = tag ? inline(tag[1]) : '';
  const all = parseReleases(html);
  const aus = ausRelease(all), releases = compactReleases(all);
  return {
    themes, miniThemes, genres, reviews: parseReviews(html), ...(tagline ? { tagline } : {}), ...parseAggregate(html),
    ...(releases.length ? { releases } : {}), ...(aus ? { ausRelease: aus } : {}), ...factsOf(html),
  };
}
