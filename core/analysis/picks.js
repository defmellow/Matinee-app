// Tonight picks: three films with roles (Safe bet, A stretch, Been waiting) and "More like these", from the user's watchlist.
// Pure: summaries, the fit model and the feel index come in; plain objects come out. See docs/DESIGN-discovery.md.
// No year or era input anywhere beyond eligible()'s "has it been released"; no match percentages leave this file.
import { eligible } from './eligible.js';
import { localDay } from '../util/localday.js';
import { similar as feelSimilar, queryFeel as feelQuery, shift as feelShift, profileOf as feelProfile } from './feel/index.js';
import { axisPosition as feelAxisPosition } from './feel/similar.js';

export const MMR_LAMBDA = 0.7;     // relevance vs variety in "More like these"
export const MORE_COUNT = 9;
export const MORE_POOL = 40;       // MMR looks only at the best-fitting 40, so it stays quick
export const RECENT = 10;          // the user's last watches, for "A stretch"
export const JITTER = 0.3;         // how far a seed may move a fit score (z units); seed 0 means none
export const MOOD_MIN = 0.05;      // DECISION: a film needs at least this mood-match score (queryFeel, 0 to 1) to count for a mood
export const LIKED_RATING = 8;     // four stars on the 1-10 half-star scale
export const SHORTER_BY = 10;      // "Shorter" must save at least this many minutes

/** The occasions as feel descriptor sets (ids from feel/lexicon.js). `avoid` films that carry these are pushed down. */
export const MOODS = [
  { label: 'Light and sweet', descriptors: ['carefree', 'playful', 'whimsical', 'heartwarming', 'charming', 'joyful', 'cosy'], avoid: ['bleak', 'harrowing', 'devastating', 'brutal', 'disturbing', 'oppressive'] },
  { label: 'Make me laugh', descriptors: ['hilarious', 'farcical', 'wry', 'playful', 'deadpan', 'satirical', 'absurd', 'irreverent', 'darkly-comic'], avoid: ['solemn', 'harrowing', 'devastating'] },
  { label: 'Cosy and comforting', descriptors: ['cosy', 'heartwarming', 'tender', 'charming', 'nostalgic', 'joyful', 'carefree', 'rewatchable'], avoid: ['bleak', 'disturbing', 'harrowing', 'brutal'] },
  { label: 'Black comedy', descriptors: ['darkly-comic', 'sardonic', 'biting', 'cynical', 'satirical', 'deadpan'], avoid: ['heartwarming', 'sentimental', 'cosy'] },
  { label: 'A good cry', descriptors: ['cathartic', 'devastating', 'moving', 'bittersweet', 'melancholic', 'love-and-loss', 'grief'], avoid: ['hilarious', 'farcical'] },
  { label: 'Edge of my seat', descriptors: ['tense', 'thrilling', 'relentless', 'propulsive', 'breakneck', 'intense', 'anxious'], avoid: ['languid', 'slow-paced', 'glacial', 'meditative'] },
  { label: 'Unsettle me', descriptors: ['unsettling', 'eerie', 'foreboding', 'uneasy', 'disturbing', 'claustrophobic', 'chilling', 'anxious'], avoid: ['carefree', 'heartwarming'] },
  { label: 'Strange and dreamy', descriptors: ['dreamlike', 'surreal', 'hypnotic', 'mind-bending', 'atmospheric', 'absurd', 'whimsical'], avoid: ['naturalistic'] },
  { label: 'Quiet and poignant', descriptors: ['intimate', 'tender', 'moving', 'bittersweet', 'meditative', 'melancholic'], avoid: ['frenetic', 'breakneck', 'farcical'] },
  { label: 'Moody and atmospheric', descriptors: ['brooding', 'atmospheric', 'shadowy', 'gloomy', 'rain-soaked', 'melancholic'], avoid: ['carefree', 'playful', 'joyful'] },
  { label: 'Slow and beautiful', descriptors: ['meditative', 'languid', 'unhurried', 'slow-burn', 'visually-striking', 'lyrical', 'painterly', 'serene', 'atmospheric'], avoid: ['propulsive', 'frenetic', 'breakneck'] },
  { label: 'Something to think about', descriptors: ['thought-provoking', 'cerebral', 'nuanced', 'profound', 'provocative', 'mind-bending'], avoid: [] },
];

