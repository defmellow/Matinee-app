// App shell: left rail navigation, the current screen, a quiet progress indicator, toasts.
import { useEffect, useRef, useErrorBoundary } from 'preact/hooks';
import LoadBar from './components/LoadBar.jsx';
import FetchNotice from './components/FetchNotice.jsx';
import { useRoute, useHistoryState, back, forward, go, href, installScrollRestore } from './router.js';
import { useCore, useToasts, useCoreFailed, retryCore } from './state.js';
import { cacheTheme, cacheMotion, routeTitle } from './shell.js';
import { useDebugMap, useDebugDiscover } from './debug/switches.js';
import { useDebug } from './debug/useDebug.js';
import Icon from './components/Icon.jsx';
import { Loading } from './components/ui.jsx';
import Welcome from './screens/Welcome.jsx';
import NewLibrary from './screens/library-new/Screen.jsx'; // the Library: Library and By feel in one, rebuilt from the approved wireframe (23 Nov)
import Lists from './screens/Lists.jsx';
import Film from './screens/Film.jsx';
import Person from './screens/Person.jsx';
import Diary from './screens/Diary.jsx';
import MapScreen from './screens/Map.jsx';
import Tonight from './screens/Tonight.jsx';
import Insights from './screens/Insights.jsx';
import Settings from './screens/Settings.jsx';
import Discover from './screens/Discover.jsx';
import Year from './screens/Year.jsx';
import Upcoming from './screens/Upcoming.jsx';
import Proto from './screens/proto/index.jsx'; // PROTOTYPES ONLY
import Tooltip from './components/Tooltip.jsx';
import PosterPop from './components/PosterPop.jsx';
import PersonPop from './components/PersonPop.jsx';
import { UpdatePill } from './screens/settings/Updates.jsx';
import WhatsNew from './whatsnew/WhatsNew.jsx';
import ProblemWatcher from './debug/ProblemWatcher.jsx';
import { SettingsDot, DebugBadge } from './debug/NavBits.jsx';
import { reportProblem } from './debug/report.js';
import { describeError } from './debug/model.js';
import { installFeelColoursKey, setFeelColours } from './feel-colours.js'; // feel colours: F8 and the Settings switch
import logoUrl from './assets/logo.png'; // Matinee's one logo, the same in every theme (drawn by build/make-icon.mjs)
import { LISTS_ARCHIVED, TONIGHT_ARCHIVED } from './archive.js';

// Tonight and Lists are archived (ui/archive.js, 23 Nov); their screens still open by link. The Map sits under the
// Library since it was finished.
const NAV = [
  ...(TONIGHT_ARCHIVED ? [] : [{ name: 'tonight', label: 'Tonight', icon: 'tonight' }]),
  { name: 'library', label: 'Library', icon: 'library' },
  { name: 'map', label: 'Map', icon: 'map' },
  ...(LISTS_ARCHIVED ? [] : [{ name: 'lists', label: 'Lists', icon: 'list' }]),
  { name: 'discover', label: 'Discover', icon: 'sparkle' },
  { name: 'upcoming', label: 'Upcoming', icon: 'upcoming' },
  { name: 'diary', label: 'Diary', icon: 'diary' },
  { name: 'insights', label: 'Insights', icon: 'insights' },
];
// The Library is design E. Library links (#/library/<filter>) are applied once and the address tidied; By feel's links
// (#/feel/<param>, from film-page chips, Insights, Tonight, the Map) open the Library with that feeling (#/library/feel:<param>).
function Library({ param, core }) {
  return <NewLibrary core={core} link={param || null} onLinkUsed={() => history.replaceState(null, '', href('library'))} />;
}
function FeelToLibrary({ param }) {
  useEffect(() => { location.replace(href('library', param ? 'feel:' + param : undefined)); }, [param]);
  return null;
}
const SCREENS = { library: Library, lists: Lists, film: Film, person: Person, diary: Diary, map: MapScreen, tonight: Tonight, insights: Insights, settings: Settings, welcome: Welcome, discover: Discover, year: Year, feel: FeelToLibrary, upcoming: Upcoming, proto: Proto };

// A crash in one screen shouldn't blank the whole window: say so, record it, and offer a way out. Re-mounted per route, so moving on clears it.
export function Guard({ children, name = 'This part of the page' }) {
  const [error, reset] = useErrorBoundary(e => {
    console.warn('Screen crashed:', e);
    reportProblem({ area: 'Matinee', message: `${name} couldn't load.`, detail: describeError(e), level: 'error' });
  });
  if (!error) return children;
  return (
    <div class="empty crash" role="alert">
      <h2>This part of the page couldn't load</h2>
      <p>Your library is safe. You can try again or go back to the Library.</p>
      <div class="crash-actions">
        <a class="btn btn-primary" href={href('library')} style={{ textDecoration: 'none' }}>Back to Library</a>
        <button type="button" class="btn" onClick={reset}>Try again</button>
      </div>
      <DebugText error={error} />
    </div>
  );
}
function DebugText({ error }) {
  const on = useDebug();
  return on ? <pre class="debug-info debug-mono" style={{ whiteSpace: 'pre-wrap' }}>{describeError(error)}</pre> : null;
}

