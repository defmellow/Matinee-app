// Short "who rates this, and how do they tend to score" notes for each outside rating (shown on hover on the film page).
//
// The numbers are copied by hand from the frozen reference table in core/analysis/scores.js (SOURCES, `ref` = [mean, sd]
// on a 0–100 scale), shown in each source's own units. "Covers most films" is mean ± 1 sd. Letterboxd and TMDB are
// provisional there (no measured distribution yet), so their typical figures are rough. Update here if those references change.
//   letterboxd [66, 9] → 3.30 ± 0.45 of 5      imdb [65.8, 10.1] → 6.6 ± 1.0 of 10
//   rt-critics [50, 29]                          rt-audience [65.2, 18.1]
//   metacritic [54, 17]                          metacritic-users [63.7, 13.3] → 6.4 ± 1.3 of 10
//   tmdb [65, 9] → 6.5 ± 0.9 of 10

import { MATINEE_TYPICAL as MT } from './matineeTypical.js';

/** `mean` and `sd` are on the 0–100 scale, matching a score part's `value100`. */
export const SOURCE_NOTES = {
  matinee: {
    who: 'Matinee blends every outside score it finds, adjusted so sites that rate high or low are comparable.',
    typical: `Typical film: about ${MT.median} out of 100; ${MT.low}–${MT.high} covers most films.`,
    read: 'A film with few scores is pulled toward the middle until more arrive.',
    mean: MT.mean, sd: MT.sd,
  },
  letterboxd: {
    who: 'Letterboxd members, so mostly keen film fans.',
    typical: 'Typical film: about 3.3 out of 5; 2.9–3.8 covers most films.',
    read: 'Members rate in half stars, and the average is usually more reliable than a single review.',
    mean: 66, sd: 9,
  },
  'rt-critics': {
    who: 'Professional critics.',
    typical: 'Typical film: about 50%; 21–79% covers most films.',
    read: 'This is the share of critics who liked it, not an average mark. A 90% means nearly all were positive, not that it is a masterpiece.',
    mean: 50, sd: 29,
  },
  'rt-audience': {
    who: 'The general audience (the Popcornmeter).',
    typical: 'Typical film: about 65%; 47–83% covers most films.',
    read: 'This is the share of viewers who liked it. Popular crowd-pleasers score high.',
    mean: 65.2, sd: 18.1,
  },
  imdb: {
    who: 'Everyday IMDb voters, a broad general audience.',
    typical: 'Typical film: about 6.6 out of 10; 5.6–7.6 covers most films.',
    read: 'IMDb voters skew kind, so a 7 is only about average and 8 and up is rare.',
    mean: 65.8, sd: 10.1,
  },
  metacritic: {
    who: 'Professional critics, blended into one weighted score.',
    typical: 'Typical film: about 54 out of 100; 37–71 covers most films.',
    read: 'An actual average of critics’ marks, so it runs lower and tighter than Rotten Tomatoes.',
    mean: 54, sd: 17,
  },
  'metacritic-users': {
    who: 'Metacritic’s registered users, a general audience.',
    typical: 'Typical film: about 6.4 out of 10; 5.1–7.7 covers most films.',
    read: 'Smaller crowds than IMDb, and a few angry or glowing votes can swing it.',
    mean: 63.7, sd: 13.3,
  },
  tmdb: {
    who: 'TMDB community members, a general audience.',
    typical: 'Typical film: about 6.5 out of 10; 5.6–7.4 covers most films.',
    read: 'Fewer voters than IMDb, so treat small vote counts with care.',
    mean: 65, sd: 9,
  },
};

/** 'Above typical' / 'Typical' / 'Below typical' for a 0–100 value, using z = (value − mean) / sd with ±0.5 cut-offs. */
export function compareToTypical(source, value100) {
  const n = SOURCE_NOTES[source];
  if (!n || typeof value100 !== 'number' || !Number.isFinite(value100)) return null;
  const z = (value100 - n.mean) / n.sd;
  return z > 0.5 ? 'Above typical' : z < -0.5 ? 'Below typical' : 'Typical';
}

/** The popover lines for one rating part ({ source, value100 }): [{ kind, text }], or null for an unknown source. */
export function sourceLines(part) {
  const n = SOURCE_NOTES[part && part.source];
  if (!n) return null;
  const verdict = compareToTypical(part.source, part.value100);
  return [
    { kind: 'who', text: n.who },
    { kind: 'typical', text: n.typical },
    { kind: 'read', text: n.read },
    ...(verdict ? [{ kind: 'verdict', text: `This film: ${verdict.toLowerCase()}.` }] : []),
  ];
}
