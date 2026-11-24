// Similarity and "like this, but …" over a FeelIndex. Pure and deterministic.
import { dot } from './latent.js';
import { softLower } from './text.js';

export const DEFAULT_EMPHASIS = { feel: 1, themes: 1, craft: 0.5, people: 0.4 };
// `directors` (the director alone, no cast or crew) is off unless asked for: the Map uses it instead of `people`
const FACET_KEYS = ['feel', 'themes', 'craft', 'people', 'directors'];
const SIDE = ['mood', 'tone', 'pace', 'impact'];

/* ---------- sparse vectors ---------- */

// Every id gets a small integer once, so two vectors can be compared by walking two sorted arrays side by side.
// Speed (18 Nov): the Map compares every film with every other; Map lookups made that about 3 s for 690 films.
const ID_NUM = new Map();
const idNum = (k) => { let n = ID_NUM.get(k); if (n === undefined) { n = ID_NUM.size; ID_NUM.set(k, n); } return n; };

export function mkVec(entries) {
  const m = new Map();
  for (const [k, w] of entries) if (w > 0 && Number.isFinite(w)) m.set(k, Math.max(w, m.get(k) || 0));
  let s = 0;
  for (const w of m.values()) s += w * w;
  const pairs = [...m].map(([k, w]) => [idNum(k), w]).sort((x, y) => x[0] - y[0]);
  return { m, n: Math.sqrt(s), ids: Int32Array.from(pairs, p => p[0]), ws: Float64Array.from(pairs, p => p[1]) };
}

export function cosine(a, b) {
  if (!a.n || !b.n) return 0;
  let d = 0;
  if (a.ids && b.ids) {
    const ai = a.ids, bi = b.ids, aw = a.ws, bw = b.ws;
    for (let i = 0, j = 0; i < ai.length && j < bi.length;) {
      const x = ai[i], y = bi[j];
      if (x === y) { d += aw[i++] * bw[j++]; } else if (x < y) i++; else j++;
    }
  } else {
    const small = a.m.size <= b.m.size ? a : b, large = small === a ? b : a;
    for (const [k, w] of small.m) { const o = large.m.get(k); if (o) d += w * o; }
  }
  return Math.min(1, d / (a.n * b.n));
}

const UNEXPLAINED = 0.6;
const hasLatent = (r) => r.hasLatent;

/* ---------- scoring ---------- */

// Themes that are not settings. Two films that share only a place (both "set in Paris") are not alike on themes.
const NOT_SETTING = new Set(['about', 'subject', 'descriptor', 'style', 'adaptation']);
const SETTING_ONLY_CAP = 0.15;
function sharesNonSetting(a, b) {
  const [s, l] = a.themes.m.size <= b.themes.m.size ? [a, b] : [b, a];
  for (const id of s.themes.m.keys()) {
    if (!l.themes.m.has(id)) continue;
    const info = a.themeInfo.get(id) || b.themeInfo.get(id);
    if (!info || NOT_SETTING.has(info.kind)) return true;
  }
  return false;
}

/** Per-facet parts; null when either film has nothing for that facet. feelOverride: { vec, latentWeight } for shift. */
export function partsOf(a, b, feelOverride = null) {
  let lex = null;
  if (feelOverride) lex = b.feel.n ? cosine(feelOverride.vec, b.feel) : null;
  else if (a.feel.n && b.feel.n) lex = cosine(a.feel, b.feel);
  const lat = hasLatent(a) && hasLatent(b) ? Math.max(0, dot(a.latent, b.latent)) : null;
  const latW = feelOverride ? feelOverride.latentWeight : 0.4;
  let feel = null;
  if (lex != null && lat != null) feel = (1 - latW) * lex + latW * lat;
  else if (lex != null) feel = lex;
  else if (lat != null) feel = lat;
  const f = (k) => (a[k] && b[k] && a[k].n && b[k].n ? cosine(a[k], b[k]) : null);
  let themes = f('themes');
  if (themes != null && !sharesNonSetting(a, b)) themes = Math.min(themes, SETTING_ONLY_CAP);
  return { feel, themes, craft: f('craft'), people: f('people'), directors: f('directors') };
}

export function combine(parts, emphasis, a, b) {
  let num = 0, den = 0;
  for (const k of FACET_KEYS) {
    const e = emphasis[k] ?? 0;
    if (e > 0 && parts[k] != null) { num += e * parts[k]; den += e; }
  }
  if (!den) return 0;
  const conf = 0.6 + 0.4 * Math.sqrt(a.confidence * b.confidence);
  return Math.max(0, Math.min(1, (num / den) * conf));
}

const clean = (parts) => Object.fromEntries(FACET_KEYS.map(k => [k, parts[k] == null ? 0 : round(parts[k])]));
const round = (x) => Math.round(x * 1000) / 1000;

export function toSet(among) {
  if (!among) return null;
  return among instanceof Set ? among : new Set(among);
}

/* ---------- reasons ---------- */