export const ROLES = {
  safe: { label: 'Safe bet' },
  stretch: { label: 'A stretch' },
  waiting: { label: 'Been waiting' },
  fresh: { label: 'Just added' },
  quick: { label: 'Quick one' },
  critics: { label: "Critics' pick" },
  comfort: { label: 'Familiar ground' },
  leftfield: { label: 'Left field' },
  recent: { label: 'Just out' },
  classic: { label: 'A classic' },
};
const ROLE_ORDER = ['safe', 'stretch', 'waiting'];   // shuffle seed 0
const EXTRA_ROLES = Object.keys(ROLES).filter(r => r !== 'safe');   // after the Safe bet, shuffles draw two from these
export const QUICK_MAX = 100;      // "Quick one" runs at most this many minutes
export const RECENT_DAYS = 150;    // "Just out": released within this many days
export const CLASSIC_AGE = 25;     // "A classic": at least this many years old

const FEEL_FACETS = new Set(['mood', 'tone', 'pace', 'impact', 'craft']);
const VOICE_RANK = { viewers: 2, critics: 1, editors: 0 };
const AXIS_FOR = { lighter: ['weight', -1], heavier: ['weight', 1], stranger: ['strangeness', 1] };

const lower = s => String(s).toLowerCase();
const num = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const byKeyAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Same stars as the UI: 1-10 half-stars to "★★★★½". */
export function starText(r) {
  if (r == null) return '';
  return '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : '');
}

