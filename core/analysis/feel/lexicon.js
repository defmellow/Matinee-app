// The feel lexicon: readable descriptors of how a film feels, with the words and phrases
// people use for each. Pure data. The engine lowercases and stems text, then matches
// `words` (single tokens) and `phrases` (consecutive tokens). No hyphens: write "slow burn".
// Weight (0.4 to 1) is lower for words that are common in ordinary prose.

// Descriptors that still count for similarity and Tonight but never show as chips (her call 30 Oct): near-copies of another word (propulsive ~ breakneck,
// unhurried ~ slow-paced), too literary (glacial, languid, measured) or not a feeling (rewatchable).
export const HIDDEN_FROM_CHIPS = new Set(['languid', 'glacial', 'measured', 'unhurried', 'propulsive', 'rewatchable']);
/**
 * Words that say nearly the same thing about PACE. Reviewers rarely describe pace, and when they do they spread over many words,
 * so one "slow" next to another review's "slow burner" or "takes its time" is a pattern even though each word appears once:
 * members of a family back each other up (extract.js); they are not merged. Tried for every row on her 691 films (11 Nov):
 * it brought back the passing-mention noise the single-mention rule removed, so it stays with pace, the one row that is a scale.
 */
export const FAMILIES = [
  ['slow-paced', 'slow-burn', 'meditative', 'unhurried', 'languid', 'glacial'], // not Drags: that is a complaint, it needs its own two mentions
  ['breakneck', 'relentless', 'frenetic', 'propulsive', 'tightly-paced'],
];
/** id -> the ids that back it up. */
export const KIN = (() => {
  const m = new Map();
  for (const fam of FAMILIES) for (const id of fam) { const s = m.get(id) || new Set(); for (const o of fam) if (o !== id) s.add(o); m.set(id, s); }
  return m;
})();

/** A hidden near-copy lends what it found to the word that is shown for it, so its evidence is not lost from the film page. */
export const SHOWN_AS = { propulsive: 'breakneck', unhurried: 'slow-paced', languid: 'slow-paced', glacial: 'slow-paced' };

export const FACETS = ['mood', 'tone', 'pace', 'craft', 'impact', 'theme'];

// exactWords match their exact spelling only (no stemming): for words whose stem would also catch an everyday word
// ("touching" -> "touch", "drags" -> "drag", "parenting" -> "parent").
const d = (id, label, facet, words, phrases = [], weight = 1, exactWords = []) => {
  const out = { id, label, facet, words };
  if (phrases.length) out.phrases = phrases;
  if (weight !== 1) out.weight = weight;
  if (exactWords.length) out.exactWords = exactWords;
  return out;
};