const lower = softLower;
export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function voiceClass(va, vb) {
  const both = va.filter(v => vb.includes(v));
  if (both.includes('viewers')) return 'viewers';
  if (both.includes('critics')) return 'critics';
  const a = va.some(v => v !== 'editors'), b = vb.some(v => v !== 'editors');
  if (a && b) return 'mixed';
  return 'editors';
}

const FEEL_SENTENCE = {
  viewers: (l) => `Both feel ${l}.`,
  critics: (l) => `Critics describe both as ${l}.`,
  mixed: (l) => `Both are described as ${l}.`,
  editors: (l) => `Described alike in articles about the film: ${l}.`,
};
const MIN_THEME_SHARED = 0.12; // below this a shared tag is too common in the library to be worth saying
const FEEL_WEIGHT = { mood: 1, tone: 1, pace: 1, impact: 1, craft: 0.5 };

function feelReason(a, b) {
  const shared = [];
  for (const [id, x] of a.descs) {
    const y = b.descs.get(id);
    const fw = FEEL_WEIGHT[x.facet];
    if (!y || !fw) continue;
    const s = Math.min(x.score, y.score) * fw * (a.idf?.get(id) ?? 1);
    if (s >= 0.1) shared.push({ id, label: x.label, s, cls: voiceClass(x.voices, y.voices) });
  }
  if (!shared.length) return null;
  shared.sort((p, q) => q.s - p.s || (p.id < q.id ? -1 : 1));
  const top = shared.slice(0, 3);
  const byCls = new Map();
  for (const t of top) { const g = byCls.get(t.cls) || { s: 0, items: [] }; g.s += t.s; g.items.push(t); byCls.set(t.cls, g); }
  const [cls, g] = [...byCls.entries()].sort((p, q) => q[1].s - p[1].s)[0];
  const items = g.items.slice(0, 3);
  return { facet: 'feel', text: FEEL_SENTENCE[cls](joinList(items.map(i => lower(i.label)))), strength: Math.min(1, items.reduce((n, i) => n + i.s, 0)) };
}

function themeReasons(a, b) {
  const groups = { about: [], subject: [], descriptor: [], style: [], adaptation: [], place: [] };
  for (const [id, wa] of a.themes.m) {
    const wb = b.themes.m.get(id);
    if (!wb) continue;
    const info = a.themeInfo.get(id) || b.themeInfo.get(id);
    if (!info || !groups[info.kind]) continue;
    const bi = b.themeInfo.get(id);
    let label = info.label;
    let cls = 'editors';
    if (info.kind === 'descriptor') cls = voiceClass(info.voices || [], bi?.voices || []);
    const s = Math.min(wa, wb);
    if (s < MIN_THEME_SHARED) continue;
    groups[info.kind].push({ label, s, cls });
  }
  const out = [];
  const take = (kind, fn, max = 3) => {
    const g = groups[kind].sort((p, q) => q.s - p.s || (p.label < q.label ? -1 : 1)).slice(0, max);
    if (!g.length) return;
    out.push({ facet: 'themes', text: fn(g), strength: Math.min(1, g.reduce((n, i) => n + i.s, 0) / 1.5) });
  };
  take('about', g => `Both are about ${joinList(g.map(i => lower(i.label)))}.`);
  take('descriptor', g => (g.some(i => i.cls !== 'editors')
    ? `Both deal with ${joinList(g.map(i => lower(i.label)))}.`
    : `Both are tagged with ${joinList(g.map(i => lower(i.label)))}.`));
  take('subject', g => `Both touch on ${joinList(g.map(i => lower(i.label)))}.`, 2);
  take('adaptation', g => `Both are based on ${joinList(g.map(i => i.label.replace(/^based on /i, '')))}.`, 1);
  take('style', g => `Shared style: ${joinList(g.map(i => lower(i.label)))}.`, 2);
  take('place', g => `Both are set in ${joinList(g.map(i => i.label))}.`, 2);
  return out;
}

const ROLE_TEXT = {
  director: ['Same director', 1], writer: ['Same writer', 0.6], cinematography: ['Same cinematographer', 0.7],
  composer: ['Same composer', 0.6], editor: ['Same editor', 0.4], cast: ['Both feature', 0.5],
};

function peopleReason(a, b, directorsOnly = false) {
  const byRole = new Map();
  for (const [id, pa] of a.peopleInfo) {
    const pb = b.peopleInfo.get(id);
    if (!pb) continue;
    if (directorsOnly && !(pa.role === 'director' && pb.role === 'director')) continue;
    const role = pa.role === pb.role ? pa.role : 'mixed'; // directed one, acted in the other: "Both involve", never "Same director"
    const arr = byRole.get(role) || [];
    arr.push(pa.name);
    byRole.set(role, arr);
  }
  let best = null;
  for (const [role, names] of byRole) {
    const [label, st] = ROLE_TEXT[role] || ['Both involve', 0.3];
    if (!best || st > best.st) best = { role, names, label, st };
  }
  if (!best) return null;
  const names = best.names.slice(0, 3);
  return { facet: directorsOnly ? 'directors' : 'people', text: `${best.label}: ${joinList(names)}.`, strength: best.st };
}

