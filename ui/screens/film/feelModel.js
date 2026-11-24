// Pure helpers for the "How it feels" section: grouping, wording and captions. No UI, no calls.


export const VOICE_LABEL ={ viewers: 'Viewers', critics: 'Critics', editors: 'Articles' };
export const FACET_ORDER = ['mood', 'tone', 'pace', 'craft', 'impact', 'theme'];
export const FACET_LABEL = { mood: 'Mood', tone: 'Tone', pace: 'Pace', craft: 'Craft', impact: 'Emotional impact', theme: 'Themes' };

/** The voice we credit a descriptor to: viewers first, then critics, then articles. */
export function mainVoice(voices) {
  const v = voices || [];
  return ['viewers', 'critics', 'editors'].find(x => v.includes(x)) || 'editors';
}

/**
 * A chip's shade says how strong that feeling is for the film: darkest, middle, lightest. Until 12 Nov the shade was only the
 * chip's share of the film's single best chip, so one very strong theme (Past Lives: Romance 0.94) turned every feeling on
 * the page into the lightest, dashed style: 2,755 of 5,289 feeling chips on a real library showed that way, and 1,862 of those were solid
 * findings (0.3 or more). Dashes now mean one thing only: a fragile chip, said by a single mention, tag or list.
 */
export const SHADE = { strong: 0.6, clear: 0.3, nearBest: 0.8, midBest: 0.55 };
const SHADE_LABEL = { 3: 'Strong', 2: 'Clear', 1: 'Light' };
/**
 * Hybrid: the darker of the chip's own strength and its standing next to the film's best confident chip.
 * Own strength alone would leave a film with few reviews all light even where its reviewers agree; standing alone is what
 * made one twenty-mention theme fade five mentions of something else. Taking the darker of the two punishes neither.
 */
export const shadeOf = (score, best = 0) => {
  const s = score || 0;
  const own = s >= SHADE.strong ? 3 : s >= SHADE.clear ? 2 : 1;
  const share = best > 0 ? s / best : 0;
  const standing = share >= SHADE.nearBest ? 3 : share >= SHADE.midBest ? 2 : 1;
  return Math.max(own, standing);
};
/**
 * Descriptors in strongest-first order, each with its shade (weight 1..3, see SHADE). Never a raw score.
 */
export function weighted(descriptors = []) {
  // Confident chips strongest first, then fragile ones in the order the engine gave them (most reliable evidence first).
  const list = descriptors.map((d, i) => ({ d, i })).sort((a, b) => (!!a.d.fragile - !!b.d.fragile) || (a.d.fragile ? a.i - b.i : (b.d.score || 0) - (a.d.score || 0) || a.i - b.i)).map(x => x.d);
  const best = Math.max(0, ...list.filter(d => !d.fragile).map(d => d.score || 0));
  return list.map(d => {
    if (d.fragile) return { ...d, voice: mainVoice(d.voices), tierLabel: 'Very unsure', weight: 1 };
    const weight = shadeOf(d.score, best);
    return { ...d, voice: mainVoice(d.voices), tierLabel: SHADE_LABEL[weight], weight };
  });
}

/** How many chips a row shows before "Show more", and how far dashed (fragile) chips may top a thin row up. */
export const ROW_SHOWN = { default: 6, pace: 3 };
export const ROW_FILL = 3;
/**
 * What one row shows at first and what waits behind "Show more". Confident chips come first, up to the row's count.
 * Fragile (dashed) chips show up front only on a film Matinee is not very sure about (`thin`), and there only to top a row up
 * to ROW_FILL: one remark among fifteen reviews is worth showing, one among forty-five is noise. Measured on a real library
 * (12 Nov): topping up every film put dashed chips on 674 of 691 films, about four each, mostly wrong on well-reviewed films.
 * `lonely`: the film shows feelings elsewhere but this row has nothing sure in it, so its dashed chips show up front too
 * (a row must never seem to vanish; the faint chip speaks for itself, no extra line).
 * @returns { shown, more } (more = the chips behind "Show more", in order)
 */
export function rowView(items = [], facet = '', { thin = false, lonely = false } = {}) {
  const max = ROW_SHOWN[facet] ?? ROW_SHOWN.default;
  const sure = items.filter(d => !d.fragile), unsure = items.filter(d => d.fragile);
  const shown = sure.slice(0, max);
  const fill = thin || (lonely && !shown.length) ? unsure.slice(0, Math.max(0, ROW_FILL - shown.length)) : [];
  return { shown: [...shown, ...fill], more: [...sure.slice(max), ...unsure.slice(fill.length)] };
}

