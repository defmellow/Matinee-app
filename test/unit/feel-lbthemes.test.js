import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandLbGroups, partsOf, splitUnknown, lbPillLabel } from '../../core/analysis/feel/lbthemes.js';

const tags = (groups, film) => expandLbGroups(groups, film).map(t => [t.label, t.row, t.confirmed, t.shown]);

test('a group splits into its confirmed parts, each in its own row; genre words are dropped', () => {
  assert.deepEqual(tags(['Monsters, aliens, sci-fi and the apocalypse'], { text: 'A giant monster flattens Tokyo. The monster wins.' }),
    [['Monsters and aliens', 'subject', true, true]]);
  assert.deepEqual(tags(['Monsters, aliens, sci-fi and the apocalypse'], { text: 'After the apocalypse, hunted by aliens.', lists: ['post-apocalypse', 'alien invasion', 'aliens'] }),
    [['Monsters and aliens', 'subject', true, true], ['Apocalypse', 'theme', true, true]]);
});

test('nothing confirmed: the main idea shows as a light hint, its other ideas are not pinned on the film', () => {
  assert.deepEqual(tags(['Monsters, aliens, sci-fi and the apocalypse'], { text: 'A quiet film.' }), [['Monsters and aliens', 'subject', false, true]]);
  assert.deepEqual(tags(['Humanity and the world around us'], { text: 'Vampires in the Delta.' }), [['Humanity', 'theme', false, true]]);
});

test('one passing word in a review is not enough; one keyword is', () => {
  const g = ['Horror, the undead and monster classics'];
  const t = 'The Terminator is a splendid meta-monster, frankensteined for the computer age.';
  assert.deepEqual(tags(g, { text: t }), [['The undead', 'subject', false, true]]);
  assert.deepEqual(tags(g, { text: t, lists: ['frankenstein'] }), [['Classic monster film', 'kind', true, true]]);
});

test('the long name itself never appears', () => {
  for (const g of ['Humanity and the world around us', 'Crude humor and satire', 'Westerns', 'Kids and animation']) {
    for (const t of expandLbGroups([g], {})) assert.ok(t.label.length <= 26 && t.label !== g, t.label);
  }
});

test('an idea Matinee already shows is not drawn twice; a genre already shown hides the Kind of film tag', () => {
  assert.deepEqual(tags(['Moving relationship stories'], { labels: ['Relationships'] }), [['Relationships', 'theme', true, false]]);
  assert.deepEqual(tags(['Westerns'], { genres: ['Western'] }), [['Western', 'kind', true, false]]);
  assert.deepEqual(tags(['Crude humor and satire'], { labels: ['Satirical'], text: 'crude jokes, crude gags' }),
    [['Bawdy', 'tone', true, true], ['Satirical', 'tone', true, false]]);
});

test('whole-word parts: heroin is not heroine; war is not award', () => {
  assert.deepEqual(tags(['Crime, drugs and gangsters'], { text: 'The heroine wins. The heroine again.' }).map(t => t[2]), [false]);
  assert.deepEqual(tags(['War and historical adventure'], { text: 'It won an award. Another award.' }).map(t => t[2]), [false]);
  assert.deepEqual(tags(['War and historical adventure'], { text: 'A war film. The war ends.' }), [['War', 'theme', true, true]]);
});

test('duplicates across groups keep the confirmed one', () => {
  const r = expandLbGroups(['Relationship comedy', 'Moving relationship stories'], { text: 'their relationship; a relationship' });
  assert.equal(r.length, 1);
  assert.equal(r[0].confirmed, true);
});

test('based-on-a-book films confirm Literary adaptation', () => {
  assert.deepEqual(tags(['Epic history and literature'], { basedOn: true }), [['Literary adaptation', 'kind', true, true]]);
});

test('unknown groups: split, genre words dropped, short labels', () => {
  assert.deepEqual(splitUnknown('Faith, sci-fi and redemption').map(p => [p.label, p.row]), [['Faith', 'theme'], ['Redemption', 'theme']]);
  assert.deepEqual(splitUnknown('Horror comedies').map(p => p.row), ['kind']);
  assert.ok(splitUnknown('An extraordinarily long and winding description of something').every(p => p.label.length <= 22));
  assert.equal(partsOf('WESTERNS')[0].label, 'Western');
});

test('old long names get a short pill label', () => {
  assert.equal(lbPillLabel('Monsters, aliens, sci-fi and the apocalypse'), 'Monsters and aliens');
  assert.equal(lbPillLabel('Westerns'), 'Western');
  assert.equal(lbPillLabel('Song and dance'), 'Musical');
  assert.equal(lbPillLabel('Monsters and aliens'), 'Monsters and aliens'); // a new tag stays as it is
  assert.equal(lbPillLabel('Apocalypse'), 'Apocalypse');
  assert.equal(lbPillLabel('Moving relationship stories'), 'Relationships');
});
