// The Library's films (rebuilt 23 Nov from the approved wireframe): poster cards with the small closeness badge on the
// poster, "More like this" on the poster while you hover, a list with scores, "Films like …" in the film page's own way,
// and a plain message with next steps when nothing matches.
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import { applyQuery } from '../../../core/analysis/query.js';
import { call } from '../../api.js';
import { href } from '../../router.js';
import { useRestoredState } from '../../state.js';
import { Poster, Stars, Score, MatineePip, runtimeText, dateText } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { useFetchNow } from '../../components/fetchnow.js';
import { matchTitle, mostlyThin } from '../feel/model.js';
import { n } from '../../format.js';
import { sortOf, dirOf, likeFilm, clearAll, hasFeel, normalise, coreQuery } from '../proto/shared/query.js';
import { useFilmFeel, loadMatches, rank } from '../proto/shared/useUnified.js';
import { PAGE } from '../proto/shared/parts.jsx';
import { emptyHeading } from './model.js';

const STATUS_WORD = f => { const u = f.user || {}; return u.watched ? null : u.watchlist ? 'Watchlist' : null; };

// The reason a film came up goes with you into its page (the film page's "Why it came up").
function rememberWhy(key, heading, match) {
  try { sessionStorage.setItem('feelWhy:' + key, JSON.stringify({ heading, lines: match.allLines, tier: match.tier.label })); } catch { /* private mode: the film page just won't say why */ }
}

/** The small closeness badge on a poster, with By feel's hover text. */
export function Tier({ match, best }) {
  return (
    <span class={`lx-tier lx-tier-${match.tier.id}`} title={matchTitle({ score: match.score, why: match.allLines }, match.tier, best)}>
      {match.tier.id === 'very' && <Icon name="sparkle" size={11} />}{match.tier.label}
    </span>
  );
}

