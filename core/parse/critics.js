// Pure parsers for the two critic-score sites. No network, no DOM: the pages embed what we need as JSON
// (Rotten Tomatoes: two <script type="application/json"> tags; Metacritic: ld+json plus a little markup), so
// small regular expressions over those specific tags are enough and fast on 600 KB pages.
//
// Both return null when the HTML is not a film page we recognise (a challenge page, a layout change, an
// error page). When it is a film page they return only the fields the page actually has, so "no score yet"
// is simply missing rather than 0.

// ---------- helpers ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (all, dec, hex, name) => {
    if (dec || hex) {
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

const cleanText = s => (typeof s === 'string' && s.trim() ? decodeEntities(s).replace(/\s+/g, ' ').trim() : undefined);

/** A finite number from a number or a numeric string ("95", "7.7", "1,294"); anything else → null. */
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const inRange = (n, lo, hi) => (n != null && n >= lo && n <= hi ? n : null);
/** A count: a non-negative whole number, or null. */
const count = v => { const n = num(v); return n != null && Number.isInteger(n) && n >= 0 ? n : null; };

const YEAR = /\b(1[89]\d{2}|20\d{2})\b/;
const yearOf = v => { const m = YEAR.exec(String(v ?? '')); return m ? Number(m[1]) : null; };

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** The JSON inside <script ... id="<id>" ...>…</script> (attributes in any order, possibly over several lines). */
function scriptJsonById(html, id) {
  const m = new RegExp(`<script\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</script>`, 'i').exec(html);
  return m ? parseJson(m[1]) : null;
}

/** Every application/ld+json block on the page, parsed, with arrays and @graph flattened. */
function ldJsonItems(html) {
  const out = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const j = parseJson(m[1]);
    const stack = Array.isArray(j) ? [...j] : j ? [j] : [];
    while (stack.length) {
      const item = stack.shift();
      if (!item || typeof item !== 'object') continue;
      out.push(item);
      if (Array.isArray(item['@graph'])) stack.push(...item['@graph']);
    }
  }
  return out;
}
const isMovie = item => [].concat(item['@type'] || []).includes('Movie');

/** A real page about something that is not a film (a TV series, say): it declares a type, none of them Movie. */
export function isNonFilmPage(html) {
  if (typeof html !== 'string' || !html) return false;
  const typed = ldJsonItems(html).filter(i => i['@type']);
  return typed.length > 0 && !typed.some(isMovie);
}

// ---------- Rotten Tomatoes ----------

const CONSENSUS_MAX = 400;
function consensusOf(html) {
  const block = /<div\b[^>]*\bid="critics-consensus"[^>]*>([\s\S]*?)<\/div>/i.exec(html)
    ?? /<div\b[^>]*\bclass="[^"]*\bconsensus\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const p = block && /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block[1]);
  if (!p) return undefined;
  let text = cleanText(p[1].replace(/<[^>]*>/g, ''));
  if (!text) return undefined;
  if (text.length > CONSENSUS_MAX) text = text.slice(0, CONSENSUS_MAX - 1).replace(/\s+\S*$/, '') + '…';
  return text;
}

/**
 * @param {string} html  a rottentomatoes.com/m/<id> page
 * @returns {{ critics?: number, criticsCount?: number, certified?: boolean, audience?: number, audienceCount?: number,
 *             consensus?: string, year?: number, title?: string } | null}
 */
