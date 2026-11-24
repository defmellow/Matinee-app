// Pure helpers for the poster chooser.
const NAMES = { lbpage: 'Letterboxd', letterboxd: 'Letterboxd', tmdb: 'TMDB', wikipedia: 'Wikipedia', wikidata: 'Wikipedia', imdb: 'IMDb', imdbpage: 'IMDb', omdb: 'OMDb', rss: 'Your Letterboxd feed', allmovie: 'AllMovie' };
export const optionLabel = o => (o && (o.label || NAMES[o.source])) || (o && o.source) || 'Poster';

/**
 * Which tile carries the "In use" mark. Chosen wins; with no choice the automatic pick (opts.auto) is in use, and that is
 * shown on the "Automatic" tile only, so exactly one tile is ever marked.
 */
export function tileState(opts, option) {
  return { picked: !!opts && opts.chosen != null && opts.chosen === option.source };
}
