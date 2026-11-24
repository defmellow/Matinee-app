// Synthetic films only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoTags, autoTagIds, tagIndex, slugify, foldText, foldSearch, canonicalCountry, subjectTags } from '../../core/analysis/tags.js';

const labels = (f, group) => autoTags(f).filter(t => !group || t.group === group).map(t => t.label);
const ids = (f, group) => autoTags(f).filter(t => !group || t.group === group).map(t => t.id);

test('slugify is lowercase, ascii and hyphenated', () => {
  assert.equal(slugify('Wim Wenders'), 'wim-wenders');
  assert.equal(slugify('Amélie'), 'amelie');
  assert.equal(slugify("Ocean's Eleven"), 'oceans-eleven');
  assert.equal(slugify('Sci-Fi & Fantasy'), 'sci-fi-and-fantasy');
  assert.equal(slugify('  --Hello,   World!--  '), 'hello-world');
  assert.equal(slugify('Ørnulf Ærø'), 'ornulf-aero');
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify(null), '');
  // Nothing ascii left: keep the letters so ids stay distinct and stable.
  assert.equal(slugify('宮崎 駿'), '宮崎-駿');
  assert.notEqual(slugify('宮崎駿'), slugify('黒澤明'));
  assert.equal(slugify('Wim Wenders'), slugify('Wim Wenders')); // stable
});

test('foldText and foldSearch ignore case, accents and punctuation', () => {
  assert.equal(foldText('Amélie'), 'amelie');
  assert.equal(foldSearch("Ocean's 11: The Heist!"), 'oceans 11 the heist');
  assert.equal(foldSearch('Tom & Jerry'), 'tom and jerry');
  assert.equal(foldSearch('千と千尋の神隠し'), '千と千尋の神隠し');
  assert.equal(foldSearch(undefined), '');
});

test('decade tag', () => {
  assert.deepEqual(autoTags({ year: 1984 }).find(t => t.group === 'decade'), { id: 'decade:1980s', label: '1980s', group: 'decade' });
  assert.equal(labels({ year: 2000 }, 'decade')[0], '2000s');
  assert.equal(labels({ year: 1999 }, 'decade')[0], '1990s');
  assert.deepEqual(labels({ year: null }, 'decade'), []);
  assert.deepEqual(labels({}, 'decade'), []);
  assert.deepEqual(labels({ year: 'abc' }, 'decade'), []);
});

test('length tags', () => {
  const len = runtime => labels({ runtime }, 'length');
  assert.deepEqual(len(25), ['Short film']);
  assert.deepEqual(len(39), ['Short film']);
  assert.deepEqual(len(40), ['Under 90 minutes']);
  assert.deepEqual(len(89), ['Under 90 minutes']);
  assert.deepEqual(len(90), []);
  assert.deepEqual(len(149), []);
  assert.deepEqual(len(150), ['Epic (2½ hours+)']);
  assert.deepEqual(len(238), ['Epic (2½ hours+)']);
  assert.deepEqual(len(null), []);
  assert.deepEqual(len(0), []);
  assert.deepEqual(len(undefined), []);
  assert.equal(ids({ runtime: 80 }, 'length')[0], 'length:under-90');
});

test('genre tags keep their names', () => {
  assert.deepEqual(autoTags({ genres: ['Drama', 'Science Fiction'] }).filter(t => t.group === 'genre'), [
    { id: 'genre:drama', label: 'Drama', group: 'genre' },
    { id: 'genre:science-fiction', label: 'Science Fiction', group: 'genre' },
  ]);
});

test('country tags use sensible articles', () => {
  const c = names => labels({ countries: names }, 'country');
  assert.deepEqual(c(['Japan']), ['From Japan']);
  assert.deepEqual(c(['United States of America']), ['From the USA']);
  assert.deepEqual(c(['United States']), ['From the USA']);
  assert.deepEqual(c(['United Kingdom']), ['From the UK']);
  assert.deepEqual(c(['Netherlands', 'Philippines']), ['From the Netherlands', 'From the Philippines']);
  assert.deepEqual(c(['Czech Republic']), ['From the Czech Republic']);
  assert.deepEqual(c(['Czechia']), ['From the Czech Republic']);
  assert.deepEqual(c(['Soviet Union']), ['From the Soviet Union']);
  assert.deepEqual(c(['United Arab Emirates']), ['From the UAE']);
  assert.deepEqual(c(['South Korea']), ['From South Korea']);
  assert.deepEqual(c(['Republic of Korea']), ['From South Korea']);
  assert.deepEqual(c(['Hong Kong', 'France']), ['From Hong Kong', 'From France']);
  assert.deepEqual(c(['']), []);
});