/** Deterministic number in [0, 1) from a seed and a key. */
export function jitterOf(seed, key) {
  let h = 2166136261;
  for (const c of `${seed}:${key}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const joinList = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Maximal marginal relevance: pick k keys, each time the one with the best  λ·relevance − (1−λ)·(likeness to what is already chosen).
 * @param {{ keys: string[], rel: (k: string) => number, simFrom: (k: string) => Map<string, number>, k?: number, lambda?: number }} o
 */
export function mmr({ keys, rel, simFrom, k = MORE_COUNT, lambda = MMR_LAMBDA }) {
  const left = new Set(keys);
  const maxSim = new Map(keys.map(x => [x, 0]));
  const out = [];
  while (out.length < k && left.size) {
    let best = null, bestV = -Infinity;
    for (const c of keys) {
      if (!left.has(c)) continue;
      const v = lambda * rel(c) - (1 - lambda) * maxSim.get(c);
      if (v > bestV + 1e-12 || (Math.abs(v - bestV) <= 1e-12 && best !== null && c < best)) { best = c; bestV = v; }
    }
    out.push(best);
    left.delete(best);
    const sims = simFrom(best);
    for (const c of left) maxSim.set(c, Math.max(maxSim.get(c), sims.get(c) || 0));
  }
  return out;
}

const minmax = values => {
  const vs = values.filter(Number.isFinite);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  return v => (hi > lo && Number.isFinite(v) ? (v - lo) / (hi - lo) : 0);
};

/** "Viewers say it's wistful, tender and slow-burn." The voice named is the best one that spoke about the film's top feeling. */
export function feelLine(profile, preferIds = []) {
  const prefer = new Set(preferIds);
  const ds = (profile?.descriptors || []).filter(d => FEEL_FACETS.has(d.facet) && d.score >= 0.15 && (d.voices || []).length);
  if (!ds.length) return null;
  ds.sort((a, b) => (prefer.has(b.id) - prefer.has(a.id)) || b.score - a.score || byKeyAsc(a.id, b.id));
  const voiceOf = d => [...d.voices].sort((a, b) => (VOICE_RANK[b] ?? -1) - (VOICE_RANK[a] ?? -1))[0];
  const voice = voiceOf(ds[0]);
  const names = ds.filter(d => d.voices.includes(voice)).slice(0, 3).map(d => lower(d.label));
  const text = voice === 'viewers' ? `Viewers say it's ${joinList(names)}.`
    : voice === 'critics' ? `Critics say it's ${joinList(names)}.`
      : `Going by articles and tags, it's ${joinList(names)}.`;
  return { voice, text };
}

/** The honest "how sure are we" line, adapted to what we really hold for this film. */
export function confidenceLine(tier, coverage, ratedNeighbours) {
  if (tier === 'know') {
    const parts = ['viewer reviews'];
    if (coverage?.critics > 0) parts.push('critics');
    if (ratedNeighbours > 0) parts.push(plural(ratedNeighbours, "film you've rated", "films you've rated"));
    return `We know this one well: ${joinList(parts)}.`;
  }
  if (tier === 'fair') return `A fair guess: critics${coverage?.editors > 0 ? ' and articles' : ''}, no viewer reviews yet.`;
  return 'A rough guess: we don\'t know much about how it feels yet, so this leans on its scores.';
}

function monthsBetween(fromIso, today) {
  const a = new Date(String(fromIso).slice(0, 10) + 'T12:00:00Z'), b = new Date(localDay(today) + 'T12:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth());
}

function waitingNote(s, today) {
  const m = s.user?.watchlistAddedAt ? monthsBetween(s.user.watchlistAddedAt, today) : null;
  if (!s.user?.watchlist) return 'From one of your lists';
  if (m == null) return 'Sitting near the top of your watchlist';
  if (m < 2) return 'Recently added to your watchlist';
  if (m < 24) return `On your watchlist for ${m} months`;
  return `On your watchlist for ${Math.floor(m / 12)} years`;
}

const ROLE_NOTE = {
  safe: () => 'The best fit we can find for tonight',
  stretch: () => 'Feels different from your last few watches',
  fresh: () => 'One of the newest additions to your watchlist',
  quick: s => `Only ${num(s.runtime)} minutes`,
  critics: () => 'Among the best reviewed on your watchlist',
  comfort: () => "Close to what you've been watching lately",
  leftfield: () => 'A curveball from near the top of your list',
  recent: () => 'Only came out recently',
  classic: s => `From ${s.year}, and still waiting for you`,
};

/**
 * Everything both entry points share: the candidate pool after eligibility and dials, and helpers over it.
 * Time: eligible() drops films with no runtime when a cap is set. Mood: films must carry the mood's feelings. Weight: Lighter/Heavier
 * keeps films that lean that way (a net-light or net-heavy descriptor balance), as shift() does for a single film.
 */
function prepare({ summaries = [], fitModel, feel = null, today = new Date(), dials = {}, exclude = [], seed = 0, fns = {} } = {}) {
  const f = { similar: feelSimilar, queryFeel: feelQuery, shift: feelShift, profileOf: feelProfile, axisPosition: feelAxisPosition, ...fns };
  const byKey = new Map(summaries.map(s => [s.key, s]));
  const ex = new Set(exclude || []);
  const maxMinutes = num(dials.maxMinutes) > 0 ? num(dials.maxMinutes) : null;
  const mood = MOODS.find(m => m.label === dials.mood) || null;
  const dir = dials.weight < 0 ? -1 : dials.weight > 0 ? 1 : 0;

  const lists = !!dials.includeLists; // films on your lists count as candidates too (Tonight's "Include my lists")
  const watchlist = summaries.filter(s => (s.user?.watchlist || (lists && s.user?.listed)) && !s.user.watched);
  // Count the stages one by one so an empty result can name the real cause.
  const eligibleAll = watchlist.filter(s => eligible(s, { today }));
  const withTime = maxMinutes ? eligibleAll.filter(s => eligible(s, { today, maxRuntime: maxMinutes })) : eligibleAll;
  let cands = withTime.filter(s => !ex.has(s.key));
  const counts = { watchlist: watchlist.length, afterEligible: eligibleAll.length, afterTime: withTime.length, afterSkips: cands.length, afterMood: cands.length, afterWeight: cands.length };
  const reasonsByKey = new Map();
  let moodIds = [];
  const preMood = cands;

  if (mood && feel) {
    moodIds = mood.descriptors;
    const hits = f.queryFeel(feel, { descriptors: mood.descriptors, avoid: mood.avoid }, { limit: cands.length || 1, among: cands.map(s => s.key) });
    const ok = new Map(hits.filter(h => h.score >= MOOD_MIN).map(h => [h.key, h]));
    cands = cands.filter(s => ok.has(s.key));
    for (const [k, h] of ok) reasonsByKey.set(k, h);
  }
  counts.afterMood = cands.length;

  if (dir && feel) {
    const ax = (feel.axes || []).find(a => a.id === 'weight');
    if (ax) cands = cands.filter(s => { const r = feel.byKey.get(s.key); return r && f.axisPosition(r, ax) * dir > 0; });
  }
  counts.afterWeight = cands.length;

  const fitMemo = new Map();
  const fit = key => { if (!fitMemo.has(key)) fitMemo.set(key, fitModel.fit(key)); return fitMemo.get(key); };
  const raw = key => fit(key).score;
  const adj = key => raw(key) + (seed ? JITTER * jitterOf(seed, key) : 0);
  const ordered = keys => [...keys].sort((a, b) => adj(b) - adj(a) || byKeyAsc(a, b));

  let recentSims = null;
  const recentOf = () => summaries
    .filter(s => s.user?.watched && s.lastWatched)
    .sort((a, b) => (a.lastWatched < b.lastWatched ? 1 : a.lastWatched > b.lastWatched ? -1 : byKeyAsc(a.key, b.key)))
    .slice(0, RECENT).map(s => s.key);
  /** key -> average likeness to the user's last watches (0 when nothing known). */
  const sameAsRecent = () => {
    if (recentSims) return recentSims;
    const among = cands.map(s => s.key);
    const recent = recentOf();
    const sum = new Map(among.map(k => [k, 0]));
    if (feel) for (const r of recent) for (const row of f.similar(feel, r, { limit: among.length, among })) sum.set(row.key, (sum.get(row.key) || 0) + row.score);
    recentSims = new Map([...sum].map(([k, v]) => [k, recent.length ? v / recent.length : 0]));
    return recentSims;
  };

  return { f, byKey, ex, cands, preMood, counts, lists, reasonsByKey, moodIds, mood, dir, maxMinutes, today, feel, fit, raw, adj, ordered, sameAsRecent, seed, summaries };
}

const bestSafe = (c, keys) => c.ordered(keys.filter(k => c.fit(k).tier !== 'guess'))[0] ?? null;

function bestStretch(c, keys) {
  if (!keys.length) return null;
  const scores = c.cands.map(s => c.raw(s.key)).sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)] ?? 0; // DECISION: the median of everything eligible tonight, not of the remainder
  // Films we know nothing about would look "furthest" from the user's recent watches (similarity 0), so they can't be a stretch.
  const known = keys.filter(k => c.fit(k).tier !== 'guess');
  if (!known.length) return null;
  const pool = known.filter(k => c.raw(k) >= median);
  const near = c.sameAsRecent();
  const dist = k => 1 - (near.get(k) || 0) + (c.seed ? 0.1 * jitterOf(c.seed, k) : 0);
  return [...(pool.length ? pool : known)].sort((a, b) => dist(b) - dist(a) || c.raw(b) - c.raw(a) || byKeyAsc(a, b))[0] ?? null;
}