function JobPill({ job }) {
  if (!job) return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : null;
  const label = `${job.label}${pct != null ? ` — ${pct}%` : ''}`;
  return (
    <a class="progress-pill" href={href('settings')} title={label} aria-label={label} role="status" style={{ flexDirection: 'column', alignItems: 'stretch', textDecoration: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><div class="spinner" /></div>
      {pct != null && <div class="bar" style={{ width: '100%' }}><i style={{ width: pct + '%' }} /></div>}
    </a>
  );
}

export default function App() {
  const route = useRoute();
  const core = useCore();
  const toastMsg = useToasts();
  const showMap = useDebugMap();
  const showDiscover = useDebugDiscover();
  const failed = useCoreFailed();
  const hist = useHistoryState();
  const nav = NAV.filter(n => (n.name !== 'map' || showMap) && (n.name !== 'discover' || showDiscover));

  useEffect(installFeelColoursKey, []); // TEMP feel colours: F8 switches them on and off
  useEffect(() => { // remember scroll per route so Back lands where you were
    const el = document.getElementById('main');
    return el ? installScrollRestore(el) : undefined;
  }, [!!core && route.name !== 'welcome']);

  useEffect(() => { // first run: send people to the welcome flow
    if (core && !core.ready && route.name !== 'welcome' && route.name !== 'settings') go('welcome');
  }, [core && core.ready, route.name]);

  useEffect(() => { // theme preference: 'system' | 'dark' (Blush) | 'light' (Blush light) | 'neutral' (Dark) | 'neutral-light' (Light)
    if (!core) return; // nothing known yet: keep the remembered theme main.jsx applied
    const t = (core.settings && core.settings.theme) || 'system';
    if (['light', 'dark', 'neutral', 'neutral-light'].includes(t)) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { cacheTheme(localStorage, t); } catch { /* no storage */ }
    try { window.matinee?.setTheme?.(t); } catch { /* older shell */ }
  }, [core && core.settings && core.settings.theme, !!core]);

  useEffect(() => { // "Less motion" (Settings → Appearance): CSS and lessMotion() read data-motion
    if (!core) return;
    const m = core.settings && core.settings.motion === 'less' ? 'less' : 'system';
    if (m === 'less') document.documentElement.dataset.motion = 'less'; else delete document.documentElement.dataset.motion;
    try { cacheMotion(localStorage, m); } catch { /* no storage */ }
  }, [core && core.settings && core.settings.motion, !!core]);

  useEffect(() => { // feel colours (Settings → Appearance): on unless switched off
    if (core && core.settings) setFeelColours(core.settings.feelColours !== false);
  }, [core && core.settings && core.settings.feelColours, !!core]);

  const first = useRef(true);
  useEffect(() => { // new screen: tell the window, and move focus there so keyboard and screen reader users aren't left in the rail
    document.title = routeTitle(route.name);
    if (first.current) { first.current = false; return; }
    const main = document.getElementById('main');
    const target = (main && main.querySelector('h1')) || main;
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [route.name, route.param]);
  const skip = () => { const m = document.getElementById('main'); if (m) { m.tabIndex = -1; m.focus(); } };

  if (!core && failed) {
    return (
      <div class="empty crash" role="alert">
        <h2>Matinee couldn't start</h2>
        <p>Something stopped it from opening your library. Your films are safe.</p>
        <div class="crash-actions"><button type="button" class="btn btn-primary" onClick={retryCore}>Try again</button></div>
      </div>
    );
  }
  if (!core) return <Loading label="Opening Matinee…" />;
  const Screen = (route.name === 'map' && !showMap) ? Library : (SCREENS[route.name] || Library);
  if (route.name === 'welcome') {
    // Onboarding shows on its own whenever there is no library; with one, only when asked for (#/welcome/again from Settings →
    // Letterboxd), and nothing here sends it away.
    const welcome = <Guard key={'welcome:' + (route.param || '')}><Welcome core={core} param={route.param} /></Guard>;
    return window.matinee?.titleBar ? <div class="welcome-frame"><div class="titlebar" aria-hidden="true" />{welcome}</div> : welcome;
  }

  return (
    <div class={window.matinee?.titleBar ? 'shell has-titlebar' : 'shell'}>
      {window.matinee?.titleBar && <div class="titlebar" aria-hidden="true" />}
      <WhatsNew />
      <ProblemWatcher />
      <button type="button" class="sr-only skip-link" onClick={skip}>Skip to content</button>
      <nav class="rail" aria-label="Main">
        <a class="rail-logo" href={href('library')} title="Matinee"><img src={logoUrl} alt="Matinee" width="40" height="40" draggable={false} /></a>
        <div class="rail-history" role="group" aria-label="History">
          <button type="button" class="rail-step" onClick={back} disabled={!hist.back} title="Back" aria-label="Back"><Icon name="back" /></button>
          <button type="button" class="rail-step" onClick={forward} disabled={!hist.forward} title="Forward" aria-label="Forward"><Icon name="chevron" /></button>
        </div>
        {nav.map(n => (
          <a key={n.name} class="rail-btn" href={href(n.name)} aria-current={route.name === n.name ? 'page' : undefined} style={{ textDecoration: 'none' }}>
            <Icon name={n.icon} />{n.label}
          </a>
        ))}
        <div class="rail-spacer" />
        <JobPill job={core.job} />
        <UpdatePill href={href('settings', null, { s: 'updates' })} />
        <DebugBadge />
        <a class="rail-btn" href={href('settings')} aria-current={route.name === 'settings' ? 'page' : undefined} style={{ textDecoration: 'none' }}><Icon name="settings" />Settings<SettingsDot /></a>
      </nav>
      <main class="main" id="main">
        <Guard key={route.name + ':' + (route.param || '')}>
          <Screen param={route.param} core={core} />
        </Guard>
      </main>
      <Tooltip />
      <PosterPop />
      <PersonPop />
      <LoadBar />
      <FetchNotice />
      {toastMsg && <div class="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
