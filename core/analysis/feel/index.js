// Feel engine entry point: build the index, read profiles, and re-export the public API.
import { createHash } from 'node:crypto';
import { expandLbGroups } from './lbthemes.js';
import { LEXICON, AXES, HIDDEN_FROM_CHIPS, SHOWN_AS, FAMILIES } from './lexicon.js';
import { classifyAll } from './categories.js';
import { prepareLatentSteps } from './latent.js';
import { contentStems, stemPhrase, slug } from './text.js';
import { buildMatcher, prepareText, scoreDescriptors, extractThemes, allTexts, ownWords } from './extract.js';
import { certaintyOf } from './certainty.js';
export { certaintyOf, CERTAINTY, CERTAINTY_LABEL } from './certainty.js';
import { mkVec } from './similar.js';
import { sectionsOf } from './sections.js';
import { chipsFor, oneDirection } from './floor.js';
import { scoreThemes, rankThemes, hitCount, labelStems, centralityFactor } from './centrality.js';

export { LEXICON, AXES };
export { similar, shift } from './similar.js';
import { lbId } from './query.js';
export { queryFeel, lbId } from './query.js';
export { describe } from './describe.js';

const FEEL_FACETS = { mood: 1, tone: 1, pace: 1, impact: 1, craft: 0.5 };
const THEME_W = { about: 1, subject: 0.8, style: 0.5, adaptation: 0.5 };
const PEOPLE_W = { director: 1, writer: 0.5, cinematography: 0.5, composer: 0.5, editor: 0.3, cast: 0.4 };
const CRAFT_PEOPLE = new Set(['cinematography', 'composer', 'editor']);
/** Setting weight in similarity: a shared place can add to a match but never carry one. */
const PLACE_W = 0.2;

const personKey = (p) => (p.id != null && p.id !== '' ? String(p.id) : 'n:' + slug(p.name || ''));

/** How many of the film's texts contain every content word of the label (the film's own title words excluded). */
function mentionsOf(label, textStems, titleStems) {
  return hitCount(labelStems(label, titleStems), textStems);
}

/**
 * The descriptors as the film page reads them: a hidden near-copy (unhurried, propulsive) adds what it found to the word shown
 * for it, as two separate pieces of evidence (1 - (1-a)(1-b)). Similarity and Tonight keep the original scores.
 */
export function forDisplay(descs) {
  const lend = new Map();
  for (const d of descs) { const to = SHOWN_AS[d.id]; if (to) lend.set(to, 1 - (1 - (lend.get(to) || 0)) * (1 - d.score)); }
  if (!lend.size) return descs;
  const out = descs.map(d => (lend.has(d.id) ? { ...d, score: 1 - (1 - d.score) * (1 - lend.get(d.id)) } : d));
  for (const [to, s] of lend) {
    if (out.some(d => d.id === to)) continue;
    const src = descs.find(d => SHOWN_AS[d.id] === to);
    const target = LEXICON.find(d => d.id === to);
    if (target) out.push({ ...src, id: to, label: target.label, facet: target.facet, score: s });
  }
  return out.sort((p, q) => q.score - p.score || (p.id < q.id ? -1 : 1));
}

/** Descriptors that may appear as chips on a film page, before the strength floor. */
export function chipCandidates(descs) {
  return descs.filter(d => !HIDDEN_FROM_CHIPS.has(d.id) && (d.facet !== 'theme' || (d.voices || []).length >= 2 || d.score >= 0.45));
}

