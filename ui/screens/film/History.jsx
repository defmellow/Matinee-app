// "Watch history": diary entries, watch count, watchlist state.
import { useState } from 'preact/hooks';
import { Stars, dateText } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { call } from '../../api.js';
import { toast } from '../../state.js';
import './watchlist.css';

const CAP = 4;

function Review({ entry }) {
  const [shown, setShown] = useState(false);
  if (!entry.review) return null;
  if (entry.spoiler && !shown) {
    return <p class="film-spoiler muted">Contains spoilers. <button type="button" class="btn-link" onClick={() => setShown(true)}>Show</button></p>;
  }
  return <p class="film-review">{entry.review}</p>;
}

/** "On your watchlist" with a small quiet way to take the film off it in Matinee (Letterboxd isn't touched).
 *  A film removed by hand keeps an Undo line (read from the film itself, so it survives the page reloading). */
function WatchlistStatus({ film }) {
  const u = film.user || {};
  const [busy, setBusy] = useState(false);
  const run = async (method, done, fail) => {
    setBusy(true);
    try { await call(method, { key: film.key }); if (done) toast(done); }
    catch (err) { toast(err.message || fail); }
    setBusy(false);
  };
  if (!u.watchlist && !u.watched && u.watchlistRemovedVia === 'manual') {
    return (
      <p class="film-watchlist-off muted">
        Removed from your watchlist in Matinee.{' '}
        <button type="button" class="btn-link" disabled={busy} onClick={() => run('restoreToWatchlist', null, "Couldn't put it back. Try again.")}>Undo</button>
      </p>
    );
  }
  if (!u.watchlist || u.watched) return null;
  return (
    <p class="film-watchlist-row">
      <span class="film-watchlist"><Icon name="clock" size={16} />On your watchlist</span>
      <button type="button" class="btn-link film-watchlist-remove" disabled={busy}
        onClick={() => run('removeFromWatchlist', "Removed from your watchlist in Matinee. It stays on Letterboxd until you remove it there.", "Couldn't remove it. Try again.")}>Remove from watchlist</button>
    </p>
  );
}

export default function History({ film }) {
  const entries = film.entries || [];
  const u = film.user || {};
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, CAP);
  const times = film.timesWatched || entries.length;
  return (
    <section class="film-section">
      <h2>Watch history</h2>
      {entries.length > 0 && (
        <p class="muted film-summary">
          Watched {times === 1 ? 'once' : `${times} times`}
          {film.firstWatched && <> · first {dateText(film.firstWatched)}</>}
        </p>
      )}
      <WatchlistStatus film={film} />
      {entries.length === 0 ? (
        <p class="muted">{u.watched ? 'You marked this one as watched, but there are no diary entries.' : "You haven't logged this one yet."}</p>
      ) : (
        <ol class="film-entries">
          {shown.map(e => (
            <li key={e.id} class="film-entry">
              <div class="film-entry-head">
                <span class="num">{dateText(e.date)}</span>
                <Stars rating={e.rating} size="14px" />
                {e.liked && <Icon name="heart" size={14} title="Liked" />}
                {e.rewatch && <span class="film-rewatch"><Icon name="rewatch" size={14} />Rewatch</span>}
              </div>
              <Review entry={e} />
            </li>
          ))}
        </ol>
      )}
      {entries.length > CAP && (
        <button type="button" class="btn-link film-showmore" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${entries.length} entries`}</button>
      )}
    </section>
  );
}
