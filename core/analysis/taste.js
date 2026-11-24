// Taste: which features go with the films you rate highly, and a ranking of what to watch tonight.
// Pure functions over summaries + the similarity index; no I/O.

import { eligible, scoreIsTiny } from './eligible.js';
import { extract, featureKind, idfOf, vectorFor, vectorAt, cosine } from './similarity.js';

const SHRINK = 3;
/** Features seen in only one film are ignored, except these (one film by a director is already a signal). */
const KEEP_SINGLE = new Set(['director', 'collection']);
/** Cosine similarity at which "close to a favourite" counts as full marks. // DECISION: tuning constant. */
const CLOSE_FULL = 0.5;
/** Affinity (in rating points, idf-weighted average) that maps to ~76% in the taste squash. // DECISION: tuning constant. */
const TASTE_SCALE = 0.6;
const JITTER = 8;

const isRated = (s) => s?.user && s.user.rating != null && s.user.rating !== '' && s.user.watched !== false;

// ---------- small formatters (exported: the UI shows the same wording) ----------

/** 1–10 rating → stars with a half: 9 → ★★★★½. */
export function stars(rating) {
  const half = Math.round(Number(rating) || 0);
  return '★'.repeat(Math.floor(half / 2)) + (half % 2 ? '½' : '');
}