test('spellings of one country share an id, so facets merge them', () => {
  assert.equal(autoTags({ countries: ['United States of America'] }).find(t => t.group === 'country').id, 'country:usa');
  assert.equal(autoTags({ countries: ['USA'] }).find(t => t.group === 'country').id, 'country:usa');
  assert.equal(autoTags({ countries: ['United Kingdom'] }).find(t => t.group === 'country').id, 'country:uk');
  assert.equal(autoTags({ countries: ['Japan'] }).find(t => t.group === 'country').id, 'country:japan');
  assert.deepEqual(canonicalCountry('Great Britain'), { id: 'uk', label: 'the UK' });
  assert.equal(canonicalCountry(''), null);
  // A co-production listing both spellings gives one tag.
  assert.equal(labels({ countries: ['United States', 'United States of America'] }, 'country').length, 1);
});

test('language tags leave out English', () => {
  assert.deepEqual(labels({ languages: ['English'] }, 'language'), []);
  assert.deepEqual(labels({ languages: ['en'] }, 'language'), []);
  assert.deepEqual(labels({ languages: ['English', 'Korean'] }, 'language'), ['In Korean']);
  assert.deepEqual(ids({ languages: ['Korean'] }, 'language'), ['language:korean']);
  assert.deepEqual(labels({ languages: ['No Language'] }, 'language'), []);
  assert.deepEqual(labels({ languages: ['Japanese', 'Mandarin Chinese'] }, 'language'), ['In Japanese', 'In Mandarin Chinese']);
});

test('director tags', () => {
  const tags = autoTags({ directors: [{ name: 'Wim Wenders', id: 'wd:Q1' }, { name: 'Pina Bausch' }] }).filter(t => t.group === 'director');
  assert.deepEqual(tags, [
    { id: 'director:wim-wenders', label: 'Directed by Wim Wenders', group: 'director' },
    { id: 'director:pina-bausch', label: 'Directed by Pina Bausch', group: 'director' },
  ]);
  assert.deepEqual(labels({ directors: [{ name: '' }, null] }, 'director'), []);
  assert.deepEqual(labels({ directors: ['Agnès Varda'] }, 'director'), ['Directed by Agnès Varda']);
  assert.equal(ids({ directors: [{ name: 'Agnès Varda' }] }, 'director')[0], 'director:agnes-varda');
});

test('award tags: Oscars', () => {
  const a = awards => labels({ awards }, 'award');
  assert.deepEqual(a([{ name: 'Academy Award for Best Picture', won: true }]), ['Best Picture winner', 'Oscar winner']);
  assert.deepEqual(a([{ name: 'Academy Award for Best Director', won: true }]), ['Oscar winner']);
  assert.deepEqual(a([{ name: 'Academy Award for Best Picture', won: false }]), ['Oscar nominated']);
  assert.deepEqual(a([{ name: 'Academy Award for Best Director', won: false }, { name: 'Academy Award for Best Actor', won: true }]), ['Oscar winner']);
  assert.deepEqual(a([{ name: 'Academy Award for Best Actor', won: false }]), ['Oscar nominated']);
  assert.deepEqual(a([]), []);
  assert.deepEqual(a(undefined), []);
});

test('award tags: festivals and other prizes', () => {
  const a = awards => labels({ awards }, 'award');
  assert.deepEqual(a([{ name: "Palme d'Or", won: true }]), ["Palme d'Or"]);
  assert.deepEqual(a([{ name: 'Palme d’Or', won: true }]), ["Palme d'Or"]);
  assert.deepEqual(a([{ name: "Palme d'Or", won: false }]), []);
  assert.deepEqual(a([{ name: 'Golden Lion', won: true }]), ['Golden Lion']);
  assert.deepEqual(a([{ name: 'Golden Bear', won: true }]), ['Golden Bear']);
  assert.deepEqual(a([{ name: 'BAFTA Award for Best Film', won: true }]), ['BAFTA winner']);
  assert.deepEqual(a([{ name: 'British Academy Film Award for Best Direction', won: true }]), ['BAFTA winner']);
  assert.deepEqual(a([{ name: 'Golden Globe Award for Best Motion Picture – Drama', won: true }]), ['Golden Globe winner']);
  assert.deepEqual(a([{ name: 'Golden Globe Award for Best Motion Picture – Drama', won: false }]), []);
});

test('a BAFTA is not mistaken for an Oscar', () => {
  assert.deepEqual(labels({ awards: [{ name: 'British Academy Film Award for Best Film', won: true }] }, 'award'), ['BAFTA winner']);
});

test('several prizes together come out in a fixed order', () => {
  const t = labels({ awards: [
    { name: 'Golden Globe Award for Best Picture', won: true },
    { name: 'BAFTA Award for Best Film', won: true },
    { name: "Palme d'Or", won: true },
    { name: 'Academy Award for Best Picture', won: true },
  ] }, 'award');
  assert.deepEqual(t, ['Best Picture winner', 'Oscar winner', "Palme d'Or", 'BAFTA winner', 'Golden Globe winner']);
});