export const LEXICON = [
  // ---- mood ----
  d('melancholic', 'Melancholic', 'mood', ['melancholy', 'melancholic', 'mournful', 'sorrowful', 'doleful']),
  d('bittersweet', 'Bittersweet', 'mood', ['bittersweet', 'bittersweetly', 'bittersweetness', 'wistful', 'wistfully', 'elegiac', 'pensive'], ['bitter sweet', 'happy and sad', 'tinged with sadness']),
  d('tender', 'Tender', 'mood', ['tender', 'tenderly', 'tenderness'], ['delicate and tender', 'tender and delicate', 'delicately told', 'delicately handled', 'delicate portrait', 'delicate film'], 0.8),
  d('nostalgic', 'Nostalgic', 'mood', ['nostalgic', 'nostalgia', 'nostalgically', 'yesteryear'], ['trip down memory lane']),
  d('lonely', 'Lonely', 'mood', ['lonely', 'lonesome', 'forlorn', 'desolate', 'loneliness']),
  d('uneasy', 'Uneasy', 'mood', ['uneasy', 'unease', 'disquiet', 'disquieting'], ['ill at ease']),
  d('bleak', 'Bleak', 'mood', ['bleak', 'bleakly', 'bleakness', 'grimly', 'joyless', 'nihilistic'], ['no hope'], 1, ['grim']),
  d('euphoric', 'Euphoric', 'mood', ['euphoric', 'euphoria', 'exhilarating', 'ecstatic', 'exultant', 'elated']),
  d('cosy', 'Cosy', 'mood', ['cosy', 'cozy', 'snug', 'homely', 'cuddly'], ['comfort watch', 'comfort film', 'warm blanket'], 1, ['comforting']),
  d('tense', 'Tense', 'mood', ['tense', 'taut', 'suspenseful', 'suspense'], ['nail biting', 'on edge'], 1, ['tension']),
  d('eerie', 'Eerie', 'mood', ['eerie', 'eerily', 'spooky', 'creepy', 'uncanny', 'ghostly']),
  d('foreboding', 'Foreboding', 'mood', ['foreboding', 'ominous', 'sinister', 'menacing', 'menace', 'dread']),
  d('serene', 'Serene', 'mood', ['serene', 'tranquil', 'peaceful', 'calming', 'placid', 'soothing']),
  d('joyful', 'Joyful', 'mood', ['joyful', 'joyous', 'jubilant', 'exuberant', 'buoyant', 'joy'], [], 0.8),
  d('hopeful', 'Hopeful', 'mood', ['hopeful', 'optimistic', 'optimism', 'buoyed', 'hope'], [], 0.7),
  d('romantic', 'Romantic', 'mood', ['romantic', 'romantically', 'swoony', 'swoon', 'swooning', 'lovesick', 'amorous'], [], 0.8),
  d('sensual', 'Sensual', 'mood', ['sensual', 'sensuous', 'steamy', 'erotic', 'seductive', 'sultry', 'smouldering', 'smoldering']),
  d('angry', 'Angry', 'mood', ['angry', 'rage', 'furious', 'fury', 'seething', 'wrathful']),
  d('anxious', 'Anxious', 'mood', ['anxious', 'anxiety', 'jittery', 'panicky', 'paranoid', 'paranoia']),
  d('longing', 'Yearning', 'mood', ['longing', 'yearning', 'yearn', 'aching', 'ache', 'pining']),
  d('restless', 'Restless', 'mood', ['restless', 'restlessness', 'agitated', 'fidgety', 'aimless'], [], 1, ['drifting']),
  d('claustrophobic', 'Claustrophobic', 'mood', ['claustrophobic', 'claustrophobia', 'stifling', 'airless', 'cramped', 'confined', 'suffocating']),
  d('oppressive', 'Oppressive', 'mood', ['oppressive', 'oppressively', 'smothering', 'weighty'], [], 0.6, ['crushing', 'heavy']),
  d('brooding', 'Moody', 'mood', ['brooding', 'moody', 'broody', 'sullen', 'brood']),
  d('gloomy', 'Gloomy', 'mood', ['gloomy', 'gloom', 'dismal', 'dreary', 'murky', 'sombre', 'somber'], [], 0.9),
  d('carefree', 'Carefree', 'mood', ['carefree', 'breezy', 'effervescent', 'sprightly', 'frothy', 'fizzy', 'bubbly', 'lighthearted'], ['light hearted']),
  d('heartwarming', 'Heartwarming', 'mood', ['heartwarming', 'heartening', 'endearing', 'wholesome', 'feelgood'], ['heart warming', 'feel good', 'warms the heart']),
  d('sad', 'Sad', 'mood', ['sad', 'sadness', 'saddening', 'downbeat', 'depressing'], [], 0.6),
  d('wonder', 'Wondrous', 'mood', ['wonder', 'wondrous', 'awe', 'awestruck', 'enchanted', 'magical'], ['awe inspiring'], 0.8),
  d('mysterious', 'Mysterious', 'mood', ['enigmatic', 'cryptic', 'inscrutable', 'mysteriously'], ['deeply mysterious', 'beautifully mysterious', 'strangely mysterious', 'mysterious atmosphere', 'air of mystery', 'sense of mystery'], 0.7),
  d('dark', 'Dark', 'mood', [], ['very dark', 'too dark', 'quite dark', 'pretty dark', 'dark tone', 'dark themes']),
  d('weird', 'Weird', 'mood', ['weird', 'weirdly', 'weirdness', 'freakish'], ['off kilter', 'strange film', 'strange movie', 'strange and wonderful', 'strange and beautiful', 'strange little'], 0.7),
  d('gentle', 'Gentle', 'mood', ['gentle', 'gentleness', 'gently', 'softspoken'], ['soft spoken', 'tender hearted', 'quiet charm']),
  d('chaotic', 'Chaotic', 'mood', ['chaotic', 'unhinged', 'pandemonium', 'bedlam'], ['pure chaos', 'controlled chaos', 'organised chaos']),
  d('cold', 'Cold', 'mood', ['aloof', 'sterile', 'frigid'], ['cold and distant', 'cold and clinical', 'emotionally distant', 'emotionally cold', 'emotionally detached', 'emotionally remote'], 1, ['coldly', 'coldness']),
  d('despairing', 'Despairing', 'mood', ['despair', 'despairing', 'hopeless', 'hopelessness', 'anguish', 'anguished', 'agony']),

  // ---- tone ----
  d('deadpan', 'Deadpan', 'tone', ['deadpan', 'droll', 'laconic'], ['dry humour', 'dry humor', 'dry wit']),
  d('absurd', 'Absurd', 'tone', ['absurd', 'absurdist', 'absurdity', 'absurdly', 'nonsensical', 'preposterous']),
  d('earnest', 'Earnest', 'tone', ['earnest', 'earnestly', 'earnestness', 'sincere', 'sincerity', 'wholehearted', 'heartfelt']),
  d('satirical', 'Satirical', 'tone', ['satirical', 'satire', 'satirise', 'satirize', 'lampoon', 'parody', 'spoof'], ['send up']),
  d('whimsical', 'Whimsical', 'tone', ['whimsical', 'whimsy', 'whimsically', 'fanciful', 'twee', 'fey', 'fairytale'], ['fairy tale']),
  d('sardonic', 'Mocking', 'tone', ['sardonic', 'sardonically', 'caustic', 'acerbic', 'sarcastic', 'sarcasm', 'mordant', 'mocking', 'scornful', 'sneering']),
  d('wry', 'Dry wit', 'tone', ['wry', 'wryly', 'witty', 'wittily', 'waggish', 'wit'], ['tongue in cheek'], 0.9),
  d('camp', 'Camp', 'tone', ['campy', 'kitsch', 'kitschy', 'flamboyant'], ['over the top', 'high camp', 'pure camp', 'camp classic']),
  d('playful', 'Playful', 'tone', ['playful', 'playfully', 'impish', 'mischievous', 'mischief', 'cheeky', 'cheekily']),
  d('irreverent', 'Irreverent', 'tone', ['irreverent', 'irreverence', 'subversive', 'anarchic', 'iconoclastic', 'impudent']),
  d('cynical', 'Cynical', 'tone', ['cynical', 'cynic', 'cynicism', 'jaded', 'disillusioned'], ['world weary']),
  d('quirky', 'Quirky', 'tone', ['quirky', 'quirk', 'quirkiness', 'offbeat', 'eccentric', 'idiosyncratic', 'kooky', 'oddball']),
  d('farcical', 'Silly', 'tone', ['farce', 'farcical', 'slapstick', 'madcap', 'screwball', 'zany', 'wacky', 'hijinks', 'silly', 'goofy']),
  d('darkly-comic', 'Darkly comic', 'tone', ['macabre', 'morbid', 'ghoulish', 'gallows'], ['dark comedy', 'black comedy', 'darkly funny', 'darkly comic', 'gallows humour', 'gallows humor']),
  d('biting', 'Biting', 'tone', ['biting', 'scathing', 'trenchant', 'incisive'], ['cutting wit', 'cutting satire', 'cutting humour', 'cutting humor', 'cutting remarks'], 1, ['withering']),
  d('ironic', 'Ironic', 'tone', ['ironic', 'irony', 'meta', 'metafictional'], ['self aware', 'knowing wink', 'knowing nod'], 0.8),
  d('understated', 'Understated', 'tone', ['understated', 'understatement', 'subtle', 'restrained', 'muted', 'reserved', 'quiet'], ['low key'], 0.6),
  d('melodramatic', 'Melodramatic', 'tone', ['melodramatic', 'melodrama', 'histrionic', 'overwrought', 'soapy']),
  d('sentimental', 'Sentimental', 'tone', ['sentimental', 'sentimentality', 'schmaltzy', 'schmaltz', 'saccharine', 'cloying', 'mawkish', 'maudlin']),
  d('bawdy', 'Bawdy', 'tone', ['bawdy', 'raunchy', 'crude', 'vulgar', 'lewd', 'ribald', 'risque']),
  d('solemn', 'Solemn', 'tone', ['solemn', 'solemnity', 'gravitas'], ['grave tone', 'grave and serious', 'gravely serious', 'sober tone', 'sober and serious'], 0.8),
  d('unflinching', 'Unflinching', 'tone', ['unflinching', 'uncompromising', 'unsparing', 'unvarnished', 'blunt', 'forthright', 'candid']),
  d('provocative', 'Provocative', 'tone', ['provocative', 'provocateur', 'transgressive', 'controversial', 'incendiary', 'confrontational']),

  // ---- pace ----
  d('slow-burn', 'Slow burn', 'pace', ['simmers', 'simmering', 'gradual'], ['slow burn', 'slow burning', 'slow burner', 'slowly builds', 'builds slowly', 'slow build', 'slowly unfolds', 'unfolds slowly'], 0.9),
  d('meditative', 'Meditative', 'pace', ['meditative', 'contemplative', 'reflective', 'introspective', 'ruminative', 'meditation']),
  d('languid', 'Languid', 'pace', ['languid', 'languorous', 'lethargic', 'indolent']),
  d('unhurried', 'Unhurried', 'pace', ['unhurried', 'leisurely', 'patient', 'easygoing', 'ambling', 'meandering', 'sauntering'], ['unrushed pace']),
  d('glacial', 'Glacial', 'pace', ['glacial', 'plodding', 'sluggish', 'ponderous', 'interminable']),
  // "slowly" is left out: it nearly always tells the plot ("he slowly loses his mind"), not the pace of the film.
  d('slow-paced', 'Slow-paced', 'pace', ['slow', 'slower', 'slowness'], ['slow paced', 'slow pace', 'slow pacing', 'slow moving', 'slow cinema', 'takes its time', 'takes its sweet time', 'leisurely pace', 'leisurely paced', 'deliberate pace', 'deliberately paced', 'moves slow', 'starts out slowly', 'starts slowly'], 0.8),
  d('propulsive', 'Propulsive', 'pace', ['propulsive', 'galloping', 'torrential']),
  d('frenetic', 'Frenetic', 'pace', ['frenetic', 'frantic', 'frenzied', 'frenzy', 'feverish', 'hectic', 'manic']),
  d('relentless', 'Relentless', 'pace', ['relentless', 'unrelenting', 'unremitting', 'nonstop', 'ceaseless', 'incessant'], ['edge of your seat', 'edge of seat']),
  d('breakneck', 'Breakneck', 'pace', ['breakneck', 'whirlwind', 'rollercoaster', 'adrenaline', 'breathless', 'brisk', 'zippy'], ['high octane', 'roller coaster', 'fast paced', 'fast pace', 'fast pacing', 'fast moving', 'quick pace', 'quickly paced', 'rapid pace', 'action packed', 'non stop action', 'never slows down', 'flies by', 'flew by']),
  d('measured', 'Measured', 'pace', ['measured', 'deliberate', 'methodical', 'steady'], [], 0.6),
  d('episodic', 'Episodic', 'pace', ['episodic', 'vignette', 'vignettes', 'digressive', 'rambling', 'discursive']),
  // Said in phrases only: "tight", "lean", "concise" and "compact" on their own were mostly about something else ("lean beggar", "leaned into", "concise commentary").
  d('tightly-paced', 'Tightly paced', 'pace', ['streamlined'], ['tightly wound', 'tightly paced', 'tightly plotted', 'well paced', 'perfectly paced', 'superbly paced', 'perfect pacing', 'great pacing', 'excellent pacing', 'never drags', 'never a dull moment', 'not a wasted minute', 'not a wasted scene', 'not a wasted frame'], 0.8),
  d('baggy', 'Drags', 'pace', ['baggy', 'bloated', 'overlong', 'padded'], ['too long', 'way too long', 'far too long', 'overstays its welcome', 'outstays its welcome', 'pacing issues', 'pacing problems', 'poorly paced', 'poor pacing', 'a slog', 'drags on', 'dragged on', 'glacially slow', 'painfully slow'], 0.8, ['dragging', 'drags', 'dragged']),

  // ---- craft ----
  d('atmospheric', 'Atmospheric', 'craft', ['atmospheric', 'atmosphere', 'ambience', 'ambiance', 'evocative'], [], 0.9),
  d('lyrical', 'Poetic', 'craft', ['lyrical', 'lyricism', 'poetic', 'poetically', 'poetry'], ['visual poetry', 'cinematic poetry', 'like a poem', 'poem like'], 0.9),
  d('minimalist', 'Minimalist', 'craft', ['minimalist', 'minimalism', 'minimal', 'spare', 'sparse', 'austere'], ['stripped back', 'stripped down', 'bare bones']),
  d('immersive', 'Immersive', 'craft', ['immersive', 'immerse', 'immersion', 'absorbing', 'engrossing'], [], 1, ['transporting']),
  d('visually-striking', 'Visually striking', 'craft', ['gorgeous', 'stunning', 'breathtaking', 'ravishing', 'beautifully'], ['visually stunning', 'visually striking', 'visual feast', 'feast for the eyes', 'eye candy'], 0.7),
  d('dialogue-driven', 'Dialogue-driven', 'craft', ['wordy', 'conversational', 'chatty', 'banter'], ['dialogue driven', 'dialogue heavy', 'sharp dialogue', 'snappy dialogue', 'heavy on dialogue'], 0.7, ['talky']),
  d('dreamlike', 'Dreamlike', 'craft', ['dreamlike', 'dreamy', 'oneiric', 'reverie', 'dreamscape', 'ethereal'], ['dream like']),
  d('hypnotic', 'Hypnotic', 'craft', ['hypnotic', 'hypnotising', 'hypnotizing', 'trance', 'trancelike', 'mesmerising', 'mesmerizing', 'spellbinding']),
  d('lush', 'Lush', 'craft', ['lush', 'lushly', 'sumptuous', 'opulent', 'opulence', 'luxuriant', 'verdant']),
  d('sun-drenched', 'Sun-drenched', 'craft', ['sunlit', 'sunbaked', 'sunkissed', 'sundrenched', 'sunsoaked', 'dappled'], ['sun drenched', 'sun soaked', 'golden hour']),
  d('rain-soaked', 'Rain-soaked', 'craft', ['rainy', 'rainswept', 'rainsoaked', 'drizzle', 'drizzly', 'downpour'], ['rain soaked']),
  d('neon-lit', 'Neon-lit', 'craft', ['neon', 'neonlit', 'nocturnal', 'nightscape'], ['neon lit', 'neon soaked'], 0.9),
  d('gritty', 'Gritty', 'craft', ['gritty', 'grit', 'grimy', 'grubby', 'seedy', 'sleazy', 'squalid']),
  d('raw', 'Raw', 'craft', ['raw', 'rawness', 'unpolished', 'scrappy', 'lofi'], ['low budget']),
  d('polished', 'Polished', 'craft', ['slick', 'glossy', 'sleek', 'gleaming'], ['impeccably crafted', 'immaculately crafted', 'impeccably made', 'impeccable production', 'immaculate production'], 1, ['polished']),
  d('stylish', 'Stylish', 'craft', ['stylish', 'stylised', 'stylized', 'stylistic', 'flair', 'chic']),
  d('naturalistic', 'True to life', 'craft', ['naturalistic', 'naturalism', 'verite', 'handheld', 'observational', 'unadorned', 'realism', 'lifelike'], ['cinema verite', 'documentary style', 'true to life']),
  d('surreal', 'Surreal', 'craft', ['surreal', 'surrealist', 'surrealism', 'surrealistic', 'kafkaesque', 'lynchian', 'bizarre', 'trippy']),
  d('epic', 'Epic', 'craft', ['epic', 'grandeur', 'majestic', 'monumental', 'panoramic', 'sprawling'], [], 0.7, ['sweeping']),
  d('intimate', 'Intimate', 'craft', ['intimate', 'intimately', 'intimacy'], ['small scale', 'chamber piece', 'chamber drama'], 0.8, ['chamber']),
  d('painterly', 'Painterly', 'craft', ['painterly', 'tableau', 'tableaux', 'symmetrical', 'symmetry', 'composition', 'compositions']),
  d('sound-led', 'Sound-led', 'craft', ['soundtrack', 'soundscape', 'score', 'synth', 'orchestral'], ['sound design', 'needle drop', 'needle drops'], 0.5),
  d('colourful', 'Colourful', 'craft', ['colourful', 'colorful', 'vibrant', 'technicolour', 'technicolor', 'saturated', 'kaleidoscopic'], ['candy coloured', 'candy colored', 'vivid colour', 'vivid color', 'vivid palette']),
  d('shadowy', 'Shadowy', 'craft', ['monochrome', 'monochromatic', 'chiaroscuro', 'noirish', 'shadowy', 'noir'], ['black and white'], 0.8),
  d('fluid-camera', 'Fluidly shot', 'craft', ['kinetic', 'balletic', 'oner'], ['long take', 'long takes', 'tracking shot', 'tracking shots', 'fluid camera', 'fluid camerawork'], 0.8, ['fluid']),
  d('standout-performances', 'Superbly acted', 'craft', ['powerhouse', 'magnetic', 'commanding'], ['tour de force', 'career best', 'career defining', 'towering performance'], 0.8),
  d('nuanced', 'Nuanced', 'craft', ['nuanced', 'nuance', 'layered', 'multilayered', 'multifaceted', 'subtext', 'subtextual']),
  d('cerebral', 'Intellectual', 'craft', ['cerebral', 'heady', 'erudite', 'esoteric'], ['thought heavy', 'idea heavy', 'heavy on ideas'], 1, ['intellectual']),

  // ---- impact ----
  d('haunting', 'Haunting', 'impact', ['haunting', 'haunted', 'haunts', 'lingering', 'lingers', 'unshakeable'], ['stays with you', 'stayed with me', 'stuck with me', 'long after']),
  d('devastating', 'Devastating', 'impact', ['devastating', 'devastated', 'gutting', 'heartbreaking', 'heartbreak', 'heartrending', 'wrenching'], ['quietly devastating', 'break your heart', 'broke my heart'], 1, ['shattering']),
  d('uplifting', 'Uplifting', 'impact', ['uplifting', 'uplift', 'soaring', 'rousing', 'stirring', 'inspirational', 'triumphant'], [], 1, ['inspiring']),
  d('cathartic', 'Cathartic', 'impact', ['cathartic', 'catharsis', 'tearjerker', 'weepy', 'sobbing', 'sobbed'], ['good cry', 'ugly cry', 'bring tissues', 'box of tissues', 'bring a tissue']),
  d('thought-provoking', 'Thought-provoking', 'impact', ['stimulating', 'ponder', 'thoughtful'], ['thought provoking', 'food for thought', 'makes you think', 'makes you question'], 0.8, ['provoking']),
  d('unsettling', 'Unsettling', 'impact', ['unsettling', 'unsettled', 'unnerving', 'disconcerting', 'discomfiting', 'jarring'], [], 0.9),
  d('harrowing', 'Harrowing', 'impact', ['harrowing', 'agonising', 'agonizing', 'gruelling', 'grueling', 'excruciating'], [], 1, ['punishing']),
  d('gut-punch', 'Gut-punching', 'impact', ['gutpunch', 'wallop', 'winded'], ['gut punch', 'punch to the gut', 'punch in the gut', 'sucker punch'], 0.8, ['floored']),
  d('life-affirming', 'Life-affirming', 'impact', ['affirming', 'rejuvenating', 'invigorating', 'restorative'], ['life affirming', 'restores faith', 'faith in humanity', 'restored my faith', 'zest for life']),
  d('mind-bending', 'Mind-bending', 'impact', ['labyrinthine', 'convoluted', 'twisty', 'puzzlebox', 'mindbending', 'mindblowing', 'bewildering'], ['mind bending', 'mind bender', 'mind blowing']),
  d('moving', 'Moving', 'impact', ['moving', 'poignant', 'poignancy', 'emotive'], [], 0.7, ['touching', 'affecting']),
  d('disturbing', 'Disturbing', 'impact', ['disturbing', 'disturbed', 'disturbingly', 'upsetting', 'distressing', 'sickening', 'nauseating'], [], 1, ['troubling']),
  d('shocking', 'Shocking', 'impact', ['shocking', 'shock', 'shocked', 'jolting', 'startling', 'shocker', 'jawdropping'], ['jaw dropping', 'jaw dropper']),
  d('chilling', 'Chilling', 'impact', ['chilling', 'chilled', 'chills', 'shivers', 'shiver', 'goosebumps'], ['spine tingling', 'spine chilling', 'blood runs cold']),
  d('terrifying', 'Terrifying', 'impact', ['terrifying', 'terrifyingly', 'scary', 'frightening', 'petrifying', 'terror', 'nightmarish']),
  d('thrilling', 'Thrilling', 'impact', ['thrilling', 'thrill', 'thrills', 'thrilled', 'gripping', 'riveting', 'compelling'], ['white knuckle']),
  d('hilarious', 'Hilarious', 'impact', ['hilarious', 'hilariously', 'uproarious', 'hysterical', 'riotous'], ['laugh out loud', 'laughed out loud', 'belly laugh', 'cried laughing']),
  d('charming', 'Charming', 'impact', ['charming', 'charm', 'delightful', 'delightfully', 'winsome']),
  d('intense', 'Intense', 'impact', ['intense', 'intensity', 'intensely', 'searing', 'fierce', 'visceral', 'ferocious']),
  d('brutal', 'Brutal', 'impact', ['brutal', 'brutality', 'brutally', 'savage', 'savagery']),
  d('rewatchable', 'Rewatchable', 'impact', ['rewatchable', 'rewatch', 'rewatched', 'rewatching', 'rewatchability'], ['watch again', 'watched it again', 'multiple viewings', 'repeat viewing']),
  d('profound', 'Profound', 'impact', ['profound', 'profoundly', 'profundity', 'resonant', 'resonates', 'resonance', 'transcendent']),

  // ---- theme ----
  d('grief', 'Grief and mourning', 'theme', ['grief', 'grieving', 'grieve', 'bereavement', 'bereaved', 'mourn', 'mourning', 'bereft'], ['loss of a loved one']),
  d('loneliness', 'Loneliness and isolation', 'theme', ['solitude', 'isolation', 'isolated', 'loner', 'loners', 'aloneness'], ['being alone']),
  d('memory', 'Memory', 'theme', ['memory', 'memories', 'reminiscence', 'recollection'], [], 0.7, ['remembering']),
  d('amnesia', 'Amnesia and forgetting', 'theme', ['amnesia', 'amnesiac', 'forgetfulness'], ['memory loss', 'false memories', 'erased memories'], 1, ['forgetting']),
  d('estrangement', 'Estrangement', 'theme', ['estranged', 'estrangement', 'rift'], ['falling out', 'drifted apart', 'broken family']),
  d('reconciliation', 'Reconciliation', 'theme', ['reconciliation', 'reconcile', 'reconciling', 'reconciled']),
  d('obsession', 'Obsession', 'theme', ['obsession', 'obsessed', 'obsessive', 'fixation', 'fixated', 'compulsion']),
  d('infatuation', 'Infatuation', 'theme', ['infatuation', 'infatuated', 'besotted']),
  d('class', 'Class', 'theme', ['classism', 'bourgeois', 'proletariat'], ['class divide', 'class struggle', 'working class', 'social class', 'class system', 'eat the rich']),
  d('privilege', 'Privilege and the elite', 'theme', ['privilege', 'privileged', 'elitism', 'snobbery', 'aristocracy', 'aristocratic']),
  d('identity', 'Identity', 'theme', ['identity', 'identities', 'selfhood'], ['sense of self']),
  d('self-discovery', 'Self-discovery', 'theme', [], ['self discovery', 'journey of self discovery', 'discovering herself', 'discovering himself']),
  d('found-family', 'Found family', 'theme', [], ['found family', 'chosen family', 'makeshift family', 'family of misfits']),
  d('misfits', 'Misfits and outcasts', 'theme', ['misfits', 'misfit', 'outcasts', 'ragtag']),
  d('coming-of-age', 'Coming of age and adolescence', 'theme', ['adolescence', 'adolescent', 'adolescents', 'teenage', 'teenager', 'teen', 'puberty'], ['coming of age', 'growing up']),
  d('faith', 'Faith and religion', 'theme', ['religion', 'religious', 'spirituality', 'spiritual', 'devout', 'pilgrimage'], ['crisis of faith']),
  d('war', 'War', 'theme', ['war', 'wartime', 'battlefield', 'combat', 'warfare'], [], 0.7, ['wars']),
  d('soldiers', 'Soldiers and veterans', 'theme', ['soldier', 'soldiers', 'veteran', 'veterans', 'infantry', 'troops']),
  d('immigration', 'Immigration', 'theme', ['immigrant', 'immigrants', 'immigration', 'migrant', 'migrants', 'diaspora']),
  d('refugees', 'Refugees', 'theme', ['refugee', 'refugees', 'displacement'], ['asylum seekers', 'seeking asylum']),
  d('addiction', 'Addiction', 'theme', ['addiction', 'junkie', 'rehab', 'relapse', 'overdose'], ['drug abuse'], 1, ['addicted', 'addict', 'addicts']),
  d('ageing', 'Ageing and old age', 'theme', ['ageing', 'aging', 'elderly', 'geriatric', 'dementia'], ['old age', 'growing old', 'later life', 'twilight years']),
  d('parenthood', 'Parenthood', 'theme', ['parenthood', 'motherhood', 'fatherhood', 'maternal', 'paternal'], ['single mother', 'single father'], 1, ['parenting']),
  d('friendship', 'Friendship and camaraderie', 'theme', ['friendship', 'friendships', 'camaraderie', 'companionship', 'bromance', 'buddy', 'buddies']),
  d('revenge', 'Revenge and retribution', 'theme', ['revenge', 'vengeance', 'vengeful', 'avenge', 'avenging', 'vendetta', 'retribution', 'payback']),
  d('justice', 'Justice and injustice', 'theme', ['justice', 'injustice', 'courtroom', 'wrongful', 'wrongfully', 'verdict', 'exoneration', 'acquittal']),
  d('alienation', 'Alienation', 'theme', ['alienation', 'alienated', 'disconnected', 'disconnection', 'rootless', 'dislocation']),
  d('outsiders', 'Outsiders', 'theme', ['outsider', 'outsiders', 'pariah', 'pariahs']),
  d('nature', 'Nature and the environment', 'theme', ['wildlife', 'ecological', 'ecology', 'environmentalism', 'environmental', 'pollution', 'deforestation', 'ecosystem'], ['mother nature', 'natural world', 'climate change', 'vs nature', 'versus nature', 'harmony with nature'], 0.7, ['wilderness']),
  d('technology', 'Technology', 'theme', ['technology', 'technological', 'algorithm', 'algorithms', 'cyberspace', 'surveillance', 'cyberpunk'], ['virtual reality', 'dystopian technology']),
  d('robots', 'Robots and AI', 'theme', ['robots', 'robot', 'android', 'androids', 'cyborg', 'cyborgs'], ['artificial intelligence']),
  d('love-and-loss', 'Heartbreak and lost love', 'theme', ['unrequited', 'breakup', 'heartache', 'jilted', 'lovelorn'], ['lost love', 'star crossed', 'doomed romance', 'doomed love', 'one that got away']),
  d('family-secrets', 'Family secrets', 'theme', [], ['family secrets', 'skeletons in the closet', 'family skeletons', 'dark family secret']),
  d('dysfunction', 'Dysfunctional families', 'theme', ['dysfunctional'], ['toxic family', 'broken home', 'abusive family', 'family dysfunction']),
  d('fame', 'Fame and celebrity', 'theme', ['fame', 'celebrity', 'stardom', 'paparazzi', 'showbiz', 'limelight', 'tabloid']),
  d('creativity', 'Creativity', 'theme', ['muse'], ['creative process', 'artistic process', 'creative block', 'artistic expression', 'writers block']),
  d('artists', 'Artists', 'theme', ['painter', 'painters', 'sculptor'], ['struggling artist', 'aspiring artist', 'starving artist', 'tortured artist', 'young artist', 'life of an artist']),
  d('madness', 'Madness and delusion', 'theme', ['madness', 'insanity', 'delusion', 'delusional', 'psychosis', 'psychotic', 'unraveling', 'unravelling'], ['mental illness', 'losing his mind', 'losing her mind', 'descent into madness']),
  d('survival', 'Survival', 'theme', ['survival', 'survive', 'survivor', 'survivors', 'stranded', 'castaway', 'shipwreck'], ['against the odds']),
  d('small-town-life', 'Small-town life', 'theme', ['hometown', 'provincial', 'rural', 'countryside', 'villagers', 'village'], ['small town', 'small town life', 'close knit community']),
  d('urban-life', 'Urban life', 'theme', ['urban', 'metropolis', 'metropolitan', 'cityscape', 'skyline'], ['big city', 'city life', 'concrete jungle'], 0.7),
  d('crime', 'Crime', 'theme', ['crime', 'criminals', 'heist', 'robbery', 'racketeering'], ['organized crime', 'drug dealer', 'drug trade', 'con artist'], 0.8),
  d('gangsters', 'Gangsters and the mafia', 'theme', ['gangster', 'gangsters', 'mafia', 'underworld', 'hitman', 'mobster', 'mobsters'], [], 0.8),
  d('power', 'Power and corruption', 'theme', ['corruption', 'corrupt', 'authoritarian', 'dictator', 'dictatorship', 'tyranny', 'regime', 'propaganda'], ['abuse of power']),
  d('freedom', 'Freedom and liberation', 'theme', ['freedom', 'liberation', 'emancipation', 'liberating'], ['breaking free', 'break free']),
  d('death', 'Death and dying', 'theme', ['death', 'dying', 'mortality', 'deathbed', 'funeral', 'afterlife', 'terminally']),
  d('redemption', 'Redemption', 'theme', ['redemption', 'redemptive', 'redeem', 'atonement', 'atone', 'penance', 'absolution']),
  d('forgiveness', 'Forgiveness', 'theme', [], ['learning to forgive', 'ask for forgiveness', 'power of forgiveness'], 1, ['forgiveness', 'forgive', 'forgives', 'forgiven']),
  d('betrayal', 'Betrayal', 'theme', ['betrayal', 'betray', 'betrayed', 'treachery', 'traitor', 'traitors', 'backstabbing'], ['double cross']),
  d('infidelity', 'Infidelity', 'theme', ['infidelity', 'adultery', 'unfaithful', 'adulterous'], ['extramarital affair', 'having an affair', 'cheating on']),
  d('marriage', 'Marriage', 'theme', ['marriage', 'marital', 'wedding', 'spouse', 'newlyweds', 'matrimony']),
  d('divorce', 'Divorce and separation', 'theme', ['divorce', 'divorced', 'divorcee'], ['custody battle', 'marriage breakdown']),
  d('queer-lives', 'Queer lives', 'theme', ['queer', 'lgbtq', 'gay', 'lesbian', 'transgender', 'bisexual', 'homosexuality', 'closeted']),
  d('race', 'Race and racism', 'theme', ['racism', 'racist', 'racial', 'segregation', 'apartheid', 'bigotry', 'discrimination'], ['civil rights']),
  d('gender', 'Gender', 'theme', ['gender', 'womanhood', 'feminist', 'feminism', 'femininity'], ['gender roles']),
  d('sexism', 'Sexism and patriarchy', 'theme', ['misogyny', 'misogynistic', 'patriarchy', 'sexism', 'sexist']),
  d('poverty', 'Poverty', 'theme', ['poverty', 'destitute', 'hardship', 'impoverished', 'slum', 'slums'], ['making ends meet']),
  d('homelessness', 'Homelessness', 'theme', ['homeless', 'homelessness', 'vagrant', 'vagrants']),
  d('childhood', 'Childhood', 'theme', ['childhood', 'schoolyard', 'playground', 'orphan', 'orphans', 'orphaned']),
  d('innocence', 'Innocence', 'theme', ['innocence', 'naivety', 'naivete'], ['loss of innocence']),
  d('siblings', 'Siblings', 'theme', ['sibling', 'siblings', 'brotherhood', 'sisterhood'], ['sibling rivalry']),
  d('twins', 'Twins', 'theme', ['twins', 'twin', 'twinship']),
  // ---- big themes added 30 Oct (Letterboxd-style: Relationships, Family, Trauma, Morality, Politics, Violence) ----
  d('relationships', 'Relationships', 'theme', ['relationship', 'relationships'], ['human connection', 'interpersonal relationships'], 0.5),
  d('romance', 'Romance', 'theme', ['romance', 'lovers', 'courtship'], ['falling in love', 'love story', 'first love', 'love affair', 'love triangle'], 0.8),
  d('family', 'Family', 'theme', ['family', 'families', 'familial', 'matriarch', 'patriarch'], ['family drama', 'family bonds', 'family ties'], 0.5),
  d('trauma', 'Trauma and PTSD', 'theme', ['trauma', 'traumatic', 'traumatised', 'traumatized', 'ptsd'], ['post traumatic'], 0.8),
  d('morality', 'Morality and conscience', 'theme', ['morality', 'moral', 'morals', 'ethical', 'ethics', 'conscience', 'amoral'], ['moral dilemma', 'right and wrong', 'moral ambiguity'], 0.6),
  d('politics', 'Politics', 'theme', ['politics', 'political', 'politician', 'politicians'], [], 0.6),
  d('activism', 'Activism and protest', 'theme', ['activism', 'activist', 'activists', 'protesters', 'protestors']),
  d('violence', 'Violence and bloodshed', 'theme', ['violence', 'violent', 'bloodshed', 'massacre'], ['cycle of violence'], 0.6),
  // ---- more big themes: language, fate, music, ambition, guilt, masculinity ----
  d('language', 'Language and communication', 'theme', ['linguist', 'linguistics', 'linguistic', 'translator', 'translation', 'dialect', 'communication'], ['language barrier', 'alien language', 'written language', 'universal language', 'mother tongue', 'learn the language'], 0.8),
  d('fate', 'Fate and free will', 'theme', ['fate', 'fated', 'destiny', 'predestined', 'predestination', 'determinism', 'inevitability'], ['free will', 'no choice', 'set in stone'], 0.8),
  d('music', 'Music and musicians', 'theme', ['musician', 'musicians', 'songwriter', 'bandleader', 'blues', 'jazz', 'guitarist'], ['rock and roll', 'music industry', 'juke joint', 'jam session'], 0.8),
  d('ambition', 'Ambition and hustle', 'theme', ['ambition', 'hustle', 'hustler', 'striving', 'careerism', 'careerist'], ['self belief', 'rise to stardom', 'climb the ladder', 'drive to succeed'], 0.6),
  d('guilt', 'Guilt', 'theme', ['guilt', 'remorse', 'remorseful', 'culpability', 'blameworthy'], ['feelings of guilt', 'survivor guilt', 'consumed by guilt'], 0.8),
  d('shame', 'Shame', 'theme', ['ashamed', 'humiliation', 'humiliated'], [], 0.8, ['shame', 'shameful']),
  d('masculinity', 'Masculinity and manhood', 'theme', ['masculinity', 'masculine', 'manhood', 'machismo', 'virility', 'emasculation', 'emasculated'], ['toxic masculinity']),
];

