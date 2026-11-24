// Feel colours: the five feel colours across the app. On by default; Settings → Appearance switches them (saved in the core's
// settings as feelColours, cached here in localStorage for the first paint). F8 still switches them too.
// Most uses are plain data-fam="red|yellow|green|blue|purple|none" attributes that only the CSS (scoped under data-feel-colours="on") acts on.
// Only the per-film colour (rings, poster lines, calendar) needs data from the Map layout, loaded the first time the colours are on.
import { useState, useEffect } from 'preact/hooks';
import { call, on } from './api.js';
import { toast } from './state.js';
import { wordFamilyOf, feelWordParts, NEUTRAL, FAMILIES, FAMILY_WORDS } from '../core/analysis/feel-families.js';
import './feel-colours.css';

// On by default since 22 Nov. A new key, so an "off" saved while comparing doesn't stick; F8 still switches them off for now.
const KEY = 'matinee.feelColours';
let isOn = true;
try { isOn = localStorage.getItem(KEY) !== 'off'; } catch { /* storage can be unavailable: then they're simply on */ }
const subs = new Set();
const apply = () => { document.documentElement.setAttribute('data-feel-colours', isOn ? 'on' : 'off'); };
apply();

/** Switch the colours on or off on screen (app.jsx calls this when the saved setting changes). Caches the choice for the next start. */
export function setFeelColours(v) {
  try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* no storage: the core's setting still applies once it loads */ }
  if (v === isOn) return;
  isOn = v;
  apply(); subs.forEach(s => s(isOn));
  if (isOn) loadColours();
}

/** F8 handler: toggles the colours through the saved setting, says so. Returns the cleanup. */
export function installFeelColoursKey() {
  const f = e => {
    if (e.key !== 'F8') return;
    e.preventDefault();
    const v = !isOn;
    setFeelColours(v);
    // call() records a failure in the problem log; the screen has already switched, only the saved choice may lag
    call('setSettings', { feelColours: v }).catch(() => {});
    toast(v ? 'Feel colours on' : 'Feel colours off');
  };
  window.addEventListener('keydown', f);
  return () => window.removeEventListener('keydown', f);
}

export function useFeelColours() {
  const [v, set] = useState(isOn);
  useEffect(() => { subs.add(set); set(isOn); return () => subs.delete(set); }, []);
  return v;
}

/** Family id for a feeling (label, then id), or 'none' for a feeling with no family (shown neutral). */
/** The colour a feeling word is written in, for a bar or word that stands for that feeling ('none' when it is not a feeling word). */
export const famOf = (...words) => { for (const w of words) { const f = wordFamilyOf(w); if (f) return f; } return 'none'; };
/** A row's feelings facets (the ones that take family colour). */
export const FEELING_FACETS = ['mood', 'tone', 'pace', 'craft', 'impact'];

// ---- a film's own colour (its blend on the Map), by film key ----
const colours = new Map();
const splits = new Map(); // films torn between two feelings: key → [first colour, second colour] (the split ring)
const families = new Map(); // key → [family] or, torn, [first family, second family]: what the colour tip names
const FAMILY_BY_HEX = new Map(Object.entries(FAMILIES).map(([f, x]) => [x.c, f]));

/** The colour tip for one family, in the Map key's words: "Red: tense or dark". */
export const familyTip = f => (FAMILY_WORDS[f] ? `${FAMILY_WORDS[f][0]}: ${FAMILY_WORDS[f][1]}` : '');
/** The tip for a film's colour line or ring: one line per colour (two for a film torn between two feelings), or '' when it has none. */
export const filmTip = key => (families.get(key) || []).map(familyTip).filter(Boolean).join('\n');
const filmSubs = new Set();
let loading = false;
function loadColours() {
  if (loading) return;
  loading = true;
  // call() reports a failure to the problem log itself; the colours just stay off for films until the next try.
  call('getMap', { lens: 'feel' }).then(m => {
    colours.clear(); splits.clear(); families.clear();
    for (const n of (m && m.nodes) || []) {
      if (n.colour && n.colour !== NEUTRAL) colours.set(n.key, n.colour);
      const torn = Array.isArray(n.split) && n.split.length === 2 ? n.split.map(x => FAMILY_BY_HEX.get(x)) : null;
      if (torn) splits.set(n.key, n.split);
      if (torn && torn.every(Boolean)) families.set(n.key, torn); else if (n.family) families.set(n.key, [n.family]);
    }
    filmSubs.forEach(s => s());
  }, () => {}).finally(() => { loading = false; });
}
if (isOn) setTimeout(loadColours, 0);
on('map', () => { if (isOn) loadColours(); });

/** The film's blend colour (hex) while the colours are on, else null. Null too when the film has none (neutral or not on the Map). */
export function useFilmColour(key) {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick(n => n + 1);
    subs.add(f); filmSubs.add(f);
    if (isOn && !colours.size) loadColours();
    return () => { subs.delete(f); filmSubs.delete(f); };
  }, []);
  return isOn && key ? colours.get(key) || null : null;
}
/** The film's two colours when it is torn between two feelings (call after useFilmColour, which re-renders when they arrive), else null. */
export const filmSplit = key => (isOn && key ? splits.get(key) || null : null);
/** Props for an element that shows the film's colour: data-fc / --fc, plus data-fc2 / --fc2 for a split. */
export function colourProps(key, fc) {
  if (!fc) return { attrs: {}, style: null };
  const sp = filmSplit(key);
  return sp ? { attrs: { 'data-fc': fc, 'data-fc2': '' }, style: { '--fc': sp[0], '--fc2': sp[1] } } : { attrs: { 'data-fc': fc }, style: { '--fc': fc } };
}
/** Plain colour lookup for code that already re-renders (calendar). */
export const filmColour = key => (isOn && key ? colours.get(key) || null : null);

const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/** Average several colours (sRGB mean). Null for none. */
export function mixColours(list) {
  const l = list.filter(Boolean);
  if (!l.length) return null;
  const s = [0, 0, 0];
  for (const c of l) hex2(c).forEach((v, i) => { s[i] += v; });
  return '#' + s.map(v => Math.round(v / l.length).toString(16).padStart(2, '0')).join('');
}

/** A sentence with each feeling word in its colour (feelWordParts in core/analysis/feel-families.js). Returns JSX children. */
export function colourWords(text, h) {
  if (typeof text !== 'string') return text;
  // data-feel-tip: pointing at a coloured word names its colour (the Tooltip shows it only while the colours are on)
  return feelWordParts(text).map((p, i) => (p.fam ? h('span', { key: i, 'data-fam': p.fam, class: 'fam-text', 'data-feel-tip': familyTip(p.fam) }, p.text) : p.text));
}
