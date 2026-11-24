// Free-form feel queries: "lonely road movie, quietly sad". Pure.
import { lbPillLabel } from './lbthemes.js';
import { dot } from './latent.js';
import { matchStems, contentStems } from './text.js';
import { scanText } from './extract.js';
import { toSet } from './similar.js';

const lower = (s) => String(s).toLowerCase();

// Everyday words that should reach several descriptors. Each alias is an "any of" group: a film that has one of them
// counts, it does not need all. Kept here, not in the lexicon, so reading reviews is not affected.
const FUNNY = ['hilarious', 'farcical', 'wry', 'playful', 'deadpan', 'satirical'];
const WARM = ['warm', 'heartwarming', 'tender', 'cosy', 'charming'];
const SCARY = ['terrifying', 'chilling', 'eerie', 'tense', 'foreboding'];
export const ALIASES = {
  funny: FUNNY, comedic: FUNNY, humorous: FUNNY, humourous: FUNNY, comic: FUNNY,
  warm: WARM, warmhearted: WARM, comforting: ['cosy', 'heartwarming', 'tender'],
  scary: SCARY, frightening: SCARY, spooky: SCARY, creepy: ['eerie', 'foreboding', 'uneasy'],
};
const WORD = /[a-z]+/g;
/**
 * Asking for two things means wanting both. A film's score is the average of what it has, scaled by how much of the ask it
 * covers: `floor` of the score for a film with none of the asked-for ideas present, all of it for a film with every one.
 * An idea counts as present from `present` up (the score a light chip has), in part below that.
 * Before this (11 Nov) a film very strong on one of two chips outranked films that had both: 59% of "Very close" badges on
 * two-chip searches on a real library went to films with only one of the two.
 */
export const COVERAGE = { floor: 0.25, present: 0.15 };
const have = v => Math.min(1, v / COVERAGE.present);

// Filter ids that are matched by what the film's profile lists, not by a vector: 'lb:<Letterboxd theme group>' and 'set:<place or era id>'.
export const lbId = name => 'lb:' + name;
const LB_W = 1, SET_W = 0.8;
const isListed = id => id.startsWith('lb:') || id.startsWith('set:');
const listCache = new WeakMap();
function listedOf(r) {
  let c = listCache.get(r);
  if (!c) {
    // New short tags, plus the raw group names so saved filters and old links that use a long name still match.
    c = { lb: new Set([...(r.profile.lbTags || []).map(x => x.label), ...(r.profile.lbGroups || [])].map(l => lower(l).trim())),
      set: new Set([...(r.profile.settings || []).map(s => s.id), ...(r.profile.themes || []).map(t => t.id)]) };
    listCache.set(r, c);
  }
  return c;
}
/** 0 when the film does not list it, else the match strength (a Letterboxd group is curated, so it counts in full). */
export function listedMatch(r, id) {
  const c = listedOf(r);
  if (id.startsWith('lb:')) return c.lb.has(lower(id.slice(3)).trim()) ? LB_W : 0;
  if (id.startsWith('set:')) return c.set.has(id.slice(4)) ? SET_W : 0;
  return 0;
}
const matchOf = (r, id) => (isListed(id) ? listedMatch(r, id) : Math.max(r.descs.get(id)?.score || 0, r.themes.m.get(id) || 0));

function themesInText(index, stems) {
  const found = new Set();
  for (let i = 0; i < stems.length;) {
    const cands = index.themeStarts.get(stems[i].stem);
    let hit = null;
    if (cands) {
      for (const p of cands) {
        if (i + p.len > stems.length) continue;
        let ok = true;
        for (let k = 1; k < p.len; k++) if (stems[i + k].stem !== p.stems[k]) { ok = false; break; }
        if (ok) { hit = p; break; }
      }
    }
    if (hit) { found.add(hit.id); i += hit.len; } else i++;
  }
  return found;
}

/**
 * @param opts.all true when everything asked for is wanted together (a By feel search): films are scaled by how much of the ask
 *   they cover (COVERAGE) and each result says so in `covers`. Left off, the list is "any of these" (Tonight's moods), as before.
 */
/**
 * The feelings and themes a typed phrase names (what queryFeel would look for), so a search box can offer them as chips.
 * Returns [{ id, kind: 'descriptors' | 'themes' }] in the order found; alias words add their whole group.
 */
export function textIds(index, text) {
  if (!text || !String(text).trim()) return [];
  const stems = matchStems(text);
  const out = new Map();
  for (const id of scanText({ stems }, index.matcher).keys()) out.set(id, 'descriptors');
  for (const id of themesInText(index, stems)) if (!out.has(id)) out.set(id, 'themes');
  for (const word of lower(text).match(WORD) || []) for (const id of ALIASES[word] || []) if (index.matcher.byId.has(id) && !out.has(id)) out.set(id, 'descriptors');
  return [...out].map(([id, kind]) => ({ id, kind }));
}

