// Letterboxd's theme groups ("Monsters, aliens, sci-fi and the apocalypse") are long and mix genres with ideas, so they are
// never shown word for word. Each group splits into short parts, and each part goes in the row it belongs to:
//   theme   → Themes row (big ideas)          subject → Subjects row (specific topics)
//   kind    → Kind of film row (genre / form)  tone    → Tone row (an existing tone word)
// Genre words on their own (sci-fi, horror, comedy, thriller) are dropped: the film's genres already say them.
// A part shows when the film's own words confirm it (two mentions in reviews or articles, or one in its keywords, categories
// or subjects; never Letterboxd's own group names), or when Matinee already found the same idea or a genre says it.
// If no part of a group is confirmed, the group's main idea (its first part) shows as a light hint, so the group is never lost
// but a broad bucket doesn't pin its other ideas on the film (Sinners isn't about nature just because it is in "Humanity and
// the world around us").
// Decided on 10 Nov 2026; the wording below can be changed freely.

/** The first part of each group is its main idea (the light hint when nothing is confirmed).
 * `words`: lower-case prefixes matched at a word start; a trailing '$' means the whole word only (heroin$ must not match heroine). */
const P = (label, row, words, extra = {}) => ({ label, row, words, ...extra });

export const LB_GROUPS = {
  'monsters, aliens, sci-fi and the apocalypse': [
    P('Monsters and aliens', 'subject', ['monster', 'alien$', 'aliens$', 'extraterrestrial', 'kaiju', 'creature feature', 'ufo', 'godzilla']),
    P('Apocalypse', 'theme', ['apocalyp', 'post-apocalyp', 'end of the world', 'doomsday', 'armageddon', 'end times']),
  ],
  'humanity and the world around us': [
    P('Humanity', 'theme', ['humanity', 'human nature', 'human condition', 'mankind', 'humankind', 'what it means to be human', 'human existence']),
    P('Nature and the environment', 'theme', ['wilderness', 'environment', 'ecolog', 'wildlife', 'climate', 'natural world', 'the planet', 'mother nature']),
  ],
  'moving relationship stories': [P('Relationships', 'theme', ['relationship'])],
  'relationship comedy': [P('Relationships', 'theme', ['relationship'])],
  'epic heroes': [P('Heroes', 'theme', ['hero$', 'heroes$', 'heroic', 'heroism'])],
  'crude humor and satire': [
    P('Bawdy', 'tone', ['crude', 'raunch', 'gross-out', 'toilet humo', 'vulgar', 'bawdy', 'lewd', 'smutty']),
    P('Satirical', 'tone', ['satir', 'parody', 'parodies', 'lampoon', 'send-up', 'spoof']),
  ],
  'intense violence and sexual transgression': [
    P('Violence and bloodshed', 'theme', ['violen', 'bloodshed', 'gore$', 'gory', 'bloodbath', 'carnage']),
    P('Sexual transgression', 'theme', ['incest', 'rape$', 'sexual abuse', 'sexual assault', 'pervers', 'pervert', 'fetish', 'taboo', 'transgress', 'explicit sex', 'erotic']),
  ],
  'horror, the undead and monster classics': [
    P('The undead', 'subject', ['undead', 'zombie', 'vampire', 'ghoul', 'mummy', 'mummies', 'reanimat', 'dracula']),
    P('Classic monster film', 'kind', ['frankenstein', 'dracula', 'wolf man', 'werewolf', 'universal monster', 'hammer horror', 'monster movie', 'creature from', 'classic horror']),
  ],
  'high speed and special ops': [
    P('Speed and chases', 'subject', ['car chase', 'chase', 'racing', 'race car', 'high-speed', 'high speed', 'getaway', 'speed$', 'pursuit']),
    P('Special ops', 'subject', ['special forces', 'special ops', 'commando', 'navy seal', 'black ops', 'covert op', 'mercenar', 'elite unit', 'strike team']),
  ],
  'war and historical adventure': [
    P('War', 'theme', ['war$', 'wars$', 'wartime', 'battle', 'soldier', 'combat']),
    P('Historical adventure', 'kind', ['historical', 'period piece', 'swashbuckl', 'ancient', 'medieval', 'gladiator', 'empire']),
  ],
  'crime, drugs and gangsters': [
    P('Crime', 'theme', ['crime', 'criminal', 'heist', 'robbery', 'murder']),
    P('Gangsters and the mafia', 'theme', ['gangster', 'mafia', 'mob$', 'mobster', 'cartel', 'yakuza', 'triad', 'gang$', 'gangs$', 'crime boss', 'crime family']),
    P('Drugs', 'subject', ['drug', 'cocaine', 'heroin$', 'narcotic', 'meth$', 'crack$', 'dealer', 'cartel', 'trafficking']),
  ],
  'epic history and literature': [
    P('History', 'theme', ['histor', 'period drama', 'period piece', 'centuries', 'century']),
    P('Literary adaptation', 'kind', ['novel', 'based on the book', 'adaptation of', 'adapted from', 'literary', 'shakespeare', 'dickens', 'tolstoy', 'austen'], { basedOn: true }),
  ],
  'song and dance': [P('Musical', 'kind', ['musical', 'song and dance', 'song-and-dance', 'dance number', 'show tune', 'broadway', 'singing'], { genre: ['musical', 'music'] })],
  'politics and human rights': [
    P('Politics', 'theme', ['politic', 'government', 'election', 'president', 'regime', 'senator', 'parliament']),
    P('Human rights', 'theme', ['human rights', 'civil rights', 'oppression', 'persecution', 'genocide', 'apartheid', 'discriminat', 'dictator', 'injustice']),
  ],
  'underdogs and coming of age': [
    P('Underdogs', 'theme', ['underdog', 'against the odds', 'against all odds', 'long shot', 'unlikely hero', 'unlikely champion']),
    P('Coming of age and adolescence', 'theme', ['coming of age', 'coming-of-age', 'adolescen', 'teenage', 'teen$', 'teens$', 'growing up']),
  ],
  'thrillers and murder mysteries': [P('Murder mystery', 'kind', ['murder mystery', 'whodunit', 'whodunnit', 'detective', 'who killed', 'sleuth'])],
  'westerns': [P('Western', 'kind', ['western', 'cowboy', 'gunslinger', 'frontier', 'outlaw', 'sheriff'], { genre: ['western'] })],
  'superheroes in action-packed battles with villains': [P('Superhero', 'kind', ['superhero', 'super hero', 'superpower', 'super-power', 'caped', 'marvel', 'dc comics'])],
  'nazis and world war ii': [
    P('Nazis', 'subject', ['nazi', 'third reich', 'hitler', 'gestapo', 'ss officer']),
    P('World War II', 'subject', ['world war ii', 'world war 2', 'wwii', 'ww2', 'second world war', 'd-day', 'normandy', 'pearl harbor', 'holocaust']),
  ],
  'emotional and captivating fantasy storytelling': [P('Fantasy', 'kind', ['fantasy', 'fairy tale', 'fairytale', 'magic', 'wizard', 'dragon', 'enchant', 'mytholog'], { genre: ['fantasy'] })],
  'kids and animation': [
    P('Animation', 'kind', ['animat', 'cartoon', 'pixar', 'ghibli', 'stop-motion', 'stop motion', 'anime$'], { genre: ['animation'] }),
    P('Family', 'kind', ['family film', 'for kids', 'for children', "children's film", 'kids film', 'family-friendly', 'family friendly', 'all ages'], { genre: ['family'] }),
  ],
};

