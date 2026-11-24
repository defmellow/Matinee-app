// Builds the FeelInput for one film from its composed view and raw per-source data. Pure; never throws.

const MAX_TEXT = 3000;
const MAX_CAST = 8;
const ROLES = ['director', 'writer', 'cinematography', 'composer', 'editor', 'cast'];

const strings = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : x?.name && typeof x.name === 'string' ? x.name.trim() : '')).filter(Boolean) : []);
const asArray = (v) => (Array.isArray(v) ? v : []);

function textOf(item) {
  if (typeof item === 'string') return item;
  return item && typeof item.text === 'string' ? item.text : '';
}

function addText(texts, voice, source, raw) {
  if (typeof raw !== 'string') return;
  const text = raw.trim().slice(0, MAX_TEXT).trim();
  if (text) texts.push({ voice, source, text });
}

function people(composed) {
  const out = {};
  for (const role of ROLES) {
    const list = asArray(composed?.people?.[role])
      .filter((p) => p && (p.name || p.id))
      .map((p) => ({ id: p.id ?? null, name: p.name ?? '' }));
    out[role] = role === 'cast' ? list.slice(0, MAX_CAST) : list;
  }
  return out;
}

function collectionOf(composed, src) {
  const wd = src?.wikidata?.collectionId;
  if (typeof wd === 'string' && wd) return wd;
  if (typeof composed?.collectionId === 'string' && composed.collectionId) return composed.collectionId;
  const c = composed?.collection;
  if (typeof c === 'string' && c) return c;
  if (c && typeof c === 'object') {
    const v = c.id ?? c.name;
    if (v != null && v !== '') return String(v);
  }
  return null;
}

/** @param composed output of compose(film)   @param film the raw film record (film.src = per-provider data) */
export function gatherFeelInput(composed, film) {
  const c = composed || {};
  const src = film?.src || {};
  const texts = [];

  // viewers
  for (const u of asArray(src.mcreviews?.users)) addText(texts, 'viewers', 'mcreviews.users', textOf(u));
  for (const r of asArray(src.tmdb?.reviews)) addText(texts, 'viewers', 'tmdb.reviews', textOf(r));
  for (const r of asArray(src.lbpage?.reviews)) addText(texts, 'viewers', 'lbpage.reviews', textOf(r));
  for (const r of asArray(src.imdbpage?.reviews)) addText(texts, 'viewers', 'imdbpage.reviews', textOf(r));
  // Letterboxd's crowd keywords ("family, moving, heartbreaking, sadness") and theme names come from how its members talk about the film.
  for (const m of asArray(src.lbpage?.miniThemes)) addText(texts, 'viewers', 'lbpage.themes', asArray(m).join(' '));
  addText(texts, 'viewers', 'lbpage.themes', asArray(src.lbpage?.themes).join('. '));
  // critics
  addText(texts, 'critics', 'rt.consensus', src.rt?.consensus);
  for (const r of asArray(src.mcreviews?.critics)) addText(texts, 'critics', 'mcreviews.critics', textOf(r));
  // AllMovie's editors write these descriptors by hand, so they count as critics' voice (not plot-description text).
  for (const k of ['moods', 'tone', 'flags', 'themes']) addText(texts, 'critics', 'allmovie.' + k, asArray(src.allmovie?.[k]).join('. '));
  addText(texts, 'critics', 'wikipedia.reception', src.wikipedia?.sections?.reception);
  // editors
  addText(texts, 'editors', 'wikipedia.themes', src.wikipedia?.sections?.themes);
  addText(texts, 'editors', 'wikipedia.plot', src.wikipedia?.sections?.plot);
  addText(texts, 'editors', 'synopsis', c.synopsis);
  addText(texts, 'editors', 'tagline', c.tagline);

  return {
    key: c.key ?? film?.key ?? null,
    title: c.title ?? film?.title ?? '',
    year: c.year ?? film?.year ?? null,
    texts,
    categories: strings(src.wikicats?.categories),
    // TMDB's "aftercreditsstinger" / "duringcreditsstinger" say a scene follows the credits: not something a film is about
    keywords: strings([...asArray(c.keywords), ...asArray(src.imdbpage?.keywords)]).filter(k => !/credits ?stinger/i.test(k)),
    subjects: strings(c.subjects),
    locations: strings(c.locations),
    basedOn: strings(c.basedOn),
    lbThemes: strings(src.lbpage?.themes), // Letterboxd's own theme groups ("Humanity and the world around us"), shown in the Themes row
    genres: strings(c.genres),
    people: people(c),
    countries: strings(c.countries),
    languages: strings(c.languages),
    runtime: typeof c.runtime === 'number' ? c.runtime : c.runtime != null && Number.isFinite(Number(c.runtime)) ? Number(c.runtime) : null,
    collection: collectionOf(c, src),
  };
}