function bestWaiting(c, keys) {
  if (!keys.length) return null;
  const top = [...keys].sort((a, b) => c.raw(b) - c.raw(a) || byKeyAsc(a, b)).slice(0, Math.max(1, Math.ceil(keys.length / 3)));
  const stamp = k => { const u = c.byKey.get(k).user || {}; return u.watchlistAddedAt ? String(u.watchlistAddedAt).slice(0, 10) : '9999-99-99'; };
  const high = k => (c.byKey.get(k).user?.priority === 'high' ? 0 : 1); // priority is not stored yet; ready for when it is
  return top.sort((a, b) => high(a) - high(b) || (stamp(a) < stamp(b) ? -1 : stamp(a) > stamp(b) ? 1 : 0) || c.raw(b) - c.raw(a) || byKeyAsc(a, b))[0] ?? null;
}

const stampOf = (c, k) => { const u = c.byKey.get(k).user || {}; return u.watchlistAddedAt ? String(u.watchlistAddedAt).slice(0, 10) : ''; };
/** The better-fitting half of the keys: the extra categories choose within it, so none of them is a poor fit. */
const upperHalf = (c, keys) => [...keys].sort((a, b) => c.raw(b) - c.raw(a) || byKeyAsc(a, b)).slice(0, Math.max(1, Math.ceil(keys.length / 2)));
const bestBy = (c, keys, value) => [...keys].sort((a, b) => value(b) - value(a) || c.raw(b) - c.raw(a) || byKeyAsc(a, b))[0] ?? null;

