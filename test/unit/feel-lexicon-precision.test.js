// Precision fixes for the feeling words. Sentences are synthetic (modelled on real review text) unless noted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEXICON, STOP_PHRASES, GUARDS } from '../../core/analysis/feel/lexicon.js';
import { buildMatcher, prepareText, scanText, scanHits, allTexts } from '../../core/analysis/feel/extract.js';

const m = buildMatcher(LEXICON);
const fired = (text, extra = {}) => [...scanText(prepareText({ text, ...extra }), m).keys()];
const no = (id, ...texts) => { for (const t of texts) assert.ok(!fired(t).includes(id), `${id} should not fire on: ${t}`); };
const yes = (id, ...texts) => { for (const t of texts) assert.ok(fired(t).includes(id), `${id} should fire on: ${t}`); };

test('negation: a negator within two words turns the feeling word off', () => {
  no('terrifying', 'It is not scary at all.', "Honestly it isn't very scary.", 'Never scary, just sad.');
  no('chaotic', 'Yet, there is hardly anything chaotic about Ran.');
  no('sentimental', 'Avoids the sentimentality of his earlier films.', 'Moving without any sentimentality.');
  no('provocative', 'Deals with serious issues in a non-confrontational way.');
  no('tense', 'Lacks tension.', "It doesn't feel tense.");
  yes('terrifying', 'It is scary.', 'Scary, not funny.');
});

test('negation: the clause turning round or carrying on keeps the word', () => {
  yes('terrifying', 'Not only scary but moving.', 'Not just scary, deeply sad.', 'No doubt a scary film.');
  yes('moving', 'Nothing short of moving.', "I can't help but find it moving.");
  yes('sad', "I couldn't stop crying, it was sad.");
  // a comma or full stop ends the reach of the negator
  yes('terrifying', 'Not a comedy, scary.', 'It is not a comedy. Scary stuff.');
  // "never-ending" is a compound, not a negation
  yes('irreverent', 'Its never-ending subversive brilliance.');
});

test('negation does not apply to a query (no text)', () => {
  const stems = prepareText({ text: 'not scary' }).stems;
  assert.ok(scanText({ stems }, m).has('terrifying'));
});

test('adverbs the lexicon does not list say how something happens, not what the film is like', () => {
  no('unflinching', 'The point is bluntly, incessantly hammered home.');
  no('cerebral', 'Intellectually, I was interested.');
  no('slow-burn', 'He gradually befriends the team.');
  yes('slow-burn', 'It unfolds slowly.'); // a listed phrase
  yes('slow-paced', 'Very slow paced, and too slow for me.');
  no('slow-paced', 'He slowly loses his mind.'); // tells the plot, not the pace
  no('slow-paced', 'The slow motion shots are gorgeous.');
  yes('relentless', 'A relentlessly fast pace.'.replace('relentlessly', 'relentless'));
  yes('brutal', 'Brutally honest and brutal to watch.');
});

test('hope: the verb and cast names are not a mood', () => {
  no('hopeful', 'I hope Charlie is happy.', "Let's hope nobody tries it.", 'Written in the hope that it helps.');
  yes('hopeful', 'A film about hope and endurance.', 'It ends on a note of hope.', 'Hopeful and warm.');
});

test('wonder: "I wonder if" is not wonder; a sense of wonder is', () => {
  no('wonder', 'I wonder if she ever thinks about it.', 'Ever wonder what those dots are?', 'Wonder Woman fans will like it.');
  yes('wonder', 'A sense of wonder throughout.', 'Full of awe and wonder.', 'An awe-inspiring journey.');
  no('uplifting', 'An awe-inspiring journey.');
});

test('moving: movement is not emotion', () => {
  no('moving', 'The camera keeps moving towards him.', 'Production moving to London later that year.', 'Her moving on from him is the point.', 'A fast moving plot.');
  yes('moving', 'A deeply moving film.', 'Moving and funny.', 'So moving by the end.');
  no('moving', 'She is touching the piano keys.', 'It touches on grief.'.replace('touches', 'touching'));
  yes('moving', 'A touching story about two friends.');
  no('moving', 'Weather affecting the crops.');
});

