// Watched / watchlist status of a film, shared by StatusBadge and tests.
export const STATUS_TEXT = {
  watched: { label: 'Watched', tip: 'Watched: it is in your Letterboxd diary or ratings.' },
  watchlist: { label: 'Watchlist', tip: "On your watchlist: you haven't watched this yet." },
};

/** 'watched' wins if a film is somehow both. null when the film is in neither (Matinee knows it, you have not listed it). */
export const statusOf = user => (user && user.watched ? 'watched' : user && user.watchlist ? 'watchlist' : null);
