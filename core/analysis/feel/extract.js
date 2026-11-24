// Turns a FeelInput into descriptors (via the lexicon), themes and settings. Pure and deterministic.
import { matchStems, stemPhrase, slug, stem, NEGATORS, NEGATION_EXCEPT, CONTRAST } from './text.js';
import { LEXICON, STOP_PHRASES, GUARDS, KIN } from './lexicon.js';

export const VOICE_WEIGHT = { viewers: 1, critics: 0.8, editors: 0.5 };
const VOICE_RANK = { viewers: 3, critics: 2, editors: 1 };
export const EDITOR_NON_THEME = 0.25;
const SAT_RATE = 0.45;
const SCORE_CAP = 0.97;
const SINGLE_MENTION_THEME = 0.5;
const TAG_SOURCES = new Set(['wikicats', 'keywords', 'subjects']);
const MIN_SCORE = 0.06;

/**
 * Letterboxd's shared theme word lists ("supernatural chilling eerie terrifying dread") are the same for every film with that
 * theme, so they say which feelings to look for, not that the film has them. For feelings (not themes):
 *   - a feeling the film's own texts also support gets a small boost from the lists;
 *   - a feeling found ONLY in the lists keeps a score that depends on how much own text the film has. Absence from a few
 *     short reviews means little, so a thin film keeps list-only feelings (lighter); a film with plenty of own text
 *     (`thinWords` to `plentyWords` of review, critic and article words, fading in between) drops them under the chip floor;
 *   - all lists together count at most `cap` times per feeling, however many lists repeat the word;
 *   - a feeling whose whole own support is ONE mention in ONE text and no list names it, on a film with plenty of own text, is capped under the chip floor.
 * The plenty-end factor times `cap` must stay under CHIP_FLOOR.min (0.1): x < 0.24.
 */
export const LIST_SUPPORT = {
  sources: new Set(['lbpage.themes']),
  boost: 0.6,   // confirmed feeling: x = own x + boost * min(list x, cap)
  cap: 1.5,     // the most list evidence one feeling can carry (one list is about 1)
  // List-only feeling: x = factor * min(list x, cap). Thin film (little own text) to plenty-of-text film.
  thin: { oneList: 0.4, agreed: 0.6 },  // agreed = two or more different lists name it
  plenty: 0.15,                          // just above the scoring minimum, under the chip floor
  thinWords: 250,   // own words at or below this: thin (about the median of the 84 devdata films that have review text)
  plentyWords: 800, // own words at or above this: plenty (about the top quarter)
  singleMentionCap: 0.2, // x ceiling for one mention in one text, plenty-of-text films only (score about 0.09)
  kinMentionCap: 0.4,    // the same, when another word of its family (lexicon FAMILIES) is also in the film's texts (score about 0.16)
};
const OWN_VOICE_SOURCE = /^wikipedia\.(reception|themes)$/;

/**
 * A feeling's score adds up mentions, so a film with 15 reviews could never score like a film with 45 even when the same share
 * of its reviewers say the same thing (the library: a median of 3 feeling chips at 10-20 reviews, 9 at 46 or more).
 * A feeling said in at least `minTexts` different reviews of a film with fewer reviews than `ref` is scaled up towards what that
 * share of reviewers would give at `ref` reviews: factor = (ref + k) / (reviews + k), at most `max`. `k` keeps a handful of
 * reviews from being trusted like a crowd. One mention is never scaled: one review is an opinion, two start to be a pattern.
 */
export const THIN_SHARE = { ref: 37, k: 12, max: 2.5, minTexts: 2 }; // ref = the median film on a real library (37 reviews)
/** How many viewer reviews and critic quotes a film has (lists, tags and article text are not reviewers). */
export function reviewCount(preps) {
  let n = 0;
  for (const p of preps) if ((p.voice === 'viewers' || p.voice === 'critics') && !LIST_SUPPORT.sources.has(p.source) && !TAG_SOURCES.has(p.source) && !/^(allmovie|wikipedia)\./.test(p.source || '')) n++;
  return n;
}
export const thinFactor = n => (n > 0 && n < THIN_SHARE.ref ? Math.min(THIN_SHARE.max, (THIN_SHARE.ref + THIN_SHARE.k) / (n + THIN_SHARE.k)) : 1);

