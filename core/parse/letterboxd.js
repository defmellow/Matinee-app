// Pure parsers for Letterboxd pages. Input: HTML/XML text. Output: plain objects.
// No network, no state — every function here is unit-tested against real saved pages.
import { parseHTML } from 'linkedom';
import { decodeEntities as decode } from './critics.js';

const BASE = 'https://letterboxd.com';

const doc = html => parseHTML(html).document;
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const attr = (el, name) => (el ? el.getAttribute(name) : null);

// "The Odyssey (2026)" -> { title: 'The Odyssey', year: 2026 }
export function splitTitleYear(name) {
  const m = /^(.*\S)\s+\((\d{4})\)$/.exec(name || '');
  return m ? { title: m[1], year: Number(m[2]) } : { title: (name || '').trim(), year: null };
}

// rated-9 -> 9 (half-stars out of 10), or null
function ratingFrom(el) {
  const m = el && /\brated-(\d+)\b/.exec(el.getAttribute('class') || '');
  return m ? Number(m[1]) : null;
}

function filmUid(el) {
  // data-postered-identifier='{"uid":"film:1255394", ...}'
  try { const id = JSON.parse(attr(el, 'data-postered-identifier') || '{}').uid || ''; return id.startsWith('film:') ? Number(id.slice(5)) : null; }
  catch { return null; }
}

function posterItem(el) {
  const name = attr(el, 'data-item-name') || attr(el, 'data-item-full-display-name') || '';
  const { title, year } = splitTitleYear(name);
  return { slug: attr(el, 'data-item-slug'), title, year, lbId: filmUid(el) };
}

function pagination(d) {
  const next = d.querySelector('.pagination a.next');
  const pages = [...d.querySelectorAll('.pagination .paginate-page')].map(li => Number(text(li))).filter(Number.isFinite);
  return { hasNext: !!next, lastPage: pages.length ? Math.max(...pages) : 1 };
}

export function isChallenge(html) {
  return /<title>Just a moment\.\.\.<\/title>/i.test(html) || /challenges\.cloudflare\.com\/cdn-cgi/i.test(html.slice(0, 20000));
}

/** Letterboxd's "Page Not Found" page (a list that was deleted or made private). Used by Lists (core/parse/list-page.js). */
export function isNotFound(html) {
  return /<body[^>]*class="[^"]*\berror\b/i.test(html) || /<title>[^<]*Page Not Found/i.test(html);
}

// /<user>/films/ and /<user>/watchlist/ pages: a grid of posters, optionally with your rating + like.
export function parsePosterGrid(html) {
  const d = doc(html);
  // Grid pages mark each film li.griditem; list pages (seen live 10 Nov 2026) use li.posteritem. Both carry the same LazyPoster component.
  const items = [...d.querySelectorAll('li.griditem, li.posteritem')].map(li => {
    const comp = li.querySelector('.react-component[data-item-slug]');
    if (!comp) return null;
    const vd = li.querySelector('.poster-viewingdata');
    return { ...posterItem(comp), rating: ratingFrom(vd && vd.querySelector('.rating')), liked: !!(vd && vd.querySelector('.icon-liked')) };
  }).filter(Boolean);
  const wl = d.querySelector('[data-num-entries]');
  return { items, ...pagination(d), total: wl ? Number(attr(wl, 'data-num-entries')) : null };
}

// /<user>/rss/ — the latest diary entries and reviews. Never Cloudflare-challenged.
export function parseRss(xml) {
  const items = [];
  const tag = (s, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(s); return m ? m[1].trim() : null; };
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const s = m[1];
    const guid = tag(s, 'guid') || '';
    const link = tag(s, 'link') || '';
    const g = /letterboxd-(watch|review|list)-(\d+)/.exec(guid);
    if (!g || g[1] === 'list') continue;
    const slug = (/\/film\/([^/]+)\//.exec(link) || [])[1] || null;
    const desc = (/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(s) || [])[1] || '';
    const poster = (/<img src="([^"]+)"/.exec(desc) || [])[1] || null;
    // review text = paragraphs other than the poster and the "Watched on ..." line
    const paras = [...desc.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(p => p[1]).filter(p => !/^<img/.test(p.trim()) && !/^Watched on /.test(p.trim()));
    const review = paras.length ? paras.map(p => decodeEntities(p.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')).trim()).join('\n\n') : null;
    let text = review, spoiler = false;
    if (text && /^This review may contain spoilers\.\s*/.test(text)) { spoiler = true; text = text.replace(/^This review may contain spoilers\.\s*/, ''); }
    const rating = tag(s, 'letterboxd:memberRating');
    items.push({
      viewingId: Number(g[2]),
      kind: g[1],
      slug,
      title: decodeEntities(tag(s, 'letterboxd:filmTitle')),
      year: Number(tag(s, 'letterboxd:filmYear')) || null,
      date: tag(s, 'letterboxd:watchedDate'),
      rewatch: tag(s, 'letterboxd:rewatch') === 'Yes',
      rating: rating ? Math.round(Number(rating) * 2) : null,
      liked: tag(s, 'letterboxd:memberLike') === 'Yes',
      tmdbId: Number(tag(s, 'tmdb:movieId')) || null,
      poster,
      review: g[1] === 'review' && text ? text : null,
      spoiler,
    });
  }
  return items;
}

const decodeEntities = s => (s == null ? s : decode(s));

export const urls = {
  films: (user, page = 1) => `${BASE}/${user}/films/${page > 1 ? `page/${page}/` : ''}`,
  diary: (user, page = 1) => `${BASE}/${user}/films/diary/${page > 1 ? `page/${page}/` : ''}`,
  watchlist: (user, page = 1) => `${BASE}/${user}/watchlist/${page > 1 ? `page/${page}/` : ''}`,
  rss: user => `${BASE}/${user}/rss/`,
  profile: user => `${BASE}/${user}/`,
  film: slug => `${BASE}/film/${slug}/`,
  filmPage: slug => `${BASE}/film/${slug}/`,
};