// Everyday idioms and titles that contain a lexicon word but don't mean it ("such a shame", "Mr. Robot", "redeems itself").
// The matcher reads each as a unit and skips it, so the word inside never counts. Two or more words each.
export const STOP_PHRASES = [
  'emotional roller coaster', 'emotional rollercoaster', 'roller coaster of emotions', 'rollercoaster of emotions', 'slow motion', 'slow mo', 'slow cooked', 'slow down', 'slowed down', 'slowing down', 'slow dance', 'slow dancing', 'slow descent', 'slow death', 'a shame', 'mr robot', 'twin peaks', 'star wars', 'spiritual experience', 'spiritual successor', 'spiritual sequel',
  'redeems itself', 'redeem itself', 'redeeming value', 'redeeming qualities', 'redeeming features',
  'multiverse of madness', 'method to the madness', 'method in the madness', 'method to his madness',
  // Idioms and set phrases that hold a feeling word without feeling it.
  'master of suspense', 'magical realism', 'magic realism', 'hopeless romantic', 'poetic justice', 'poetic licence', 'poetic license',
  'prince charming', 'charming prince', 'charm offensive', 'war on terror', 'downpour of', 'rage against the machine', 'heavy handed',
  // DECISION: Letterboxd's own theme-group names. They name a kind of film ("Crude humor and satire"), not how this one feels, and every film
  // in the group would otherwise get the same chip. They still show in the Themes row.
  'crude humor and satire', 'intense violence and sexual transgression', 'moving relationship stories', 'epic heroes', 'epic history and literature',
];

