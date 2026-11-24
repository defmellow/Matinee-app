// Audit fixes: Oscar tag, local day, Tonight empty reasons, Upcoming tie-break, dialects, subject casing, tiny scores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoTags, subjectTags } from '../../core/analysis/tags.js';
import { localDay } from '../../core/util/localday.js';
import { eligible } from '../../core/analysis/eligible.js';
import { upcoming } from '../../core/features/upcoming.js';
import { insights } from '../../core/analysis/stats.js';
import { buildPicks } from '../../core/analysis/picks.js';
import { crowdOf } from '../../core/analysis/fit.js';

const labels = (s, group) => autoTags(s).filter(t => t.group === group).map(t => t.label);

test('country submissions and non-Oscar academies are not Oscar nominations', () => {
  assert.deepEqual(labels({ awards: [{ name: 'International Submission to the Academy Awards', won: false }] }, 'award'), []);
  assert.deepEqual(labels({ awards: [{ name: 'Polish Academy Award for Best European Film', won: false }] }, 'award'), []);
  assert.deepEqual(labels({ awards: [{ name: 'Academy Award for Achievement in Casting', won: false }] }, 'award'), ['Oscar nominated']);
});

test('localDay uses local calendar parts and never shifts strings', () => {
  const d = new Date(2026, 10, 1, 7, 0); // 1 Nov 2026, 07:00 local
  assert.equal(localDay(d), '2026-11-01');
  assert.equal(localDay('2026-10-22'), '2026-10-22');
  assert.equal(localDay('2026-10-22T23:59:59Z'), '2026-10-22');
  assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
});

test('eligible and upcoming read a Date as the local day', () => {
  const morning = new Date(2026, 10, 1, 7, 0);
  assert.equal(eligible({ released: '2026-11-01', runtime: 100, year: 2026 }, { today: morning }), true);
  assert.equal(eligible({ released: '2026-11-01', runtime: 100, year: 2026 }, { today: '2026-10-31' }), false);
  const r = upcoming({ today: morning, summaries: [{ key: 'x', title: 'X', user: {}, ausRelease: { date: '2026-10-31' } }] });
  assert.equal(r.today, '2026-11-01');
  assert.equal(r.justOpened.length, 1);
});

test('insights honours an injected local today for the streak', () => {
  const e = d => ({ id: d, key: 'x', date: d, rating: null, liked: false, rewatch: false, review: '', tags: [] });
  const r = insights({ summaries: [{ key: 'x', title: 'X', year: 2000 }], entries: [e('2026-10-30'), e('2026-10-31'), e('2026-11-01')], today: '2026-11-01' });
  assert.equal(r.streaks.currentDays, 3);
});

const film = (key, o = {}) => ({
  key, title: key, year: 2000, released: '2000-05-05', runtime: 100, genres: ['Drama'], kind: 'film', ratings: { imdb: { value: 7, votes: 50000 } },
  user: { watched: false, rating: null, watchlist: true, watchlistAddedAt: '2025-06-01' }, lastWatched: null, ...o,
});
const model = { fit: () => ({ score: 0, tier: 'know', neighbours: [], caution: null }) };
const run = (summaries, extra = {}) => buildPicks({ summaries, fitModel: model, feel: { axes: [], byKey: new Map() }, today: '2026-10-22', fns: { similar: () => [] }, ...extra });

test('Tonight names the real reason when nothing is left', () => {
  const three = [film('a'), film('b'), film('c')];
  assert.equal(run(three, { exclude: ['a', 'b', 'c'] }).empty.why, 'skipped');
  assert.equal(run(three, { exclude: ['a', 'b', 'c'], dials: { maxMinutes: 30 } }).empty.why, 'time');
  assert.equal(run([film('f', { released: '2027-01-01', year: 2027 }), film('t', { kind: 'tv' })]).empty.why, 'eligible');
  assert.equal(run(three, { dials: { maxMinutes: 30 } }).empty.why, 'time');
});

test('Just opened: newest first, then watchlist first, then title', () => {
  const s = (key, date, watchlist) => ({ key, title: key, user: { watchlist }, ausRelease: { date } });
  const r = upcoming({ today: '2026-10-22', summaries: [s('Alpha', '2026-10-15', false), s('Gamma', '2026-10-15', true), s('Beta', '2026-10-15', true), s('New', '2026-10-20', false)] });
  assert.deepEqual(r.justOpened.map(i => i.film.key), ['New', 'Beta', 'Gamma', 'Alpha']);
});

test('English dialects are not foreign-language tags', () => {
  assert.deepEqual(labels({ languages: ['American English', 'Australian English', 'English', 'French'] }, 'language'), ['In French']);
});

test('subject tags keep acronyms and proper nouns, capitalise subjects', () => {
  const l = subjectTags({ keywords: ['LGBTQ+', 'UFO', 'World War II', 'road trip'], subjects: ['revenge'] }).map(t => t.label);
  assert.deepEqual(l, ['Revenge', 'LGBTQ+', 'UFO', 'World War II', 'Road trip']);
});

test('fit ignores a score backed by a handful of votes', () => {
  assert.equal(crowdOf({ score: 95, ratings: { rt: { audience: 95, audienceCount: 5 } } }), null);
  assert.equal(crowdOf({ score: 95, ratings: { imdb: { value: 9.5, votes: 5000 } } }), 95);
});
