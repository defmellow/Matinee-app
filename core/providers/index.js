// Extra data sources ("providers"). Each is a plug-in with this shape:
//
// {
//   id: 'wikidata',                     // also the key under film.src and film.checked
//   label: 'Wikidata',                  // shown in Settings and progress ("Checking Wikidata")
//   gives: ['ids', 'people', 'awards'], // what it adds, for the Settings screen
//   needsKey: false,                    // true → only runs when settings.keys[id] is set
//   keyHelp: { url, steps: [..] },      // for key providers: where to get a free key
//   requires(film) → bool,              // prerequisites (e.g. an IMDb id); optional
//   refreshDays: 30, retryMissDays: 30, // optional freshness rules (see enrich.js defaultWants)
//   enabled(settings) → bool,           // optional; key providers check their key
//   async enrich(films, ctx),           // ctx: { http, settings, signal, progress(d,t), log, done(film, data|null, ids), fail(film, err) }
// }
//
// A provider writes normalised fields (see core/model.js PRIORITY and RATING_SOURCES) via ctx.done(film, data, ids).
// Providers run in the order below; later ones can use ids found by earlier ones.

// Each provider module does `export default { id, label, ... }`. core/providers/all.js (lead-owned) imports them.

export const PROVIDER_ORDER = ['boxd', 'wikidata', 'tmdb', 'wikipedia', 'imdb', 'rt', 'metacritic', 'omdb'];

export function sortProviders(list) {
  const rank = id => { const i = PROVIDER_ORDER.indexOf(id); return i === -1 ? 99 : i; };
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
}