export const ABOUT_LIMIT = 6; // Subjects shown before "Show more"
const ABOUT_WEIGHT = [1, 2, 3]; // tier 0, 1, 2 -> chip class w1, w2, w3

/** About chips strongest first: the shade (tier) is the main sort, then centrality, so the darkest chips are always on the left. Hover text: the reasons, then whose voice. */
export function aboutChips(themes = []) {
  const byStrength = [...themes].sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0) || (b.centrality || 0) - (a.centrality || 0));
  return byStrength.map(t => {
    const voices = (t.voices?.length ? t.voices : ['editors']).map(v => VOICE_LABEL[v]).join(' and ').toLowerCase();
    const why = Array.isArray(t.why) && t.why.length ? t.why.join('. ') + '. ' : '';
    return { ...t, weight: ABOUT_WEIGHT[t.tier] ?? 1, title: `${why}From ${voices}` };
  });
}

/** Groups descriptors by facet in a fixed order, strongest first inside each group. Unknown facets go last. */
export function groupByFacet(descriptors = []) {
  const groups = new Map();
  for (const d of weighted(descriptors)) {
    const f = d.facet || 'other';
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(d);
  }
  const rank = f => { const i = FACET_ORDER.indexOf(f); return i === -1 ? 99 : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([facet, items]) => ({ facet, label: FACET_LABEL[facet] || 'More', items }));
}

/** Which voices appear anywhere in the chips, for the key. */
export function voicesUsed(descriptors = [], themes = []) {
  const set = new Set();
  for (const d of descriptors) set.add(mainVoice(d.voices));
  for (const t of themes) if (t.voices?.length) set.add(mainVoice(t.voices));
  return ['viewers', 'critics', 'editors'].filter(v => set.has(v));
}

/** Tooltip for a chip: whose voice, plus the evidence excerpt when there is one. */
export function chipTitle(d) {
  const who = (d.voices?.length ? d.voices : ['editors']).map(v => VOICE_LABEL[v]).join(' and ');
  const FRAGILE_WHY = { list: "only one of Letterboxd's theme lists names it", review: 'one review says it, once', tag: 'only one keyword tag says it' };
  const how = d.fragile ? `Very unsure: ${FRAGILE_WHY[d.fragileBy] || 'only one thing says it'}. ` : d.tierLabel ? `${d.tierLabel} for this film. ` : '';
  return d.evidence ? `${how}${who}: “${trim(d.evidence, 160)}”` : `${how}From ${who.toLowerCase()}`;
}

export function trim(text, max = 100) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '') + '…';
}

/** One-line caption for a similar-film card: the first reason, as a short sentence. */
export function caption(item, max = 80) {
  const r = item?.reasons?.find(x => x?.text);
  if (!r) return '';
  const t = trim(r.text, max);
  return /[.…!?]$/.test(t) ? t : t + '.';
}

/** The small "how sure" note under the profile: { level, label, title } or null when there is nothing to be sure about. */
export function sureNote(profile) {
  const c = profile?.certainty;
  if (!c || c.level === 'none') return null;
  // Worded and styled as a line about the whole section, not a key for the chips.
  const TEXT = { high: "Matinee is very sure about this film's feel", medium: "Matinee is fairly sure about this film's feel", low: "This film's feel is a rough guess: little has been written about it" };
  return { level: c.level, label: c.label, text: TEXT[c.level] || c.label, title: (c.reasons || []).join('\n') };
}

/** Wording under the profile. `hasTmdbKey` false adds the one-time hint. */
export function basisText(summary) {
  const based = summary?.basedOn || [];
  if (!based.length) return '';
  const joined = based.join(' · ');
  return summary.thin ? `Based on ${joined}. No viewer reviews found yet.` : `Based on ${joined}`;
}

export function showTmdbHint(summary, hasTmdbKey) {
  return !!summary?.thin && !hasTmdbKey;
}

/** Buttons for "Like this, but…" from the facet axes. Labels are the axis's own low/high words. */
export function shiftButtons(axes) {
  const out = [];
  for (const a of axes || []) { // null or undefined while getFeelAxes is still loading (it crashed the film page in v0.47-exp.59)
    if (a.low) out.push({ id: `${a.id}:-1`, axis: a.id, dir: -1, label: a.low });
    if (a.high) out.push({ id: `${a.id}:1`, axis: a.id, dir: 1, label: a.high });
  }
  return out;
}

export const shiftHeading = b => `Like this, but ${String(b.label).toLowerCase()}`;

/** True when there is nothing worth showing at all. */
export function isEmptyProfile(feel) {
  const p = feel?.profile;
  if (!p) return true;
  return !(p.descriptors?.length || p.themes?.length || p.settings?.length);
}
