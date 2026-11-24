// Wikipedia provider (no key). For every film with an English Wikipedia article it adds the theatrical poster
// (when the article's lead image is a portrait) and the first paragraph as a short synopsis.
// API: https://en.wikipedia.org/api/rest_v1/page/summary/<Title> — see docs/research/keyless-sources.md.

const BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const CONCURRENCY = 3;            // net.js paces the host as well
const THUMB_WIDTH = 250;          // one of Wikimedia's standard thumbnail widths
const MIN_SYNOPSIS = 40;          // shorter than this is a stub, not a synopsis
const PORTRAIT_RATIO = 1.2;       // a poster is clearly taller than it is wide

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

/** The page title as it goes into the URL: spaces become underscores, then URL-encoded. Accepts a pasted article link too. */
export function titleForUrl(enwiki) {
  let t = String(enwiki ?? '').trim();
  const link = /^https?:\/\/[^/]*wikipedia\.org\/wiki\/(.+)$/i.exec(t);
  if (link) { try { t = decodeURIComponent(link[1]); } catch { t = link[1]; } }
  return encodeURIComponent(t.replace(/\s+/g, '_'));
}

/** Drop the ?utm_source=… tail Wikipedia adds to image links. */
const stripQuery = url => String(url).replace(/[?#].*$/, '');

const COMMONS_FILE = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z-]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/i;
const FILE_THAT_NEEDS_CONVERTING = /\.svg$/i;
const FILE_WE_CAN_RESIZE = /\.(jpe?g|png|gif|webp|svg)$/i;

/**
 * Wikimedia thumbnail link for an original image, at a standard width:
 * .../wikipedia/en/a/ab/File.jpg → .../wikipedia/en/thumb/a/ab/File.jpg/250px-File.jpg (same for /commons/).
 * Anything that doesn't look like an original upload (or can't be resized) is returned unchanged.
 */
export function thumbUrl(url, width = THUMB_WIDTH) {
  const m = COMMONS_FILE.exec(url);
  if (!m || !FILE_WE_CAN_RESIZE.test(m[3])) return url;
  const [, base, hash, file] = m;
  const rendered = FILE_THAT_NEEDS_CONVERTING.test(file) ? `${file}.png` : file; // SVGs are rendered as PNG
  return `${base}/thumb/${hash}/${file}/${width}px-${rendered}`;
}

const isNumber = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** The poster from a summary, or null when there's no image or it isn't a portrait (stills and logos are landscape). */
export function posterFrom(summary) {
  // DECISION: if a summary has only a thumbnail (no originalimage), that thumbnail is used rather than losing the poster.
  const img = summary?.originalimage?.source ? summary.originalimage : summary?.thumbnail;
  if (!img?.source) return null;
  const { width, height } = img;
  if (!isNumber(width) || !isNumber(height) || !(height > width * PORTRAIT_RATIO)) return null;
  const url = stripQuery(img.source);
  return { url, thumb: width > THUMB_WIDTH ? thumbUrl(url) : url, width, height };
}

/**
 * Wikipedia's summary JSON → Matinee's normalised data, or null when there is nothing worth keeping
 * (a disambiguation page, or no poster, no synopsis and no description).
 */
export function mapSummary(summary) {
  if (!summary || typeof summary !== 'object' || summary.type === 'disambiguation') return null;
  const extract = String(summary.extract ?? '').trim();
  const description = String(summary.description ?? '').trim();
  const data = {
    poster: posterFrom(summary),
    synopsis: extract.length >= MIN_SYNOPSIS ? extract : null,
    wikipediaDescription: description || null,
  };
  return data.poster || data.synopsis || data.wikipediaDescription ? data : null;
}

// ---------- article sections (plot / themes / reception) ----------

const EXTRACT_URL = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&titles=';
const SECTION_CAP = 3000;
const PLOT_HEADING = /^(plot|synopsis|premise|story)/i;
// Only real analysis sections count as themes. Music, cinematography, style and genre used to match too, which put soundtrack
// prose into the feel engine as a film's "themes". "Reception and analysis" / "Critical analysis" go to reception (checked first).
const THEMES_HEADING = /^(themes?\b|(thematic )?analysis|interpretations?|symbolism|motifs?)/i;
// Stored sections carry this marker. Text stored without it was split with the old, broad themes rule (see purgeOldThemes).
export const SECTIONS_RULE = 2;
const RECEPTION_HEADING = /^(reception|critical (reception|response|analysis)|reviews?)/i;

/** Cut at a sentence end when one falls in the back half, otherwise at a word boundary. */
function capText(text, max = SECTION_CAP) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence >= max / 2) return cut.slice(0, sentence + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

const tidy = s => s.replace(/\[(?:\d+|[a-z]|citation needed|clarification needed|note \d+)\]/gi, '').replace(/\s+/g, ' ').trim();

/**
 * Plain-text article extract ("== Plot ==" headings) → { plot?, themes?, reception? }.
 * Level-3 sub-sections inherit their parent's kind (so "Critical response" under "Reception" stays in reception).
 */
export function splitSections(extractText) {
  const parts = { plot: [], themes: [], reception: [] };
  let kind = null, parentKind = null;
  for (const line of String(extractText ?? '').split(/\r?\n/)) {
    const h = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line.trim());
    if (h) {
      const level = h[1].length, name = h[2];
      if (level > 3) continue; // deeper headings stay inside the current section
      const own = PLOT_HEADING.test(name) ? 'plot' : RECEPTION_HEADING.test(name) ? 'reception' : THEMES_HEADING.test(name) ? 'themes' : null;
      if (level === 2) { kind = own; parentKind = own; }
      else kind = own ?? parentKind;
      continue;
    }
    if (kind) parts[kind].push(line);
  }
  const out = {};
  for (const k of ['plot', 'themes', 'reception']) {
    const text = capText(tidy(parts[k].join(' ')));
    if (text) out[k] = text;
  }
  if (Object.keys(out).length) out.rule = SECTIONS_RULE;
  return out;
}