/** Feel words for the cards (Display → How it feels under posters), asked for in one call per page of cards. */
function useBriefs(keys, on) {
  const [briefs, setBriefs] = useState({});
  const sig = on ? keys.join('|') : '';
  useEffect(() => {
    if (!on) return undefined;
    const want = keys.filter(k => !(k in briefs));
    if (!want.length) return undefined;
    let live = true;
    call('getFeelBriefs', { keys: want }).then(
      r => live && setBriefs(b => { const nb = { ...b }; for (const k of want) nb[k] = (r && r[k]) || null; return nb; }),
      () => {}, // recorded by api.call; the cards just go without the line
    );
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return briefs;
}

/** One poster card. In Select mode the whole card is a checkbox. */
const Card = memo(function Card({ item, best, eager, pip, words, selecting, selected, onPick, onLike, heading }) {
  const { film: f, match } = item;
  const u = f.user || {};
  const meta = (
    <span class="lx-meta2">
      {f.year && <span class="num">{f.year}</span>}
      {u.rating != null ? <Stars rating={u.rating} size="11px" /> : STATUS_WORD(f) && <span>{STATUS_WORD(f)}</span>}
      {match && match.rough && <span class="lx-rough" title="Little has been written about this film, so how it feels is a rough guess">rough guess</span>}
    </span>
  );
  const body = (
    <>
      <Poster film={f} eager={eager}>
        {pip && <MatineePip score={f.score} />}
        {u.liked && <span class="badge-heart" title="Liked"><Icon name="heart" size={13} fill="currentColor" /><span class="sr-only">Liked</span></span>}
      </Poster>
      <span class="lx-t">{f.title}</span>
      {meta}
      {words && <span class="lx-words">{words}</span>}
    </>
  );
  if (selecting) {
    const label = `${f.title}${f.year ? ` (${f.year})` : ''}`;
    return (
      <div class={`lx-card lx-pick${selected ? ' is-on' : ''}`}>
        <div class="film-card lx-link" inert aria-hidden="true">{body}</div>
        <button type="button" class="lx-pick-hit" role="checkbox" aria-checked={String(selected)} aria-label={label} onClick={e => onPick(f.key, e.shiftKey)} />
        <span class="lx-check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
      </div>
    );
  }
  return (
    <div class={`lx-card${match ? ' has-tier' : ''}`}>
      <a class="film-card lx-link" href={href('film', f.key)} title={`${f.title}${f.year ? ` (${f.year})` : ''}`} onClick={match ? () => rememberWhy(f.key, heading, match) : undefined}>{body}</a>
      {/* Over the poster but outside the link, so the poster's hover card and this button never fight. */}
      <div class="lx-over" data-pop-over>
        {match && <Tier match={match} best={best} />}
        <button type="button" class="lx-more" onClick={() => onLike(f.key)} aria-label={`More films like ${f.title}`}>More like this</button>
      </div>
    </div>
  );
});

// ---------- list ----------
const COLS = [
  { id: 'title', label: 'Film', sort: 'title' }, { id: 'director', label: 'Director' }, { id: 'rating', label: 'You', sort: 'rating' },
  { id: 'lb', label: 'Letterboxd', sort: 'letterboxd', num: true }, { id: 'rt', label: 'RT critics', num: true }, { id: 'imdb', label: 'IMDb', num: true },
  { id: 'mc', label: 'Metacritic', num: true }, { id: 'score', label: 'Matinee', sort: 'score', num: true }, { id: 'runtime', label: 'Runtime', sort: 'runtime', num: true },
  { id: 'last', label: 'Last watched', sort: 'recent', num: true },
];
const dash = <span class="faint">–</span>;
const fmt = {
  lb: f => { const v = f.ratings?.letterboxd?.value; return v ? `★ ${v.toFixed(2)}` : dash; },
  rt: f => { const v = f.ratings?.rt?.critics; return v ? `${Math.round(v)}%` : dash; },
  imdb: f => { const v = f.ratings?.imdb?.value; return v ? v.toFixed(1) : dash; },
  mc: f => { const v = f.ratings?.metacritic?.critics; return v ? Math.round(v) : dash; },
};
const Row = memo(function Row({ item, ranked, best, hide, selecting, selected, onPick, heading }) {
  const { film: f, match } = item;
  const u = f.user || {};
  const d = (f.directors || []).map(p => p.name).join(', ');
  return (
    <tr class={selected ? 'is-on' : undefined} onClick={selecting ? e => onPick(f.key, e.shiftKey) : undefined}>
      <td class="lx-lt">
        <a href={href('film', f.key)} class="lx-lt-a" tabIndex={selecting ? -1 : undefined} onClick={selecting ? e => e.preventDefault() : match ? () => rememberWhy(f.key, heading, match) : undefined}>
          {selecting && <input type="checkbox" class="lx-rowcheck" checked={selected} aria-label={f.title} onClick={e => { e.stopPropagation(); onPick(f.key, e.shiftKey); }} onChange={() => {}} />}
          <span class="lx-thumb"><Poster film={f} /></span>
          <span class="lx-lt-t">{f.title}</span>{f.year && <span class="faint num">{f.year}</span>}
        </a>
      </td>
      {ranked && <td>{match ? <Tier match={match} best={best} /> : null}</td>}
      <td class="lx-ld" title={d}>{d || dash}</td>
      {!hide.has('rating') && <td>{u.rating != null ? <Stars rating={u.rating} size="12px" /> : <span class="muted">{u.watched ? 'Watched' : u.watchlist ? 'Watchlist' : '–'}</span>}</td>}
      <td class="num-col num">{fmt.lb(f)}</td>
      <td class="num-col num">{fmt.rt(f)}</td>
      <td class="num-col num">{fmt.imdb(f)}</td>
      <td class="num-col num">{fmt.mc(f)}</td>
      <td class="num-col"><Score score={f.score} /></td>
      <td class="num-col num">{runtimeText(f.runtime) || dash}</td>
      {!hide.has('last') && <td class="num-col num">{f.lastWatched ? dateText(f.lastWatched, { day: 'numeric', month: 'short', year: 'numeric' }) : dash}</td>}
    </tr>
  );
});
function List({ u, items, sel, heading }) {
  const { q, ranked, best } = u;
  const sort = sortOf(q), dir = dirOf(q);
  const hide = new Set(q.status === 'watchlist' ? ['rating', 'last'] : []);
  const cols = (ranked ? [COLS[0], { id: 'match', label: 'How close', sort: 'match' }, ...COLS.slice(1)] : COLS).filter(c => !hide.has(c.id));
  const onSort = s => (s === 'match' ? u.set({ sort: 'match', dir: null }) : u.set(s === sort ? { sort: s, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: s, dir: null }));
  return (
    <div class="lx-table-wrap">
      <table class="lx-table">
        <thead><tr>{cols.map(c => {
          const on = c.sort && c.sort === sort;
          return (
            <th key={c.id} class={c.num ? 'num-col' : ''} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
              {c.sort ? <button type="button" class="lx-th" onClick={() => onSort(c.sort)}>{c.label}{on && <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}</button> : c.label}
            </th>
          );
        })}</tr></thead>
        <tbody>{items.map(it => <Row key={it.film.key} item={it} ranked={ranked} best={best} hide={hide} selecting={sel.selecting} selected={sel.selecting && sel.sel.has(it.film.key)} onPick={sel.pick} heading={heading} />)}</tbody>
      </table>
    </div>
  );
}

// ---------- the wall ----------
export function Films({ u, view, sel, heading }) {
  const { results, q } = u;
  const [shown, setShown] = useRestoredState('library.shown', PAGE);
  const sig = JSON.stringify([q, view.mode]);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setShown(PAGE); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const sentinel = useRef();
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= results.length) return undefined;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(x => x + PAGE); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results, view.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const wall = useRef();
  useFetchNow(wall, [results, shown, view.mode, sel.selecting]);
  const slice = results.slice(0, shown);
  const wordsOn = view.words && view.mode !== 'list';
  const briefs = useBriefs(slice.map(r => r.film.key), wordsOn);
  const onLike = useCallback(key => {
    u.setQ(x => likeFilm(x, key));
    const m = document.querySelector('main'); if (m) m.scrollTo({ top: 0 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={wall} class="lx-films" data-stale={String(!!u.stale)}>
      {view.mode === 'list'
        ? <List u={u} items={slice} sel={sel} heading={heading} />
        : (
          <div class="lx-grid" style={{ '--card': view.size + 'px' }}>
            {slice.map((it, i) => {
              const b = wordsOn ? briefs[it.film.key] : null;
              return <Card key={it.film.key} item={it} best={u.best} eager={i < 12} pip={view.pip} words={b && b.words && b.words.length ? b.words.map((w, j) => (j ? w.toLowerCase() : w)).join(', ') : null}
                selecting={sel.selecting} selected={sel.sel.has(it.film.key)} onPick={sel.pick} onLike={onLike} heading={heading} />;
            })}
          </div>
        )}
      {shown < results.length && <div ref={sentinel} class="lx-sentinel" aria-hidden="true" />}
    </div>
  );
}

export function Skeleton() {
  return <div class="lx-grid lx-skel" aria-busy="true" aria-label="Looking for films">{Array.from({ length: 12 }, (_, i) => <div key={i} class="lx-skel-card"><div class="lx-skel-p" /><div class="lx-skel-l" /></div>)}</div>;
}

// ---------- films like a film ----------
/** "Films like Paris, Texas": the film page's Similar in feel, opened out (no lighter/heavier, just how close). */
export function LikeBand({ u }) {
  const film = u.likeFilm;
  const feel = useFilmFeel(film && film.key);
  if (!film) return null;
  const head = feel && feel !== 'error' && feel.summary && feel.summary.headline;
  return (
    <section class="lx-like" aria-label={`Films like ${film.title}`}>
      <a class="lx-like-p" href={href('film', film.key)} aria-label={`Open ${film.title}`}><Poster film={film} eager /></a>
      <div class="lx-like-b">
        <h2 class="lx-like-h">Films like {film.title}{film.year && <span class="faint num"> {film.year}</span>}</h2>
        {head && <p class="lx-like-s">{head}</p>}
        {feel === null && <p class="lx-like-s muted">Little has been written about this film yet, so its matches lean on genres and people.</p>}
      </div>
      <button type="button" class="btn btn-ghost btn-small lx-like-x" onClick={() => u.set({ like: null, likeShift: null })}><Icon name="close" size={14} />Stop</button>
    </section>
  );
}

/** One quiet line when most of the closest films lean on article tags and keywords (By feel's sample of five). */
export function ThinNote({ u }) {
  const keys = u.ranked ? u.results.slice(0, 5).map(r => r.film.key) : [];
  const sig = keys.join('|');
  const [thin, setThin] = useState(false);
  useEffect(() => {
    if (!keys.length) { setThin(false); return undefined; }
    let live = true;
    Promise.all(keys.map(k => call('getFeel', { key: k }).catch(() => null /* recorded by api.call; that film just isn't sampled */)))
      .then(got => live && setThin(mostlyThin(got.map(g => g && g.summary))));
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!thin || !keys.length) return null;
  return <p class="lx-note faint">Most of these matches lean on article tags and keywords, not viewer reviews. They'll get better as more reviews come in.</p>;
}

// ---------- nothing matches ----------
/** How many films a different question would bring back (for the empty state's ways back). null while counting or if it failed. */
function useCountFor(u, queries) {
  const sig = JSON.stringify(queries.map(x => x && normalise(x)));
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let live = true;
    setCounts({});
    const films = u.lib.films;
    queries.forEach((q2, i) => {
      if (!q2) return;
      const base = applyQuery(films, coreQuery(q2));
      if (!hasFeel(q2)) { setCounts(c => ({ ...c, [i]: base.length })); return; }
      loadMatches(q2).then(m => live && setCounts(c => ({ ...c, [i]: rank(base, q2, m).results.length })),
        () => {}); // recorded by api.call; that way back just goes without its number
    });
    return () => { live = false; };
  }, [sig, u.lib]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

/** A plain message where the films would be, with its next steps (no boxed card). */
export function Nothing({ u, pills }) {
  const { lib, q } = u;
  const ways = pills.slice(0, 6).map(p => normalise(p.patch(q)));
  const everywhere = q.status !== 'all' ? normalise({ ...q, status: 'all' }) : null;
  const counts = useCountFor(u, [...ways, everywhere]);
  const typed = q.text.trim();
  if (!lib.films.length) {
    return (
      <div class="lx-nothing">
        <h2 class="lx-nothing-h">Your library is empty</h2>
        <p>Bring in your Letterboxd export and every film you've watched or want to watch shows up here.</p>
        <p class="lx-nothing-acts"><a class="btn btn-primary" href="#/welcome">Bring in your Letterboxd films</a></p>
      </div>
    );
  }
  if (q.like && !pills.length && !typed) {
    return (
      <div class="lx-nothing">
        <h2 class="lx-nothing-h">Nothing close to {u.likeFilm ? u.likeFilm.title : 'this film'}{q.status !== 'all' ? ' here' : ''}</h2>
        <p>{q.status !== 'all' ? 'Nothing in this part of your library feels close enough.' : 'More needs to be written about this film before Matinee can find films like it.'}</p>
        <p class="lx-nothing-acts">
          {everywhere && counts[ways.length] !== 0 && <button type="button" class="btn btn-primary" onClick={() => u.set({ status: 'all' })}>Look in all your films{counts[ways.length] != null && ` · ${n(counts[ways.length])}`}</button>}
          <button type="button" class="btn" onClick={() => u.set({ like: null, likeShift: null })}>Stop comparing</button>
        </p>
      </div>
    );
  }
  const n0 = pills.length;
  return (
    <div class="lx-nothing">
      <h2 class="lx-nothing-h">{typed && !n0 ? `No titles or people match “${typed}”` : emptyHeading(q.status, n0 + (typed ? 1 : 0))}</h2>
      {n0 > 0 && <p>Take one off to see films again:</p>}
      {n0 > 0 && (
        <div class="chips lx-nothing-ways">
          {pills.slice(0, 6).map((p, i) => (
            <button type="button" key={p.key} class="chip lx-way" title={`Take off ${p.label}`} onClick={() => u.setQ(p.patch)}>
              {p.out && <Icon name="ban" size={13} />}<span class="lx-chip-l">{p.label}</span>{counts[i] != null && <span class="lx-chip-n num">{n(counts[i])} {counts[i] === 1 ? 'film' : 'films'}</span>}<Icon name="close" size={12} class="lx-x" />
            </button>
          ))}
        </div>
      )}
      {typed && <p>Check the spelling, or look for films that feel like those words.</p>}
      <p class="lx-nothing-acts">
        {everywhere && counts[ways.length] !== 0 && <button type="button" class="btn btn-primary" onClick={() => u.set({ status: 'all' })}>Look in all your films{counts[ways.length] != null && ` · ${n(counts[ways.length])}`}</button>}
        {typed && <button type="button" class={`btn${everywhere ? '' : ' btn-primary'}`} onClick={() => u.setQ(x => ({ ...x, feelText: typed, text: '' }))}>Films that feel “{typed}”</button>}
        <button type="button" class="btn" onClick={() => u.setQ(clearAll(q))}>Clear all</button>
      </p>
    </div>
  );
}
