// How central each theme is to ONE film: a score C in 0..1, a tier (0 weak, 1 fair, 2 strong) and plain reasons. Pure.
// Evidence: where the theme came from (a prior, ordinal) and how many of the film's own texts talk about it
// (critics and viewers count for more than plot summaries). No film-specific words live here.
import { contentStems } from './text.js';

/** Every tunable number, in one place so it can be fitted later. */
export const CENTRALITY = {
  // Ordinal prior by where the theme came from: Wikidata main subject > "Films about" category ~ keyword > other category > style > adaptation.
  prior: { p921: 0.55, 'about-category': 0.35, keyword: 0.3, category: 0.25, style: 0.15, adaptation: 0.1 },
  curated: ['p921', 'about-category'],
  interpretive: { weight: 0.6, rate: 0.7 }, // critics and viewers
  descriptive: { weight: 0.25, rate: 0.5 }, // synopsis, plot, article themes
  // Agreement: how many INDEPENDENT sources name the theme (same label, a synonym or a stem match). Sources are grouped by where
  // they come from, so correlated ones count once (TMDB and IMDb keywords; a Wikipedia category and Wikipedia text; every
  // Letterboxd theme list). E = sum of the supporting groups' weights; one group adds nothing, more lift C by
  // weight * (1 - exp(-rate * (E - 1))). Letterboxd theme names and keyword lists inflate broad themes, so they count half.
  agreement: { weight: 0.3, rate: 0.9, groupWeight: { 'lbpage.themes': 0.5, synopsis: 0.5 }, defaultGroupWeight: 1, noLift: ['style', 'adaptation'] }, // styles and source material are genres, not ideas: agreement never lifts them
  tierBands: { strong: 0.8, fair: 0.55 },   // relative to the film's top C
  // How a theme's C scales its weight in similarity: floor + (1 - floor) * min(1, C / full) ^ curve.
  // A theme at or above C = full counts in full; an incidental one (C ~ 0.25) keeps about half. Two films multiply
  // their weights (cosine), so a theme central to both counts far more than one that is central to only one.
  similarity: { full: 0.8, floor: 0.3, curve: 1, missing: 0.5 }, // missing: factor for a theme with no C
};

/** Similarity weight factor (0..1) for a theme with centrality C. */
export function centralityFactor(C, constants = CENTRALITY) {
  const S = constants.similarity;
  if (!Number.isFinite(C)) return S.missing;
  return S.floor + (1 - S.floor) * Math.pow(Math.max(0, Math.min(1, C / S.full)), S.curve);
}

const WHY = {
  p921: 'Wikidata main subject',
  'about-category': 'Wikipedia “Films about…” category',
  keyword: 'Listed as a keyword',
  category: 'Wikipedia category',
  style: 'A style of the film',
  adaptation: 'Source material',
};

// Which independent source group a text belongs to: the site it came from (the part of "mcreviews.critics" before the dot).
const ORIGIN = { tagline: 'synopsis' };
function groupOf(t) {
  const src = t.source ? String(t.source) : 'text:' + (t.voice || '');
  if (src === 'lbpage.themes') return src; // Letterboxd's theme names and keyword lists: low weight, one group
  const origin = src.split('.')[0];
  return ORIGIN[origin] || origin;
}
// Where each structured list comes from. Lists the caller does not pass are simply not cross-checked.
const LIST_GROUP = { wikipedia: 'wikipedia', keywords: 'keywords', wikidata: 'wikidata' };
const PRIOR_GROUP = { p921: 'wikidata', 'about-category': 'wikipedia', category: 'wikipedia', keyword: 'keywords' };
const GROUP_NAME = { wikidata: 'Wikidata', wikipedia: 'Wikipedia', keywords: 'keywords', lbpage: 'Letterboxd', 'lbpage.themes': 'Letterboxd themes', synopsis: 'the synopsis', rt: 'Rotten Tomatoes', mcreviews: 'Metacritic', tmdb: 'TMDB', imdbpage: 'IMDb', allmovie: 'AllMovie' };

const sat = (rate, hits) => 1 - Math.exp(-rate * hits);

// Words that only place a label ("… in the United States") and say nothing about the idea itself.
const PLACE_WORDS = new Set(['unit', 'state', 'america', 'american', 'britain', 'british', 'kingdom']);

/** Content stems of a label with the film's own title words and place-only words taken out. */
export function labelStems(label, titleStems) {
  const skip = titleStems instanceof Set ? titleStems : new Set(titleStems || []);
  const all = [...new Set(contentStems(label))];
  const kept = all.filter(s => !skip.has(s) && !PLACE_WORDS.has(s));
  return kept.length ? kept : all.filter(s => !skip.has(s));
}

/** Stems a text must contain: all of one or two, half of four, a third of longer curated names (“Ku Klux Klan” is met by “the Klan”). */
export const needed = n => (n <= 2 ? n : Math.ceil(n / 3) === 1 ? 1 : Math.ceil(n / 2));