test('ironic: "knowing" alone is not irony; a knowing wink is', () => {
  no('ironic', 'Despite knowing the journey, she goes.', 'Ironically, the film failed.');
  yes('ironic', 'A knowing wink at the genre.', 'Deeply ironic, self aware.');
});

test('stems that only look like the word: withered, creep, crush, grimes, chambers, polish, fluids, talkies', () => {
  no('biting', 'His face is weary and withered.', 'It was left on the cutting room floor.', 'Composing with cutting.');
  yes('biting', 'A withering takedown.', 'Cutting wit and a scathing eye.');
  no('slow-burn', 'Feelings can creep up on you.');
  yes('slow-burn', 'A creeping dread builds slowly.');
  no('oppressive', 'He has a crush on her.', 'The case was heavily disputed.');
  yes('oppressive', 'A crushing, oppressive silence.');
  no('bleak', 'Starring Luke Grimes and Emma Stone.');
  yes('bleak', 'A grim and bleak outlook.');
  no('intimate', 'Sheriff Al Chambers arrives.');
  yes('intimate', 'A chamber piece about two people.');
  no('polished', 'A coproduction with the Polish Film Institute.');
  yes('polished', 'A polished, glossy thriller.');
  no('fluid-camera', 'Covered in bodily fluids.');
  yes('fluid-camera', 'Long takes and fluid camera work.');
  no('dialogue-driven', 'The birth of the talkies.');
  yes('dialogue-driven', 'Talky and conversational.');
});

test('idioms and set phrases', () => {
  no('tense', 'The pudgy master of suspense returns.');
  yes('tense', 'A tense, suspenseful thriller.');
  no('naturalistic', 'A magical realism drama.');
  yes('naturalistic', 'A film of gritty realism.');
  no('despairing', 'A hopeless romantic at heart.');
  yes('despairing', 'A hopeless, bleak ending.');
  no('lyrical', 'There is a kind of poetic justice in it.');
  yes('lyrical', 'Poetic and visual.');
  no('charming', 'Prince Charming arrives.');
  no('rain-soaked', 'An absolute downpour of joy.');
});

test('other senses: score, shock, tension, grave, tight, lean, heavy, raw, spare', () => {
  no('sound-led', 'The film holds a score of 80 out of 100.', 'Metacritic gave an average score of 74.', 'He could score the scene himself.');
  yes('sound-led', 'The score is haunting.', 'A memorable soundtrack.');
  no('shocking', "Shocked to learn it's a remake.", 'Suffering from culture shock.');
  yes('shocking', 'A shocking ending.');
  no('tense', 'Racial tensions rise.', 'Political tension in the city.');
  yes('tense', 'The tension is unbearable.');
  no('solemn', "Laying flowers on his grave.", 'Grave of the Fireflies is a war film.');
  yes('solemn', 'A solemn, grave tone.');
  no('tightly-paced', 'A tight budget.', 'He will lean on his friends.');
  no('tightly-paced', 'Lean and economical.'); // said in phrases only since 12 Nov
  yes('tightly-paced', 'Well paced, with never a dull moment.');
  no('oppressive', 'Heavy metal soundtrack.', 'A heavy-handed message.');
  no('raw', 'Raw footage from the set.');
  yes('raw', 'Raw and unpolished.');
  no('minimalist', 'Spare us the details.', 'Spare time.');
  yes('minimalist', 'Spare, minimal and quiet.');
  no('understated', 'I low-key want to see it.');
  yes('understated', 'A low key, understated drama.');
  no('lonely', 'Fighting for peace.'); // control
});

test('praise aimed at people or one part of the film does not describe how the film feels', () => {
  no('charming', 'Charming performances all round.', 'A charming lead.', 'Full of charming characters.');
  yes('charming', 'A charming, delightful comedy.', 'The film has real charm.');
  no('charm', 'Prince Charming'); // not a descriptor id: control
  no('thrilling', 'A compelling performance by the lead.', 'Gripping acting.');
  yes('thrilling', 'A gripping thriller.', 'Compelling and riveting.');
  no('visually-striking', 'A stunning performance.', 'Gorgeous voice work.', 'Beautifully acted.');
  yes('visually-striking', 'A stunning, gorgeous film.', 'Beautifully animated.', 'Visually stunning.');
  no('colourful', 'A vibrant community.');
  yes('colourful', 'Vibrant, saturated colours.');
});