/** Themes text stored by the old broad rule may be soundtrack prose: drop it (only it) from what is stored, even if this re-read finds nothing. */
function purgeOldThemes(film) {
  const sec = film.src?.wikipedia?.sections;
  if (sec && sec.themes && sec.rule !== SECTIONS_RULE) delete sec.themes;
}

/** The article's plain text split into sections, or null when the request fails (the summary is kept regardless). */
async function fetchSections(film, ctx) {
  try {
    const r = await ctx.http.json(EXTRACT_URL + titleForUrl(film.ids.enwiki), { signal: ctx.signal });
    const page = r?.query?.pages?.find?.(p => !p.missing);
    const sections = splitSections(page?.extract);
    return Object.keys(sections).length ? sections : null;
  } catch (e) {
    if (e?.code === 'aborted') throw e;
    ctx.warn?.(film, "Couldn't read the full Wikipedia article (only the summary was kept).", e);
    return null;
  }
}

export default {
  id: 'wikipedia',
  label: 'Wikipedia',
  gives: ['posters', 'plot summaries'],
  needsKey: false,
  requires: film => !!film.ids?.enwiki,
  needsIds: ['enwiki'],
  waitFor: ['tmdb'], // let TMDB's step for the film finish first: if it holds the poster and synopsis, the summary request is skipped
  refreshDays: 90,
  since: '2026-10-29', // themes now only from real analysis sections (not music/style): films checked earlier are fetched again once
  retryMissDays: 30,

  async enrich(films, ctx) {
    let next = 0, finished = 0, fatal = null;

    const worker = async () => {
      while (!fatal && next < films.length) {
        if (ctx.signal?.aborted) { fatal = fatal || abortError(); return; }
        const film = films[next++];
        if (ctx.skip?.(film)) { ctx.progress(++finished, films.length); continue; }
        try {
          purgeOldThemes(film);
          // enrich.js leaves this source out of the urgent lanes (0-2 as it decides) when TMDB has the poster and synopsis; the background crawl
          // still gets here and reads everything, so the summary and Wikipedia's poster option arrive later.
          let summary;
          try { summary = await ctx.http.json(BASE + titleForUrl(film.ids.enwiki), { signal: ctx.signal }); }
          catch (e) {
            if (e?.status === 404) summary = null; // no such article
            else throw e;
          }
          const data = mapSummary(summary);
          if (data) {
            const sections = await fetchSections(film, ctx);
            if (sections) data.sections = sections;
          }
          ctx.done(film, data);
        } catch (e) {
          if (e?.code === 'aborted') { fatal = fatal || e; return; }
          ctx.fail(film, e); // not marked as checked: tried again next time
        }
        ctx.progress(++finished, films.length);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, films.length) }, worker));
    if (fatal) throw fatal;
  },
};