// Words that only count in some contexts. Key = the spelling as typed (lowercase, or two words for a phrase); `prev` / `next` = neighbouring
// words (same sentence) that turn the match off. Used for: another sense of the word, and praise aimed at people rather than the film.
const PERFORMERS = ['performance', 'performances', 'performer', 'performers', 'acting', 'cast', 'ensemble', 'lead', 'leads', 'actor', 'actress', 'turn',
  'script', 'writing', 'dialogue', 'screenplay', 'ending', 'finale', 'twist', 'debut', 'direction', 'soundtrack', 'score', 'music', 'voice', 'voices',
  'work', 'portrayal', 'portrayals', 'chemistry', 'character', 'characters', 'protagonist', 'villain', 'hero', 'man', 'woman', 'boy', 'girl', 'guy',
  'lady', 'duo', 'pair', 'couple', 'sociopath', 'psychopath', 'killer', 'stranger', 'rogue'];
const SUBJECT_PRONOUNS = ['i', 'we', 'you', 'they', 'he', 'she', 'id', 'ill', 'ive', 'weve', 'theyd', 'to', 'do', 'dont', 'didnt', 'doesnt', 'cant', 'would', 'wouldnt',
  'will', 'wont', 'might', 'can', 'could', 'always', 'just', 'really', 'still', 'often', 'only', 'let', 'lets'];