/** Count texts that contain enough of the stems. Returns 0 when there are no stems to look for. */
export function hitCount(stems, stemSets) {
  if (!stems.length) return 0;
  const need = needed(stems.length);
  let n = 0;
  for (const set of stemSets) { let c = 0; for (const s of stems) if (set.has(s) && ++c >= need) { n++; break; } }
  return n;
}

/**
 * @param themes [{ id, label, kind, voices, sources?: string[] }]
 * @param opts { texts: [{voice,text}], titleStems?: string[]|Set, constants?: CENTRALITY }
 * @returns the same themes (copies) plus { centrality, tier, why, hits: {interpretive, descriptive} }, in the input order
 */
export function scoreThemes(themes, { texts = [], titleStems = [], constants = CENTRALITY, lists = {} } = {}) {
  const K = constants;
  // Per source group: the texts' stem sets, and the entries of the structured lists (one entry = one short phrase).
  const byGroup = new Map();
  const groupSets = (g) => { if (!byGroup.has(g)) byGroup.set(g, []); return byGroup.get(g); };
  for (const t of texts) if (t && t.text) groupSets(groupOf(t)).push(new Set(contentStems(t.text)));
  for (const [name, list] of Object.entries(lists || {})) {
    const g = LIST_GROUP[name]; if (!g) continue;
    for (const e of list || []) if (e) groupSets(g).push(new Set(contentStems(String(e))));
  }
  const interp = [], descr = [], critics = [], viewers = [];
  for (const t of texts) {
    if (!t || !t.text) continue;
    const set = new Set(contentStems(t.text));
    if (t.voice === 'critics') { interp.push(set); critics.push(set); }
    else if (t.voice === 'viewers') { interp.push(set); viewers.push(set); }
    else descr.push(set);
  }
  const skip = new Set(titleStems);
  const scored = (themes || []).map(t => {
    const sources = (t.sources && t.sources.length ? t.sources : ['category']).filter(s => K.prior[s] != null);
    const prior = sources.reduce((m, s) => Math.max(m, K.prior[s]), 0);
    const stems = labelStems(t.label, skip);
    const hi = hitCount(stems, interp), hd = hitCount(stems, descr);
    const C0 = 1 - (1 - prior) * (1 - K.interpretive.weight * sat(K.interpretive.rate, hi)) * (1 - K.descriptive.weight * sat(K.descriptive.rate, hd));
    // Independent agreement. The theme's own origin counts as a group even when the caller passed no lists.
    const support = new Map();
    for (const s of sources) if (PRIOR_GROUP[s]) support.set(PRIOR_GROUP[s], 1);
    for (const [g, sets] of byGroup) if (hitCount(stems, sets)) support.set(g.startsWith('lbpage') && g !== 'lbpage.themes' ? 'lbpage' : g, 1);
    let E = 0;
    for (const g of support.keys()) E += K.agreement.groupWeight[g] ?? K.agreement.defaultGroupWeight;
    const lift = E > 1 && !K.agreement.noLift.includes(t.kind) ? K.agreement.weight * (1 - Math.exp(-K.agreement.rate * (E - 1))) : 0;
    const C = 1 - (1 - C0) * (1 - lift);
    const curated = sources.some(s => K.curated.includes(s));
    const groups = (sources.length ? 1 : 0) + (hi ? 1 : 0) + (hd ? 1 : 0);
    const evTier = curated && hi ? 2 : groups >= 2 || sources.includes('p921') ? 1 : 0;
    const why = [];
    const top = [...sources].sort((a, b) => K.prior[b] - K.prior[a])[0];
    if (top) why.push(WHY[top]);
    if (hi) {
      const who = [hitCount(stems, critics) && 'critics', hitCount(stems, viewers) && 'viewers'].filter(Boolean);
      why.push(`Discussed by ${who.join(' and ')}`);
    }
    if (hd) why.push('Mentioned in the plot or synopsis');
    if (support.size >= 2) why.push(`Named by ${support.size} sources`);
    return { ...t, centrality: Math.round(C * 1000) / 1000, evTier, why, hits: { interpretive: hi, descriptive: hd }, agreement: { sources: [...support.keys()].sort(), score: Math.round(E * 100) / 100 } };
  });
  const best = scored.reduce((m, t) => Math.max(m, t.centrality), 0);
  return scored.map(({ evTier, ...t }) => {
    const ratio = best > 0 ? t.centrality / best : 0;
    const rel = ratio >= K.tierBands.strong ? 2 : ratio >= K.tierBands.fair ? 1 : 0;
    return { ...t, tier: Math.min(rel, evTier) };
  });
}

/** Strongest first; ties by id so the order never depends on input order. */
export function rankThemes(scored) {
  return [...scored].sort((a, b) => b.centrality - a.centrality || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
