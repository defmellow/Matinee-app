// Automatic tags: derived from a film's data on the fly, never stored. See PLAN.md 2.4.
// Also home to the small text helpers (fold, slugify, country names) the other analysis modules share.

// ---------- text helpers ----------

const SPECIAL = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ł': 'l', 'ð': 'd', 'þ': 'th', 'ı': 'i' };

/** Lowercase, no accents ("Amélie" → "amelie", "Ørnulf" → "ornulf"). Keeps everything else. */
export function foldText(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[øæœßđłðþı]/g, c => SPECIAL[c]);
}

/** Folded text for searching: words separated by single spaces, punctuation gone, '&' → 'and', non-Latin letters kept. */
export function foldSearch(s) {
  return foldText(s).replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Stable id fragment: lowercase ascii with hyphens. Falls back to keeping non-Latin letters when nothing ascii is left. */
export function slugify(s) {
  const base = foldText(s).replace(/&/g, ' and ').replace(/['’`]/g, '');
  const ascii = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (ascii) return ascii;
  return base.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

const capitalise = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const nameOf = v => clean(typeof v === 'object' && v ? v.name : v);

// ---------- countries ----------

// Folded name (see foldSearch) → canonical country. `label` is what follows "From ".
const COUNTRY_ALIASES = {
  'united states of america': ['usa', 'the USA'], 'united states': ['usa', 'the USA'], 'usa': ['usa', 'the USA'],
  'us': ['usa', 'the USA'], 'u s a': ['usa', 'the USA'], 'u s': ['usa', 'the USA'], 'america': ['usa', 'the USA'],
  'united kingdom': ['uk', 'the UK'], 'uk': ['uk', 'the UK'], 'u k': ['uk', 'the UK'],
  'great britain': ['uk', 'the UK'], 'britain': ['uk', 'the UK'],
  'russian federation': ['russia', 'Russia'],
  'republic of korea': ['south-korea', 'South Korea'], 'korea south': ['south-korea', 'South Korea'], 'south korea': ['south-korea', 'South Korea'],
  'peoples republic of china': ['china', 'China'],
  'republic of ireland': ['ireland', 'Ireland'],
  'czechia': ['czech-republic', 'the Czech Republic'], 'czech republic': ['czech-republic', 'the Czech Republic'],
  'ussr': ['soviet-union', 'the Soviet Union'], 'soviet union': ['soviet-union', 'the Soviet Union'],
  'uae': ['united-arab-emirates', 'the UAE'], 'united arab emirates': ['united-arab-emirates', 'the UAE'],
};
const THE_COUNTRIES = new Set(['netherlands', 'philippines', 'bahamas', 'gambia', 'maldives', 'seychelles', 'comoros']);
const THE_PREFIX = /^(united|republic of|kingdom of|democratic|federation|commonwealth|union of)\b/;

/**
 * Canonical country: variants of a name (TMDB vs Wikidata spellings) share one `id`.
 * @returns {{ id: string, label: string }|null} label reads after "From " ("the USA", "Japan", "the Netherlands")
 */
export function canonicalCountry(name) {
  const raw = clean(name);
  if (!raw) return null;
  const folded = foldSearch(raw);
  const alias = COUNTRY_ALIASES[folded];
  if (alias) return { id: alias[0], label: alias[1] };
  const slug = slugify(raw);
  if (!slug) return null;
  const article = THE_COUNTRIES.has(folded) || THE_PREFIX.test(folded);
  return { id: slug, label: article ? `the ${raw}` : raw };
}

// ---------- tag builders ----------

export const GROUP_ORDER = ['decade', 'length', 'genre', 'country', 'language', 'director', 'award', 'source', 'series', 'subject'];

const tag = (group, slug, label) => ({ id: `${group}:${slug}`, label, group });

function decadeTag(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1800 || y > 2999) return null;
  const d = Math.floor(y / 10) * 10;
  return tag('decade', `${d}s`, `${d}s`);
}

function lengthTag(runtime) {
  const m = Number(runtime);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m < 40) return tag('length', 'short', 'Short film');
  if (m < 90) return tag('length', 'under-90', 'Under 90 minutes');
  if (m >= 150) return tag('length', 'epic', 'Epic (2½ hours+)');
  return null;
}

const NO_LANGUAGE = new Set(['english', 'en', 'eng', 'no language', 'no dialogue', 'none', 'xx', 'zxx', 'silent', 'no spoken language']);

const OSCAR = /^academy awards? for\b/i;
const BEST_PICTURE = /\bacademy awards? for best picture\b/i;

function awardTags(awards) {
  const list = (awards || []).map(a => (typeof a === 'string' ? { name: a, won: true } : a)).filter(a => a && clean(a.name));
  // DECISION: an award with no `won` flag counts as won; "Best Picture winner" needs a won Best Picture, and a film that
  // wins Best Picture also gets "Oscar winner".
  const won = a => a.won !== false;
  const text = a => clean(a.name).replace(/’/g, "'");
  const out = [];
  const oscars = list.filter(a => OSCAR.test(text(a)) && !/\bbritish academy\b/i.test(text(a)));
  if (oscars.some(a => won(a) && BEST_PICTURE.test(text(a)))) out.push(tag('award', 'best-picture', 'Best Picture winner'));
  if (oscars.some(won)) out.push(tag('award', 'oscar-winner', 'Oscar winner'));
  else if (oscars.length) out.push(tag('award', 'oscar-nominated', 'Oscar nominated'));
  if (list.some(a => won(a) && /palme d'or/i.test(text(a)))) out.push(tag('award', 'palme-dor', "Palme d'Or"));
  if (list.some(a => won(a) && /golden lion/i.test(text(a)))) out.push(tag('award', 'golden-lion', 'Golden Lion'));
  if (list.some(a => won(a) && /golden bear/i.test(text(a)))) out.push(tag('award', 'golden-bear', 'Golden Bear'));
  if (list.some(a => won(a) && /\bbafta\b|british academy (film )?awards?/i.test(text(a)))) out.push(tag('award', 'bafta-winner', 'BAFTA winner'));
  if (list.some(a => won(a) && /golden globes?/i.test(text(a)))) out.push(tag('award', 'golden-globe-winner', 'Golden Globe winner'));
  return out;
}

function sourceTag(basedOn) {
  const items = (basedOn || []).map(nameOf).filter(Boolean);
  if (!items.length) return null;
  const text = items.join(' ; ').toLowerCase();
  if (/\b(comics?|comic books?|graphic novels?|manga)\b/.test(text)) return tag('source', 'comic', 'Based on a comic');
  if (/\bplays?\b/.test(text)) return tag('source', 'play', 'Based on a play');
  if (/\bnovels?\b/.test(text)) return tag('source', 'novel', 'Based on a novel');
  if (/\bshort stor(y|ies)\b/.test(text)) return tag('source', 'story', 'Based on a short story');
  if (/\bbooks?\b/.test(text)) return tag('source', 'book', 'Based on a book');
  return tag('source', 'other', 'Based on another work');
}

/**
 * Subject tags: subjects as given, then keywords lower-cased with a capital first letter. Duplicates (by id) dropped.
 * @param {object} s summary-like with `subjects` and `keywords`
 * @param {{max?: number}} [opts] max tags to return (default 8)
 */
export function subjectTags(s, { max = 8 } = {}) {
  const out = [], seen = new Set();
  const add = label => {
    const slug = slugify(label);
    if (!slug || seen.has(slug) || out.length >= max) return;
    seen.add(slug);
    out.push(tag('subject', slug, label));
  };
  for (const v of s?.subjects || []) add(capitalise(nameOf(v)));
  // Keep acronyms and proper nouns (LGBTQ+, World War II); lower-case only plain words.
  for (const v of s?.keywords || []) { const k = nameOf(v); add(capitalise(/[A-Z]/.test(k.slice(1)) && !(k === k.toUpperCase() && /\s|[A-Z]{6,}/.test(k)) ? k : k.toLowerCase())); }
  return out;
}

/**
 * Every automatic tag a film earns, in group order (decade, length, genre, country, language, director, award,
 * source, series, subject). Ids are `${group}:${slug}` and are stable.
 * @param {object} s summary-like: { year, runtime, genres, countries, languages, directors, awards, basedOn, collection, subjects, keywords }
 * @returns {Array<{id:string,label:string,group:string}>}
 */
export function autoTags(s) {
  const f = s || {};
  const out = [];
  const push = t => { if (t) out.push(t); };

  push(decadeTag(f.year));
  push(lengthTag(f.runtime));
  for (const g of f.genres || []) { const n = nameOf(g); if (slugify(n)) push(tag('genre', slugify(n), n)); }
  for (const c of f.countries || []) { const k = canonicalCountry(nameOf(c)); if (k) push(tag('country', k.id, `From ${k.label}`)); }
  for (const l of f.languages || []) {
    const n = nameOf(l);
    if (!n || NO_LANGUAGE.has(foldSearch(n)) || /\benglish$/.test(foldSearch(n)) || !slugify(n)) continue;
    push(tag('language', slugify(n), `In ${n}`));
  }
  for (const d of f.directors || []) { const n = nameOf(d); if (slugify(n)) push(tag('director', slugify(n), `Directed by ${n}`)); }
  for (const t of awardTags(f.awards)) push(t);
  push(sourceTag(f.basedOn));
  const series = clean(f.collection);
  if (series && slugify(series)) push(tag('series', slugify(series), `Part of ${series.replace(/\s+Collection$/i, '')}`));
  for (const t of subjectTags(f)) push(t);

  const seen = new Set();
  return out.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/** Just the ids of `autoTags(s)`: what library summaries store in `autoTags`. */
export const autoTagIds = s => autoTags(s).map(t => t.id);

/**
 * Every automatic tag across a library with how many films have it, for filter facets.
 * Sorted by group (GROUP_ORDER), then count descending, then label.
 * @returns {Array<{id:string,label:string,group:string,count:number}>}
 */
export function tagIndex(summaries) {
  const map = new Map();
  for (const s of summaries || []) {
    for (const t of autoTags(s)) {
      const e = map.get(t.id);
      if (e) e.count++; else map.set(t.id, { ...t, count: 1 });
    }
  }
  const rank = g => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? GROUP_ORDER.length : i; };
  return [...map.values()].sort((a, b) => rank(a.group) - rank(b.group) || b.count - a.count || a.label.localeCompare(b.label));
}
