// Audit fixes for the Diary / Insights / Year / Discover / By feel / Tonight screens (source-level checks;
// the screens themselves are exercised by the Playwright UI checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiLimit, apiScope, searchArgs } from '../../ui/screens/feel/model.js';

const src = p => readFileSync(new URL('../../ui/screens/' + p, import.meta.url), 'utf8');

test('every scope asks for 60, and an old saved unwatched scope means the watchlist', () => {
  assert.equal(apiLimit('unwatched'), 60);
  assert.equal(apiLimit('all'), 60);
  assert.equal(apiLimit('watchlist'), 60);
  const f = { descriptors: [], themes: [], avoid: [], text: ' x ' };
  assert.equal(searchArgs(f, 'unwatched').limit, 60);
  assert.equal(searchArgs(f, 'unwatched').scope, apiScope('unwatched'));
});

test('Year: save failure toasts, chips use aria-current', () => {
  const y = src('Year.jsx');
  assert.match(y, /Couldn't save the picture\. Try again\./);
  assert.match(y, /aria-current=/);
  assert.doesNotMatch(y, /aria-pressed/);
  assert.match(src('year.css'), /chip\[aria-current="page"\]/);
});

test('Diary, Insights and Year error states offer Try again', () => {
  for (const f of ['Diary.jsx', 'Insights.jsx', 'Year.jsx']) assert.match(src(f), /onClick=\{reload\}/, f);
});

test('Diary empty state copy and action', () => {
  const d = src('Diary.jsx');
  assert.match(d, /Log films on Letterboxd and they'll show up here after the next refresh\./);
  assert.match(d, /href="#\/welcome"/);
});

test('Insights: singular typical month, keyed rank rows, library-loading guard', () => {
  assert.match(src('insights/tabs.jsx'), /plural\(d\.filmsPerMonthAvg, 'film', 'films'\)/);
  assert.match(src('insights/parts.jsx'), /key=\{r\.id \|\| r\.name\}/);
  assert.match(src('insights/parts.jsx'), /ready/);
});

test('Discover and Tonight guard against stale responses', () => {
  const d = src('Discover.jsx');
  assert.match(d, /seq\.current/);
  assert.match(d, /WAIT_MS/);
  assert.match(src('Tonight.jsx'), /at !== gen\.current/);
});
