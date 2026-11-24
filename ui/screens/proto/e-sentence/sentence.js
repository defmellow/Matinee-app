// PROTOTYPE E: the query told as one plain sentence, in parts you can click. Pure functions, no UI.
import { lbPillLabel } from '../../../../core/analysis/feel/lbthemes.js';
import { activeFilters } from '../../library/model.js';
import { sortOf } from '../shared/query.js';

export const STATUS_PHRASE = {
  all: 'All your films', watched: "Films you've watched", watchlist: 'Your watchlist', listed: 'Films on your lists', liked: 'Films you liked', unrated: 'Watched, not rated',
};

export const SORT_PHRASE = {
  match: 'closest first', recent: 'recently watched first', title: 'by title', year: 'newest first', rating: 'your highest rated first',
  score: 'best Matinee score first', letterboxd: 'best Letterboxd average first', runtime: 'longest first', popularity: 'most popular first', yourTake: 'your hottest takes first',
};
export const sortPhrase = (sort, status, dir) => {
  if (sort === 'recent' && status === 'watchlist') return dir === 'desc' ? 'newest added first' : 'oldest added first';
  if (sort === 'year' && dir === 'asc') return 'oldest first';
  if (sort === 'runtime' && dir === 'asc') return 'shortest first';
  if (sort === 'title' && dir === 'desc') return 'by title, Z to A';
  return SORT_PHRASE[sort] || 'recently watched first';
};

/** Which picker section an id lives in ('mood', 'theme', 'subjects', 'kinds', 'settings'…), from the facet sections. */
export function sectionIndex(sections) {
  const m = new Map();
  for (const s of sections || []) for (const it of s.items || []) if (!m.has(it.id)) m.set(it.id, s.id);
  return m;
}

const labelOf = (u, id) => u.labels.get(id) || (id.startsWith('lb:') ? lbPillLabel(id.slice(3)) : id.replace(/^set:/, ''));
const lower = s => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s); // "Eerie" → "eerie", keep "Paris, Texas"

/**
 * The sentence parts in reading order: [{ lead, items: [{ key, text, kind, id?, patch? }] }].
 * kind: 'status' | 'text' | 'like' | 'feel' | 'feelText' | 'about' | 'place' | 'kindOf' | 'avoid' | 'lib' | 'sort'
 */
export function sentenceOf(u, autoLabels = {}, { compact = false } = {}) {
  const { q } = u;
  const where = sectionIndex(u.sections);
  const parts = [];
  parts.push({ lead: '', items: [{ key: 'status', kind: 'status', text: STATUS_PHRASE[q.status] || STATUS_PHRASE.all }] });
  if (q.text.trim()) parts.push({ lead: 'matching', items: [{ key: 'text', kind: 'text', text: `“${q.text.trim()}”`, patch: x => ({ ...x, text: '' }) }] });
  if (q.like) parts.push({ lead: 'like', items: [{ key: 'like', kind: 'like', text: u.likeFilm ? u.likeFilm.title : 'a film', patch: x => ({ ...x, like: null, likeShift: null }) }] });
  const feel = [], about = [], place = [], kinds = [];
  for (const id of q.feel) (where.get(id) === 'theme' ? about : feel).push(id);
  for (const id of q.themes) {
    const s = where.get(id) || (id.startsWith('set:') ? 'settings' : 'theme');
    (s === 'settings' ? place : s === 'kinds' ? kinds : about).push(id);
  }
  // A leave-out read from typed "not …" lives in the search text, so taking it off clears the text.
  const drop = id => (u.asFeel === 'out' && !(u.qStoredAvoid || []).includes(id) && q.avoid.includes(id)
    ? x => ({ ...x, text: '' })
    : x => ({ ...x, feel: x.feel.filter(v => v !== id), themes: x.themes.filter(v => v !== id), avoid: x.avoid.filter(v => v !== id) }));
  const items = (ids, kind) => ids.map(id => ({ key: kind + id, kind, id, text: kind === 'place' || kind === 'kindOf' ? labelOf(u, id) : lower(labelOf(u, id)), patch: drop(id) }));
  if (!compact && (feel.length || q.feelText.trim())) {
    const its = items(feel, 'feel');
    if (q.feelText.trim()) its.push({ key: 'feelText', kind: 'feelText', text: `“${q.feelText.trim()}”`, patch: u.asFeel ? x => ({ ...x, text: '' }) : x => ({ ...x, feelText: '' }) });
    parts.push({ lead: 'that feel', items: its });
  }
  if (compact) { // (22 Nov) chosen feelings and filters are pills under the bar, so the sentence keeps what they can't say
    if (q.feelText.trim()) parts.push({ lead: 'that feel', items: [{ key: 'feelText', kind: 'feelText', text: `“${q.feelText.trim()}”`, patch: u.asFeel ? x => ({ ...x, text: '' }) : x => ({ ...x, feelText: '' }) }] });
    return parts;
  }
  if (about.length) parts.push({ lead: 'about', items: items(about, 'about') });
  if (kinds.length) parts.push({ lead: 'that are', items: items(kinds, 'kindOf') });
  if (place.length) parts.push({ lead: 'set in', items: items(place, 'place') });
  if (q.avoid.length) parts.push({ lead: 'but not', items: items(q.avoid, 'avoid') });
  const lib = activeFilters({ ...q, feel: [] }, autoLabels).map(c => ({ key: 'lib' + c.id, kind: 'lib', text: libPhrase(c), patch: x => ({ ...x, ...c.patch }) }));
  if (lib.length) parts.push({ lead: '', items: lib });
  return parts;
}