function bestFresh(c, keys) {
  const dated = upperHalf(c, keys).filter(k => stampOf(c, k));
  return bestBy(c, dated, k => Date.parse(stampOf(c, k)));
}
function bestQuick(c, keys) {
  const short = keys.filter(k => { const r = num(c.byKey.get(k).runtime); return r && r <= QUICK_MAX && c.fit(k).tier !== 'guess'; });
  return bestBy(c, short, k => c.raw(k));
}
function bestCritics(c, keys) {
  const scored = keys.filter(k => Number.isFinite(c.byKey.get(k).score));
  return bestBy(c, scored, k => c.byKey.get(k).score);
}
function bestComfort(c, keys) {
  const near = c.sameAsRecent();
  const known = upperHalf(c, keys).filter(k => (near.get(k) || 0) > 0);
  return bestBy(c, known, k => near.get(k));
}
function bestLeftfield(c, keys) {
  const known = upperHalf(c, keys).filter(k => c.fit(k).tier !== 'guess');
  const ax = c.feel && (c.feel.axes || []).find(a => a.id === 'strangeness');
  if (ax) {
    const placed = known.filter(k => c.feel.byKey.get(k));
    if (placed.length) return bestBy(c, placed, k => c.f.axisPosition(c.feel.byKey.get(k), ax) + (c.seed ? 0.3 * jitterOf(c.seed, k) : 0));
  }
  return bestBy(c, known, k => jitterOf(c.seed || 1, k));
}
function bestRecent(c, keys) {
  const cut = Date.parse(localDay(c.today) + 'T12:00:00Z') - RECENT_DAYS * 864e5;
  const out = keys.filter(k => { const t = Date.parse(String(c.byKey.get(k).released || '').slice(0, 10) + 'T12:00:00Z'); return Number.isFinite(t) && t >= cut; });
  return bestBy(c, out, k => c.raw(k));
}
function bestClassic(c, keys) {
  const year = Number(localDay(c.today).slice(0, 4)) - CLASSIC_AGE;
  const old = keys.filter(k => { const y = num(c.byKey.get(k).year); return y && y <= year; });
  return bestBy(c, old, k => c.raw(k));
}

const CHOOSE = { safe: bestSafe, stretch: bestStretch, waiting: bestWaiting, fresh: bestFresh, quick: bestQuick, critics: bestCritics, comfort: bestComfort, leftfield: bestLeftfield, recent: bestRecent, classic: bestClassic };

/** The three roles for a seed: seed 0 is the classic trio; otherwise the Safe bet plus two others in a repeatable shuffled order (more are listed so a role with no film can be skipped). */
export function rolesFor(seed) {
  if (!seed) return ROLE_ORDER;
  const rest = [...EXTRA_ROLES].sort((a, b) => jitterOf(seed, a) - jitterOf(seed, b) || (a < b ? -1 : 1));
  return ['safe', ...rest];
}

function whyLines(c, key, fitRes) {
  const lines = [];
  const prof = c.feel ? c.f.profileOf(c.feel, key) : null;
  const fl = feelLine(prof, c.moodIds);
  if (fl) lines.push(fl);
  const liked = (fitRes.neighbours || []).filter(n => n.rating >= LIKED_RATING && c.byKey.get(n.key)).sort((a, b) => b.sim - a.sim || byKeyAsc(a.key, b.key))[0];
  if (liked) lines.push({ voice: 'you', text: `Because you rated ${c.byKey.get(liked.key).title} ${starText(liked.rating)}, which feels alike.` });
  return lines.slice(0, 2);
}

function card(c, key, role = null, note = null) {
  const s = c.byKey.get(key);
  const fitRes = c.fit(key);
  const prof = c.feel ? c.f.profileOf(c.feel, key) : null;
  let caution = null;
  if (fitRes.caution && c.byKey.get(fitRes.caution.key)) {
    const t = c.byKey.get(fitRes.caution.key);
    caution = { key: t.key, title: t.title, rating: fitRes.caution.rating, text: `It feels close to ${t.title}, which you gave ${starText(fitRes.caution.rating)}.` };
  }
  const out = {
    key, film: s, tier: fitRes.tier,
    why: whyLines(c, key, fitRes),
    confidence: { tier: fitRes.tier, text: confidenceLine(fitRes.tier, prof?.coverage, (fitRes.neighbours || []).length) },
    caution,
  };
  if (role) {
    out.role = role;
    out.roleLabel = ROLES[role].label;
    out.roleNote = role === 'waiting' ? waitingNote(s, c.today) : ROLE_NOTE[role](s);
    out.nudgeNote = note;
  }
  return out;
}

