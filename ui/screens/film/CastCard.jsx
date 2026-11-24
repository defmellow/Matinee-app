// "Cast and crew" card beside the hero: key crew, the first six cast, and a toggle to show everyone.
import { useEffect, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { href } from '../../router.js';
import Headshot from '../../components/Headshot.jsx';

const KEY_ROWS = [['director', 'Director'], ['composer', 'Music'], ['cinematography', 'Cinematography']];
const ALL_ROWS = [['director', 'Director'], ['writer', 'Writing'], ['cinematography', 'Cinematography'], ['composer', 'Music'], ['editor', 'Editing']];
const MAIN = 6;

export function hasCastCard(people = {}) {
  return !!(people.cast?.length || ALL_ROWS.some(([k]) => people[k]?.length));
}

const JOB = { director: 'Director', writer: 'Writer', cinematography: 'Cinematographer', composer: 'Composer', editor: 'Editor', producer: 'Producer', cast: 'Cast' };
// data-photo and data-as feed the person hover card (components/PersonPop.jsx): the headshot and the person's job on this film
const Name = ({ p, role }) => (
  <a class="film-link" href={href('person', p.id || p.name, { role })} data-photo={p.photo || undefined} data-as={role === 'cast' && p.role ? `as ${p.role}` : JOB[role]}>{p.name}</a>
);

function CastList({ cast }) {
  return (
    <ul class="film-cast">
      {cast.map((p, i) => (
        <li key={(p.id || p.name) + i}>
          <span class="film-cast-who"><Headshot photo={p.photo} name={p.name} /><Name p={p} role="cast" /></span>{!p.role && <span class="faint" aria-hidden="true" />}
          {p.role && <span class="faint" title={p.role}>{p.role.replace(/ \/ /g, " · ")}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Portraits for the people shown who have none in the film's own credits (a film TMDB does not list takes its people from
 * Letterboxd, which has no portraits). Asked once per set of names; the card shows initials until an answer lands.
 */
function usePortraits(people, shown) {
  const missing = shown.filter(p => p && !p.photo && (p.id || p.name)).slice(0, 12).map(p => ({ id: p.id || null, name: p.name }));
  const sig = missing.map(p => p.id || p.name).join('|');
  const [found, setFound] = useState({});
  useEffect(() => {
    setFound({});
    if (!sig) return undefined;
    let live = true;
    call('getPeoplePhotos', { people: missing }).then(r => { if (live) setFound(r || {}); }, () => {}); // a failure is recorded by api.call; the initials stay
    return () => { live = false; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const fill = p => (p.photo || !found[p.id || p.name] ? p : { ...p, photo: found[p.id || p.name] });
  return Object.fromEntries(Object.entries(people).map(([k, list]) => [k, Array.isArray(list) ? list.map(fill) : list]));
}

export default function CastCard({ people: given = {} }) {
  const [all, setAll] = useState(false);
  const head = [...ALL_ROWS.flatMap(([k]) => given[k] || []), ...(given.cast || []).slice(0, MAIN)];
  const people = usePortraits(given, head);
  if (!hasCastCard(people)) return null;
  const rows = (all ? ALL_ROWS : KEY_ROWS).filter(([k]) => people[k]?.length);
  const cast = people.cast || [];
  const canExpand = all || cast.length > MAIN || ALL_ROWS.some(([k]) => !KEY_ROWS.some(r => r[0] === k) && people[k]?.length);
  return (
    <aside data-pop-side class={'film-castcard' + (all ? ' open' : '')} aria-label="Cast and crew">
      <h2 class="film-card-title">Cast and crew</h2>
      {rows.length > 0 && (
        <dl class="film-crew">
          {rows.map(([k, label]) => (
            <div key={k} class="film-crew-row">
              <dt class="eyebrow">{people[k].length > 1 && k === 'director' ? 'Directors' : label}</dt>
              <dd class="film-crew-who">{people[k].map((p, i) => <span key={(p.id || p.name) + i} class="film-cast-who"><Headshot photo={p.photo} name={p.name} /><Name p={p} role={k} /></span>)}</dd>
            </div>
          ))}
        </dl>
      )}
      {cast.length > 0 && (
        <>
          <h3 class="film-sub">{all ? 'Cast' : 'Main cast'}</h3>
          <CastList cast={all ? cast : cast.slice(0, MAIN)} />
        </>
      )}
      {canExpand && (
        <button type="button" class="btn-link film-showmore" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Full cast and crew'}</button>
      )}
    </aside>
  );
}
