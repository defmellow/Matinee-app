// IMDb provider (no key). IMDb publishes its ratings for free (personal, non-commercial use) as a daily dataset:
// https://datasets.imdbws.com/title.ratings.tsv.gz — about 9 MB, one line per title: tconst, averageRating, numVotes.
// One run = one download. The file is streamed straight through gunzip and only the rows for our films are kept.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const PROGRESS_STEPS = 20; // progress is worked out in 5% steps of the download

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

const NOT_FORMAT = "IMDb's ratings file wasn't in the format Matinee expects, so no ratings were changed.";

/**
 * Read a gunzipped ratings TSV (a stream of text chunks) and pick out the rows for `wanted`.
 * Never holds more than one line of the file plus the matches.
 * @param {AsyncIterable<string>} chunks
 * @param {Set<string>} wanted  IMDb ids (tconst) to keep
 * @returns {Promise<Map<string, { value: number, votes: number }>>}
 */
export async function readRatings(chunks, wanted) {
  const found = new Map();
  let rest = '', first = true, rows = 0;

  const line = text => {
    if (first) { // header row
      first = false;
      if (!/^tconst\taveragerating\tnumvotes\s*$/i.test(text)) throw new Error(NOT_FORMAT);
      return;
    }
    const a = text.indexOf('\t');
    if (a < 0) return;
    rows++;
    const id = text.slice(0, a);
    if (!wanted.has(id)) return;
    const b = text.indexOf('\t', a + 1);
    const value = Number(text.slice(a + 1, b < 0 ? undefined : b));
    const votes = Number(b < 0 ? NaN : text.slice(b + 1));
    if (Number.isFinite(value) && value >= 0 && value <= 10 && Number.isFinite(votes) && votes >= 0) found.set(id, { value, votes });
  };

  for await (const chunk of chunks) {
    rest += chunk;
    let from = 0, nl;
    while ((nl = rest.indexOf('\n', from)) >= 0) {
      line(rest.slice(from, rest[nl - 1] === '\r' ? nl - 1 : nl));
      from = nl + 1;
    }
    rest = rest.slice(from);
  }
  if (rest) line(rest.endsWith('\r') ? rest.slice(0, -1) : rest);
  if (first || rows === 0) throw new Error(NOT_FORMAT); // empty or header-only: don't call every film "not found"
  return found;
}

const friendlyFailure = e => {
  if (e?.code === 'aborted' || e?.name === 'AbortError' || e?.code === 'ABORT_ERR') return abortError();
  if (e?.message === NOT_FORMAT) return e;
  const why = e?.status ? `IMDb's ratings file isn't available right now (error ${e.status}).` : "Couldn't download IMDb's ratings file. Check your internet connection and try again.";
  return Object.assign(new Error(why), { cause: e });
};

const megabytes = bytes => `${(bytes / 1e6).toFixed(1)} MB`;

export default {
  id: 'imdb',
  label: 'IMDb',
  gives: ['IMDb ratings'],
  needsKey: false,
  requires: film => !!film.ids?.imdb,
  refreshDays: 7,
  retryMissDays: 30,
  // The whole file is downloaded for any number of films, so the runner (enrich.js) holds this back until `minFilms` want it
  // or the last download is over `minGapMs` old, and on-demand fetching (fetchNow) leaves it out entirely.
  bulk: { cacheKey: 'imdbDownload', minFilms: 5, minGapMs: 7 * 864e5 },

  async enrich(films, ctx) {
    if (ctx.signal?.aborted) throw abortError();
    // Several films can share one IMDb id (e.g. a duplicated diary entry).
    const byId = new Map();
    for (const film of films) {
      const id = String(film.ids.imdb).trim();
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(film);
    }
    const wanted = new Set(byId.keys());

    ctx.log(`Downloading IMDb's ratings file to look up ${films.length} ${films.length === 1 ? 'film' : 'films'}.`);
    let bytes = 0, found;
    try {
      // the dataset is streamed for a while: the 30 s default per request would cut it off
      const res = await ctx.http.response(RATINGS_URL, { signal: ctx.signal, timeoutMs: 180000 });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${RATINGS_URL}`), { status: res.status });
      if (!res.body) throw new Error('IMDb sent an empty reply.');
      const total = Number(res.headers.get('content-length')) || 0;
      let reported = 0;
      // Fetch implementations that honour Content-Encoding: gzip have already unzipped the body.
      const alreadyUnzipped = /\bgzip\b/i.test(res.headers.get('content-encoding') || '');

      async function* counted(source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          if (total) { // bytes-based progress, kept just below "all done" until the rows have been read
            const step = Math.min(PROGRESS_STEPS - 1, Math.floor((bytes / total) * PROGRESS_STEPS));
            const done = Math.floor((films.length * step) / PROGRESS_STEPS);
            if (done > reported) { reported = done; ctx.progress(done, films.length); }
          }
          yield chunk;
        }
      }
      const read = async source => { found = await readRatings(source, wanted); };
      await pipeline(
        Readable.fromWeb(res.body),
        counted,
        ...(alreadyUnzipped ? [] : [createGunzip()]),
        async function* (source) { // bytes to text, without splitting a multi-byte character across chunks
          const decoder = new TextDecoder();
          for await (const chunk of source) yield decoder.decode(chunk, { stream: true });
        },
        read,
        { signal: ctx.signal },
      );
    } catch (e) {
      throw friendlyFailure(e); // nothing has been recorded yet, so no film is marked as checked
    }

    let matched = 0;
    for (const [id, group] of byId) {
      const row = found.get(id);
      if (row) matched += group.length;
      for (const film of group) ctx.done(film, row ? { ratings: { imdb: { value: row.value, votes: row.votes } } } : null);
    }
    ctx.progress(films.length, films.length);
    ctx.log(`Downloaded IMDb's ratings file (${megabytes(bytes)}): found ratings for ${matched} of ${films.length} ${films.length === 1 ? 'film' : 'films'}.`);
  },
};
