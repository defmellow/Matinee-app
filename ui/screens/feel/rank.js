// Text matching for the film picker: accent- and case-folded. Match quality: 3 = starts with the query, 2 = a word starts with it, 1 = appears inside, 0 = no match.

export const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function tokenScore(token, text) {
  const i = text.indexOf(token);
  if (i < 0) return 0;
  if (i === 0) return 3;
  // a word starts here (after a space or punctuation)
  for (let at = i; at >= 0; at = text.indexOf(token, at + 1)) {
    if (at === 0 || /[^a-z0-9]/.test(text[at - 1])) return 2;
    if (at + 1 >= text.length) break;
  }
  return 1;
}

/** Score a folded query against folded text. Every word of the query has to match; the weakest word sets the score. */
export function matchScore(query, text) {
  if (!query) return 0;
  const whole = tokenScore(query, text);
  if (whole) return whole;
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length < 2) return 0;
  let worst = 3;
  for (const w of words) { const s = tokenScore(w, text); if (!s) return 0; worst = Math.min(worst, s); }
  return worst;
}

/** Best score across several folded strings (title, original title, ...). */
export const bestScore = (query, texts) => texts.reduce((m, t) => (t ? Math.max(m, matchScore(query, t)) : m), 0);

const ROLE_LABELS = { director: 'Director', cast: 'Actor', writer: 'Writer', cinematographer: 'Cinematographer', composer: 'Composer', editor: 'Editor', producer: 'Producer' };
const roleLabel = r => ROLE_LABELS[r] || (r ? r[0].toUpperCase() + r.slice(1) : 'Person');
const ROLE_PRIORITY = ['director', 'writer', 'cinematographer', 'composer', 'editor', 'cast', 'producer'];
