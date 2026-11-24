// Readable summary of one FeelProfile. Pure.
import { softLower, stem } from './text.js';

const ADJECTIVE_FACETS = new Set(['mood', 'tone', 'pace', 'craft', 'impact']);
const VOICE_RANK = { viewers: 3, critics: 2, editors: 1 };
const KIND_FIT = { about: 1, subject: 0.6 }; // categories ("Films about …") are more deliberate than keywords
const MIN_ADJ_SCORE = 0.15;
const lower = softLower;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function list(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function strongestVoice(voices = []) {
  return [...voices].sort((a, b) => (VOICE_RANK[b] || 0) - (VOICE_RANK[a] || 0))[0] || 'editors';
}

function derivedKinds(profile) {
  const voices = new Set();
  for (const d of profile.descriptors || []) for (const v of d.voices || []) voices.add(v);
  const out = [];
  if (voices.has('viewers')) out.push('viewer reviews');
  if (voices.has('critics')) out.push('critic quotes');
  if (voices.has('editors') || (profile.themes || []).length) out.push('article categories');
  return out;
}

/** Up to three adjectives, strongest first, from different facets where possible (so not "wondrous, whimsical and charming"). */
function pickAdjectives(descriptors) {
  const pool = descriptors.filter(d => ADJECTIVE_FACETS.has(d.facet) && (d.score ?? 1) >= MIN_ADJ_SCORE);
  const chosen = [];
  const facets = new Set();
  for (const d of pool) {
    if (chosen.length >= 3) break;
    if (facets.has(d.facet)) continue;
    facets.add(d.facet);
    chosen.push(d);
  }
  for (const d of pool) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(d)) chosen.push(d);
  }
  // keep strongest-first order of the original list
  return chosen.sort((a, b) => descriptors.indexOf(a) - descriptors.indexOf(b)).map(d => lower(d.label));
}

const stemsOf = (s) => new Set(String(s).toLowerCase().split(/[^\p{L}]+/u).filter(w => w.length >= 4).map(stem));
const overlaps = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

/**
 * The most telling "about" theme: not so rare that it is a one-off category, not so common that it says nothing.
 * Falls back to anything about/subject when profile.libraryFilms is unknown.
 */
function pickAbout(themes, libraryFilms, themeDesc) {
  const cands = themes.filter(t => KIND_FIT[t.kind] && t.label && t.label.length <= 40);
  if (!cands.length) return null;
  const n = libraryFilms || 0;
  const quality = (t) => {
    if (!n || !t.films) return 1;
    if (t.films < 2) return 0.55;
    const share = t.films / n;
    // Best when shared with a handful of films (3 to about 30 in a library of 680): specific, but not a one-off.
    const off = Math.max(0, Math.abs(Math.log(share / 0.015)) - Math.log(3));
    return Math.max(0.2, 1 - off / Math.log(50)) * (1 - 0.02 * Math.log(t.films));
  };
  // A theme that echoes what the text says ("memory erasure" for a film described as about memory) is the safer pick.
  const echo = themeDesc ? stemsOf(themeDesc.label) : new Set();
  return cands
    .map((t, i) => ({ t, i, q: KIND_FIT[t.kind] * quality(t) * (overlaps(stemsOf(t.label), echo) ? 1.6 : 1) * (1 + (t.centrality != null ? 1.5 * t.centrality : 0.6 * Math.min(3, t.mentions || 0))) }))
    .sort((a, b) => b.q - a.q || a.i - b.i)[0].t;
}

export function describe(profile) {
  const descriptors = profile?.descriptors || [];
  const themes = profile?.themes || [];
  const adjectives = pickAdjectives(descriptors);
  // The headline's one big theme is the strongest one.
  // (Tried 11 Nov: preferring themes that are rarer in the library. 173 headlines changed and as many got worse as better, so it stays by strength.)
  const themeDescs = descriptors.filter(d => d.facet === 'theme');
  const themeDesc = themeDescs.find(d => d.score >= 0.2) || themeDescs[0];
  const about = pickAbout(themes, profile?.libraryFilms, themeDesc);
  const style = themes.find(t => t.kind === 'style');
  const aboutShown = about;

  let head = '';
  if (adjectives.length) {
    head = cap(list(adjectives));
    // Feelings, then the one big theme. The specific subjects live in their own rows, so the line no longer ends "— about …" (31 Oct).
    // "about" (22 Nov): every theme label is a noun phrase, so "…, about war" / "about robots and AI" reads right,
    // where "with a sense of" broke on most of them ("a sense of technology", "a sense of twins").
    if (themeDesc) head += `, about ${lower(themeDesc.label)}`;
  } else if (themeDesc || about || style) {
    const subject = aboutShown ? lower(aboutShown.label) : themeDesc ? lower(themeDesc.label) : '';
    head = style ? cap(lower(style.label)) + (subject ? ` about ${subject}` : '') : cap(`about ${subject}`);
  } else {
    head = 'Not much has been written about this one yet';
  }

  return {
    headline: head,
    chips: descriptors.map(d => ({ label: d.label, facet: d.facet, voice: strongestVoice(d.voices) })),
    basedOn: Array.isArray(profile?.kinds) ? [...profile.kinds] : derivedKinds(profile || {}),
    thin: !profile || (profile.coverage?.viewers ?? 0) === 0,
  };
}
