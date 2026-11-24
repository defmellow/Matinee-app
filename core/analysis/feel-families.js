// The feel palette: five colours, which feelings belong to each, and how a film's feelings blend into one colour. Pure (the UI imports it too).
// Lives outside core/analysis/feel/ on purpose: the saved feel index is stamped by a hash of that folder, and a palette change must not throw it away. Map layouts are saved with their node colours, so after a palette change bump "map vN" in core/api.js.

/** The five feeling colours (matte: red, yellow, green, blue, purple) and their word lists, from the design. One source for the Map, the film page and the rest of the app. A film's colour blends them in Lab.
 * 20 Nov (check that plain dramas fit the key): blue holds serious, moving and thoughtful films, not only sad ones; "epic" and "immersive"
 * are about scale and craft, not a feeling, so they colour nothing; "intense" and "raw" are tense, not thrilling; thoughtful is not strange. */
export const FAMILIES = {
  red: { c: '#ec9481', w: 'tense eerie foreboding anxious angry bleak claustrophobic oppressive gloomy uneasy dark cold terrifying disturbing brutal shocking unsettling chilling harrowing gritty shadowy unflinching cynical relentless intense raw provocative' },
  yellow: { c: '#e9c77f', w: 'heartwarming joyful hopeful euphoric carefree cosy charming hilarious uplifting life-affirming silly whimsical playful quirky dry-wit satirical absurd irreverent camp bawdy deadpan colourful sentimental darkly-comic ironic biting mocking' },
  green: { c: '#95d0a2', w: 'thrilling breakneck frenetic chaotic stylish restless tightly-paced' },
  blue: { c: '#94b6e2', w: 'sad lonely melancholic gentle tender nostalgic yearning despairing bittersweet serene moving devastating profound haunting cathartic gut-punching understated earnest intimate nuanced poetic meditative slow-paced true-to-life romantic sensual thought-provoking intellectual melodramatic' },
  purple: { c: '#bea6e8', w: 'weird wondrous mysterious surreal dreamlike hypnotic mind-bending painterly' },
};
export const NEUTRAL = '#b8aaa0';
/** How the app names each colour and what it stands for (the Map's key and the colour tips use these exact words), in palette order. */
export const FAMILY_WORDS = { red: ['Red', 'tense or dark'], yellow: ['Yellow', 'warm or funny'], green: ['Green', 'thrilling or fast'], blue: ['Blue', 'moving, thoughtful or sad'], purple: ['Purple', 'strange or dreamlike'] };
const FAMILY_OF = new Map();
for (const [f, v] of Object.entries(FAMILIES)) for (const w of v.w.split(' ')) FAMILY_OF.set(w, f);
export const slug = s => String(s || '').toLowerCase().trim().replace(/\s+/g, '-');

/** The family id (red, yellow, green, blue, purple) a feeling label or id belongs to, or null. */
export const familyOf = word => FAMILY_OF.get(slug(word)) || null;

/** Feeling words that colour only the WORD where it is written (the film page headline, the Map's lists), never a film's own colour:
 * 22 Nov: every feeling word gets a colour ("epic isn't given a colour, it all should"). Craft, pace and scale words
 * say little about how a film feels on their own, so letting them into familyWeights would move the whole-film colours the user finds
 * accurate (20 Nov: Epic and Immersive in green coloured 107 films green). */
export const WORD_ONLY = {
  red: 'moody',
  yellow: 'lush sun-drenched rewatchable',
  green: 'epic propulsive neon-lit polished fluidly-shot',
  blue: 'solemn slow-burn languid unhurried glacial measured drags episodic minimalist dialogue-driven rain-soaked superbly-acted',
  purple: 'atmospheric immersive visually-striking sound-led',
};
const WORD_FAMILY = new Map();
for (const [f, w] of Object.entries(WORD_ONLY)) for (const x of w.split(' ')) WORD_FAMILY.set(x, f);
/** The colour a feeling word is written in: its family, or its WORD_ONLY colour. Every feeling word has one. */
export const wordFamilyOf = word => familyOf(word) || WORD_FAMILY.get(slug(word)) || null;