/** Words of the film's own interpretive text by voice: { viewers, critics, articles, total } (Letterboxd's lists and tags are not counted). */
export function ownWords(preps) {
  const w = { viewers: 0, critics: 0, articles: 0, total: 0 };
  for (const p of preps) {
    if (LIST_SUPPORT.sources.has(p.source) || TAG_SOURCES.has(p.source)) continue;
    if (p.voice === 'editors' && !OWN_VOICE_SOURCE.test(p.source)) continue;
    const n = p.stems.length;
    w[p.voice === 'viewers' ? 'viewers' : p.voice === 'critics' ? 'critics' : 'articles'] += n;
    w.total += n;
  }
  return w;
}

/** 0 for a thin film up to 1 for a film with plenty of its own interpretive text (reviews, critics, article reception/themes). */
export function ownTextShare(preps) {
  const words = ownWords(preps).total;
  const { thinWords: lo, plentyWords: hi } = LIST_SUPPORT;
  return Math.max(0, Math.min(1, (words - lo) / (hi - lo)));
}

const voiceWeight = (voice, facet) => (voice === 'editors' && facet !== 'theme' ? EDITOR_NON_THEME : (VOICE_WEIGHT[voice] ?? 0.5));

function isAmbiguous(word, stemmed) {
  const w = word.toLowerCase();
  return stemmed.length <= 3 || (stemmed !== w && (stemmed.length <= 4 || /ly$/.test(w)));
}

/** Compile a lexicon into a first-stem lookup of patterns. */
export function buildMatcher(lexicon, stops = STOP_PHRASES, guards = lexicon === LEXICON ? GUARDS : {}) {
  const byId = new Map();
  const starts = new Map(); // first stem -> [{ stems, ids: [], len }]
  const add = (stems, id, word = null, forceExact = false) => {
    if (!stems.length) return;
    const list = starts.get(stems[0]) || [];
    const sig = stems.join(' ');
    let p = list.find(x => x.sig === sig);
    if (!p) { p = { stems, sig, ids: [], len: stems.length, exact: new Set(), listed: new Set(), loose: false }; list.push(p); }
    if (id != null && !p.ids.includes(id)) p.ids.push(id);
    if (word) p.listed.add(word);
    // A word whose stem is short or an adverb stem ("madness" -> "mad", "biting" -> "bit", "beautifully" -> "beautiful")
    // would also match unrelated everyday words. Those entries match their exact spelling only.
    if (word && stems.length === 1 && (forceExact || isAmbiguous(word, stems[0]))) p.exact.add(word);
    else p.loose = true;
    starts.set(stems[0], list);
  };
  for (const d of lexicon) {
    byId.set(d.id, d);
    for (const w of d.words || []) add(stemPhrase(w), d.id, w);
    for (const w of d.exactWords || []) add(stemPhrase(w), d.id, w, true);
    for (const w of d.phrases || []) add(stemPhrase(w), d.id);
  }
  // Stop phrases: patterns with no descriptor, so a match is consumed and nothing counts.
  for (const w of stops || []) add(stemPhrase(w), null);
  for (const list of starts.values()) list.sort((a, b) => b.len - a.len || (a.sig < b.sig ? -1 : 1));
  // Context guards: a listed spelling that only counts when the words around it make sense.
  const guardMap = new Map();
  for (const [key, g] of Object.entries(guards || {})) guardMap.set(key, { prev: new Set(g.prev || []), next: new Set(g.next || []) });
  return { byId, starts, guards: guardMap };
}

/** Which stems of a text belong to the film's own title (a full or partial run of two or more title words; a one-word title everywhere). */
function titleMask(stems, title) {
  const t = stemPhrase(title);
  if (!t.length) return undefined;
  const runs = new Set();
  if (t.length === 1) runs.add(t[0]);
  else for (let a = 0; a < t.length; a++) for (let b = a + 2; b <= t.length; b++) runs.add(t.slice(a, b).join(' '));
  const mask = new Set();
  const lens = new Set([...runs].map(r => r.split(' ').length));
  for (let i = 0; i < stems.length; i++) {
    for (const n of lens) {
      if (i + n > stems.length) continue;
      if (runs.has(stems.slice(i, i + n).map(x => x.stem).join(' '))) for (let k = i; k < i + n; k++) mask.add(k);
    }
  }
  return mask.size ? mask : undefined;
}

/** Prepare one text once: stems with positions. A `title` masks the film's own title words; `names` (lowercase words of cast and crew names) mask capitalised surnames. */
export function prepareText(t) {
  const stems = matchStems(t.text);
  const prep = { ...t, stems };
  if (t.title) prep.masked = titleMask(stems, t.title);
  if (t.names && t.names.length) prep.nameSet = new Set(t.names);
  return prep;
}

