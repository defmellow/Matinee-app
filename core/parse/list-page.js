// A Letterboxd list page (/<user>/list/<slug>/ and /page/N/): the same poster grid as the watchlist, plus the list's name, owner,
// description and (on the /detail/ view) the note under each film. NOTE: the heading/owner/description selectors are best guesses
// from how Letterboxd lays list pages out (og:title/og:description meta, h1 title, .attribution owner); the fixtures are synthetic.
// Everything falls back, so a changed layout loses the extras (owner, notes), never the films.
import { parseHTML } from 'linkedom';
import { parsePosterGrid, isChallenge, isNotFound } from './letterboxd.js';

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const meta = (d, name) => {
  const el = d.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
  return el ? clean(el.getAttribute('content')) : '';
};

/**
 * @param {string} html
 * @param {{ url?: string }} [o] the page's address (its owner is the first part of the path)
 * @returns {{ ok: boolean, challenge?: boolean, notFound?: boolean, private?: boolean,
 *   name: string, owner: string, ownerName: string, description: string,
 *   items: { slug: string, title: string, year: number|null, filmId: number|null, note: string }[], hasNext: boolean, total: number|null }}
 */
export function parseListPage(html, { url = '' } = {}) {
  const text = String(html || '');
  const none = { name: '', owner: '', ownerName: '', description: '', items: [], hasNext: false, total: null };
  if (isChallenge(text) || /<title[^>]*>\s*(?:Attention Required|Access denied)/i.test(text)) return { ok: false, challenge: true, ...none };
  if (isNotFound(text)) return { ok: false, notFound: true, ...none };
  const d = parseHTML(text).document;
  const grid = parsePosterGrid(text);

  // Notes live beside each film on the detail view: <li class="film-detail"> … <div class="body-text">…</div>.
  const notes = new Map();
  for (const li of d.querySelectorAll('li.film-detail, li.posteritem, li.griditem')) {
    const comp = li.querySelector('.react-component[data-item-slug]');
    const body = li.querySelector('.film-detail-content .body-text, .body-text');
    if (comp && body) { const n = clean(body.textContent); if (n) notes.set(comp.getAttribute('data-item-slug'), n); }
  }
  const items = grid.items.filter(i => i.slug).map(i => ({ slug: i.slug, title: i.title, year: i.year ?? null, filmId: i.lbId ?? null, note: notes.get(i.slug) || '' }));

  // The first <h1> on a real page is the site logo, so the list title is looked for by class first, then og:title (verified live 10 Nov 2026).
  const h1 = d.querySelector('h1.title-1') || d.querySelector('h1.headline-1');
  const name = clean(h1 ? h1.textContent : '') || meta(d, 'og:title').replace(/\s*[•|]\s*(?:A list by|Letterboxd).*$/i, '');
  const ownerFromUrl = (/letterboxd\.com\/([^/]+)\/list\//i.exec(url) || [])[1] || '';
  const ownerEl = d.querySelector('.attribution .displayname, a.attribution .name, .list-title-intro .displayname, [itemprop="author"]');
  const ownerAttr = (d.querySelector('[data-owner]') || { getAttribute: () => '' }).getAttribute('data-owner') || ''; // real pages carry data-owner="<username>"
  const ownerName = clean(ownerEl ? ownerEl.textContent : '');
  const descEl = d.querySelector('.list-title-intro .body-text, .body-text.-prose, div[itemprop="description"], .list-description');
  const description = clean(descEl ? descEl.textContent : '');
  const priv = !items.length && /this list is private|list is not public/i.test(text);
  // A page that is not a list (an error page, a changed layout) is not trusted; an empty list still has the grid markup.
  const ok = !priv && (items.length > 0 || /class="[^"]*\bposter-list\b|data-num-entries/.test(text));
  return { ok, private: priv || undefined, name, owner: ownerFromUrl || ownerAttr || ownerName, ownerName: ownerName || ownerFromUrl || ownerAttr, description, items, hasNext: ok && grid.hasNext, total: grid.total };
}