test('source tags', () => {
  const src = basedOn => labels({ basedOn }, 'source');
  assert.deepEqual(src([]), []);
  assert.deepEqual(src(undefined), []);
  assert.deepEqual(src(['Pride and Prejudice']), ['Based on another work']);
  assert.deepEqual(src(['The Remains of the Day (novel)']), ['Based on a novel']);
  assert.deepEqual(src(['a 1957 play by someone']), ['Based on a play']);
  assert.deepEqual(src(['Watchmen comic book series']), ['Based on a comic']);
  assert.deepEqual(src(['Akira (manga)']), ['Based on a comic']);
  assert.deepEqual(src(['Persepolis graphic novel']), ['Based on a comic']);
  assert.deepEqual(src(['non-fiction book']), ['Based on a book']);
  assert.deepEqual(src(['Playtime']), ['Based on another work']); // "play" only as a whole word
  assert.deepEqual(src(['Some Story', 'Some novel']), ['Based on a novel']);
  assert.deepEqual(ids({ basedOn: ['x novel'] }, 'source'), ['source:novel']);
});

test('series tag', () => {
  assert.deepEqual(autoTags({ collection: 'The Lord of the Rings Collection' }).find(t => t.group === 'series'),
    { id: 'series:the-lord-of-the-rings-collection', label: 'Part of The Lord of the Rings', group: 'series' });
  assert.deepEqual(labels({ collection: null }, 'series'), []);
  assert.deepEqual(labels({ collection: '   ' }, 'series'), []);
});

test('subject tags: subjects capitalised, keywords lower-cased then capitalised, max 8', () => {
  assert.deepEqual(labels({ subjects: ['Grief', 'friendship'], keywords: ['ROAD TRIP', 'friendship', 'neo-noir'] }, 'subject'),
    ['Grief', 'Friendship', 'Road trip', 'Neo-noir']);
  const many = Array.from({ length: 20 }, (_, i) => `keyword ${i}`);
  assert.equal(labels({ keywords: many }, 'subject').length, 8);
  assert.equal(labels({ subjects: ['a', 'b', 'c', 'd', 'e'], keywords: many }, 'subject').length, 8);
  assert.deepEqual(labels({ subjects: ['a', 'b', 'c', 'd', 'e'], keywords: many }, 'subject').slice(0, 5), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(subjectTags({ keywords: many }, { max: Infinity }).length, 20);
  assert.deepEqual(subjectTags({}), []);
});

test('autoTags returns nothing for an empty or missing film, and never throws', () => {
  assert.deepEqual(autoTags({}), []);
  assert.deepEqual(autoTags(null), []);
  assert.deepEqual(autoTags(undefined), []);
  assert.deepEqual(autoTags({ genres: null, countries: null, directors: null, awards: null, subjects: null, keywords: null }), []);
});

test('a full film gets tags in group order with stable, unique ids', () => {
  const film = {
    year: 1984, runtime: 147, genres: ['Drama'], countries: ['West Germany', 'United States of America', 'France'], languages: ['English', 'German'],
    directors: [{ name: 'Wim Wenders' }], awards: [{ name: "Palme d'Or", won: true }], basedOn: [], collection: null,
    subjects: ['loneliness'], keywords: ['road movie'],
  };
  const tags = autoTags(film);
  assert.deepEqual(tags.map(t => t.group), ['decade', 'genre', 'country', 'country', 'country', 'language', 'director', 'award', 'subject', 'subject']);
  assert.equal(new Set(tags.map(t => t.id)).size, tags.length);
  assert.deepEqual(autoTagIds(film), tags.map(t => t.id));
  for (const t of tags) assert.match(t.id, /^[a-z]+:[^\s]+$/);
  assert.deepEqual(autoTags(film), tags); // deterministic
});

test('tagIndex counts films per tag, sorted by group then count', () => {
  const films = [
    { year: 1984, genres: ['Drama', 'Comedy'], countries: ['Japan'], runtime: 80 },
    { year: 1986, genres: ['Drama'], countries: ['Japan'], runtime: 200 },
    { year: 1991, genres: ['Drama'], countries: ['France'] },
    { year: 1985, genres: ['Horror', 'Horror'], countries: ['Japan', 'Japan'] },
  ];
  const idx = tagIndex(films);
  const find = id => idx.find(t => t.id === id);
  assert.equal(find('decade:1980s').count, 3);
  assert.equal(find('decade:1990s').count, 1);
  assert.equal(find('genre:drama').count, 3);
  assert.equal(find('genre:horror').count, 1); // a repeated genre counts the film once
  assert.equal(find('country:japan').count, 3);
  assert.equal(find('country:japan').label, 'From Japan');
  assert.equal(find('length:under-90').count, 1);

  const order = idx.map(t => t.group);
  const firstOf = g => order.indexOf(g);
  assert.ok(firstOf('decade') < firstOf('length') && firstOf('length') < firstOf('genre') && firstOf('genre') < firstOf('country'));
  // within a group: count descending
  const genres = idx.filter(t => t.group === 'genre');
  assert.deepEqual(genres.map(t => t.count), [...genres.map(t => t.count)].sort((a, b) => b - a));
  assert.equal(genres[0].id, 'genre:drama');
});

test('tagIndex on an empty library', () => {
  assert.deepEqual(tagIndex([]), []);
  assert.deepEqual(tagIndex(undefined), []);
  assert.deepEqual(tagIndex([{}, null]), []);
});
