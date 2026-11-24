import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCategory, classifyAll } from '../../core/analysis/feel/categories.js';

const k = (l) => { const c = classifyCategory(l); return [c.kind, c.id]; };

test('about categories', () => {
  assert.deepEqual(k('Films about atonement'), ['about', 'atonement']);
  assert.deepEqual(k('Films about father–son relationships'), ['about', 'father-son-relationships']);
  assert.deepEqual(k('Films about domestic violence'), ['about', 'domestic-violence']);
  assert.deepEqual(k('Films about dysfunctional families'), ['about', 'dysfunctional-families']);
  assert.deepEqual(k('Television shows about grief'), ['about', 'grief']);
  assert.deepEqual(k('Works about memory'), ['about', 'memory']);
  assert.deepEqual(k('FILMS ABOUT Atonement'), ['about', 'atonement']);
  assert.equal(classifyCategory('Films about domestic violence').label, 'Domestic violence');
  assert.equal(classifyCategory('Films about ').kind, 'noise');
});

test('era and place', () => {
  assert.deepEqual(k('Films set in the 1940s'), ['era', '1940s']);
  assert.deepEqual(k('Films set in 1984'), ['era', '1984']);
  assert.deepEqual(k('Films set in the 19th century'), ['era', '19th-century']);
  assert.deepEqual(k('Films set in the future'), ['era', 'future']);
  assert.deepEqual(k('Films set in Texas'), ['place', 'texas']);
  assert.deepEqual(k('Films set in Paris'), ['place', 'paris']);
  assert.deepEqual(k('Films set in Japan'), ['place', 'japan']);
  assert.deepEqual(k('Films set in Los Angeles'), ['place', 'los-angeles']);
  assert.deepEqual(k('Films set in Antarctica'), ['place', 'antarctica']);
  assert.deepEqual(k('Films set in London'), ['place', 'london']);
  assert.deepEqual(k('Films set in the United States'), ['place', 'united-states']);
  assert.equal(classifyCategory('Films set in Los Angeles').label, 'Los Angeles');
});

test('adaptations', () => {
  assert.deepEqual(k('Films based on British novels'), ['adaptation', 'adapted-from-british-novels']);
  assert.deepEqual(k('Films based on true events'), ['adaptation', 'adapted-from-true-events']);
  assert.deepEqual(k('Films based on short stories'), ['adaptation', 'adapted-from-short-stories']);
  assert.deepEqual(k('Films based on comics'), ['adaptation', 'adapted-from-comics']);
  assert.deepEqual(k('Films based on plays'), ['adaptation', 'adapted-from-plays']);
  assert.equal(classifyCategory('Films based on British novels').label, 'Based on British novels');
});

test('style categories', () => {
  assert.deepEqual(k('1980s drama road movies'), ['style', 'road-movie']);
  assert.deepEqual(k('American drama road movies'), ['style', 'road-movie']);
  assert.deepEqual(k('Contemporary Western films'), ['style', 'contemporary-western']);
  assert.deepEqual(k('Neo-noir'), ['style', 'neo-noir']);
  assert.deepEqual(k('Heist films'), ['style', 'heist']);
  assert.deepEqual(k('Coming-of-age films'), ['style', 'coming-of-age']);
  assert.deepEqual(k('Dystopian films'), ['style', 'dystopian']);
  assert.deepEqual(k('Slow cinema'), ['style', 'slow-cinema']);
  assert.deepEqual(k('Surrealist films'), ['style', 'surrealist']);
  assert.deepEqual(k('Black comedy films'), ['style', 'black-comedy']);
  assert.deepEqual(k('Psychological thriller films'), ['style', 'psychological-thriller']);
  assert.deepEqual(k('Postapocalyptic films'), ['style', 'postapocalyptic']);
  assert.deepEqual(k('Road trip films'), ['style', 'road-trip']);
  assert.deepEqual(k('West German road movies'), ['style', 'road-movie']);
  assert.deepEqual(k('21st-century American heist films'), ['style', 'heist']);
  assert.deepEqual(k('English-language black comedy films'), ['style', 'black-comedy']);
  assert.equal(classifyCategory('American drama road movies').label, 'Road movie');
});

test('bare generics are noise', () => {
  for (const l of ['Drama films', 'Comedy films', 'American drama films', 'West German drama films', 'French films', 'English-language films', 'Thriller films', '1980s films']) {
    assert.equal(classifyCategory(l).kind, 'noise', l);
  }
});

test('production, awards, formats and the rest are noise', () => {
  for (const l of ['1984 films', '1984 drama films', 'Films shot in Houston', 'Films shot in 35 mm film', 'Films directed by Wim Wenders',
    'Films scored by Ry Cooder', 'Films produced by Don Guest', 'Films with screenplays by Sam Shepard', 'Films with cinematography by Robby Müller',
    "Palme d'Or winners", 'Best Picture Winners', 'Films that won the Palme d’Or', 'BAFTA winners', 'Dolby Atmos films', 'IMAX films',
    'English-language independent films', 'American independent films', 'Independent films', 'Films distributed by Warner Bros.', 'Film remakes',
    'Films with live action and animation', 'Sundance Film Festival award winners', 'Films starring Harry Dean Stanton',
    'Culturally significant films', 'United States National Film Registry films', 'Warner Bros. films', 'Universal Pictures films',
    'Cult films', 'Debut films', '']) {
    assert.equal(classifyCategory(l).kind, 'noise', JSON.stringify(l));
  }
});

test('subject "X in film"', () => {
  assert.deepEqual(k('Incest in film'), ['subject', 'incest']);
  assert.deepEqual(k('Death in film'), ['subject', 'death']);
  assert.deepEqual(k('Suicide in fiction'), ['subject', 'suicide']);
  assert.deepEqual(k('Religion in popular culture'), ['subject', 'religion']);
  assert.equal(classifyCategory('Incest in film').label, 'Incest');
});

test('edge cases', () => {
  assert.equal(classifyCategory(undefined).kind, 'noise');
  assert.equal(classifyCategory(null).kind, 'noise');
  assert.equal(classifyCategory(42).kind, 'noise');
  assert.equal(classifyCategory('   ').kind, 'noise');
  assert.equal(classifyCategory('Films about ' + 'x'.repeat(400)).kind, 'noise');
  assert.deepEqual(k('  Category: Films  about   atonement '), ['about', 'atonement']);
  assert.deepEqual(k('films set in texas'), ['place', 'texas']);
  assert.equal(classifyCategory('Some unknown shape of thing').kind, 'noise');
});

test('classifyAll splits, dedupes and counts noise', () => {
  const r = classifyAll(['Films about atonement', 'Films about Atonement', 'Films set in Texas', 'Films set in the 1940s',
    'Neo-noir', '1984 films', 'Films directed by Wim Wenders', 'Films based on British novels']);
  assert.deepEqual(r.themes.map((t) => t.id), ['atonement', 'neo-noir', 'adapted-from-british-novels']);
  assert.deepEqual(r.settings.map((t) => t.id), ['texas', '1940s']);
  assert.equal(r.noise, 2);
  assert.deepEqual(classifyAll(undefined), { themes: [], settings: [], noise: 0 });
});
