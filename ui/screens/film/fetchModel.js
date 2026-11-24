// Pure helpers behind the film page's live fetch and the "Failed N sources" pill (no Preact, so node tests can import them).
import { plural } from '../../format.js';

export const REOPEN_MS = 2 * 60 * 1000; // opening the same film again within this window does not fetch again
const LABELS = {
  boxd: 'Letterboxd link', wikidata: 'Wikidata', wikipedia: 'Wikipedia', imdb: 'IMDb ratings', rt: 'Rotten Tomatoes', metacritic: 'Metacritic',
  wikicats: 'Wikipedia categories', mcreviews: 'Metacritic reviews', lbpage: 'Letterboxd', imdbpage: 'IMDb', allmovie: 'AllMovie', tmdb: 'TMDB', omdb: 'OMDb',
};

export const providerLabel = (id, label) => label || LABELS[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : 'A source');

/** Plain-English reason for an outcome. Never shows status codes or error text. */
export function reasonText(o) {
  const r = String((o && o.reason) || '').toLowerCase();
  if (o && o.status === 'miss') return (o.hollow || /page there/.test(r)) ? "The film's page is there, but Matinee couldn't find the scores on it." : "This site doesn't seem to have the film.";
  if (o && o.status === 'deferred') return 'This site asked Matinee to slow down. It will look again shortly.';
  if (/429|rate|slow|paused|too many|breaker|host-paused/.test(r)) return 'This site asked Matinee to slow down.';
  if (/challenge|human|403|cf-mitigated|blocked|captcha/.test(r)) return 'This site wants a check that you are a person.';
  if (/timeout|timed out|abort/.test(r)) return 'This site took too long to answer.';
  if (/404|not.?found/.test(r)) return "This site doesn't seem to have the film.";
  if (/network|offline|enotfound|econn|fetch failed|dns/.test(r)) return "Couldn't reach this site. Check your internet connection.";
  if (/key/.test(r)) return 'This source needs a key in Settings.';
  return "Couldn't read this site just now.";
}


/** { failed, deferred, missed: [outcome] } from a fetchStatus, tolerant of null. */
export function split(status) {
  const outs = (status && Array.isArray(status.outcomes)) ? status.outcomes : [];
  return { failed: outs.filter(o => o.status === 'failed'), deferred: outs.filter(o => o.status === 'deferred'), missed: outs.filter(o => o.status === 'miss') };
}

/** Text for the pill, or '' when nothing needs showing. */
export function pillText(status) {
  const { failed, deferred, missed } = split(status);
  if (failed.length) return `Failed ${plural(failed.length, 'source', 'sources')}`;
  if (deferred.length) return `Waiting on ${plural(deferred.length, 'source', 'sources')}`;
  if (missed.length) return `Not found on ${plural(missed.length, 'source', 'sources')}`;
  return '';
}

/** Fold one 'film' event into a status. Events without a provider (the done marker) only carry the totals. */
export function applyEvent(status, ev) {
  const base = status || { outcomes: [] };
  if (!ev || !ev.provider) return base;
  const outcomes = [...(base.outcomes || [])];
  const i = outcomes.findIndex(o => o.provider === ev.provider);
  const next = { provider: ev.provider, label: providerLabel(ev.provider, i >= 0 ? outcomes[i].label : null), status: ev.status, reason: ev.reason || '', at: Date.now() };
  if (i >= 0) outcomes[i] = next; else outcomes.push(next);
  return { ...base, outcomes };
}

/** Does this 'film' event concern the key? */
export const eventIsFor = (ev, key) => !!ev && (ev.key === key || (Array.isArray(ev.keys) && ev.keys.includes(key)));

// One fetch per film per session window.
const lastRun = new Map();
export function shouldFetch(key, now = Date.now(), seen = lastRun) {
  const t = seen.get(key);
  if (t != null && now - t < REOPEN_MS) return false;
  seen.set(key, now);
  return true;
}
