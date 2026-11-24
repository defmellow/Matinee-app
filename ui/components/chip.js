// Pure helpers behind Chip and the film-page filter links (kept out of the .jsx so node tests can import them).
import { href } from '../router.js';

/** What a Chip renders as: a link when it has an href, otherwise a button. Informational things are Badges, never chips. */
export const chipTag = ({ href: to } = {}) => (to ? 'a' : 'button');

/**
 * Link to the Library filtered by one thing. kind: tag | auto | genre | country | language | decade | status | rating | runtime | text.
 * Library reads these in library/model.js queryFromParam: filterHref('genre', 'Drama') -> #/library/genre%3ADrama.
 * 'text' puts the value in the search box, so filterHref('text', 'year:1984') and filterHref('text', 'language:korean') work.
 * 'rating' takes your rating on the 1–10 half-star scale, or a range: filterHref('rating', 8), filterHref('rating', '7-8').
 * 'runtime' takes minutes as a range with either end open: filterHref('runtime', '91-120'), filterHref('runtime', '-90').
 */
export const filterHref = (kind, value) => href('library', `${kind === 'text' ? 'q' : kind}:${value}`);

/**
 * Where a link target from core's text parts (core/analysis/text-parts.js) goes: a person's page (id or name, with the
 * role they were named in), a Year in review, a film's page, or else the Library filtered by it (filterHref's kinds).
 */
export function linkHref(to) {
  if (!to || to.value == null || to.value === '') return null;
  switch (to.kind) {
    case 'person': return href('person', to.value, to.role ? { role: to.role } : undefined);
    case 'year': return href('year', to.value);
    case 'film': return href('film', to.value);
    default: return filterHref(to.kind, to.value);
  }
}