export const GUARDS = {
  // another sense of the word
  // A genre name ("romantic comedy drama film") says what kind of film it is, not that it feels romantic.
  romantic: { prev: [], next: ['comedy', 'comedies', 'drama', 'dramas', 'thriller', 'adventure', 'fantasy', 'musical'] },
  wonder: { prev: SUBJECT_PRONOUNS, next: ['if', 'whether', 'why', 'how', 'what', 'who', 'where', 'when', 'woman', 'years', 'boy', 'bread', 'about'] },
  hope: { prev: SUBJECT_PRONOUNS, next: ['you', 'to', 'they', 'this', 'so', 'he', 'she', 'we', 'i', 'there', 'someone', 'everyone', 'one', 'that', 'the', 'it', 'my', 'your', 'his', 'her', 'our', 'their'] },
  moving: { prev: ['fast', 'slow', 'slowly', 'camera', 'keeps', 'keep', 'kept', 'constantly', 'ever', 'forward', 'back'],
    next: ['to', 'on', 'towards', 'toward', 'into', 'onto', 'forward', 'through', 'along', 'from', 'around', 'between', 'out', 'in', 'up', 'down', 'back', 'away', 'off', 'past', 'across', 'over', 'at',
      'picture', 'pictures', 'image', 'images', 'parts', 'target', 'van', 'truck', 'pieces', 'house', 'abroad', 'camera', 'shot', 'shots', 'train', 'car', 'cars', 'vehicle'] },
  touching: { next: ['her', 'his', 'him', 'them', 'the', 'each', 'one', 'a', 'an', 'their', 'my', 'your', 'its', 'it', 'on', 'upon', 'base', 'up', 'down', 'ground', 'themselves', 'hands', 'hand', 'lips', 'face', 'faces'] },
  affecting: { next: ['the', 'their', 'his', 'her', 'my', 'your', 'its', 'how', 'him', 'them', 'us', 'everyone', 'all', 'our', 'change'] },
  shocked: { next: ['to', 'that'] },
  shock: { prev: ['culture', 'shell', 'electric', 'in', 'sticker'], next: ['absorbers', 'absorber', 'collar', 'troops'] },
  tender: { prev: ['legal'], next: ['age', 'loving', 'offer', 'bid', 'process', 'meat', 'steak', 'spot', 'points'] },
  tension: { prev: ['racial', 'political', 'social', 'ethnic', 'class', 'religious', 'cultural', 'international', 'sectarian', 'geopolitical', 'diplomatic'] },
  heavy: { next: ['metal', 'drinking', 'drinker', 'handed', 'lifting', 'rain', 'traffic', 'breathing', 'duty', 'artillery', 'machinery', 'load', 'use', 'smoker', 'smoking', 'hand', 'weapons'] },
  crushing: { next: ['defeat', 'majority', 'debt', 'victory'] },
  sweeping: { next: ['statement', 'statements', 'generalisation', 'generalisations', 'generalization', 'generalizations', 'changes', 'reforms', 'claims'] },
  monumental: { next: ['achievement', 'mistake', 'blunder', 'failure', 'flop', 'performance', 'work', 'talent', 'waste', 'success', 'impact', 'effort'] },
  epic: { next: ['fail', 'fails', 'failure', 'win', 'wins'] },
  'low key': { prev: ['i', 'we', 'im', 'ive', 'you', 'they'], next: ['want', 'love', 'hate', 'think', 'need', 'kind', 'kinda', 'obsessed', 'cry', 'crying', 'hurt', 'sad', 'wanna', 'ship', 'feel', 'felt', 'loved', 'enjoyed', 'wanted', 'fell', 'relate', 'mad', 'angry', 'annoyed', 'disappointed', 'cringe', 'jealous', 'scared', 'terrified', 'gay', 'hot', 'cute', 'like', 'just', 'actually', 'been', 'am', 'was'] },
  raw: { next: ['footage', 'material', 'materials', 'data', 'meat', 'fish', 'ingredients', 'egg', 'eggs', 'sewage', 'vegetables', 'deal'] },
  spare: { prev: ['to', 'can', 'could', 'would', 'will', 'should', 'must', 'no'], next: ['time', 'parts', 'part', 'change', 'room', 'tire', 'key', 'us', 'him', 'her', 'them', 'me', 'no', 'you', 'your', 'his', 'their', 'my', 'our', 'its', 'the', 'a', 'an'] },
  minimal: { next: ['effort', 'damage', 'impact', 'difference', 'changes', 'interference', 'cost', 'risk'] },
  score: { prev: ['average', 'weighted', 'positive', 'metascore', 'audience', 'critic', 'critics', 'user', 'review', 'overall', 'rating', 'aggregate', 'to', 'could', 'would', 'will', 'can', 'he', 'she', 'they', 'i', 'we'], next: ['of', 'on', 'from', 'out'] },
  trance: { next: ['music', 'beats', 'beat'] },
  polished: { next: ['off'] },
  haunted: { next: ['house', 'houses', 'mansion', 'hotel', 'castle', 'forest', 'attraction'] },
  chilled: { next: ['out', 'wine', 'beer', 'water', 'champagne'] },
  peaceful: { next: ['protest', 'protests', 'transition', 'coexistence', 'resolution', 'solution', 'demonstration', 'demonstrators'] },
  blunt: { next: ['instrument', 'force', 'object', 'trauma'] },
  biting: { next: ['into', 'off', 'down', 'her', 'his', 'my', 'their', 'your', 'the', 'nails', 'lip', 'tongue', 'back', 'at'] },
  intellectual: { next: ['property', 'properties', 'disability', 'disabilities'] },
  rage: { next: ['against'] },
  // praise aimed at people or a part of the film ("charming performances", "a stunning score") says nothing about how the film feels
  compelling: { next: PERFORMERS },
  gripping: { next: PERFORMERS },
  riveting: { next: PERFORMERS },
  stunning: { next: PERFORMERS },
  gorgeous: { next: PERFORMERS },
  breathtaking: { next: PERFORMERS },
  charming: { next: PERFORMERS },
  delightful: { next: PERFORMERS },
  winsome: { next: PERFORMERS },
  vibrant: { next: [...PERFORMERS, 'community', 'communities', 'energy', 'personality', 'personalities', 'city', 'culture', 'life'] },
  charm: { prev: ['his', 'her', 'their'], next: ['of', 'offensive'] },
  beautifully: { next: ['acted', 'written', 'performed', 'played', 'observed', 'told', 'paced', 'balanced', 'scripted', 'portrayed', 'executed'] },
};

