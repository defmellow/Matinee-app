// Feel ids that were renamed or folded into another. Old saved filters, links and views still carry the old id,
// so anything that reads a stored id runs it through here. Add a line when a descriptor id disappears.
export const FEEL_ID_ALIASES = {
  wistful: 'bittersweet', // folded into Bittersweet (8 Nov)
};

/** The current id for a stored one (unchanged when it was never renamed). */
export const canonicalFeelId = id => FEEL_ID_ALIASES[id] || id;

/** Map a list of stored ids to current ones, dropping repeats and keeping order. */
export const canonicalFeelIds = ids => [...new Set((ids || []).map(canonicalFeelId))];
