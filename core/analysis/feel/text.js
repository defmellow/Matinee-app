// Tiny text toolkit for the feel engine: tokenizer, stemmer, stopwords, n-grams. Pure and deterministic.

export const STOPWORDS = new Set((
  'a about above after again against all am an and any are as at be because been before being below between both but by ' +
  'can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its ' +
  'just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them ' +
  'then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your ' +
  'film films movie movies one also even still really much many get gets got make makes made like likes ' +
  'plot story character characters scene scenes director directed cast ' +
  'yet however although though whilst per via'
).split(/\s+/));

// Negation, read on raw words (apostrophes are dropped from contractions: "isn't" is "isnt"). A negator within two words before a feeling word
// turns it off ("not scary", "hardly chaotic", "non-confrontational"), unless the clause turns round ("not only scary") or carries on ("not just tense").
export const NEGATORS = new Set(('not no never nor neither without hardly barely scarcely lacks lacking lack lacked avoids avoided avoiding avoid non ' +
  'isnt wasnt arent werent dont doesnt didnt cant cannot couldnt wont wouldnt shouldnt hasnt havent hadnt aint').split(' '));
export const NEGATION_EXCEPT = new Set('only just merely simply solely least doubt wonder less one matter once ending stop'.split(' '));
export const CONTRAST = new Set('but yet however although though while whereas except'.split(' '));

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** Lowercase words, keeping internal apostrophes and hyphens; tokens containing digits are dropped. */
export function tokenize(text) {
  return tokenizeWithPos(text).map(t => t.raw);
}

/** [{ raw, start }] */
export function tokenizeWithPos(text) {
  const out = [];
  if (!text) return out;
  const s = String(text).toLowerCase();
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(s))) {
    if (/\d/.test(m[0])) continue;
    out.push({ raw: m[0].replace(/’/g, "'"), start: m.index });
  }
  return out;
}

const cache = new Map();

/** Small suffix stripper. Deterministic; both lexicon and text go through it, so it only needs to be consistent. */
export function stem(word) {
  let w = String(word).toLowerCase();
  const hit = cache.get(w);
  if (hit !== undefined) return hit;
  const orig = w;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  const suffixes = ['ness', 'ing', 'ed', 'ly', 'est'];
  for (const suf of suffixes) {
    const minLeft = 3;
    if (w.endsWith(suf) && w.length - suf.length >= minLeft && !(suf === 'ly' && /er$/.test(w.slice(0, -2)))) {
      w = w.slice(0, -suf.length);
      if (/([^aeiou])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('y')) w = w.slice(0, -1) + 'i';
  if (cache.size < 200000) cache.set(orig, w);
  return w;
}

/** Stems for matching: hyphens split, apostrophes dropped (possessive 's removed). [{ stem, raw, start }] */
export function matchStems(text) {
  const out = [];
  for (const t of tokenizeWithPos(text)) {
    const cleaned = t.raw.replace(/'s$/, '').replace(/'/g, '');
    for (const part of cleaned.split('-')) if (part) out.push({ stem: stem(part), raw: part, start: t.start });
  }
  return out;
}

/** Stems of a phrase, for lexicon patterns. */
export function stemPhrase(phrase) {
  return matchStems(phrase).map(t => t.stem);
}

/** Content stems for the latent layer: no stopwords, length >= 3. */
export function contentStems(text) {
  const out = [];
  for (const t of tokenizeWithPos(text)) {
    const cleaned = t.raw.replace(/'s$/, '').replace(/'/g, '');
    for (const part of cleaned.split('-')) {
      if (part.length < 3 || STOPWORDS.has(part)) continue;
      out.push(stem(part));
    }
  }
  return out;
}

export function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

export function slug(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

const PROPER = [[/\bworld war (i{1,2})\b/gi, (m, n) => `World War ${n.toUpperCase()}`], [/\bunited (states|kingdom)\b/gi, (m, n) => `United ${n[0].toUpperCase()}${n.slice(1)}`],
  [/\bnew york\b/gi, () => 'New York'], [/\bai\b/gi, () => 'AI'], [/\bnazism\b/gi, () => 'Nazism']];

/**
 * Lowercase a label for use mid-sentence, but keep proper nouns: "Disability in the United States" ->
 * "disability in the United States"; "Vietnam War" stays as it is (a capital word follows the first).
 */
export function softLower(label) {
  const s = String(label);
  const words = s.split(' ');
  let out;
  if (words.length === 1) out = s.toLowerCase();
  else if (/^\p{Lu}/u.test(words[1]) && /^\p{Lu}/u.test(words[0])) out = s;
  else out = words[0].toLowerCase() + ' ' + words.slice(1).join(' ');
  for (const [re, fn] of PROPER) out = out.replace(re, fn);
  return out;
}
