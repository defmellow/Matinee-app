// Small building blocks for the Insights screen.
import { useEffect, useRef, useState } from 'preact/hooks';
import { h, Fragment } from 'preact';
import { colourWords } from '../../feel-colours.js'; // TEMP feel colours
import { wordFamilyOf } from '../../../core/analysis/feel-families.js'; // TEMP feel colours
import { Poster, Stars } from '../../components/film.jsx';
import { externalScores } from '../../components/scores.js';
import { href } from '../../router.js';
import { linkHref } from '../../components/chip.js';
import { n as num, plural } from '../../format.js';

/** A card: a titled panel. `wide` spans the whole grid, `hint` is one muted line under the title, `aside` sits right of the title. */
export function Section({ title, hint, children, wide, aside, class: cls = '' }) {
  return (
    <section class={'ins-section ins-card' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '')}>
      <header class="ins-card-head">
        <div>
          <h2>{title}</h2>
          {hint && <p class="muted ins-hint">{hint}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

export const Thin = ({ children = 'Rate a few more films to see this.' }) => <p class="faint ins-thin">{children}</p>;

/** A quiet text link (the film page's `film-link`), or the plain children when there is nowhere to go. */
export const TextLink = ({ to, children, class: cls = '' }) => (to ? <a class={'film-link' + (cls ? ' ' + cls : '')} href={to}>{children}</a> : children);

/** A sentence given as text parts (core/analysis/text-parts.js): plain parts as text, linked parts as quiet links. */
export function Words({ parts }) {
  return (parts || []).map((p, i) => (typeof p === 'string'
    ? <Fragment key={i}>{colourWords(p, h)}</Fragment>
    : <TextLink key={i} to={linkHref(p.to)}>{p.text}</TextLink>));
}

/**
 * A short note in plain sentences, the way you'd tell a friend: used where a row of number tiles would otherwise go.
 * `children` is the opening paragraph (wrap the numbers in <b>); `lines` are further sentences, one per line: a string,
 * text parts (an array, see Words) or anything renderable.
 */
export function Note({ children, lines = [], title = null }) {
  return (
    <section class="ins-note-card wide">
      {title && <h2>{title}</h2>}
      <p class="ins-lede">{children}</p>
      {lines.length > 0 && <ul class="ins-lines">{lines.map((g, i) => <li key={i}>{typeof g === 'string' ? colourWords(g, h) : Array.isArray(g) ? <Words parts={g} /> : g}</li>)}</ul>}
    </section>
  );
}

/** A few posters laid on top of each other, each turned a little, like prints left on a table. Not links: the stack sits inside one. */
export function Stack({ keys = [], lib, max = 3 }) {
  const films = keys.map(k => lib.get(k)).filter(Boolean).slice(0, max);
  if (!films.length) return null;
  return (
    <span class={'ins-stack n' + films.length} aria-hidden="true">
      {films.map((f, i) => <span key={f.key} class="ins-stack-p" style={{ '--i': i }}><Poster film={f} /></span>)}
    </span>
  );
}

/** Up to `max` small posters of films (keys looked up in `lib`), each a link. Missing films are skipped. */
export function MiniPosters({ keys = [], lib, max = 4 }) {
  const films = keys.map(k => lib.get(k)).filter(Boolean).slice(0, max);
  if (!films.length) return null;
  return (
    <span class="ins-minis">
      {films.map(f => <a key={f.key} href={href('film', f.key)} title={`${f.title}${f.year ? ` (${f.year})` : ''}`}><Poster film={f} /></a>)}
    </span>
  );
}

/**
 * rows: [{ name, id?, count, averageRating, keys? }]. People rows (`linkPeople`) link to their page, by id when known,
 * else by name, opening on `role`; `link(row)` gives any other row's href (a genre, country…).
 * `posters` (with `lib`) adds a few of each row's films on the right.
 */
export function RankList({ rows, linkPeople = false, role = null, link = null, lib = null, posters = false, unit = ['film', 'films'] }) {
  const to = r => (linkPeople ? ((r.id || r.name) ? href('person', r.id || r.name, role ? { role } : undefined) : null) : link ? link(r) : null);
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <ol class={'ins-rank' + (posters ? ' with-posters' : '')}>
      {rows.map((r, i) => (
        <li key={r.id || r.name} style={{ '--i': i }} title={`${r.name}: ${plural(r.count, unit[0], unit[1])}${r.averageRating != null ? `, ${r.averageRating.toFixed(2)}★ on average` : ''}`}>
          <span class="ins-rank-n num faint" aria-hidden="true">{i + 1}</span>
          <span class="ins-rank-name">{to(r) ? <a href={to(r)}>{r.name}</a> : r.name}</span>
          {posters && lib && <MiniPosters keys={r.keys} lib={lib} />}
          <span class="ins-rank-avg">{r.averageRating != null && <Stars rating={Math.round(r.averageRating * 2)} size="12px" />}</span>
          <span class="ins-rank-count num">{r.count}</span>
          <span class="ins-rank-bar" aria-hidden="true"><i style={{ width: (r.count / max) * 100 + '%' }} /></span>
        </li>
      ))}
    </ol>
  );
}

/**
 * "You rate these higher / lower than usual": rows [{ name|label, count, rated?, averageRating }], a bar either side of
 * their own average. `link` gives each row's href (or nothing).
 */
export function LeanList({ rows, mean, link = null, lib = null }) {
  const scale = Math.max(0.3, ...rows.map(r => Math.abs(r.averageRating - mean)));
  return (
    <ul class="ins-lean">
      {rows.map((r, i) => {
        const name = r.label || r.name, d = r.averageRating - mean, up = d >= 0;
        const to = link && link(r);
        return (
          <li key={r.id || name} style={{ '--i': i }} title={`${name}: ${r.averageRating.toFixed(2)}★ across ${plural(r.rated ?? r.count, 'film', 'films')} (your average is ${mean.toFixed(2)}★)`}>
            <span class="ins-lean-name">{to ? <a class="chip" href={to} data-fam={wordFamilyOf(r.label || r.id) || undefined}>{name}</a> : name}</span>
            {lib && <MiniPosters keys={r.keys} lib={lib} max={3} />}
            <span class="ins-lean-track" aria-hidden="true"><i class={up ? 'up' : 'down'} style={{ width: Math.min(50, (Math.abs(d) / scale) * 50) + '%', [up ? 'left' : 'right']: '50%' }} /></span>
            <span class="ins-lean-avg num">{r.averageRating.toFixed(1)}<span class="ins-star">★</span></span>
            <span class="ins-lean-count faint num">{plural(r.rated ?? r.count, 'film', 'films')}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** How many columns of at least `min` px fit the element's width (with `gap` between them); 0 until measured. */
function useColumns(min, gap) {
  const ref = useRef(null);
  const [cols, setCols] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => setCols(Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))));
    fit();
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);
  return [ref, cols];
}

/**
 * Film posters with a line under each, in full rows only: as many as fit `rows` rows of the card, never a ragged last row.
 * items: [{ key, label?, note? }] (keys looked up in `lib`).
 */
export function PosterRow({ items, lib, label, rows = 1 }) {
  const [ref, cols] = useColumns(112, 12);
  const all = items.map(x => ({ ...x, f: lib.get(x.key) })).filter(x => x.f);
  if (!all.length) return <Thin>Nothing here yet.</Thin>;
  const shown = cols ? all.slice(0, cols * rows) : all.slice(0, 6);
  return (
    <ul class="ins-posters" aria-label={label} ref={ref} style={{ '--cols': cols || 6 }}>
      {shown.map((x, i) => (
        <li key={x.key + (x.label || '')} style={{ '--i': i }}>
          <a href={href('film', x.f.key)} title={`${x.f.title}${x.f.year ? ` (${x.f.year})` : ''}`}>
            {x.label && <span class="ins-poster-label">{x.label}</span>}
            <Poster film={x.f} />
            <span class="ins-poster-title">{x.f.title}</span>
            {x.note && <span class="ins-poster-note faint num">{x.note}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}

const lb = f => externalScores(f.ratings).find(x => x.source === 'letterboxd');

export function TakeList({ items, lib, ready = true }) {
  if (!items.length) return <Thin>Nothing here yet. This fills in once Matinee has scores for films you've rated.</Thin>;
  if (!ready) return <Thin>Loading…</Thin>;
  const rows = items.filter(t => lib.get(t.key));
  if (!rows.length) return <Thin>Nothing here yet. This fills in once Matinee has scores for films you've rated.</Thin>;
  return (
    <ul class="ins-takes">
      {rows.map((t, i) => {
        const f = lib.get(t.key);
        const gap = Math.round(t.diff);
        return (
          <li key={t.key} style={{ '--i': i }}>
            <a class="ins-take-poster" href={href('film', f.key)} tabIndex={-1} aria-hidden="true"><Poster film={f} /></a>
            <div class="ins-take-body">
              <a class="ins-take-title" href={href('film', f.key)}>{f.title}</a>
              <span class="ins-take-nums muted">You <Stars rating={f.user && f.user.rating} size="12px" /> · Matinee <span class="num" title="Matinee score, out of 100">{f.score}</span>{lb(f) && <> · <span class="num" title={lb(f).title}>{lb(f).text}</span></>}</span>
            </div>
            <span class={'ins-take-gap num ' + (gap > 0 ? 'up' : 'down')} title="Points apart, out of 100">{gap > 0 ? '+' : '−'}{Math.abs(gap)}</span>
          </li>
        );
      })}
    </ul>
  );
}
