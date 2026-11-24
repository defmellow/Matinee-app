// Turns Wikipedia category labels into themes / settings, and drops noise (years, awards, crew, formats…).
// Precision over recall: anything we do not recognise is noise.

const KINDS_THEME = new Set(['about', 'subject', 'adaptation', 'style']);

/** kebab-case key; dashes of any kind become '-', apostrophes vanish. */
function kebab(s) {
  return String(s).toLowerCase().replace(/[’']/g, '').replace(/[‐-―]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}
const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s) => String(s).replace(/\s+/g, ' ').replace(/\[[^\]]*\]/g, '').trim();

const noise = { kind: 'noise', id: '', label: '' };

const NATIONS = ['west german', 'east german', 'south korean', 'north korean', 'new zealand', 'hong kong', 'south african',
  'soviet', 'american', 'british', 'english', 'french', 'german', 'italian', 'spanish', 'japanese', 'chinese', 'korean',
  'indian', 'canadian', 'australian', 'irish', 'scottish', 'welsh', 'swedish', 'danish', 'norwegian', 'finnish', 'icelandic',
  'dutch', 'belgian', 'swiss', 'austrian', 'polish', 'czech', 'czechoslovak', 'hungarian', 'romanian', 'russian', 'ukrainian',
  'greek', 'turkish', 'iranian', 'israeli', 'egyptian', 'mexican', 'brazilian', 'argentine', 'argentinian', 'chilean',
  'colombian', 'cuban', 'portuguese', 'thai', 'taiwanese', 'filipino', 'indonesian', 'vietnamese', 'nigerian', 'yugoslav',
  'serbian', 'croatian', 'european', 'latin american', 'african', 'asian', 'bengali', 'tamil', 'telugu', 'hindi'].sort((a, b) => b.length - a.length);

const MODIFIER_TOKEN = /^(?:\d{4}s|\d{1,2}(?:st|nd|rd|th)-century|[\p{L}]+-language|early|late|mid)$/u;

// Whole phrases that only restate a genre we already know.
const GENERIC = new Set(['drama', 'comedy', 'action', 'thriller', 'horror', 'romance', 'documentary', 'animated', 'animation',
  'fantasy', 'science fiction', 'crime', 'adventure', 'war', 'western', 'musical', 'mystery', 'family', 'biographical',
  'historical', 'comedy-drama', 'comedy drama', 'drama comedy', 'live-action', 'short', 'feature', 'television', 'fiction',
  'romantic', 'romantic drama', 'romantic comedy', 'action thriller', 'crime drama', 'crime thriller', 'war drama']);

// A style phrase must contain one of these to count as "what the film is like".
const HEADS = new RegExp('\\b(?:' + [
  'western', 'noir', 'thriller', 'horror', 'comed', 'heist', 'road', 'coming-of-age', 'dystop', 'utop', 'surreal', '(?:post-?)?apocalyp',
  'sci-fi', 'science fiction', 'fantasy', 'romanc', 'romantic', 'musical', 'crime', 'gangster', 'war', 'spy', 'espionage',
  'mystery', 'slash', 'disaster', 'satir', 'parod', 'zombie', 'vampire', 'ghost', 'monster', 'superhero', 'martial arts',
  'sport', 'prison', 'courtroom', 'teen', 'buddy', 'revenge', 'survival', 'time travel', 'found footage', 'mockumentar',
  'silent', 'black-and-white', 'experimental', 'avant-garde', 'absurd', 'magic(?:al)? realis', 'psycholog', 'gothic', 'erotic',
  'melodrama', 'epic', 'biograph', 'biopic', 'historical', 'period', 'politic', 'religio', 'existential', 'slow cinema',
  'new wave', 'cyberpunk', 'steampunk', 'space', 'alien', 'robot', 'vigilante', 'caper', 'whodunit', 'detective', 'police',
  'cop', 'legal', 'school', 'mumblecore', 'v[ée]rit', 'realis', 'expression', 'minimalis', 'feminist', 'anti-war', 'pre-code',
  'giallo', 'sploitation', 'exploitation', 'christmas', 'holiday', 'screwball', 'farce', 'kung fu', 'swashbuckl', 'sword',
  'neo-', 'drama',
].join('|') + ')', 'i');

const NOISE_PATTERNS = [
  /\bfilms?\s+(?:directed|produced|scored|shot|filmed|distributed|edited|written|starring|featuring|with|released|made|financed|that|by|composed|narrated|photographed|co-)/i,
  /\b(?:winners?|nominees?|nominations?|awards?|prizes?)\b/i,
  /\bwon\b/i,
  /palme d'or|palme d’or|bafta|academy award|golden globe|oscar|cannes|sundance|berlin|venice|film festival|emmy|césar|cesar/i,
  /\b(?:dolby|imax|3-?d|cinemascope|technicolor|\d+\s?mm|digital|anamorphic)\b/i,
  /\bindependent\b/i,
  /remake|sequel|prequel|reboot|franchise|film series|spin-?off/i,
  /national film registry|culturally significant|library of congress|debut|cult films?$/i,
  /live action and animation|live-action and animation/i,
  /\b(?:in|by|from|for|of|at|on|to|with)\s+\d{4}\b/i,
  /\b(?:studios?|pictures|productions?|entertainment|bros\.?|films? (?:inc|ltd))\b/i,
];

const ERA_WORDS = /^(?:the )?(?:future|past|middle ages|medieval|ancient (?:rome|greece|egypt)|prehistoric|stone age|victorian era|edwardian era|roaring twenties)$/i;

function cleanTopic(raw) {
  return clean(raw).replace(/^the\s+/i, '');
}

function classifyStyle(text) {
  let t = text.toLowerCase();
  const suffix = t.match(/\s+(films?|movies?)$/);
  let core = suffix ? t.slice(0, suffix.index) : t;
  const tail = suffix && /^movie/.test(suffix[1]) ? ' movie' : '';
  // strip leading nationality / decade / language words
  let changed = true;
  while (changed) {
    changed = false;
    core = core.trim();
    for (const n of NATIONS) {
      if (core === n || core.startsWith(n + ' ') || (core.startsWith(n + '-') && !core.startsWith(n + '-language'))) { core = core.slice(n.length).replace(/^[\s-]+/, ''); changed = true; break; }
    }
    if (changed) continue;
    const first = core.split(' ')[0];
    if (first && MODIFIER_TOKEN.test(first) && core !== first) { core = core.slice(first.length).trim(); changed = true; }
    else if (first && MODIFIER_TOKEN.test(first)) { core = ''; }
  }
  core = core.trim();
  if (!core) return noise;
  if (GENERIC.has(core) && !tail) return noise;
  // drop a leading "drama" / "comedy" when something more specific follows
  const m = core.match(/^(?:drama|comedy)\s+(.+)$/);
  if (m && !GENERIC.has(m[1])) core = m[1];
  if (GENERIC.has(core)) return noise;
  const phrase = core + tail;
  if (/\d/.test(phrase) || phrase.split(/\s+/).length > 4) return noise;
  if (!HEADS.test(phrase)) return noise;
  return { kind: 'style', id: kebab(phrase), label: sentence(phrase) };
}

/** @returns {{kind:string,id:string,label:string}} */
export function classifyCategory(label) {
  if (typeof label !== 'string') return noise;
  let s = clean(label).replace(/^category:\s*/i, '');
  if (!s || s.length > 160) return noise;
  if (/^\d{4}\b(?!s)/.test(s)) return noise; // '1984 films', '1984 drama films'

  let m = s.match(/^(?:[\p{L}\p{N}'’\- ]+? )?(?:films|movies|television shows|television series|tv series|works|novels|books|plays) about (.+)$/iu);
  if (m) {
    const topic = cleanTopic(m[1]);
    const id = kebab(topic);
    return id ? { kind: 'about', id, label: sentence(topic) } : noise;
  }

  m = s.match(/^(?:[\p{L}\p{N}'’\- ]+? )?(?:films|movies) set in (.+)$/iu);
  if (m) {
    const rest = cleanTopic(m[1]);
    let d;
    if ((d = rest.match(/^(\d{4})s$/))) return { kind: 'era', id: `${d[1]}s`, label: `${d[1]}s` };
    if (/^\d{4}$/.test(rest)) return { kind: 'era', id: rest, label: rest };
    if ((d = rest.match(/^(\d{1,2})(st|nd|rd|th)[- ]century(?:\s+\w+)?$/i))) {
      return { kind: 'era', id: `${d[1]}${d[2].toLowerCase()}-century`, label: `${d[1]}${d[2].toLowerCase()} century` };
    }
    if (ERA_WORDS.test(rest)) return { kind: 'era', id: kebab(rest), label: sentence(rest.toLowerCase()) };
    const id = kebab(rest);
    return id ? { kind: 'place', id, label: sentence(rest) } : noise;
  }

  m = s.match(/^(?:[\p{L}\p{N}'’\- ]+? )?(?:films|movies|television shows|television series|works|plays) based on (.+)$/iu);
  if (m) {
    const src = cleanTopic(m[1]);
    const id = kebab(src);
    return id ? { kind: 'adaptation', id: `adapted-from-${id}`, label: `Based on ${src}` } : noise;
  }

  if (NOISE_PATTERNS.some((re) => re.test(s))) return noise;

  m = s.match(/^(.+?) in (?:film|fiction|popular culture|literature)$/i);
  if (m && !/^(?:films?|movies?)\b/i.test(m[1])) {
    const topic = cleanTopic(m[1]);
    const id = kebab(topic);
    return id ? { kind: 'subject', id, label: sentence(topic) } : noise;
  }

  return classifyStyle(s);
}

/** Classify many labels at once; themes and settings deduped by id. */
export function classifyAll(labels) {
  const themes = [];
  const settings = [];
  const seenT = new Set();
  const seenS = new Set();
  let noiseCount = 0;
  for (const l of Array.isArray(labels) ? labels : []) {
    const c = classifyCategory(l);
    if (c.kind === 'noise') { noiseCount++; continue; }
    const item = { id: c.id, label: c.label, kind: c.kind };
    if (KINDS_THEME.has(c.kind)) { if (!seenT.has(c.id)) { seenT.add(c.id); themes.push(item); } }
    else if (!seenS.has(c.id)) { seenS.add(c.id); settings.push(item); }
  }
  return { themes, settings, noise: noiseCount };
}
