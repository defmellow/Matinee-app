// SYNTHETIC Letterboxd export for tests. Every film, person and review here is made up.
// Same layout as the real thing: profile.csv, watched/ratings/watchlist/diary/reviews.csv, likes/films.csv, lists/<slug>.csv,
// plus deleted/ and orphaned/ folders that the importer must ignore.
import { zipSync, strToU8 } from 'fflate';
import { entryCodeFromViewingId } from '../../../core/parse/export.js';

/** Viewing ids (what the RSS feed calls letterboxd-watch-<id>) and the export's matching entry codes. */
export const VIEWING = { alphaFirst: 1000000001, alphaRewatch: 1000000002, betaReview: 1000000003, epsilon: 1000000004, zetaReview: 1000000005 };
export const CODE = Object.fromEntries(Object.entries(VIEWING).map(([k, v]) => [k, entryCodeFromViewingId(v)]));

const url = code => `https://boxd.it/${code}`;
const lines = (...l) => l.join('\r\n') + '\r\n';

export const FILES = {
  'profile.csv': lines(
    'Date Joined,Username,Given Name,Family Name,Email Address,Location,Website,Bio,Pronoun,Favorite Films',
    `2024-01-02,synth_user,Sam,Tester,sam@example.invalid,Nowhere,,"Line one,\nline two ""quoted""",They / them,"${url('aaa')}, ${url('zzz')}"`,
  ),
  'watched.csv': lines(
    'Date,Name,Year,Letterboxd URI',
    `2024-01-03,Synthetic Alpha,2001,${url('aaa')}`,
    `2024-01-04,"Synthetic Beta, The ""Sequel""",2005,${url('bbb')}`,
  ),
  'ratings.csv': lines(
    'Date,Name,Year,Letterboxd URI,Rating',
    `2024-01-03,Synthetic Alpha,2001,${url('aaa')},3.5`,
    `2024-01-04,"Synthetic Beta, The ""Sequel""",2005,${url('bbb')},5`,
  ),
  'watchlist.csv': lines(
    'Date,Name,Year,Letterboxd URI',
    `2025-01-02,Synthetic Gamma,1999,${url('ccc')}`,
    `2025-01-03,Synthetic Untitled,,${url('ccd')}`,
  ),
  'likes/films.csv': lines(
    'Date,Name,Year,Letterboxd URI',
    `2024-02-01,Synthetic Delta,2010,${url('ddd')}`,
    `2024-02-02,Synthetic Alpha,2001,${url('aaa')}`,
  ),
  'diary.csv': lines(
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
    `2025-03-02,Synthetic Alpha,2001,${url(CODE.alphaFirst)},3.5,,"in cinema, friends",2025-03-01`,
    `2025-06-01,Synthetic Alpha,2001,${url(CODE.alphaRewatch)},4,Yes,,2025-06-01`,
    `2025-04-01,"Synthetic Beta, The ""Sequel""",2005,${url(CODE.betaReview)},5,,in cinema,2025-04-01`,
    `2025-05-05,Synthetic Épsilon & Co,2015,${url(CODE.epsilon)},,,,2025-05-05`,
  ),
  'reviews.csv': lines(
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date',
    // joins by entry link
    `2025-04-01,"Synthetic Beta, The ""Sequel""",2005,${url(CODE.betaReview)},5,,"Great.\r\n\r\nSecond paragraph, with ""quotes"".",in cinema,2025-04-01`,
    // different link from its diary row: joins by title + year + watched date
    `2025-06-02,Synthetic Alpha,2001,${url('xxxxxx')},4,Yes,Better the second time.,,2025-06-01`,
    // no diary row and no watched date: becomes an entry of its own, dated by when it was logged
    `2025-07-07,Synthetic Zeta,2020,${url(CODE.zetaReview)},2,,Not for me.,,`,
  ),
  'lists/my-favourites.csv': lines(
    'Letterboxd list export v7',
    'Date,Name,Tags,URL,Description',
    `2025-01-01,My favourites,,${url('lst01')},"First line\nsecond line"`,
    '',
    'Position,Name,Year,URL,Description',
    `1,Synthetic Alpha,2001,${url('aaa')},`,
    `2,Synthetic Fox,1990,${url('fff')},`,
  ),
  'deleted/diary.csv': lines(
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
    `2025-09-09,Synthetic Deleted,2009,${url('ddddd1')},1,,,2025-09-09`,
  ),
  'orphaned/reviews.csv': lines('Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date'),
};

/**
 * Build an export ZIP. `replace` swaps the text of a file (null removes it); `add` adds files.
 * @returns {Uint8Array}
 */
export function makeExport({ replace = {}, add = {} } = {}) {
  const files = { ...FILES, ...add };
  for (const [name, text] of Object.entries(replace)) { if (text === null) delete files[name]; else files[name] = text; }
  return zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)])));
}

export { lines };