export function queryFeel(index, { descriptors = [], themes = [], avoid = [], text = '' } = {}, { limit = 30, among = null, all = false } = {}) {
  const wantD = new Map();
  const wantT = new Map();
  const wantL = new Map(); // lb: / set: ids
  for (const id of descriptors) wantD.set(id, 1);
  for (const id of themes) (isListed(id) ? wantL : wantT).set(id, 1);
  let q = null;
  if (text && String(text).trim()) {
    const stems = matchStems(text);
    const found = scanText({ stems }, index.matcher);
    for (const id of found.keys()) if (!wantD.has(id)) wantD.set(id, 0.9);
    for (const id of themesInText(index, stems)) if (!wantT.has(id)) wantT.set(id, 0.9);
    const v = index.latent.project(contentStems(text));
    if (v.some(x => x !== 0)) q = v;
  }
  // Alias groups from the words of the text (only descriptors this lexicon knows).
  const wantG = [];
  if (text && String(text).trim()) {
    const seenAlias = new Set();
    for (const word of lower(text).match(WORD) || []) {
      const ids = ALIASES[word] && ALIASES[word].filter(id => index.matcher.byId.has(id));
      const sig = ids && ids.join('|');
      if (ids?.length && !seenAlias.has(sig)) { seenAlias.add(sig); wantG.push({ ids, w: 0.9, label: word }); }
    }
  }
  const avoidSet = new Set(avoid);
  for (const id of avoidSet) { wantD.delete(id); wantT.delete(id); wantL.delete(id); }
  // One idea counts once: the same id, or a theme and a descriptor with the same label, is not scored twice.
  const labelOf = (id, isTheme) => lower(isTheme ? (index.themeLabels?.get(id) ?? id) : (index.matcher.byId.get(id)?.label ?? id));
  const concepts = new Set();
  for (const id of wantD.keys()) concepts.add(labelOf(id, false));
  for (const id of [...wantT.keys()]) {
    if (wantD.has(id)) { wantD.set(id, Math.max(wantD.get(id), wantT.get(id))); wantT.delete(id); continue; }
    const c = labelOf(id, true);
    if (concepts.has(c)) wantT.delete(id); else concepts.add(c);
  }
  const latentW = q ? 0.5 : 0;
  let den = latentW;
  for (const w of wantD.values()) den += w;
  for (const w of wantT.values()) den += w;
  for (const w of wantL.values()) den += w;
  for (const g of wantG) den += g.w;
  // Only things to avoid and nothing to look for: everything that doesn't carry them, best-known films first.
  const excludeOnly = !den && avoidSet.size > 0;
  if (!den && !excludeOnly) return [];

  const only = toSet(among);
  const out = [];
  for (const r of index.recs) {
    if (only && !only.has(r.key)) continue;
    if (excludeOnly) {
      let worst = 0;
      for (const id of avoidSet) worst = Math.max(worst, matchOf(r, id));
      if (worst >= 0.15) continue;
      out.push({ key: r.key, score: Math.round((0.5 + 0.5 * r.confidence - worst) * 1000) / 1000, why: [] });
      continue;
    }
    let s = 0, cov = 0, asked = 0, whole = 0;
    const hits = [];
    const count = (w, v) => { asked += w; cov += w * have(v); if (v >= COVERAGE.present) whole += w; };
    for (const [id, w] of wantD) {
      const v = Math.max(r.descs.get(id)?.score || 0, r.themes.m.get(id) || 0);
      count(w, v);
      if (v > 0) { s += w * v; if (v >= 0.15) hits.push({ v: w * v, text: lower(index.matcher.byId.get(id)?.label ?? id) }); }
    }
    for (const [id, w] of wantT) {
      const v = Math.max(r.themes.m.get(id) || 0, r.descs.get(id)?.score || 0);
      count(w, v);
      if (v > 0) {
        s += w * v;
        const info = r.themeInfo.get(id);
        hits.push({ v: w * v, text: info ? (info.kind === 'about' ? `about ${lower(info.label)}` : lower(info.label)) : id });
      }
    }
    for (const [id, w] of wantL) {
      const v = listedMatch(r, id);
      count(w, v);
      if (v > 0) {
        s += w * v;
        const label = id.startsWith('lb:') ? lbPillLabel(id.slice(3)) : (r.profile.settings.find(x => x.id === id.slice(4)) || r.profile.themes.find(x => x.id === id.slice(4)) || {}).label || id.slice(4);
        hits.push({ v: w * v, text: id.startsWith('lb:') ? lower(label) : 'set in ' + lower(label) });
      }
    }
    for (const g of wantG) {
      let best = 0, bestId = null;
      for (const id of g.ids) {
        const v = Math.max(r.descs.get(id)?.score || 0, r.themes.m.get(id) || 0);
        if (v > best) { best = v; bestId = id; }
      }
      count(g.w, best);
      if (best > 0) {
        s += g.w * best;
        if (best >= 0.15) hits.push({ v: g.w * best, text: lower(index.matcher.byId.get(bestId)?.label ?? bestId) });
      }
    }
    if (q && r.hasLatent) s += latentW * Math.min(1, 2 * Math.max(0, dot(q, r.latent)));
    let pen = 0, leftOut = false;
    for (const id of avoidSet) { const v = matchOf(r, id); pen += 0.8 * v; if (v >= COVERAGE.present) leftOut = true; }
    // In a By feel search "leave out" means out: a film that clearly has the chip never shows, however strong it is on the rest.
    // (A faint trace only lowers it.) Tonight's moods keep the softer penalty alone.
    if (all && leftOut) continue;
    const covered = all && asked ? COVERAGE.floor + (1 - COVERAGE.floor) * (cov / asked) : 1;
    let score = (s / den) * covered * (0.7 + 0.3 * r.confidence) - pen;
    if (!(score > 0)) continue;
    score = Math.min(1, score);
    hits.sort((a, b) => b.v - a.v || (a.text < b.text ? -1 : 1));
    const why = [...new Set(hits.map(h => h.text))].slice(0, 4);
    const row = { key: r.key, score: Math.round(score * 1000) / 1000, why };
    // covers = the share of what was asked that the film clearly has (each idea in full or not at all), for the closeness badge;
    // the score above uses the softer figure, where a faint trace counts in part.
    if (all) row.covers = asked ? Math.round((whole / asked) * 100) / 100 : 1;
    out.push(row);
  }
  out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  return out.slice(0, limit);
}