function chooseMore(c, keys, picks) {
  const pool = c.ordered(keys).slice(0, MORE_POOL);
  if (pool.length <= 1) return pool;
  const relFit = minmax(pool.map(c.raw));
  const close = new Map(pool.map(k => [k, 0]));
  if (c.feel) for (const p of picks) for (const row of c.f.similar(c.feel, p, { limit: pool.length, among: pool })) close.set(row.key, Math.max(close.get(row.key), row.score));
  const relClose = minmax([...close.values()]);
  const useClose = picks.length > 0 && c.feel;
  const rel = k => (useClose ? 0.6 * relFit(c.raw(k)) + 0.4 * relClose(close.get(k)) : relFit(c.raw(k))) + (c.seed ? 0.05 * jitterOf(c.seed, k) : 0);
  const simCache = new Map();
  const simFrom = k => {
    if (!simCache.has(k)) simCache.set(k, new Map(c.feel ? c.f.similar(c.feel, k, { limit: pool.length, among: pool }).map(r => [r.key, r.score]) : []));
    return simCache.get(k);
  };
  return mmr({ keys: pool, rel, simFrom });
}

/**
 * @param {object} o
 * @param {Array} o.summaries film summaries (api summarize shape: user.watchlist/watched/watchlistAddedAt, runtime, released, kind, lastWatched)
 * @param {{ fit: Function }} o.fitModel from buildFit
 * @param {object} o.feel feel index
 * @param {Date|string} [o.today]
 * @param {{ maxMinutes?: number|null, mood?: string|null, weight?: -1|0|1 }} [o.dials] weight: -1 Lighter, 0 either, 1 Heavier
 * @param {Array<string>} [o.exclude] keys never to pick (snoozed, or already on screen)
 * @param {number} [o.seed] 0 = best picks; other numbers shuffle deterministically among near-best, and draw different categories
 * @param {Array<string>} [o.avoid] keys shown in the last few shuffles: left out while enough other films remain
 * @param {object} [o.fns] swap feel functions in tests
 * @returns {{ picks: Array, more: Array, counts: object, empty: null|{ why: 'watchlist'|'time'|'mood'|'weight'|'fit', text: string }, moods: string[] }}
 */
/** How many of tonight's candidates (after time and weight, before any mood) match each mood, so the UI can hide the ones with nothing. */
function moodCounts(c) {
  const out = {};
  const among = c.preMood.map(s => s.key);
  for (const m of MOODS) {
    if (!c.feel || !among.length) { out[m.label] = among.length; continue; }
    out[m.label] = c.f.queryFeel(c.feel, { descriptors: m.descriptors, avoid: m.avoid }, { limit: among.length, among }).filter(h => h.score >= MOOD_MIN).length;
  }
  return out;
}

export function buildPicks(o = {}) {
  const c = prepare(o);
  const base = { counts: c.counts, lists: c.lists, moods: MOODS.map(m => m.label), moodCounts: moodCounts(c) };
  if (!c.cands.length) return { picks: [], more: [], ...base, empty: emptyFor(c) };
  const taken = new Set();
  const picks = [];
  const avoid = new Set(o.avoid || []);
  const allKeys = c.cands.map(s => s.key);
  // Fresh films first: only fall back to ones shown lately when too few others are left to fill the screen.
  const fresh = allKeys.filter(k => !avoid.has(k));
  const pool = fresh.length >= 3 + MORE_COUNT ? fresh : allKeys;
  // A role with nothing suitable among the unseen films is skipped; films shown lately are used only if the screen would otherwise stay short.
  for (const from of pool === allKeys ? [allKeys] : [pool, allKeys]) {
    for (const role of rolesFor(c.seed)) {
      if (picks.length === 3) break;
      if (picks.some(p => p.role === role)) continue;
      const k = CHOOSE[role](c, from.filter(x => !taken.has(x)));
      if (k == null) continue;
      taken.add(k);
      picks.push(card(c, k, role));
    }
  }
  if (!picks.length) return { picks: [], more: [], ...base, empty: { why: 'fit', text: "We don't know enough about these films yet to pick one with confidence." } };
  const left = allKeys.filter(k => !taken.has(k));
  const leftFresh = left.filter(k => !avoid.has(k));
  let moreKeys = chooseMore(c, leftFresh.length >= MORE_COUNT ? leftFresh : left, picks.map(p => p.key));
  if (moreKeys.length < MORE_COUNT && leftFresh.length < left.length) {
    // Not enough unseen films: top up with ones shown lately rather than leave gaps.
    const have = new Set(moreKeys);
    moreKeys = [...moreKeys, ...chooseMore(c, left.filter(k => !have.has(k)), picks.map(p => p.key)).slice(0, MORE_COUNT - moreKeys.length)];
  }
  const more = moreKeys.map(k => card(c, k));
  return { picks, more, ...base, empty: null };
}