function buildRec(input, matcher, classify) {
  const texts = allTexts(input);
  const preps = texts.map(prepareText);
  const descs = scoreDescriptors(preps, matcher);
  const coverage = { viewers: 0, critics: 0, editors: 0 };
  let vChars = 0, cChars = 0;
  for (const t of texts) {
    coverage[t.voice] = (coverage[t.voice] || 0) + 1;
    if (t.voice === 'viewers') vChars += t.text.length;
    else if (t.voice === 'critics') cChars += t.text.length;
  }
  const confidence = vChars + cChars === 0 ? 0 : 1 - Math.exp(-(vChars + 0.6 * cChars) / 1500);

  const extracted = extractThemes(input, classify);
  const settings = extracted.settings;
  // Score every candidate theme before anything is dropped, then rank by how central it is to this film.
  const titleStems = [...new Set(contentStems(input.title || ''))];
  const themes = rankThemes(scoreThemes(extracted.themes, { texts: input.texts || [], titleStems, lists: { wikipedia: input.categories, keywords: input.keywords, wikidata: input.subjects } }));
  const textStems = (input.texts || []).filter(t => t && t.text).map(t => new Set(contentStems(t.text)));
  for (const t of themes) t.mentions = mentionsOf(t.label, textStems, titleStems);

  const descMap = new Map(descs.map(d => [d.id, d]));
  const feelE = [], craftE = [], themeE = [];
  const themeInfo = new Map();
  for (const d of descs) {
    const fw = FEEL_FACETS[d.facet];
    if (fw && d.id !== 'rewatchable') feelE.push([d.id, d.score * fw]); // a habit, not a feeling: stays a facet, out of the vector
    if (d.facet === 'craft') craftE.push([d.id, d.score]);
    if (d.facet === 'theme') { themeE.push([d.id, 0.9 * d.score]); themeInfo.set(d.id, { label: d.label, kind: 'descriptor', voices: d.voices }); }
  }
  for (const t of themes) {
    themeE.push([t.id, (THEME_W[t.kind] ?? 0.5) * centralityFactor(t.centrality)]);
    if (t.kind === 'style') craftE.push([t.id, 0.8]);
    themeInfo.set(t.id, { label: t.label, kind: t.kind, voices: t.voices });
  }
  // Places count towards similarity; "era" settings (set in the 1940s, medieval) are kept for display only: no era, no connection.
  for (const s of settings) { if (s.kind === 'era') continue; themeE.push([s.id, PLACE_W]); if (!themeInfo.has(s.id)) themeInfo.set(s.id, { label: s.label, kind: s.kind, voices: ['editors'] }); }
  for (const g of input.genres || []) craftE.push(['g:' + slug(g), 0.4]);

  const peopleE = [];
  const directorE = []; // directors alone: the Map counts them (weakly) and never the cast (20 Nov)
  const peopleInfo = new Map();
  const p = input.people || {};
  for (const role of Object.keys(PEOPLE_W)) {
    const list = (p[role] || []).slice(0, role === 'cast' ? 5 : 4);
    for (const person of list) {
      if (!person || !(person.id || person.name)) continue;
      const id = personKey(person);
      const w = PEOPLE_W[role];
      peopleE.push([id, w]);
      if (role === 'director') directorE.push([id, 1]);
      const prev = peopleInfo.get(id);
      if (!prev || w > prev.w) peopleInfo.set(id, { name: person.name || id, role, w });
      if (CRAFT_PEOPLE.has(role)) craftE.push(['p:' + id, 0.3]);
    }
  }

  const kinds = [];
  if (coverage.viewers) kinds.push('viewer reviews');
  if (coverage.critics) kinds.push('critic quotes');
  if ((input.texts || []).some(t => t.voice === 'editors' && t.text)) kinds.push('article text');
  if ((input.categories || []).length) kinds.push('article categories');
  if ((input.keywords || []).length || (input.subjects || []).length) kinds.push('keywords');

  // Each row keeps its own strongest chips (floor.js).
  const shownDescs = oneDirection(forDisplay(descs), FAMILIES);
  const chipDescs = chipsFor(chipCandidates(shownDescs));
  // Letterboxd's theme groups, split into short tags for the right rows (lbthemes.js). Their own names never confirm a part.
  const lbGroups = (input.lbThemes || []).slice(0, 6);
  const ownText = (input.texts || []).filter(t => t && t.text && t.source !== 'lbpage.themes').map(t => t.text).join(' \n ');
  const ownLists = [...(input.keywords || []), ...(input.categories || []), ...(input.subjects || [])];
  const lbTags = expandLbGroups(lbGroups, {
    text: ownText, lists: ownLists, genres: input.genres || [], basedOn: (input.basedOn || []).length > 0,
    labels: [...chipDescs.filter(d => !d.fragile).map(d => d.label), ...themes.map(t => t.label)], // a fragile chip confirms nothing
  });
  const profile = {
    key: input.key,
    descriptors: chipDescs,
    lbGroups,
    lbTags,
    lbThemes: lbTags.filter(t => t.row === 'theme' && t.shown).map(t => t.label), // Themes-row tags from Letterboxd (kept for older readers)
    themes,
    settings,
    confidence: Math.round(confidence * 1000) / 1000,
    certainty: certaintyOf(ownWords(preps), chipDescs, coverage), // how sure this read is, in words the user can see (certainty.js)
    coverage,
    kinds,
  };
  // The words for the latent layer, counted once here (in order of first appearance) so a rebuild does not count them again.
  const tf = new Map();
  const add = (w) => tf.set(w, (tf.get(w) || 0) + 1);
  for (const t of texts) for (const w of contentStems(t.text)) add(w);
  for (const t of themes) add('t:' + t.id);
  return {
    key: input.key, title: input.title, year: input.year, profile, confidence, coverage,
    descs: descMap, entries: { feel: feelE, themes: themeE, craft: craftE }, feel: null, themes: null, craft: null, people: mkVec(peopleE), directors: mkVec(directorE),
    themeInfo, peopleInfo, terms: [...tf.keys()], counts: [...tf.values()], latent: null, hasLatent: false,
  };
}