/**
 * A sentence split into plain text and feeling words: [{ text, fam }] (fam null for plain text). At each word the longest feeling
 * of up to three words wins ("visually striking", "true to life"). Stops at the theme (", about …", or the older "with a sense of" / " — about"): themes stay plain.
 */
export function feelWordParts(text) {
  if (typeof text !== 'string' || !text) return [];
  const cut = text.search(/, about | with a sense of | — about /);
  const head = cut < 0 ? text : text.slice(0, cut), tail = cut < 0 ? '' : text.slice(cut);
  const parts = head.split(/([A-Za-z][A-Za-z-]*)/); // odd indexes are words, even ones the gaps
  const out = [];
  let plain = '';
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { plain += parts[i]; continue; }
    let hit = null;
    for (let n = 3; n >= 1 && !hit; n--) {
      const end = i + 2 * (n - 1);
      if (end >= parts.length) continue;
      if (parts.slice(i + 1, end).some((g, j) => j % 2 === 0 && g !== ' ')) continue; // words joined by single spaces only
      const phrase = parts.slice(i, end + 1).join('');
      const fam = wordFamilyOf(phrase);
      if (fam) hit = { fam, phrase, end };
    }
    if (!hit) { plain += parts[i]; continue; }
    if (plain) out.push({ text: plain, fam: null });
    plain = '';
    out.push({ text: hit.phrase, fam: hit.fam });
    i = hit.end;
  }
  plain += tail;
  if (plain) out.push({ text: plain, fam: null });
  return out;
}

const toLin = c => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToLab(h) {
  const [r, g, b] = [1, 3, 5].map(i => toLin(parseInt(h.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToHex([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186168 * m + 1.707614701 * s];
  return '#' + rgb.map(c => Math.round(Math.max(0, Math.min(255, toSrgb(Math.max(0, c))))).toString(16).padStart(2, '0')).join('');
}
const FAMILY_LAB = Object.fromEntries(Object.entries(FAMILIES).map(([k, v]) => [k, hexToLab(v.c)]));
const NEUTRAL_LAB = hexToLab(NEUTRAL);

/** How much of each feeling family a film has, from its descriptors [{ id, label, facet, score, fragile }]. */
export function familyWeights(descriptors = []) {
  const w = { red: 0, yellow: 0, green: 0, blue: 0, purple: 0 };
  for (const d of descriptors) {
    if (!d || d.fragile || d.facet === 'theme' || !(d.score >= 0.15)) continue;
    const f = familyOf(d.label) || familyOf(d.id);
    if (f) w[f] += d.score;
  }
  return w;
}

/**
 * A film torn between two feelings (22 Nov): its second family is at least `ratio` of its first. Blending such a pair
 * often lands on a third colour (blue + yellow reads green, red + green reads yellow: 51 of 150 such films on a real library),
 * so these films show both colours instead. Returns [first, second] family ids, or null.
 */
export function tornPair(w, ratio = 0.7) {
  const s = Object.entries(w || {}).sort((a, b) => b[1] - a[1]);
  if (s.length < 2 || !(s[0][1] >= 0.15) || s[1][1] < ratio * s[0][1]) return null;
  return [s[0][0], s[1][0]];
}

/** Blend family weights into one matte colour (hex). No weight at all gives the warm neutral. */
export function blendColour(w) {
  const tot = Object.values(w).reduce((a, b) => a + b, 0);
  if (tot < 0.05) return NEUTRAL;
  let L = 0, A = 0, B = 0, Z = 0;
  for (const f in w) { const q = (w[f] / tot) ** 2.2; Z += q; L += FAMILY_LAB[f][0] * q; A += FAMILY_LAB[f][1] * q; B += FAMILY_LAB[f][2] * q; }
  return labToHex([L / Z, A / Z, B / Z]);
}
