// Dialog for a Discover film (these aren't in the library, so there's no film page to open).
import { Dialog } from '../../components/ui.jsx';
import { Poster, runtimeText, compact } from '../../components/film.jsx';
import { openExternal } from '../../api.js';
import { rowScores } from '../../components/scores.js';

export default function Details({ item, onClose }) {
  const l = item.links || {};
  const scores = rowScores(item.ratings, item.imdb);
  const facts = [
    item.year, item.kind === 'tv' ? 'TV' : null, runtimeText(item.runtime), item.genres?.slice(0, 3).map(g => g.replace(/ film$/, '')).join(', '),
  ].filter(Boolean).join(' · ');
  const footer = <>
    {l.imdb && <button type="button" class="btn" onClick={() => openExternal(l.imdb)}>IMDb</button>}
    {l.wikipedia && <button type="button" class="btn" onClick={() => openExternal(l.wikipedia)}>Wikipedia</button>}
    {l.letterboxd && <button type="button" class="btn btn-primary" onClick={() => openExternal(l.letterboxd)}>Open on Letterboxd</button>}
  </>;
  return (
    <Dialog title={item.title} onClose={onClose} footer={footer}>
      <div class="disc-dialog">
        <div class="disc-dialog-poster"><Poster film={item} eager /></div>
        <div class="disc-dialog-body">
          {facts && <p class="muted">{facts}</p>}
          {item.directors?.length > 0 && <p>Directed by {item.directors.join(', ')}</p>}
          {scores.length > 0 && (
            <p class="num disc-scores">
              {scores.map(s => <span key={s.source} title={s.title}>{s.text}</span>)}
              {item.imdb?.votes ? <span class="muted"> {compact(item.imdb.votes)} IMDb votes</span> : null}
            </p>
          )}
          {item.reasons?.length > 0 && (
            <div>
              <h3 class="eyebrow">Why this one</h3>
              <ul class="disc-reasons">{item.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