export function reasonsFor(a, b, emphasis, extra = []) {
  const cands = [...extra];
  const f = feelReason(a, b); if (f) cands.push(f);
  cands.push(...themeReasons(a, b));
  const p = peopleReason(a, b, !(emphasis.people > 0) && emphasis.directors > 0); if (p) cands.push(p);
  for (const c of cands) c.weighted = c.fixed ? 10 : c.strength * (emphasis[c.facet] ?? 0.5);
  cands.sort((x, y) => y.weighted - x.weighted || (x.text < y.text ? -1 : 1));
  const out = [];
  const used = new Set();
  for (const c of cands) {
    if (out.length >= 3) break;
    if (c.weighted <= 0 && !c.fixed) continue;
    if (used.has(c.text)) continue;
    used.add(c.text);
    out.push({ facet: c.facet, text: c.text });
  }
  return out;
}

/* ---------- public ---------- */

export function similar(index, key, { emphasis = DEFAULT_EMPHASIS, limit = 12, among = null } = {}) {
  const a = index.byKey.get(key);
  if (!a) return [];
  const emph = { ...DEFAULT_EMPHASIS, ...emphasis };
  const only = toSet(among);
  const scored = [];
  for (const b of index.recs) {
    if (b === a || (only && !only.has(b.key))) continue;
    const score = combine(partsOf(a, b), emph, a, b);
    if (score > 0) scored.push({ b, score }); // parts are worked out again for the few rows kept (less garbage over every pair)
  }
  scored.sort((x, y) => y.score - x.score || (x.b.key < y.b.key ? -1 : 1));
  // A match we cannot explain is probably word overlap in the text, not a real likeness: rank it lower.
  const rows = scored.slice(0, Math.max(limit * 3, limit + 10)).map(({ b, score }) => {
    const parts = partsOf(a, b);
    const reasons = reasonsFor(a, b, emph);
    return { key: b.key, score: round(reasons.length ? score : score * UNEXPLAINED), parts: clean(parts), reasons };
  });
  rows.sort((x, y) => y.score - x.score || (x.key < y.key ? -1 : 1));
  return rows.slice(0, limit);
}

export function axisPosition(rec, axis) {
  const sum = (ids) => ids.reduce((n, id) => n + (rec.descs.get(id)?.score || 0), 0);
  return sum(axis.highIds) - sum(axis.lowIds);
}

export function shift(index, key, { axis, dir } = {}, { limit = 12, among = null, strength = 0.8, emphasis = DEFAULT_EMPHASIS } = {}) {
  const ax = (index.axes || []).find(x => x.id === axis);
  if (!ax) throw new Error(`Unknown axis "${axis}". Known axes: ${(index.axes || []).map(x => x.id).join(', ')}`);
  if (dir !== 1 && dir !== -1) throw new Error('shift dir must be -1 or 1');
  const a = index.byKey.get(key);
  if (!a) return [];
  const toward = dir === 1 ? ax.highIds : ax.lowIds;
  const away = dir === 1 ? ax.lowIds : ax.highIds;
  const t = new Map(a.feel.m);
  const bump = (ids, sign) => {
    const k = strength / Math.sqrt(Math.max(1, ids.length));
    for (const id of ids) if (index.feelIds.has(id)) t.set(id, (t.get(id) || 0) + sign * k);
  };
  bump(toward, 1);
  bump(away, -1);
  for (const [id, w] of t) if (w <= 0) t.delete(id);
  const target = mkVec(t);
  const override = { vec: target, latentWeight: 0.15 };
  const emph = { ...DEFAULT_EMPHASIS, ...emphasis };
  const srcPos = axisPosition(a, ax) * dir;
  const only = toSet(among);
  const scored = [];
  for (const b of index.recs) {
    if (b === a || (only && !only.has(b.key))) continue;
    if (axisPosition(b, ax) * dir <= srcPos) continue;
    if (!toward.some(id => (b.descs.get(id)?.score || 0) > 0)) continue; // it must actually carry a toward-descriptor
    const parts = partsOf(a, b, override);
    const score = combine(parts, emph, a, b);
    if (score > 0) scored.push({ b, parts, score });
  }
  scored.sort((x, y) => y.score - x.score || (x.b.key < y.b.key ? -1 : 1));
  const word = lower(dir === 1 ? ax.high : ax.low);
  return scored.slice(0, limit).map(({ b, parts, score }) => {
    const lead = toward
      .map(id => b.descs.get(id)).filter(Boolean)
      .sort((p, q) => q.score - p.score || (p.id < q.id ? -1 : 1)).slice(0, 3);
    const extra = [];
    {
      const editorsOnly = lead.every(d => d.voices.every(v => v === 'editors'));
      extra.push({
        facet: 'feel', fixed: true,
        text: `Similar feel, but ${word}: ${joinList(lead.map(d => lower(d.label)))}${editorsOnly ? ' (going by articles and tags)' : ''}.`,
      });
    }
    return { key: b.key, score: round(score), parts: clean(parts), reasons: reasonsFor(a, b, emph, extra) };
  });
}

export { SIDE };
