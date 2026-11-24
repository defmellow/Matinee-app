// Which chips a film's "How it feels" rows hold, and in what order. Pure.
// Rules (12 Nov): show what there is, strongest first, and let the row's length do the cutting.
//   - A chip is CONFIDENT when more than one piece of evidence is behind it and it clears a small minimum.
//   - A chip is FRAGILE when one thing only says it: one mention in one review, one keyword tag, or one Letterboxd word list
//     (extract.js marks it). Fragile chips come after every confident one, dashed on the page, so on most films they sit
//     past the end of the row and only show where a row would otherwise be thin.
//   - Nothing is dropped for being far behind the row's leader: twenty mentions of one thing must not erase five of another.
//   - The page shows the first few of a row and keeps the rest behind "Show more" (ui/screens/film/Feel.jsx); ROW_LIMIT is the
//     most a row holds at all.
//   - Pace plays safe: only a confident chip that is clearly there. Half of the lighter pace chips were wrong on a real library,
//     so an unsure pace says nothing and the page says so.
// History: one limit of 14 for the whole page cut rows on a quarter of the user's films (gone 11 Nov); a chip under 30% of its row's
// top was dropped (gone 12 Nov); a weak stand-in for an empty row was tried and removed 11 Nov, then brought back in this
// form, as fragile chips, once the user had seen what dashed meant.

/** Every tunable number, in one place. */
export const CHIP_FLOOR = {
  min: { default: 0.1, pace: 0.2 },  // a confident chip's minimum score
  fragile: 0.06,                     // a fragile chip's minimum score
  relative: { default: 0.30 },       // themes only: the share of the film's strongest theme a theme must reach
};
/** The most chips a row holds, visible or behind "Show more". Themes: the most any film has. */
export const ROW_LIMIT = { mood: 12, tone: 12, pace: 3, craft: 12, impact: 12, theme: 12, default: 12 };
/** Rows that never show a fragile chip. */
const NO_FRAGILE = new Set(['pace', 'theme']);

const pick = (table, facet) => table[facet] ?? table.default;

/**
 * Pace is a scale, so a film reads as slow or fast, not both: the side with less behind it (summed scores) is dropped unless it
 * is nearly as strong (`PACE_BOTH` of the other side), which is a film that really does change gear.
 * @param sides [[ids of the slow side], [ids of the fast side]]
 */
export const PACE_BOTH = 0.6;
export function oneDirection(descs, sides) {
  const side = d => (d.facet !== 'pace' ? -1 : sides.findIndex(ids => ids.includes(d.id)));
  const sum = [0, 0];
  for (const d of descs) { const k = side(d); if (k >= 0) sum[k] += d.score; }
  if (!sum[0] || !sum[1]) return descs;
  const lose = sum[0] < sum[1] ? 0 : 1;
  if (sum[lose] >= PACE_BOTH * sum[1 - lose]) return descs;
  return descs.filter(d => side(d) !== lose);
}

/**
 * Themes keep their floor as it was: at least the minimum and within reach of the film's strongest theme. (Letting any theme
 * of 0.2 or more through was tried 12 Nov: 108 more themes, many marginal, such as Before Sunset "Nature and the environment".
 * A theme with five mentions already clears this floor whatever leads the row.)
 * @param descs [{ facet, score }] strongest first. Returns the kept rows in the same order.
 */
export function applyChipFloor(descs, constants = CHIP_FLOOR) {
  const top = new Map();
  for (const d of descs) if (!top.has(d.facet)) top.set(d.facet, d.score);
  return descs.filter(d => {
    if (d.score < pick(constants.min, d.facet)) return false;
    return d.score === top.get(d.facet) || d.score >= pick(constants.relative, d.facet) * top.get(d.facet);
  });
}

/**
 * The chips of one film, row by row: confident chips strongest first, then fragile ones, up to the row's limit.
 * @param candidates every descriptor that may show ({ facet, score, fragile? })
 * @returns chips in page order within each row (confident before fragile, then by score); fragile ones keep `fragile: true`
 */
export function chipsFor(candidates, { limits = ROW_LIMIT, constants = CHIP_FLOOR } = {}) {
  const byScore = (a, b) => b.score - a.score || (a.id < b.id ? -1 : 1);
  const sorted = [...candidates].sort(byScore);
  const themes = new Set(applyChipFloor(sorted.filter(d => d.facet === 'theme'), constants));
  const keep = d => (d.facet === 'theme' ? themes.has(d)
    : d.fragile ? !NO_FRAGILE.has(d.facet) && d.score >= constants.fragile
      : d.score >= pick(constants.min, d.facet));
  const count = new Map();
  const out = [];
  // Fragile chips mostly share one score (a single mention is capped), so they are ordered by where the evidence came from.
  const fragileRank = { list: 0, review: 1, tag: 2 };
  const fragile = sorted.filter(d => d.fragile).sort((a, b) => (fragileRank[a.fragileBy] ?? 3) - (fragileRank[b.fragileBy] ?? 3) || byScore(a, b));
  for (const d of [...sorted.filter(d => !d.fragile), ...fragile]) {
    if (!keep(d)) continue;
    const n = count.get(d.facet) || 0;
    if (n >= pick(limits, d.facet)) continue;
    count.set(d.facet, n + 1);
    out.push({ ...d });
  }
  return out;
}
