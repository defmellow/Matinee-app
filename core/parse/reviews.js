// Pure parsers for the review cards on Metacritic's critic-reviews and user-reviews pages. Each card carries a score
// badge (title="Metascore 100 out of 100" / title="User score 7 out of 10"), the reviewer's name (never read here) and
// the quote in data-testid="review-quote-text". Only the quote and the score are kept: no names, no handles.
import { decodeEntities } from './critics.js';

const MAX_TEXT = 320;
const MAX_ITEMS = 10;

const STOPWORDS = new Set(['the', 'and', 'of', 'to', 'is', 'it', 'that', 'was', 'this', 'with', 'for', 'but', 'are', 'not', 'his', 'her', 'its', 'film', 'movie', 'you', 'have']);

/** Trim, collapse whitespace and cut at a word boundary with "…" when longer than `max`. */
export function clip(text, max = MAX_TEXT) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.5) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/** Cheap check that a text is English: mostly ASCII letters, and (for longer texts) a couple of common English words. */
export function isMostlyEnglish(text) {
  const t = String(text ?? '');
  const letters = t.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const ascii = letters.filter(c => /[A-Za-z]/.test(c)).length;
  if (ascii / letters.length < 0.85) return false;
  if (t.length <= 60) return true;
  const seen = new Set();
  for (const w of t.toLowerCase().match(/[a-z']+/g) || []) if (STOPWORDS.has(w)) seen.add(w);
  return seen.size >= 2;
}

const plain = html => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseCards(html, scoreRe, max) {
  if (typeof html !== 'string' || !html) return [];
  const out = [], seen = new Set();
  for (const chunk of html.split(/data-testid="review-card"/).slice(1)) {
    const card = chunk.split(/<\/article>|<\/section>|<footer\b/i)[0]; // keep the last card from running on into the page footer
    const quote = /data-testid="review-quote-text"[^>]*>([\s\S]*?)<\/div>/.exec(card);
    if (!quote) continue;
    const raw = plain(quote[1]);
    if (!raw || !isMostlyEnglish(raw)) continue;
    const text = clip(raw, MAX_TEXT);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const s = scoreRe.exec(card);
    const score = s ? Number(s[1]) : null;
    out.push(score != null && Number.isFinite(score) && score <= max ? { text, score } : { text });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** @returns {{ text: string, score?: number }[]} critic quotes, score 0–100 */
export const parseMcCritics = html => parseCards(html, /title="Metascore (\d+(?:\.\d+)?) out of 100"/, 100);

/** @returns {{ text: string, score?: number }[]} user reviews, score 0–10 */
export const parseMcUsers = html => parseCards(html, /title="User score (\d+(?:\.\d+)?) out of 10"/, 10);