/** Mark a memo loaded from disk (feel-memo-file.js) as made with the built-in lexicon and classifier, so buildFeelIndex keeps it. */
export function adoptMemo(memo) { memo.lexicon = LEXICON; memo.classify = classifyAll; return memo; }

const sigs = new WeakMap(); // input object -> its hash, so an input handed in again (core/api.js keeps them) is not hashed again
/**
 * A short hash of a FeelInput (not the text itself: the memo is kept on disk). Worked out once per input object, so an input
 * must never be changed after it has been handed to the feel engine: build a new one instead (gatherFeelInput always does).
 */
export function inputSig(input) {
  let sig = sigs.get(input);
  if (sig === undefined) { sig = createHash('sha1').update(JSON.stringify(input)).digest('base64'); sigs.set(input, sig); }
  return sig;
}

/** buildRec through the memo. The stored record is never handed out: the build below changes records, so each use gets a copy. */
function memoRec(memo, input, matcher, classify) {
  const sig = inputSig(input);
  let hit = memo.get(input.key);
  if (!hit || hit.sig !== sig) { hit = { sig, rec: buildRec(input, matcher, classify) }; memo.set(input.key, hit); memo.dirty = true; }
  const base = hit.rec;
  return { ...base, profile: structuredClone(base.profile) };
}

const IDF_MIN_FILMS = 40;   // below this a library is too small to say what is "common"
const IDF_FLOOR = 0.3;
const IDF_REF_SHARE = 0.02; // on 2% of films or fewer (about 14 of 680) it carries full weight

/**
 * How distinguishing each descriptor, theme, style and genre is in this library: 1 when rare, down to IDF_FLOOR when it
 * shows up on most films ("thrilling" says little when a sixth of the library is thrilling).
 */