function emptyFor(c) {
  const n = c.counts;
  if (!n.watchlist) return { why: 'watchlist', text: c.lists ? 'Your watchlist and lists are empty.' : 'Your watchlist is empty.' };
  if (!n.afterEligible) return { why: 'eligible', text: 'Nothing on your watchlist is out yet.' };
  if (!n.afterTime) return { why: 'time', text: 'Nothing on your watchlist fits that much time.' };
  if (!n.afterSkips) return { why: 'skipped', text: "You've passed on everything that fits." };
  if (!n.afterMood) return { why: 'mood', text: "Nothing on your watchlist feels like that yet." };
  return { why: 'weight', text: 'Nothing on your watchlist leans that way.' };
}

/** Steers a "Choose for me" reroll: what the user said about the film the user turned down, turned into a filter on what is left. */
export const STEERS = {
  lighter: 'Too heavy', heavier: 'Too light', plainer: 'Too strange', stranger: 'Too ordinary',
  shorter: 'Too long', faster: 'Too slow', different: 'Seen something like it',
};
/** Reasons that rule out films carrying certain feelings (scored 0.15 or more), using the exclusion-only search. */
export const AVOID_STEERS = {
  bleak: ['bleak', 'despairing', 'gloomy', 'oppressive', 'harrowing', 'devastating'],
  silly: ['farcical', 'absurd', 'playful', 'whimsical', 'camp', 'bawdy', 'irreverent', 'quirky'],
  intense: ['intense', 'harrowing', 'relentless', 'tense', 'anxious', 'brutal', 'gut-punch'],
  scary: ['terrifying', 'chilling', 'eerie', 'disturbing', 'foreboding', 'claustrophobic', 'unsettling'],
};
const FAST = ['propulsive', 'tightly-paced', 'breakneck', 'relentless', 'thrilling'];

function applySteer(c, keys, st) {
  const rej = st.key ? c.byKey.get(st.key) : null;
  if (st.kind === 'mood') {
    const m = MOODS.find(x => x.label === st.label);
    if (!m || !c.feel) return keys;
    const hits = c.f.queryFeel(c.feel, { descriptors: m.descriptors, avoid: m.avoid }, { limit: keys.length || 1, among: keys });
    const ok = new Set(hits.filter(h => h.score >= MOOD_MIN).map(h => h.key));
    return keys.filter(k => ok.has(k));
  }
  if (AVOID_STEERS[st.kind]) {
    if (!c.feel) return keys;
    const ok = new Set(c.f.queryFeel(c.feel, { avoid: AVOID_STEERS[st.kind] }, { limit: keys.length || 1, among: keys }).map(h => h.key));
    return keys.filter(k => ok.has(k));
  }
  if (st.kind === 'faster') {
    if (!c.feel) return keys;
    const ok = new Set(c.f.queryFeel(c.feel, { descriptors: FAST, avoid: ['languid', 'glacial', 'slow-paced'] }, { limit: keys.length || 1, among: keys }).filter(h => h.score >= MOOD_MIN).map(h => h.key));
    return keys.filter(k => ok.has(k));
  }
  if (!rej) return keys;
  if (st.kind === 'shorter') {
    const rt = num(rej.runtime);
    return rt ? keys.filter(k => { const r = num(c.byKey.get(k).runtime); return r && r <= rt - SHORTER_BY; }) : keys;
  }
  if (st.kind === 'different') {
    if (!c.feel) return keys;
    const near = new Set(c.f.similar(c.feel, st.key, { limit: 15, among: keys }).map(r => r.key));
    return keys.filter(k => !near.has(k));
  }
  const axisDir = { lighter: ['weight', -1], heavier: ['weight', 1], plainer: ['strangeness', -1], stranger: ['strangeness', 1] }[st.kind];
  if (!axisDir || !c.feel) return keys;
  const ax = (c.feel.axes || []).find(a => a.id === axisDir[0]);
  const from = c.feel.byKey.get(st.key);
  if (!ax || !from) return keys;
  const at = c.f.axisPosition(from, ax);
  return keys.filter(k => { const r = c.feel.byKey.get(k); return r && (c.f.axisPosition(r, ax) - at) * axisDir[1] > 0; });
}

