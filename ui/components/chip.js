// Pure helpers behind Chip and the film-page filter links (kept out of the .jsx so node tests can import them).
import { href } from '../router.js';

/** What a Chip renders as: a link when it has an href, otherwise a button. Informational things are Badges, never chips. */
export const chipTag = ({ href: to } = {}) => (to ? 'a' : 'button');

/**
 * Link to the Library filtered by one thing. kind: tag | auto | genre | country | decade | status | text.
 * Library reads these in library/model.js queryFromParam: filterHref('genre', 'Drama') -> #/library/genre%3ADrama.
 * 'text' puts the value in the search box, so filterHref('text', 'year:1984') and filterHref('text', 'language:korean') work.
 */
export const filterHref = (kind, value) => href('library', `${kind === 'text' ? 'q' : kind}:${value}`);