const PART_LABELS = new Set(Object.values(LB_GROUPS).flat().map(p => p.label.toLowerCase()));

// Genre words that carry no idea of their own: dropped when splitting a group not in the table.
const GENRE_WORDS = new Set(['sci-fi', 'science fiction', 'horror', 'comedy', 'comedies', 'thriller', 'thrillers', 'drama', 'dramas', 'action',
  'adventure', 'adventures', 'fantasy', 'animation', 'romance', 'romcom', 'romcoms', 'documentary', 'documentaries', 'musical', 'musicals',
  'westerns', 'western', 'mystery', 'mysteries', 'film', 'films', 'movies', 'stories', 'storytelling', 'classics']);

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Parts for a group name not in the table: split on commas and "and", drop genre words, a light theme each. */
export function splitUnknown(name) {
  const bits = norm(name).split(/,\s*|\s+and\s+|\s*&\s*/).map(b => b.replace(/^(the|a|an)\s+/, '').trim()).filter(Boolean);
  const kept = bits.filter(b => !GENRE_WORDS.has(b) && !b.split(' ').every(w => GENRE_WORDS.has(w)));
  if (!kept.length) return bits.length ? [P(cap(bits[0]).slice(0, 22).trim(), 'kind', [bits[0]])] : [];
  return kept.map(b => {
    let label = b.length <= 22 ? b : b.slice(0, 23).replace(/\s+\S*$/, '');
    return P(cap(label), 'theme', [b]);
  });
}

