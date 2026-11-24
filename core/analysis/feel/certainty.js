// How sure Matinee is about what it says a film feels like. Pure.
// Three things make a read trustworthy: enough written about the film, more than one kind of voice (viewers, critics,
// articles), and those voices agreeing on the feelings shown. The score is their product, so a film is only "sure" with all three.
// It is a statement about the evidence, never about the film: a great film nobody has written about reads as a rough guess.

/** Every tunable number, in one place. */
export const CERTAINTY = {
  words: 700,                  // text part = 1 - exp(-own words / words): 250 words 0.30, 800 0.68, 1800 0.92
  voices: [0, 0.6, 0.85, 1],   // by how many of viewers / critics / articles have written text
  agreeFloor: 0.7,             // the share of the score that does not depend on voices agreeing
  levels: { high: 0.6, medium: 0.33 },
};
export const CERTAINTY_LABEL = { high: 'Very sure', medium: 'Fairly sure', low: 'Rough guess', none: 'Too little to say' };
const FEELING = new Set(['mood', 'tone', 'pace', 'craft', 'impact']);

/**
 * @param words { viewers, critics, articles, total } own words by voice (extract.js ownWords)
 * @param chips the film's chips (profile.descriptors)
 * @param counts { viewers, critics } how many texts of each
 * @returns { level: 'high'|'medium'|'low'|'none', label, score 0..1, words, voices, agreed, feelings, reasons: [plain sentences] }
 */
export function certaintyOf(words, chips = [], counts = {}) {
  const voices = ['viewers', 'critics', 'articles'].filter(v => (words[v] || 0) > 0);
  const feelings = chips.filter(d => FEELING.has(d.facet) && !d.fragile); // one-mention chips are not findings
  const agreed = feelings.filter(d => (d.voices || []).length >= 2).length;
  const text = 1 - Math.exp(-(words.total || 0) / CERTAINTY.words);
  const agree = feelings.length ? agreed / feelings.length : 0;
  const score = text * CERTAINTY.voices[voices.length] * (CERTAINTY.agreeFloor + (1 - CERTAINTY.agreeFloor) * agree);
  // Only one-mention (fragile) feelings to show is a rough guess, not nothing.
  const anyFeeling = chips.some(d => FEELING.has(d.facet));
  const level = !words.total || !anyFeeling ? 'none' : !feelings.length ? 'low' : score >= CERTAINTY.levels.high ? 'high' : score >= CERTAINTY.levels.medium ? 'medium' : 'low';
  const n = (k, one, many) => (k === 1 ? `1 ${one}` : `${k} ${many}`);
  const reasons = [];
  const from = [];
  if (counts.viewers) from.push(n(counts.viewers, 'viewer review', 'viewer reviews'));
  if (counts.critics) from.push(n(counts.critics, 'critic quote', 'critic quotes'));
  if (words.articles) from.push('article text');
  reasons.push(from.length ? `Read from ${from.join(', ')} (about ${Math.round((words.total || 0) / 50) * 50} words)` : 'Nothing has been written about this film that Matinee could read');
  if (!feelings.length && anyFeeling) reasons.push('Every feeling found rests on a single mention');
  if (feelings.length) reasons.push(agreed === feelings.length ? 'Every feeling shown is said by more than one kind of source' : `${agreed} of ${feelings.length} feelings shown are said by more than one kind of source`);
  if (level === 'low' || level === 'medium') reasons.push(voices.length < 2 ? 'Only one kind of source so far' : (words.total || 0) < 800 ? 'Not much written yet' : 'The sources mostly say different things');
  return { level, label: CERTAINTY_LABEL[level], score: Math.round(score * 1000) / 1000, words: words.total || 0, voices, agreed, feelings: feelings.length, reasons };
}
