// Pure parsers for IMDb's keyword and review pages. IMDb pages are Next.js: the data sits in a <script id="__NEXT_DATA__">
// JSON block, which is sturdier than CSS classes, so that is read first and the visible HTML is a fallback.
// Only keyword text and the review text/rating/spoiler flag are read: never names, handles or dates.
// NOTE: written without being able to load IMDb from the build container (blocked), so the JSON paths below are the
// documented/known shapes and are tried defensively. Fixtures are synthetic.
import { decodeEntities } from './critics.js';
import { clip, isMostlyEnglish } from './reviews.js';

const MAX_KEYWORDS = 40;
const MAX_REVIEWS = 8;
const MAX_TEXT = 320;

const plain = html => decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function nextData(html) {
  if (typeof html !== 'string') return null;
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

const get = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o);

/** @returns {string[]} lowercase keywords, at most 40 */
export function parseImdbKeywords(html) {
  const out = [], seen = new Set();
  const add = raw => {
    if (typeof raw !== 'string') return;
    let k = plain(raw).toLowerCase();
    if (!k || k.length > 60 || /\bfound this relevant\b|^\d+$|^\d+ of \d+/.test(k)) return;
    if (seen.has(k)) return;
    seen.add(k); out.push(k);
  };
  const data = nextData(html);
  const pp = data?.props?.pageProps;
  const edges = get(pp, ['contentData', 'data', 'title', 'keywords', 'edges']) || get(pp, ['mainColumnData', 'keywords', 'edges']) || [];
  for (const e of edges) add([get(e, ['node', 'keyword', 'text', 'text']), get(e, ['node', 'keyword', 'text']), get(e, ['node', 'text']), get(e, ['node', 'keyword'])].find(v => typeof v === 'string'));
  if (!out.length && typeof html === 'string') {
    // Fallback: keyword links (the vote counts sit in separate elements, so only the link text is taken)
    for (const m of html.matchAll(/<a[^>]+href="[^"]*\/search\/keyword\/?\?[^"]*keywords=[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) add(m[1]);
  }
  return out.slice(0, MAX_KEYWORDS);
}

function reviewNodes(data) {
  const pp = data?.props?.pageProps;
  const a = get(pp, ['contentData', 'reviews']);
  if (Array.isArray(a)) return a.map(r => r?.review || r);
  const edges = get(pp, ['contentData', 'data', 'title', 'reviews', 'edges']) || get(pp, ['mainColumnData', 'reviews', 'edges']);
  if (Array.isArray(edges)) return edges.map(e => e?.node);
  return [];
}

function fromNode(n) {
  if (!n || n.spoiler === true || n.isSpoiler === true) return null;
  let raw = n.reviewText ?? get(n, ['text', 'originalText', 'plainText']) ?? get(n, ['text', 'originalText', 'plaidHtml']) ?? n.text;
  if (typeof raw !== 'string') return null;
  const rating = Number(n.authorRating ?? n.rating);
  return { raw: plain(raw), rating: Number.isFinite(rating) && rating >= 1 && rating <= 10 ? Math.round(rating) : null };
}

function fromHtml(html) {
  const out = [];
  for (const chunk of html.split(/ipc-list-card--border-speech|data-testid="review-card-parent"/).slice(1)) {
    const card = chunk.split(/<\/article>|<\/li>/)[0]; // keep the last card from running on into the page footer
    if (/review-spoiler|spoiler-warning|ipc-signpost[^>]*>\s*Spoiler|>Warning: Spoilers</i.test(card)) continue;
    const t = /ipc-html-content-inner-div[^>]*>([\s\S]*?)<\/div>/.exec(card);
    if (!t) continue;
    const r = /ipc-rating-star--rating[^>]*>\s*(\d+)\s*</.exec(card);
    out.push({ raw: plain(t[1]), rating: r ? Number(r[1]) : null });
  }
  return out;
}

/** @returns {{ text: string, rating?: number }[]} up to 8 short English excerpts; spoiler reviews skipped */
export function parseImdbReviews(html) {
  if (typeof html !== 'string' || !html) return [];
  const data = nextData(html);
  let items = reviewNodes(data).map(fromNode).filter(Boolean);
  if (!items.length) items = fromHtml(html);
  const out = [], seen = new Set();
  for (const { raw, rating } of items) {
    if (!raw || !isMostlyEnglish(raw)) continue;
    const text = clip(raw, MAX_TEXT);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rating >= 1 && rating <= 10 ? { text, rating } : { text });
    if (out.length >= MAX_REVIEWS) break;
  }
  return out;
}