/**
 * "Choose for me": one film, nothing about it shown, and a reroll that learns from why the user turned the last one down.
 * @param {object} o same as buildPicks
 * @param {{ rejected?: string[], steers?: Array<{ kind: string, key?: string, label?: string }> }} choose
 * @returns {{ pick: null|{ key: string, film: object }, relaxed?: boolean, left?: number, empty?: object, miss?: string }}
 */
export function choosePick(o = {}, choose = {}) {
  const rejected = choose.rejected || [];
  const c = prepare({ ...o, exclude: [...(o.exclude || []), ...rejected] });
  if (!c.cands.length) return { pick: null, empty: emptyFor(c) };
  const all = c.cands.map(s => s.key);
  const active = [...(choose.steers || [])];
  let kept = all, relaxed = false;
  for (;;) {
    kept = active.reduce((ks, st) => applySteer(c, ks, st), all);
    if (kept.length || !active.length) break;
    active.shift(); relaxed = true; // the user's newest reasons matter most: drop the oldest until something fits
  }
  const k = bestSafe(c, kept) ?? c.ordered(kept)[0] ?? null;
  if (k == null) return { pick: null, miss: "That's everything on your watchlist that fits tonight." };
  return { pick: { key: k, film: c.byKey.get(k) }, relaxed, left: kept.length };
}

/**
 * One nudge on one pick: returns { pick } with a replacement for the same role, or { pick: null, miss } when there is nothing to offer.
 * Callers put every key on screen (and snoozed ones) in `exclude`; `nudge.key` is excluded too.
 * @param {object} o same as buildPicks
 * @param {{ role: 'safe'|'stretch'|'waiting', key: string, kind: 'lighter'|'heavier'|'shorter'|'stranger'|'else' }} nudge
 */
export function nudgePick(o = {}, nudge = {}) {
  const { role, key, kind } = nudge;
  const c = prepare({ ...o, exclude: [...(o.exclude || []), key] });
  const cur = c.byKey.get(key);
  const choose = CHOOSE[role] || bestSafe;
  const keys = c.cands.map(s => s.key);
  let k = null, note = null;
  if (AXIS_FOR[kind] && c.feel && cur) {
    const [axis, dir] = AXIS_FOR[kind];
    const rows = c.f.shift(c.feel, key, { axis, dir }, { limit: 8, among: keys });
    const best = c.ordered(rows.map(r => r.key).filter(x => keys.includes(x)))[0];
    k = best ?? null;
    const word = kind === 'lighter' ? 'Lighter' : kind === 'heavier' ? 'Heavier' : 'Stranger';
    note = k ? `${word} than ${cur.title}.` : null;
  } else if (kind === 'shorter' && cur) {
    const rt = num(cur.runtime);
    const shorter = rt ? keys.filter(x => { const r = num(c.byKey.get(x).runtime); return r && r <= rt - SHORTER_BY; }) : [];
    k = shorter.length ? choose(c, shorter) : null;
    note = k ? `${rt - num(c.byKey.get(k).runtime)} minutes shorter than ${cur.title}.` : null;
  } else {
    k = choose(c, keys);
  }
  if (k == null) return { pick: null, miss: MISS[kind] || MISS.else };
  return { pick: card(c, k, role, note) };
}

const MISS = {
  lighter: 'Nothing lighter on your watchlist fits that. Try another mood or more time.',
  heavier: 'Nothing heavier on your watchlist fits that. Try another mood or more time.',
  stranger: 'Nothing stranger on your watchlist fits that. Try another mood or more time.',
  shorter: 'Nothing shorter on your watchlist fits that.',
  else: "That's everything on your watchlist that fits tonight. Try more time or another mood.",
};