/** The parts a Letterboxd group stands for (table first, then the generic split). */
export function partsOf(name) {
  return LB_GROUPS[norm(name)] || splitUnknown(name);
}

/**
 * Short name for an lb: id: a new tag's label as is; an old long group name (saved filters, old links) becomes its main idea,
 * so a pill or a "why" line never shows Letterboxd's long wording.
 */
export function lbPillLabel(name) {
  const s = String(name);
  if (PART_LABELS.has(norm(s)) || (!/,| and /i.test(s) && !LB_GROUPS[norm(s)])) return s; // already a short tag
  const parts = partsOf(s);
  return parts.length ? parts[0].label : s;
}

const MIN_TEXT_MENTIONS = 2; // reviews and articles: one passing word ("a meta-monster, frankensteined") is not enough
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function wordRe(words) {
  const k = words.join('|');
  let re = reCache.get(k);
  if (!re) {
    const alts = words.map(w => w.endsWith('$') ? esc(w.slice(0, -1)) + '(?![a-z])' : esc(w));
    re = new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'g');
    reCache.set(k, re);
  }
  return re;
}

/**
 * Expand a film's Letterboxd groups into tags.
 * @param {string[]} groups  the film's Letterboxd theme group names, strongest first
 * @param {{ text?: string, lists?: string[], labels?: Iterable<string>, genres?: string[], basedOn?: boolean }} film
 *   text: the film's reviews and articles (NOT the Letterboxd group names), any case;
 *   lists: its keywords, categories and subjects (curated, so one mention counts);
 *   labels: labels Matinee already shows for the film (descriptors, themes, subjects), any case;
 *   genres: the film's genres; basedOn: true when the film is based on a book or other source.
 * @returns {{ label: string, row: 'theme'|'subject'|'kind'|'tone', confirmed: boolean, shown: boolean, group: string }[]}
 *   `shown: false` means Matinee already shows that idea itself (same label), or a genre already says it; the tag still
 *   counts for By feel, it just isn't drawn twice.
 */
export function expandLbGroups(groups, film = {}) {
  const text = ' ' + norm(film.text) + ' ';
  const lists = ' ' + (film.lists || []).map(norm).join(' | ') + ' ';
  const count = (re, s) => { re.lastIndex = 0; let n = 0; while (re.exec(s) && n < MIN_TEXT_MENTIONS) n++; return n; };
  const said = words => { const re = wordRe(words); return count(re, lists) > 0 || count(re, text) >= MIN_TEXT_MENTIONS; };
  const have = new Set([...(film.labels || [])].map(norm));
  const genres = new Set((film.genres || []).map(norm));
  const out = new Map();
  for (const g of groups || []) {
    const parts = partsOf(g);
    const checked = parts.map(p => {
      const already = have.has(norm(p.label));
      const genreSaysIt = p.row === 'kind' && (genres.has(norm(p.label)) || (p.genre || []).some(x => genres.has(x)));
      const confirmed = already || genreSaysIt || (p.basedOn && film.basedOn) || said(p.words);
      return { p, confirmed, shown: !already && !genreSaysIt };
    });
    const any = checked.some(c => c.confirmed);
    for (const [i, c] of checked.entries()) {
      if (any ? !c.confirmed : i > 0) continue; // only what the film's own words confirm; else the group's main idea as a hint
      const key = norm(c.p.label);
      const prev = out.get(key);
      if (prev && (prev.confirmed || !c.confirmed)) continue;
      out.set(key, { label: c.p.label, row: c.p.row, confirmed: c.confirmed, shown: c.shown, group: g });
    }
  }
  return [...out.values()];
}