export function descriptorIdf(recs) {
  const out = new Map();
  if (recs.length < IDF_MIN_FILMS) return out;
  const df = new Map();
  for (const r of recs) {
    const ids = new Set();
    for (const [id, x] of r.descs) if (x.score >= 0.15) ids.add(id);
    // themes, styles and genres count too: "black comedy" or "Drama" on a fifth of the library is no signal
    for (const list of [r.entries.themes, r.entries.craft]) for (const [id] of list) if (!r.descs.has(id)) ids.add(id);
    for (const id of ids) df.set(id, (df.get(id) || 0) + 1);
  }
  const ref = Math.log(1 / IDF_REF_SHARE);
  for (const [id, n] of df) out.set(id, Math.max(IDF_FLOOR, Math.min(1, Math.log(recs.length / n) / ref)));
  return out;
}

/**
 * The build as steps: it yields between pieces of work (after each film, each library-wide pass), so buildFeelIndexAsync can
 * let other work run in between. Run to the end without pausing it is exactly buildFeelIndex.
 */
function* buildSteps(inputs, { lexicon = LEXICON, axes = AXES, dims = 48, classify = classifyAll, memo = null } = {}) {
  const matcher = buildMatcher(lexicon);
  // memo (optional Map you keep between builds): each film's text work is kept against its input, so a rebuild after one
  // film changed only redoes that film. The result is identical to a cold build.
  if (memo && (memo.lexicon !== lexicon || memo.classify !== classify)) { memo.clear(); memo.dirty = true; memo.lexicon = lexicon; memo.classify = classify; }
  const seenKeys = new Set();
  const recs = [];
  const byKey = new Map();
  for (const input of inputs || []) {
    if (!input || input.key == null || byKey.has(input.key)) continue;
    const r = memo ? memoRec(memo, input, matcher, classify) : buildRec(input, matcher, classify);
    seenKeys.add(input.key);
    recs.push(r);
    byKey.set(r.key, r);
    yield;
  }
  if (memo) for (const k of [...memo.keys()]) if (!seenKeys.has(k)) { memo.delete(k); memo.dirty = true; }
  // How many films share each theme, so describe() can prefer the specific over the generic.
  const themeDf = new Map();
  for (const r of recs) for (const t of r.profile.themes) themeDf.set(t.id, (themeDf.get(t.id) || 0) + 1);
  for (const r of recs) for (const t of r.profile.themes) t.films = themeDf.get(t.id);
  const libraryFilms = recs.length;
  for (const r of recs) r.profile.libraryFilms = libraryFilms;
  const idf = descriptorIdf(recs);
  yield;
  let i = 0;
  for (const r of recs) {
    r.idf = idf;
    // genres keep their weight: they are coarse, but they stop a comedy matching a war film on one shared tag
    const damp = (list) => mkVec(list.map(([id, w]) => [id, id.startsWith('g:') ? w : w * (idf.get(id) ?? 1)]));
    r.feel = damp(r.entries.feel);
    r.themes = damp(r.entries.themes);
    r.craft = damp(r.entries.craft);
    r.entries = null;
    if (++i % 50 === 0) yield;
  }
  const L = yield* prepareLatentSteps(recs.map(r => ({ terms: r.terms, counts: r.counts })), { dims });
  yield;
  const vecs = [];
  i = 0;
  for (const r of recs) {
    r.latent = L.projectCounts(r);
    vecs.push(r.latent);
    r.hasLatent = r.latent.some(x => x !== 0);
    r.terms = null;
    r.counts = null;
    if (++i % 25 === 0) yield;
  }
  const latent = { dims: L.dims, vecs, project: L.project, vocabSize: L.vocabSize };
  const feelIds = new Set(lexicon.filter(d => FEEL_FACETS[d.facet]).map(d => d.id));
  // Theme labels the library knows, so free-text queries can pick them up.
  const themeLabels = new Map();
  for (const r of recs) for (const [id, info] of r.themeInfo) if (info.kind !== 'descriptor' && !themeLabels.has(id)) themeLabels.set(id, info.label);
  yield;
  const themeStarts = new Map();
  i = 0;
  for (const [id, label] of themeLabels) {
    if (++i % 500 === 0) yield;
    const stems = stemPhrase(label);
    if (!stems.length) continue;
    const list = themeStarts.get(stems[0]) || [];
    list.push({ id, stems, len: stems.length });
    themeStarts.set(stems[0], list);
  }
  for (const list of themeStarts.values()) list.sort((a, b) => b.len - a.len || (a.id < b.id ? -1 : 1));
  return { recs, byKey, axes, lexicon, matcher, latent, feelIds, themeStarts, themeLabels, dims: latent.dims };
}

