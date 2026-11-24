// Sentences with links in them. Core writes a sentence as parts so the UI can make some words links without core
// knowing about routes; joining the parts' text always gives back the plain sentence, word for word.
//
// A part is a plain string, or { text, to } where `to` says what the words stand for:
//   { kind: 'person', value: <id or name>, role?: 'director' | 'cast' | 'writer' | 'cinematography' | 'composer' | 'editor' }
//   { kind: 'year', value: 2025 }                          Year in review for that year
//   { kind: 'film', value: <film key> }                    the film's page
//   { kind: 'genre' | 'country' | 'language' | 'tag' | 'auto' | 'decade' | 'status' | 'rating' | 'text', value }
//                                                          a Library filter (the forms the Library's links take)

/** @typedef {{ kind: string, value: string|number, role?: string }} LinkTarget */
/** @typedef {string | { text: string, to: LinkTarget }} TextPart */

/** A linked part. `extra` adds fields to the target (a person's role). */
export const linkPart = (text, kind, value, extra = {}) => ({ text: String(text), to: { kind, value, ...extra } });

/** A person as a linked part: their id when known, else their name. */
export const personPart = (p, role) => linkPart(p.name, 'person', p.id != null && p.id !== '' ? p.id : p.name, role ? { role } : {});

/** The plain sentence the parts spell. */
export const partsText = parts => (parts || []).map(p => (typeof p === 'string' ? p : p && p.text != null ? p.text : '')).join('');
