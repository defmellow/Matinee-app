// Language names as people say them, Silent / No dialogue, and the Library's Languages filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normLanguages, compose } from '../../core/model.js';
import { queryFromParam, toCoreQuery, activeFilters } from '../../ui/screens/library/model.js';
import { applyQuery } from '../../core/analysis/query.js';

test('normLanguages: aliases fold, duplicates drop, order kept', () => {
  assert.deepEqual(normLanguages(['American English', 'English', 'French']), ['English', 'French']);
  assert.deepEqual(normLanguages(['Standard Chinese', 'Mandarin', 'Standard Taiwanese Mandarin']), ['Mandarin']);
  assert.deepEqual(normLanguages(['Modern Greek']), ['Greek']);
  assert.deepEqual(normLanguages([]), []);
  assert.equal(normLanguages(null), null);
});

test('No Language: Silent before 1930 (Metropolis, Sunrise), No dialogue after (Koyaanisqatsi)', () => {
  assert.deepEqual(normLanguages(['No Language'], 1927), ['Silent']);
  assert.deepEqual(normLanguages(['No Language'], 1982), ['No dialogue']);
  assert.deepEqual(normLanguages(['No Language'], null), ['No dialogue']);
  assert.deepEqual(normLanguages(['silent film', 'German'], 1927), ['Silent', 'German']);
});

test('compose applies it, so the film page, search and filters agree', () => {
  const f = compose({ key: 'k', title: 'Metropolis', year: 1927, src: { tmdb: { languages: ['No Language'] }, wikidata: { languages: ['German'] } } });
  assert.deepEqual(f.languages, ['Silent']);
});

test('Library: language links, filter chips and the core query', () => {
  assert.deepEqual(queryFromParam('language:French').languages, ['French']);
  const q = { languages: ['French', 'Silent'] };
  assert.deepEqual(toCoreQuery(q).languages, ['French', 'Silent']);
  assert.deepEqual(activeFilters(q).filter(c => c.id.startsWith('l:')).map(c => c.label), ['French', 'Silent']);
  const films = [{ key: 'a', languages: ['French'] }, { key: 'b', languages: ['Silent'] }, { key: 'c', languages: ['English'] }];
  assert.deepEqual(applyQuery(films, { languages: ['Silent'] }).map(f => f.key), ['b']);
});