/** @returns FeelIndex (opaque; use the functions exported here) */
export function buildFeelIndex(inputs, opts = {}) {
  const steps = buildSteps(inputs, opts);
  for (;;) { const s = steps.next(); if (s.done) return s.value; }
}

const SLICE_MS = 20;
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
/**
 * buildFeelIndex in slices: after about `sliceMs` of work it waits a turn of the event loop, so the core keeps answering other
 * calls while a big build (the first one after an update: every film's text read from scratch) runs. Same result, same memo use.
 * Callers must not start a second build on the same memo while one is running (core/api.js runs them one at a time).
 */
export async function buildFeelIndexAsync(inputs, opts = {}, { sliceMs = SLICE_MS, pause = nextTurn } = {}) {
  const steps = buildSteps(inputs, opts);
  let since = performance.now();
  for (;;) {
    const s = steps.next();
    if (s.done) return s.value;
    if (performance.now() - since >= sliceMs) { await pause(); since = performance.now(); }
  }
}

export function profileOf(index, key) {
  const r = index.byKey.get(key);
  return r ? r.profile : null;
}

/**
 * Library-wide counts for filter UIs, named like the film page's rows.
 *   descriptors: mood, tone, pace, craft, impact and theme descriptors (each has `facet`)
 *   themes:      Letterboxd theme groups (`lb:<name>`, section 'lb') and the engine's themes, sorted into the film page's rows
 *                by `section`: 'subject' (Subjects), 'kind' (Kind of film), 'other' (never shown on a film page, kept for labels)
 *   settings:    places (`set:<id>`) and eras (`set:<theme id>`) for "Set in"
 */
export function facets(index, among = null) {
  const only = among ? new Set(among) : null; // count only these films (the ones in view), when given
  const d = new Map(), t = new Map(), s = new Map();
  const bump = (m, id, label, extra) => { const e = m.get(id); if (e) e.count++; else m.set(id, { id, label, ...extra, count: 1 }); };
  for (const r of index.recs) {
    if (only && !only.has(r.key)) continue;
    for (const x of r.descs.values()) if (x.score >= 0.25 && !HIDDEN_FROM_CHIPS.has(x.id)) bump(d, x.id, x.label, { facet: x.facet });
    const placeLabels = r.profile.settings.map(x => x.label);
    const sec = sectionsOf(r.profile.themes, [], placeLabels);
    const sectionOf = new Map();
    for (const x of sec.subjects) sectionOf.set(x.id, 'subject');
    for (const x of sec.kind) sectionOf.set(x.id, 'kind');
    for (const x of r.profile.themes) {
      if (sec.eras.includes(x)) bump(s, 'set:' + x.id, x.label, { kind: 'era' });
      else bump(t, (sectionOf.get(x.id) || 'other') + '|' + x.id, x.label, { themeId: x.id, section: sectionOf.get(x.id) || 'other' });
    }
    for (const x of r.profile.lbTags || []) bump(t, 'lb|' + x.label, x.label, { themeId: lbId(x.label), section: x.row === 'theme' ? 'lb' : x.row === 'tone' ? 'lb-tone' : x.row });
    for (const x of r.profile.settings) bump(s, 'set:' + x.id, x.label, { kind: x.kind });
  }
  const sorted = (m) => [...m.values()].sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return {
    descriptors: sorted(d),
    themes: sorted(t).map(({ themeId, ...x }) => ({ ...x, id: themeId })),
    settings: sorted(s),
  };
}