/** Directions for "like this one, but ...". Each side lists descriptor ids. */
export const AXES = [
  { id: 'weight', low: 'Lighter', high: 'Heavier',
    lowIds: ['playful', 'carefree', 'whimsical', 'heartwarming', 'cosy', 'hilarious', 'farcical'],
    highIds: ['bleak', 'harrowing', 'oppressive', 'devastating', 'brutal', 'gloomy', 'disturbing'] },
  { id: 'pace', low: 'Slower', high: 'Faster',
    lowIds: ['slow-burn', 'languid', 'unhurried', 'meditative', 'glacial', 'slow-paced'],
    highIds: ['propulsive', 'frenetic', 'breakneck', 'relentless', 'tightly-paced'] },
  { id: 'strangeness', low: 'More grounded', high: 'Stranger',
    lowIds: ['naturalistic', 'earnest', 'understated', 'minimalist', 'measured'],
    highIds: ['surreal', 'dreamlike', 'absurd', 'mind-bending', 'quirky', 'hypnotic'] },
  { id: 'warmth', low: 'Cooler', high: 'Warmer',
    lowIds: ['cynical', 'bleak', 'brooding', 'chilling', 'sardonic'],
    highIds: ['tender', 'cosy', 'heartwarming', 'charming', 'joyful'] },
  { id: 'hope', low: 'Bleaker', high: 'More hopeful',
    lowIds: ['bleak', 'despairing', 'gloomy', 'cynical', 'harrowing', 'oppressive'],
    highIds: ['hopeful', 'uplifting', 'life-affirming', 'euphoric', 'joyful', 'heartwarming'] },
  { id: 'scale', low: 'More intimate', high: 'More epic',
    lowIds: ['intimate', 'minimalist', 'understated', 'dialogue-driven', 'tender'],
    highIds: ['epic', 'lush', 'visually-striking', 'sound-led', 'colourful'] },
  { id: 'humour', low: 'More serious', high: 'Funnier',
    lowIds: ['solemn', 'earnest', 'bleak', 'harrowing', 'brooding'],
    highIds: ['hilarious', 'deadpan', 'farcical', 'wry', 'playful', 'absurd', 'satirical'] },
  { id: 'polish', low: 'Rawer', high: 'More polished',
    lowIds: ['raw', 'gritty', 'naturalistic', 'unflinching'],
    highIds: ['polished', 'stylish', 'lush', 'visually-striking', 'colourful'] },
];