const PUNCT = /[.,;:!?()"“”‘’—–…*\[\]]/;

/** Whether the match at stems[i, end) must not count (null = counts for everything, true = counts for nothing, 'feel' = counts for themes only). */
function blockedBy(prep, matcher, hit, i, end) {
  const s = prep.stems;
  const text = typeof prep.text === 'string' ? prep.text : null;
  if (prep.masked) for (let k = i; k < end; k++) if (prep.masked.has(k)) return true;
  if (prep.nameSet && text && end - i === 1 && prep.nameSet.has(s[i].raw)) {
    const ch = text[s[i].start];
    if (ch && ch !== ch.toLowerCase()) return true;
  }
  if (!text) return null;
  const gap = (a, b) => PUNCT.test(text.slice(s[a].start, s[b].start));
  // An adverb ("bluntly", "gradually", "intellectually") describes how something happens, not the film, unless the lexicon lists that exact spelling.
  if (end - i === 1 && /ly$/.test(s[i].raw) && !hit.listed.has(s[i].raw)) return 'feel';
  const g = matcher.guards.get(s.slice(i, end).map(x => x.raw).join(' '));
  if (g) {
    const prev = i > 0 && !gap(i - 1, i) ? s[i - 1].raw : null;
    const next = end < s.length && !gap(end - 1, end) ? s[end].raw : null;
    if ((prev && g.prev.has(prev)) || (next && g.next.has(next))) return 'feel';
  }
  // Negation within two words before the match, inside the same clause ("not scary", "isn't very tense", "without any sentimentality").
  for (let d = 1; d <= 2 && i - d >= 0; d++) {
    const j = i - d;
    if (gap(j, j + 1)) break;
    const w = s[j].raw;
    if (CONTRAST.has(w)) break;
    if (NEGATORS.has(w)) {
      let affirmative = false;
      for (let k = j + 1; k < i; k++) if (NEGATION_EXCEPT.has(s[k].raw)) affirmative = true;
      if (!affirmative) return 'feel';
      break;
    }
  }
  return null;
}

/** Every counted match in a prepared text: [{ ids, pos, word, at }] (`at` = first stem index). */
export function scanHits(prep, matcher) {
  const out = [];
  const s = prep.stems;
  for (let i = 0; i < s.length;) {
    const cands = matcher.starts.get(s[i].stem);
    let hit = null;
    if (cands) {
      for (const p of cands) {
        if (i + p.len > s.length) continue;
        let ok = true;
        for (let k = 1; k < p.len; k++) if (s[i + k].stem !== p.stems[k]) { ok = false; break; }
        if (ok && p.len === 1 && !p.loose && !p.exact.has(s[i].raw)) ok = false;
        if (ok) { hit = p; break; }
      }
    }
    if (!hit) { i++; continue; }
    const end = i + hit.len;
    if (hit.ids.length) {
      const why = blockedBy(prep, matcher, hit, i, end);
      // A blocked feeling word still lets a theme through: "such a shame" is handled by stop phrases, but "not about war" is not a feeling.
      const ids = why === true ? [] : why === 'feel' ? hit.ids.filter(id => matcher.byId.get(id)?.facet === 'theme') : hit.ids;
      if (ids.length) out.push({ ids, pos: s[i].start, word: s.slice(i, end).map(x => x.raw).join(' '), at: i });
    }
    i = end;
  }
  return out;
}

/** Count lexicon matches in a prepared text. Returns Map id -> { count, pos } */
export function scanText(prep, matcher) {
  const out = new Map();
  for (const h of scanHits(prep, matcher)) {
    for (const id of h.ids) {
      const e = out.get(id);
      if (e) e.count++; else out.set(id, { count: 1, pos: h.pos });
    }
  }
  return out;
}

export function excerpt(text, pos, max = 100) {
  const t = String(text);
  if (t.length <= max) return t.trim();
  let a = Math.max(0, pos - 35);
  let b = Math.min(t.length, a + max - 2);
  if (a > 0) { const sp = t.indexOf(' ', a); if (sp !== -1 && sp < pos) a = sp + 1; }
  if (b < t.length) { const sp = t.lastIndexOf(' ', b); if (sp > pos) b = sp; }
  let s = t.slice(a, b).trim();
  if (a > 0) s = '…' + s;
  if (b < t.length) s += '…';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** The texts of one film as an ordered list of {voice, source, text}, including keywords/categories/subjects as short editor texts. */
export function allTexts(input) {
  const texts = [];
  // The film's title and the words of its people's names ride along so a title ("Fury Road") or a surname ("Lean") is never read as a feeling.
  const title = input.title || '';
  const names = [...new Set(Object.values(input.people || {}).flat().flatMap(p => matchStems(p && p.name).map(x => x.raw)).filter(w => w.length >= 3))];
  for (const t of input.texts || []) if (t && t.text) texts.push({ voice: t.voice, source: t.source || 'text', text: t.text, title, names });
  for (const [src, list] of [['wikicats', input.categories], ['keywords', input.keywords], ['subjects', input.subjects]]) {
    for (const s of list || []) if (s) texts.push({ voice: 'editors', source: src, text: String(s), title, names });
  }
  return texts;
}

/**
 * Score descriptors for a set of prepared texts.
 * Returns [{ id, label, facet, score, voices, evidence?, raw }] strongest first (all above MIN_SCORE).
 */
export function scoreDescriptors(preps, matcher) {
  const acc = new Map();
  const share = ownTextShare(preps);
  const lift = thinFactor(reviewCount(preps));
  for (const prep of preps) {
    const found = scanText(prep, matcher);
    if (!found.size) continue;
    const norm = Math.sqrt(Math.max(prep.stems.length, 25) / 25);
    for (const [id, { count, pos }] of found) {
      const d = matcher.byId.get(id);
      const w = (d.weight ?? 1) * voiceWeight(prep.voice, d.facet);
      const x = w * (1 + Math.log(count)) / norm;
      let a = acc.get(id);
      if (!a) { a = { x: 0, listX: 0, lists: 0, ownTexts: 0, ownHits: 0, texts: 0, tagged: false, voices: new Set(), evRank: -1, evidence: undefined }; acc.set(id, a); }
      if (LIST_SUPPORT.sources.has(prep.source)) { a.listX += x; a.lists++; } else { a.x += x; a.ownTexts++; a.ownHits += count; }
      a.texts++;
      if (TAG_SOURCES.has(prep.source)) a.tagged = true;
      a.voices.add(prep.voice);
      const rank = (VOICE_RANK[prep.voice] || 0) * 10 + Math.min(9, Math.round(x * 5));
      if (!TAG_SOURCES.has(prep.source) && rank > a.evRank) {
        a.evRank = rank; a.evidence = excerpt(prep.text, pos);
      }
    }
  }
  const out = [];
  // A near-synonym the film's own texts also use ("slow burner" next to "slow") backs a single mention up.
  const hasKin = id => { const kin = KIN.get(id); if (kin) for (const k of kin) if ((acc.get(k)?.ownHits || 0) > 0) return true; return false; };
  for (const [id, a] of acc) {
    const d = matcher.byId.get(id);
    // A theme found in only one text ("the war", "a mad dash") is weak evidence; an editor's tag or a second, independent text is not.
    let x, fragile = false;
    if (d.facet === 'theme') {
      // Letterboxd's word lists count for a theme the way a review does: each list is one text, so two lists naming it stand
      // like two reviews, and one list alone is a single mention. (11 Nov: scaling list-only themes down like feelings was tried
      // and reverted. Of the 43 chips it removed on a real library about half were right: The Martian's Technology, Rent's Music
      // and musicians, Snowden's Power and corruption. The lists are per film and the user finds them reliable, if general.)
      x = a.x + a.listX;
      if (a.texts < 2 && !a.tagged) x *= SINGLE_MENTION_THEME;
    } else {
      // Fragile ("very unsure, like one mention"): one thing only says it. One review, one keyword tag or one
      // Letterboxd list; or lists alone on a film whose many reviews never use the word. Two reviews, two lists, or a review
      // and a list agreeing are not fragile. The page shows these dashed and last (floor.js).
      fragile = a.ownTexts + a.lists <= 1 || (a.ownTexts === 0 && share >= 0.5);
      const list = Math.min(a.listX, LIST_SUPPORT.cap);
      if (a.x > 0) {
        x = (a.ownTexts >= THIN_SHARE.minTexts ? lift : 1) * a.x + LIST_SUPPORT.boost * list;
        // One passing mention in a film with plenty of text is not a pattern (unless a list also names it).
        if (share >= 0.5 && a.ownTexts === 1 && a.ownHits === 1 && !a.tagged && !a.listX) {
          // Backed by a near-synonym elsewhere in the film's texts it is a light chip; alone it stays under the chip floor.
          if (hasKin(id)) x = Math.min(x, LIST_SUPPORT.kinMentionCap);
          else x = Math.min(x, LIST_SUPPORT.singleMentionCap);
        }
      } else {
        const thin = a.lists > 1 ? LIST_SUPPORT.thin.agreed : LIST_SUPPORT.thin.oneList;
        x = (thin + (LIST_SUPPORT.plenty - thin) * share) * list;
      }
    }
    const score = SCORE_CAP * (1 - Math.exp(-SAT_RATE * x));
    if (score < MIN_SCORE) continue;
    const row = { id, label: d.label, facet: d.facet, score, voices: sortVoices([...a.voices]) };
    // fragileBy: what the one piece of evidence is. A Letterboxd list is the most reliable of the three, a lone keyword tag the least.
    if (fragile) { row.fragile = true; row.fragileBy = a.lists > 0 ? 'list' : row.voices.some(v => v !== 'editors') ? 'review' : 'tag'; }
    if (a.evidence) row.evidence = a.evidence;
    out.push(row);
  }
  out.sort((p, q) => q.score - p.score || (p.id < q.id ? -1 : 1));
  return out;
}

export function sortVoices(v) { return v.sort((a, b) => (VOICE_RANK[b] || 0) - (VOICE_RANK[a] || 0)); }

const GENRE_KEYWORD = /(?:comedy|drama|fiction|fantasy|thriller|horror|romance|western|musical|anime(?: and manga)?|manga|children'?s?|family|melodrama|noir|films?|movie|cinema)$/i;

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A one-word keyword that is already a feel word (Frightened, Playful) describes how the film feels, not what it is about.
let feelWordStems = null;
const isFeelWord = k => {
  if (!feelWordStems) feelWordStems = new Set(LEXICON.filter(d => d.facet !== 'theme').flatMap(d => [...(d.words || []), ...(d.exactWords || [])]).map(stem));
  const w = String(k).trim().toLowerCase();
  return /^[a-z]+$/.test(w) && feelWordStems.has(stem(w));
};

/** Themes (from categories/keywords/subjects/basedOn) and settings (from categories/locations). */
export function extractThemes(input, classify) {
  const themes = new Map();
  const settings = new Map();
  // source = where the theme came from (for centrality): p921 (Wikidata main subject), about-category, category, keyword, style, adaptation
  const addTheme = (id, label, kind, source, voice = 'editors') => {
    if (!id) return;
    const t = themes.get(id);
    if (t) {
      if (!t.voices.includes(voice)) t.voices.push(voice);
      if (source && !t.sources.includes(source)) t.sources.push(source);
      if (rankKind(kind) > rankKind(t.kind)) t.kind = kind;
      return;
    }
    themes.set(id, { id, label, kind, voices: [voice], sources: source ? [source] : [] });
  };
  const catSource = (kind) => (kind === 'about' ? 'about-category' : kind === 'style' || kind === 'adaptation' ? kind : 'category');
  const addSetting = (id, label, kind) => { if (id && !settings.has(id)) settings.set(id, { id, label, kind }); };
  const c = classify(input.categories || []);
  for (const t of c.themes || []) addTheme(t.id, t.label, t.kind, catSource(t.kind));
  for (const s of c.settings || []) addSetting(s.id, s.label, s.kind);
  // Some keyword lists carry genre names ("Romantic comedy", "Children's", "Fantasy anime and manga"). Those say
  // what kind of film it is, not what it is about: keep real styles, drop the rest.
  const genreLike = [];
  for (const k of input.keywords || []) {
    if (GENRE_KEYWORD.test(String(k))) genreLike.push(k);
    else if (isFeelWord(k)) continue;
    else addTheme(slug(k), cap(String(k)), 'subject', 'keyword');
  }
  if (genreLike.length) for (const t of classify(genreLike).themes || []) if (t.kind === 'style') addTheme(t.id, t.label, 'style', 'style');
  for (const k of input.subjects || []) addTheme(slug(k), cap(String(k)), 'subject', 'p921');
  for (const k of input.basedOn || []) addTheme('based-on-' + slug(k), String(k), 'adaptation', 'adaptation');
  for (const l of input.locations || []) addSetting(slug(l), String(l), 'place');
  return { themes: [...themes.values()], settings: [...settings.values()] };
}

const KIND_RANK = { about: 4, subject: 3, style: 2, adaptation: 1 };
const rankKind = (k) => KIND_RANK[k] || 0;
