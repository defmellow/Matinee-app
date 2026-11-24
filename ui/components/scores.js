// Pure helpers for showing outside ratings: Letterboxd first, then Rotten Tomatoes, IMDb, Metacritic.
// `ratings` is the summary shape: { letterboxd:{value 0–5,votes}, imdb:{value,votes}, rt:{critics,criticsCount,audience,audienceCount}, metacritic:{critics,criticsCount} }.

export const SOURCE_ORDER = ['letterboxd', 'rt-critics', 'rt-audience', 'imdb', 'metacritic', 'metacritic-users', 'tmdb'];

/** Sort scoreParts ({ source, … }) into the display order; unknown sources go last. */
export function orderParts(parts = []) {
  const rank = s => { const i = SOURCE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  return [...parts].sort((a, b) => rank(a.source) - rank(b.source));
}

const votes = n => (n ? ` from ${new Intl.NumberFormat('en-AU').format(n)} ${n === 1 ? 'rating' : 'ratings'}` : '');

/**
 * Every outside score we have, in display order: [{ source, label, text, title }].
 * `text` is short ("★ 3.94", "RT 92%", "IMDb 7.8"); `title` explains it for hover.
 */
export function externalScores(r = {}) {
  const out = [];
  const lb = r.letterboxd?.value;
  if (lb > 0) out.push({ source: 'letterboxd', label: 'Letterboxd', text: `★ ${lb.toFixed(2)}`, title: `Letterboxd average, out of 5${votes(r.letterboxd.votes)}` });
  const rt = r.rt?.critics;
  if (rt != null) out.push({ source: 'rt-critics', label: 'Rotten Tomatoes', text: `RT ${Math.round(rt)}%`, title: `Rotten Tomatoes critics${r.rt.criticsCount ? `, ${r.rt.criticsCount} reviews` : ''}` });
  const pc = r.rt?.audience;
  if (pc != null) out.push({ source: 'rt-audience', label: 'Popcornmeter', text: `Popcorn ${Math.round(pc)}%`, title: `Rotten Tomatoes audience (Popcornmeter)${votes(r.rt.audienceCount)}` });
  const im = r.imdb?.value;
  if (im > 0) out.push({ source: 'imdb', label: 'IMDb', text: `IMDb ${im.toFixed(1)}`, title: `IMDb rating, out of 10${votes(r.imdb.votes)}` });
  const mc = r.metacritic?.critics;
  if (mc > 0) out.push({ source: 'metacritic', label: 'Metacritic', text: `Metacritic ${Math.round(mc)}`, title: `Metacritic critics score, out of 100${r.metacritic.criticsCount ? `, ${r.metacritic.criticsCount} reviews` : ''}` });
  return out;
}

/** Scores for list rows: the Letterboxd, Rotten Tomatoes critics and IMDb ones only (compact), in order. `ratings` may be partial. */
export function rowScores(ratings, imdb) {
  const r = { ...(ratings || {}) };
  if (!(r.imdb?.value > 0) && imdb?.value > 0) r.imdb = imdb;
  return externalScores(r).filter(s => ['letterboxd', 'rt-critics', 'imdb'].includes(s.source));
}

/** The score to lead with: Letterboxd, else the next one available (always labelled via `text`). */
export function primaryScore(r) {
  return externalScores(r)[0] || null;
}