test('Black Swan case: charm and delicacy in a dark ballet film do not become Charming or Tender', () => {
  const text = 'A delicate ballerina, disarming and fragile, under the charm of a seductive director. Prince Charming is the ballet. A delicate balance of nerves.';
  no('charming', text);
  no('tender', text);
  // the film's own words still count
  yes('tender', 'A tender, delicately handled love story.');
});

test('the film title and cast names are never read as a feeling', () => {
  const fury = { title: 'Mad Max: Fury Road' };
  no('angry', ...[]);
  assert.ok(!fired('Mad Max: Fury Road is a 2015 action film.', fury).includes('angry'));
  assert.ok(fired('Mad Max: Fury Road is a 2015 action film.').includes('angry')); // without the title, it would
  assert.ok(fired('Pure fury on the road.', fury).includes('angry'));
  assert.ok(!fired('Oh, you love 12 Angry Men?', { title: '12 Angry Men' }).includes('angry'));
  assert.ok(!fired('Grave of the Fireflies is a war film.', { title: 'Grave of the Fireflies' }).includes('solemn'));
  assert.ok(!fired('Sentimental Value is a drama.', { title: 'Sentimental Value' }).includes('sentimental'));
  // a one-word title is masked everywhere; other words are not
  assert.ok(!fired('Wonder is a family drama.', { title: 'Wonder' }).includes('wonder'));
  assert.ok(fired('A bleak, grim drama.', { title: 'Wonder' }).includes('bleak'));
  // surnames: only when capitalised and in the film's people
  const names = ['david', 'lean'];
  assert.ok(!fired("Lean's masterpiece.", { names }).includes('tightly-paced'));
  assert.ok(!fired('Directed by David Lean.', { names }).includes('tightly-paced'));
  assert.ok(fired('A film full of hope.', { names: ['hope', 'davis'] }).includes('hopeful')); // lower case: a word
  assert.ok(!fired('Starring Hope Davis.', { names: ['hope', 'davis'] }).includes('hopeful'));
});

test('allTexts carries the title and the words of people names', () => {
  const t = allTexts({ title: 'Lawrence of Arabia', texts: [{ voice: 'viewers', text: 'x' }], people: { director: [{ name: 'David Lean' }], cast: [{ name: 'Peter O\'Toole' }, null] } });
  assert.equal(t[0].title, 'Lawrence of Arabia');
  assert.ok(t[0].names.includes('lean') && t[0].names.includes('david'));
});

test('theme-group names Letterboxd gives a film do not read as feelings', () => {
  for (const g of ['Crude humor and satire', 'Intense violence and sexual transgression', 'Moving relationship stories', 'Epic heroes', 'Epic history and literature']) {
    assert.deepEqual(fired(g).filter(id => LEXICON.find(d => d.id === id).facet !== 'theme'), [], g);
  }
  // but a review that says the same about itself still counts
  yes('bawdy', 'The humour is crude.');
  yes('satirical', 'A sharp satire.');
});

test('guards only name spellings the lexicon knows, and stop phrases stay 2+ words', () => {
  const listed = new Set(LEXICON.flatMap(d => [...d.words, ...(d.exactWords || []), ...(d.phrases || [])]));
  for (const key of Object.keys(GUARDS)) assert.ok(listed.has(key), `guard "${key}" is not a lexicon spelling`);
  for (const p of STOP_PHRASES) assert.ok(p.split(' ').length >= 2, p);
});

test('scanHits returns the same matches scanText counts', () => {
  const prep = prepareText({ text: 'Tense and tense, but not scary.' });
  const hits = scanHits(prep, m);
  assert.deepEqual(hits.map(h => h.word), ['tense', 'tense']);
  assert.equal(scanText(prep, m).get('tense').count, 2);
});
