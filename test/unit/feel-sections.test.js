import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionsOf } from '../../core/analysis/feel/sections.js';

const t = (label, extra = {}) => ({ id: label.toLowerCase(), label, kind: 'subject', sources: ['keyword'], ...extra });
const labels = a => a.map(x => x.label);

test('sectionsOf sorts items into subjects, kind of film and eras, and drops metadata and mood words', () => {
  const out = sectionsOf([
    t('Suicide', { sources: ['about-category'] }), t('Road trip'), t('Neo-noir', { kind: 'style', sources: ['style'] }),
    t('Black-and-white'), t('Based on novel or book'), t('1970s'), t('19th century'), t('Aftercreditsstinger'),
    t('Woman director'), t('Obscenity controversies'), t('Bold'), t('Amused'), t('Philosophical'), t('Flashback'),
  ]);
  assert.deepEqual(labels(out.subjects), ['Suicide', 'Road trip', 'Philosophical']);
  assert.deepEqual(labels(out.kind), ['Neo-noir', 'Black-and-white', 'Based on novel or book']);
  assert.deepEqual(labels(out.eras), ['1970s', '19th century']);
  assert.ok(['Aftercreditsstinger', 'Woman director', 'Bold', 'Flashback'].every(l => labels(out.dropped).includes(l)));
});

test('sectionsOf drops repeats of the Themes row and of the places under Set in; a decade goes when a year in it is listed', () => {
  const out = sectionsOf([t('Coming-of-age'), t('Bullying'), t('New york city'), t('Manhattan, new york city'), t('1930s'), t('1990s')],
    ['Coming of age'], ['New York City', '1932']);
  assert.deepEqual(labels(out.subjects), ['Bullying']);
  assert.deepEqual(labels(out.eras), ['1990s']);
});

test('sectionsOf shows one of the same subject listed by several sources, and treats Vigilante from a keyword list as a subject', () => {
  const out = sectionsOf([t('Mother–son relationships'), t('Mother son relationship'), t('Cats'), t('Cat'), t('Vigilante', { kind: 'style', sources: ['style', 'keyword'] }), t('Psychological thriller', { kind: 'style', sources: ['style'] })]);
  assert.deepEqual(labels(out.subjects), ['Mother–son relationships', 'Cats', 'Vigilante']);
  assert.deepEqual(labels(out.kind), ['Psychological thriller']);
});

test('sectionsOf: a franchise or title that came in as a source note is not a kind of film', () => {
  const out = sectionsOf([t('Barbie', { kind: 'adaptation', sources: ['adaptation'] }), t('Based on American novels', { kind: 'adaptation', sources: ['adaptation'] })]);
  assert.deepEqual(labels(out.kind), ['Based on American novels']);
});

test('sectionsOf keeps the more specific of two overlapping subjects, and a Kind of film that is already a feeling chip is not repeated', () => {
  const out = sectionsOf([t('Vampire'), t('Vampire hunter (slayer)'), t('Twins'), t('Twin brothers'), t('Epic', { kind: 'style', sources: ['style'] })], [], [], ['Epic']);
  assert.deepEqual(labels(out.subjects), ['Vampire hunter (slayer)', 'Twin brothers']);
  assert.deepEqual(labels(out.kind), []);
});

test('a subject made only of the words of a theme phrase is dropped (Revenge under Revenge and retribution)', () => {
  const themes = [{ id: 'a', label: 'Revenge', mentions: 3 }, { id: 'b', label: 'Contract killing', mentions: 3 }, { id: 'c', label: 'Mother–daughter relationships', mentions: 3 }];
  const r = sectionsOf(themes, ['Revenge and retribution', 'Romance and relationships'], [], []);
  assert.deepEqual(r.subjects.map(t => t.label), ['Contract killing', 'Mother–daughter relationships']);
});
