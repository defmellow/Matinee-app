// Film page: everything about one film. Data: getFilm({ key }).
import './film.css';
import { useCall } from '../state.js';
import { touchesKey } from '../libraryPatch.js';
import { back, href } from '../router.js';
import { Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import Icon from '../components/Icon.jsx';
import Hero from './film/Hero.jsx';
import History from './film/History.jsx';
import Tags from './film/Tags.jsx';
import About from './film/About.jsx';
import Awards from './film/Awards.jsx';
import Series from './film/Series.jsx';
import Lists from './film/Lists.jsx';
import { LISTS_ARCHIVED } from '../archive.js';
import Feel from './film/Feel.jsx';
import FilmDebug from '../debug/FilmDebug.jsx';
import { useFilmFetch } from './film/useFilmFetch.js';

export default function Film({ param }) {
  const { data: film, error, loading } = useCall('getFilm', { key: param }, [param], { refreshOn: { event: 'library', when: p => touchesKey(p, param) } });
  const fetchState = useFilmFetch(param, film && film.fetchStatus);
  const backBtn = <button type="button" class="btn btn-ghost film-back" onClick={back}><Icon name="back" />Back</button>;

  if (!film && loading) return <div class="screen">{backBtn}<Loading /></div>;
  if (!film) {
    return (
      <div class="screen">
        {backBtn}
        <EmptyState title={error?.code === 'not-found' || !error ? "That film isn't in your library any more." : "Couldn't open that film."}
          action={<a class="btn btn-primary" href={href('library')}>Back to Library</a>}>
          {error && error.code !== 'not-found' ? error.message : 'It may have been removed. Your other films are still in the Library.'}
        </EmptyState>
      </div>
    );
  }
  return (
    <div class="film-page">
      <div class="film-top">{backBtn}</div>
      <Hero film={film} fetch={fetchState} />
      <div class="screen film-body">
        <div class="film-cols">
          <div class="film-col">
            <Feel film={film} />
            <About film={film} />
          </div>
          <div class="film-col">
            <Awards awards={film.awards} />
            <History film={film} />
            {!LISTS_ARCHIVED && <Lists key={'l' + film.key} film={film} />}
            <Tags key={film.key} film={film} />
            <Series filmKey={film.key} />
          </div>
        </div>
        <FilmDebug film={film} stamp={(fetchState.status?.outcomes || []).map(o => o.provider + o.status).join()} />
      </div>
    </div>
  );
}