/** Minutes → "1 h 40 m", "2 h", "45 m". */
export function formatMinutes(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} m`;
  return r ? `${h} h ${r} m` : `${h} h`;
}

// ---------- taste profile ----------

/**
 * What predicts your ratings. For each feature: affinity = sum(rating − your mean, +1 if liked) / (count + 3)
 * over the rated films that have it (so a feature seen twice can't outshout one seen twenty times).
 * @param {object[]} summaries
 * @returns {{ mean: number|null, ratedCount: number, features: Map<string, { affinity: number, count: number, label: string, kind: string }> }}
 */
export function tasteProfile(summaries = []) {
  const rated = (summaries || []).filter(isRated);
  if (!rated.length) return { mean: null, ratedCount: 0, features: new Map() };
  const mean = rated.reduce((a, s) => a + Number(s.user.rating), 0) / rated.length;
  const acc = new Map();
  for (const s of rated) {
    const dev = Number(s.user.rating) - mean + (s.user.liked ? 1 : 0);
    for (const f of extract(s)) {
      let e = acc.get(f.id);
      if (!e) { e = { sum: 0, count: 0, label: f.label, kind: f.kind }; acc.set(f.id, e); }
      e.sum += dev;
      e.count++;
    }
  }
  const features = new Map();
  for (const [id, e] of acc) {
    if (e.count < 2 && !KEEP_SINGLE.has(e.kind)) continue;
    features.set(id, { affinity: e.sum / (e.count + SHRINK), count: e.count, label: e.label, kind: e.kind });
  }
  return { mean, ratedCount: rated.length, features };
}

// ---------- tonight ----------

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** Deterministic 0–1 from a seed and a key. */
function unit(seed, key) {
  let t = (hash(`${seed}|${key}`) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function moodMatcher(mood) {
  const wanted = String(mood || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (!wanted.length) return null;
  return (s) => {
    const pool = [...(s.genres || []), ...(s.keywords || []), ...(s.subjects || []), ...(s.user?.tags || [])]
      .map((x) => String(x).toLowerCase());
    return wanted.some((w) => pool.some((p) => p === w || p.includes(w)));
  };
}

/** How a liked feature reads in a sentence. */
function likesPhrase(kind, label) {
  switch (kind) {
    case 'director': case 'writer': case 'cinematography': case 'composer': case 'editor': case 'cast':
      return `You rate ${label} highly`;
    case 'collection': return `You rate the ${label} series highly`;
    case 'genre': return `You rate ${label} films highly`;
    case 'keyword': case 'subject': return `You like films about ${label}`;
    case 'country': return `You rate films from ${label} highly`;
    case 'language': return `You rate ${label}-language films highly`;
    default: return `You rate ${label} highly`;
  }
}

/**
 * Rank candidates (normally the watchlist) for tonight.
 * fit = 0.55 × taste + 0.25 × closeness to your top-rated films + 0.2 × score, scaled to 0–100.
 * @param {ReturnType<typeof tasteProfile>} profile
 * @param {object} index from buildIndex (should include your rated films, so favourites can be found)
 * @param {object[]} candidates summaries
 * @param {{ minutes?: number, maxMinutes?: number, mood?: string, exclude?: string[], shuffleSeed?: number, limit?: number }} [opts]
 *   minutes / maxMinutes: time available; films longer than that are dropped (maxMinutes wins if both given).
 *   mood: genre / keyword / tag text a film must match (comma-separated = any).
 *   includeShorts / includeTV / today: see eligible(); unreleased films, shorts and TV items are never picked unless asked for.
 *   A film with no runtime is dropped when a time cap is set.
 *   shuffleSeed: non-zero adds repeatable jitter (±8) so "Shuffle" gives new picks.
 * @returns {{ key: string, fit: number, reasons: string[] }[]}
 */
export function rankTonight(profile, index, candidates = [], { minutes, maxMinutes, mood, exclude = [], shuffleSeed = 0, limit = 20, includeShorts = false, includeTV = false, today = new Date() } = {}) {
  const cap = Number(maxMinutes) > 0 ? Number(maxMinutes) : Number(minutes) > 0 ? Number(minutes) : null;
  const skip = new Set(exclude || []);
  const moodOk = moodMatcher(mood);
  const feats = profile?.features || new Map();

  // The films you rate 9+ (or 8+ if there are fewer than three), as vectors.
  let top = [];
  for (let i = 0; i < index.size; i++) {
    const s = index.summaries[i];
    if (isRated(s) && Number(s.user.rating) >= 9) top.push(i);
  }
  if (top.length < 3) {
    top = [];
    for (let i = 0; i < index.size; i++) {
      const s = index.summaries[i];
      if (isRated(s) && Number(s.user.rating) >= 8) top.push(i);
    }
  }
  const topVecs = top.map((i) => ({ i, vec: vectorAt(index, i) }));

  const out = [];
  for (const c of candidates || []) {
    if (!c || c.key == null || skip.has(c.key)) continue;
    if (!eligible(c, { today, includeShorts, includeTV, maxRuntime: cap })) continue;
    if (moodOk && !moodOk(c)) continue;

    // Taste: idf-weighted average of affinity over the film's features.
    const ex = extract(c);
    let num = 0;
    let den = 0;
    const liked = [];
    for (const f of ex) {
      const w = f.weight * idfOf(index, f.id);
      den += w;
      const a = feats.get(f.id);
      if (a) {
        num += a.affinity * w;
        if (a.affinity > 0) liked.push({ ...a, id: f.id, contribution: a.affinity * w });
      }
    }
    const taste = feats.size && den ? 0.5 + 0.5 * Math.tanh(num / den / TASTE_SCALE) : 0.5;

    // Closeness to a favourite.
    let closest = null;
    let sim = 0;
    if (topVecs.length) {
      const pos = index.pos.get(c.key);
      const cv = pos !== undefined ? vectorAt(index, pos) : vectorFor(index, c);
      for (const t of topVecs) {
        if (t.i === pos) continue;
        const s = cosine(cv, t.vec);
        if (s > sim) { sim = s; closest = t.i; }
      }
    }
    const close = topVecs.length ? Math.min(1, sim / CLOSE_FULL) : 0.5;

    // Scores sit on an IMDb-equivalent scale (most films 50–90), so stretch 30–90 across 0–1 to keep the spread.
    const crowd = c.score != null && !scoreIsTiny(c) && Number.isFinite(Number(c.score)) ? Math.max(0, Math.min(1, (Number(c.score) - 30) / 60)) : 0.6;

    let fit = 100 * (0.55 * taste + 0.25 * close + 0.2 * crowd);
    if (shuffleSeed) fit += (unit(shuffleSeed, c.key) * 2 - 1) * JITTER;
    fit = Math.max(0, Math.min(100, Math.round(fit)));

    // Reasons, in order of how well they explain the pick; the first three are kept.
    liked.sort((p, q) => q.contribution - p.contribution);
    const best = liked.find((l) => l.affinity >= 0.4);
    const second = best && liked.find((l) => l.affinity >= 0.6 && l.kind !== best.kind && l.label !== best.label);
    const reasons = [];
    if (closest != null && sim >= CLOSE_FULL * 0.4) {
      const f = index.summaries[closest];
      reasons.push(`Because you rated ${f.title} ${stars(f.user.rating)}`);
    }
    if (best) reasons.push(likesPhrase(best.kind, best.label));
    if (moodOk) reasons.push(`Fits your mood: ${String(mood).trim()}`);
    if (cap && c.runtime) reasons.push(`Fits in ${formatMinutes(cap)}`);
    if (c.score != null && Number(c.score) >= 80) reasons.push(`Highly rated everywhere (${Math.round(Number(c.score))})`);
    if (second) reasons.push(likesPhrase(second.kind, second.label));

    out.push({ key: c.key, fit, reasons: reasons.slice(0, 3), order: out.length });
  }
  out.sort((a, b) => b.fit - a.fit || a.order - b.order);
  return out.slice(0, Math.max(0, limit)).map(({ key, fit, reasons }) => ({ key, fit, reasons }));
}

// ---------- blind spots ----------

const BLIND_KINDS = new Set(['director', 'cinematography', 'composer', 'writer', 'collection']);

/**
 * People (and series) you rate highly that still have films waiting on your watchlist.
 * @returns {{ label: string, kind: string, reason: string, keys: string[], affinity: number }[]} strongest first
 */
export function blindSpots(profile, index, summaries, { limit = 5 } = {}) {
  const pool = summaries || (index ? index.summaries : []) || [];
  const feats = profile?.features;
  if (!feats?.size) return [];
  const waiting = new Map();
  for (const s of pool) {
    if (!s?.user?.watchlist || s.user.watched) continue;
    for (const f of extract(s)) {
      if (!BLIND_KINDS.has(f.kind)) continue;
      const a = feats.get(f.id);
      if (!a || a.affinity < 0.5) continue;
      if (!waiting.has(f.id)) waiting.set(f.id, []);
      waiting.get(f.id).push(s.key);
    }
  }
  const out = [];
  for (const [id, keys] of waiting) {
    const a = feats.get(id);
    const kind = featureKind(id);
    const n = keys.length;
    const films = n === 1 ? '1 film' : `${n} films`;
    const reason = kind === 'collection'
      ? `You rate the ${a.label} series highly and have ${films} waiting`
      : `You rate ${a.label} highly and have ${films} waiting`;
    out.push({ label: a.label, kind, reason, keys, affinity: a.affinity });
  }
  out.sort((p, q) => q.affinity * Math.sqrt(q.keys.length) - p.affinity * Math.sqrt(p.keys.length) || p.label.localeCompare(q.label));
  return out.slice(0, limit);
}