export function parseRottenTomatoes(html) {
  if (typeof html !== 'string' || !html) return null;
  const card = scriptJsonById(html, 'media-scorecard-json');
  const hero = scriptJsonById(html, 'media-hero-json');
  if (!card && !hero) return null;
  const out = {};

  // Tomatometer. Scores are strings: "95" in `score` (to 2026) or "95%" in `scorePercent` (Nov 2026 pages, no `score` key).
  // A film with too few reviews has neither.
  const pct = s => (s == null ? null : num(String(s).replace(/%\s*$/, '')));
  const cs = card?.criticsScore;
  const critics = inRange(num(cs?.score) ?? pct(cs?.scorePercent), 0, 100);
  if (critics != null) {
    out.critics = critics;
    const n = count(cs.reviewCount) ?? count(cs.ratingCount);
    if (n != null) out.criticsCount = n;
    if (typeof cs.certified === 'boolean') out.certified = cs.certified;
  }

  // Popcornmeter. RT can hide it (hideAudienceScore); the count is liked + not liked, which is the number of
  // ratings behind the score. The banded text ("10,000+ Ratings") is only a fallback, and "Fewer than 50" is no count at all.
  const as = card?.audienceScore;
  const audience = card?.hideAudienceScore === true ? null : inRange(num(as?.score) ?? pct(as?.scorePercent), 0, 100);
  if (audience != null) {
    out.audience = audience;
    const liked = count(as.likedCount), notLiked = count(as.notLikedCount);
    let n = liked != null || notLiked != null ? (liked || 0) + (notLiked || 0) : null;
    if (!n) {
      const banded = String(as.bandedRatingCount ?? '');
      n = /fewer than/i.test(banded) ? null : count(/(\d[\d,]*)/.exec(banded)?.[1]?.replace(/,/g, ''));
    }
    if (n) out.audienceCount = n;
  }

  // Critics Consensus: <div id="critics-consensus" class="consensus"> … <p>sentence</p>. Plain text, entities decoded.
  const consensus = consensusOf(html);
  if (consensus) out.consensus = consensus;

  // Title and year. Recent films show a month ("May 2026") or a date ("In Theaters Dec 18") instead of a bare year,
  // so look for any 4-digit year in the hero props, then fall back to the page's ld+json.
  const ld = ldJsonItems(html).find(isMovie);
  const title = cleanText(hero?.content?.title) ?? cleanText(ld?.name)
    ?? cleanText(/<title>([^<|]*?)(?:\s*\(\d{4}\))?\s*\|[^<]*<\/title>/i.exec(html)?.[1]);
  if (title) out.title = title;
  const props = Array.isArray(hero?.content?.metadataProps) ? hero.content.metadataProps : [];
  const year = props.map(yearOf).find(y => y != null) ?? yearOf(ld?.dateCreated) ?? yearOf(ld?.datePublished);
  if (year != null) out.year = year;
  return out;
}

// ---------- Metacritic ----------

/**
 * @param {string} html  a metacritic.com/movie/<slug>/ page
 * @returns {{ critics?: number, criticsCount?: number, users?: number, usersCount?: number,
 *             year?: number, title?: string } | null}
 */
export function parseMetacritic(html) {
  if (typeof html !== 'string' || !html) return null;
  const movie = ldJsonItems(html).find(isMovie);
  if (!movie) return null;
  const out = {};

  // Metascore: the ld+json aggregate rating. A film with fewer than four reviews has no aggregateRating ("tbd").
  const agg = movie.aggregateRating;
  let critics = inRange(num(agg?.ratingValue), 0, 100);
  let criticsCount = count(agg?.reviewCount) ?? count(agg?.ratingCount);
  if (critics == null && !agg) {
    // Markup fallback: <div title="Metascore 81 out of 100" …> and "Based on 13 Critic Reviews".
    critics = inRange(num(/title="Metascore (\d+(?:\.\d+)?) out of 100"/.exec(html)?.[1]), 0, 100);
    if (critics != null) criticsCount = count(/Based on ([\d,]+) Critic Reviews?/.exec(html)?.[1]?.replace(/,/g, ''));
  }
  if (critics != null) {
    out.critics = critics;
    if (criticsCount != null) out.criticsCount = criticsCount;
  }

  // User score: no structured data. The page's own score badge carries title="User score 7.7 out of 10" next to
  // data-testid="global-score-value-wrapper". Individual user reviews have the same title text (their own score), and
  // a hidden placeholder says "User score null out of 10", so only the global badge counts. "TBD" means no score yet.
  let users = inRange(num(/title="User score (\d+(?:\.\d+)?) out of 10"[^>]*data-testid="global-score-value-wrapper"/.exec(html)?.[1]), 0, 10);
  if (users == null) {
    // Older layouts: the badge sits just after the "Based on N User Ratings" line.
    users = inRange(num(/Based on [\d,]+ User Ratings?[\s\S]{0,1200}?title="User score (\d+(?:\.\d+)?) out of 10"/.exec(html)?.[1]), 0, 10);
  }
  if (users != null) {
    out.users = users;
    const n = count(/Based on ([\d,]+) User Ratings?/.exec(html)?.[1]?.replace(/,/g, ''));
    if (n != null) out.usersCount = n;
  }

  const title = cleanText(movie.name);
  if (title) out.title = title;
  const year = yearOf(movie.datePublished) ?? yearOf(movie.dateCreated);
  if (year != null) out.year = year;
  return out;
}