/** The Library's filter chips, said in words that fit a sentence. */
function libPhrase(c) {
  const id = c.id;
  if (id.startsWith('g:')) return c.label;
  if (id === 'decade') return `from the ${c.label}`;
  if (id.startsWith('c:')) return `from ${c.label}`;
  if (id.startsWith('l:')) return `in ${c.label}`;
  if (id.startsWith('t:')) return `tagged ${c.label.replace(/^Tag: /, '')}`;
  if (id === 'runtime') return c.label.replace(/^Under (\d+) min$/, (m, n) => `under ${+n % 60 === 0 ? (+n / 60) + ' h' : n + ' min'}`);
  if (id === 'rating') return c.label.replace(/^You rated/, 'you rated');
  return c.label;
}

export const sortNow = q => sortOf(q);

/**
 * Every chosen feeling, theme, place, leave-out and Library filter as a removable pill (the old Library's row
 * 22 Nov): [{ key, label, out, patch }]. A feeling reads "Feels tense", a place "Set in Paris", a leave-out "Not violent".
 */
export function pillsOf(u, autoLabels = {}) {
  const { q } = u;
  const where = sectionIndex(u.sections);
  const typedOut = id => u.asFeel === 'out' && !(u.qStoredAvoid || []).includes(id) && q.avoid.includes(id);
  const drop = id => (typedOut(id) ? x => ({ ...x, text: '' }) : x => ({ ...x, feel: x.feel.filter(v => v !== id), themes: x.themes.filter(v => v !== id), avoid: x.avoid.filter(v => v !== id) }));
  const out = [];
  for (const id of q.feel) out.push({ key: 'f' + id, label: where.get(id) === 'theme' ? labelOf(u, id) : `Feels ${lower(labelOf(u, id))}`, patch: drop(id) });
  for (const id of q.themes) {
    const sec = where.get(id) || (id.startsWith('set:') ? 'settings' : 'theme');
    out.push({ key: 't' + id, label: sec === 'settings' ? `Set in ${labelOf(u, id)}` : labelOf(u, id), patch: drop(id) });
  }
  for (const id of q.avoid) out.push({ key: 'a' + id, label: `Not ${lower(labelOf(u, id))}`, out: true, patch: drop(id) });
  for (const c of activeFilters({ ...q, feel: [] }, autoLabels)) out.push({ key: 'l' + c.id, label: c.label, patch: x => ({ ...x, ...c.patch }) });
  return out;
}
