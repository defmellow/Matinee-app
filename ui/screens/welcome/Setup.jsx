// Onboarding frames 3-8: the three optional steps (Your look, About you, A quick look around) and the end (You're all set).
// Every step can be skipped; whatever was picked so far is already saved, because each choice is saved as it is made.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { refreshCore, toast, useLibrary } from '../../state.js';
import { setFeelColours } from '../../feel-colours.js';
import { lessMotion } from '../../motion.js';
import { Poster } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import { pluralN } from '../../format.js';
import { FAMILY_WORDS } from '../../../core/analysis/feel-families.js';
import { ThemePicker, THEMES } from '../settings/ThemePicker.jsx';
import logoUrl from '../../assets/logo.png';
import { CountrySelect, COUNTRY_HINT, FriendCode, KeyFold } from './Fields.jsx';
import { countryName } from './countries.js';
import { FillBar } from './Start.jsx';
import { tourCards } from './tour.js';
import { fillOf } from './fill.js';
import { zoomKeysText } from '../../platform.js';

export const STEPS = [{ id: 'look', label: 'Your look' }, { id: 'about', label: 'About you' }, { id: 'tour', label: 'A quick look around' }];
const FAMILY_ORDER = ['red', 'yellow', 'green', 'blue', 'purple'];
const fillText = f => `Filling in your films: ${f.done.toLocaleString('en-AU')} of ${f.total.toLocaleString('en-AU')}`;

/** The top bar on every step: logo, the three steps in words, and Skip for now. */
export function Head({ step, onSkip, right }) {
  const at = STEPS.findIndex(s => s.id === step);
  return (
    <header class="onb-top">
      <span class="onb-brand"><img src={logoUrl} alt="" width="26" height="32" draggable={false} />Matinee</span>
      {step && (
        <ol class="onb-stepper" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.id} class={i < at ? 'done' : i === at ? 'on' : ''} aria-current={i === at ? 'step' : undefined}>
              {i > 0 && <span class="onb-dash" aria-hidden="true" />}
              <i aria-hidden="true">{i < at ? <Icon name="check" size={12} /> : i + 1}</i>{s.label}
            </li>
          ))}
        </ol>
      )}
      <span class="onb-skip">{right !== undefined ? right : onSkip && <button type="button" class="btn btn-ghost onb-btn" onClick={onSkip}>Skip for now</button>}</span>
    </header>
  );
}

/** The footer on every step: the filling bar on the left, Back and Next on the right. */
export function Foot({ core, onBack, onNext, nextLabel = 'Next', middle = null }) {
  return (
    <footer class="onb-foot">
      <FillBar core={core} text={fillText} />
      {middle && <span class="onb-foot-mid">{middle}</span>}
      <span class="onb-grow" />
      {onBack && <button type="button" class="btn btn-ghost onb-btn" onClick={onBack}>Back</button>}
      {onNext && <button type="button" class="btn btn-primary onb-btn" onClick={onNext}>{nextLabel}</button>}
    </footer>
  );
}

/** The colour key, in the Map key's words, one line per colour (FAMILY_WORDS is the one wording). */
export function ColourKey({ hint = null, columns = true }) {
  return (
    <div class={'onb-key' + (columns ? ' cols' : '')}>
      {FAMILY_ORDER.map(f => <span key={f} class="onb-ky"><i style={{ background: `var(--feel-${f}-edge)` }} /><b>{FAMILY_WORDS[f][0]}:</b> {FAMILY_WORDS[f][1]}</span>)}
      {hint && <span class="onb-ky onb-ky-hint">{hint}</span>}
    </div>
  );
}

const saveFailed = what => () => toast(`Couldn't change ${what}. Try again.`); // api.call has recorded why

/** Frame 3: theme, feel colours, less motion. Each click repaints the window at once (the app follows core settings). */
export function Look({ core }) {
  const theme = (core.settings && core.settings.theme) || 'system';
  const colours = core.settings.feelColours !== false;
  const less = core.settings.motion === 'less';
  const setTheme = t => { call('setSettings', { theme: t }).then(refreshCore, saveFailed('the theme')); };
  const setColours = v => { setFeelColours(v); call('setSettings', { feelColours: v }).then(refreshCore, saveFailed('Feel colours')); };
  const setMotion = v => {
    if (v) document.documentElement.dataset.motion = 'less'; else delete document.documentElement.dataset.motion;
    call('setSettings', { motion: v ? 'less' : 'system' }).then(refreshCore, saveFailed('Less motion'));
  };
  return (
    <div class="onb-col">
      <div><h1 class="onb-t">Your look</h1><p class="onb-lead">Pick what feels comfy. The window changes as you choose.</p></div>
      <section class="panel onb-panel onb-look">
        <h2 class="onb-ph">Theme</h2>
        <ThemePicker value={theme} onChange={setTheme} />
        <p class="onb-hint">Match system follows your computer's light or dark setting, with Blush or Blush light.</p>
      </section>
      <section class="panel onb-panel onb-checks">
        <label class="set-check onb-check">
          <input type="checkbox" checked={colours} onChange={e => setColours(e.currentTarget.checked)} />
          <span><b>Feel colours</b> · Colours that attempt to match the general feeling of the film, used throughout the app.</span>
        </label>
        {colours && <ColourKey hint="Forget one? Hover on any colour." />}
        <hr class="onb-rule" />
        <label class="set-check onb-check">
          <input type="checkbox" checked={less} onChange={e => setMotion(e.currentTarget.checked)} />
          <span><b>Less motion</b> · Reduces animations, also works if your computer is set to reduce animations.</span>
        </label>
      </section>
    </div>
  );
}

/** Frames 4 and 5a-5c: country, username, the folded keys and the friend code. */
export function About({ core }) {
  const saved = (core.user && core.user.username) || '';
  const [name, setName] = useState(saved);
  const timer = useRef(null);
  const latest = useRef(name);
  latest.current = name;
  const save = async v => {
    if (v.trim() === ((core.user && core.user.username) || '')) return;
    try { await call('setSettings', { username: v }); refreshCore(); } catch (err) { toast("Couldn't save your username. Try again."); } // api.call recorded why
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); save(latest.current); } }, []); // leaving the step saves what was typed
  const type = v => { setName(v); clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; save(v); }, 700); };
  return (
    <div class="onb-col">
      <div><h1 class="onb-t">About you</h1><p class="onb-lead">Two small details help Matinee fit your life. Both are optional.</p></div>
      <section class="panel onb-panel onb-about">
        <div class="onb-fld">
          <label for="onb-country">Country</label>
          <CountrySelect core={core} id="onb-country" class="onb-in" />
          <p class="onb-hint">{COUNTRY_HINT}</p>
        </div>
        <div class="onb-fld">
          <label for="onb-user">Letterboxd username <span>optional</span></label>
          <input id="onb-user" class="input onb-in" value={name} placeholder="Your username on Letterboxd" autocomplete="off" spellcheck={false}
            onInput={e => type(e.currentTarget.value)} onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; save(name); } }} />
          <p class="onb-hint">Allows syncing new diary entries, watchlist films and changed ratings. It is suggested to import a fresh export once in a while.</p>
        </div>
        <hr class="onb-rule" />
        <div class="onb-extras">
          <KeyFold core={core} />
          <FriendCode core={core} variant="onboarding" />
        </div>
      </section>
    </div>
  );
}

/** Frames 6 and 7: one card at a time, moved by the user, never by a timer. */
export function Tour({ core, index, setIndex, onDone }) {
  const cards = tourCards(core.settings.feelColours !== false);
  const i = Math.min(index, cards.length - 1);
  const c = cards[i];
  const last = i === cards.length - 1;
  const hasUser = !!(core.user && core.user.username);
  const fade = lessMotion() ? '' : ' onb-fade';
  const next = () => (last ? onDone() : setIndex(i + 1));
  return (
    <div class="onb-tour">
      <div class={'onb-shot' + fade} key={'s' + c.id}><img src={c.img} alt={c.alt} width="1200" height="750" draggable={false} /></div>
      <div class={'onb-card' + fade} key={'c' + c.id} aria-live="polite">
        <span class="onb-small">{i + 1} of {cards.length}</span>
        <h1 class="onb-card-t">{c.title}</h1>
        <p class="onb-card-p">{c.text}</p>
        {c.noUser && !hasUser && <p class="onb-hint">{c.noUser}</p>}
        <div class="onb-pager">
          <button type="button" class="btn onb-sm" aria-label="Previous card" disabled={i === 0} onClick={() => setIndex(i - 1)}>‹</button>
          <span class="onb-dots" role="tablist" aria-label="Cards">
            {cards.map((x, j) => <button key={x.id} type="button" role="tab" class={j === i ? 'on' : ''} aria-selected={String(j === i)} aria-label={`${x.title}, card ${j + 1} of ${cards.length}`} onClick={() => setIndex(j)} />)}
          </span>
          <button type="button" class={'btn onb-sm' + (last ? ' btn-primary' : '')} onClick={next}>{last ? "I'm ready" : 'Next ›'}</button>
        </div>
        {last && (
          <div class="onb-last">
            <p class="onb-hint">Text too small? {zoomKeysText()}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Three of your own posters, laid by hand like Insights' little stacks: overlapping, each turned a little, a ring in the page colour. */
function Posters() {
  const lib = useLibrary();
  const films = useMemo(() => {
    if (!lib) return [];
    const has = f => f.poster && (f.poster.thumb || f.poster.url);
    const rank = f => (f.user.liked ? 2 : 0) + (f.user.rating || 0) / 10 + (f.user.watched ? 0.5 : 0);
    return lib.films.filter(has).slice().sort((a, b) => rank(b) - rank(a)).slice(0, 3);
  }, [lib]);
  if (films.length < 3) return null; // too few posters in yet for the little stack: the words carry the page
  return (
    <div class="onb-posters" aria-hidden="true">
      {films.map((f, i) => <span key={f.key} class="onb-pp" style={{ '--i': i }}><Poster film={f} /></span>)}
    </div>
  );
}

/** "Blush, feel colours on, Australia, Dendy Newtown on." — only what they set. */
export function choicesSentence(core) {
  const s = core.settings || {};
  const theme = (THEMES.find(t => t.value === (s.theme || 'system')) || THEMES[THEMES.length - 1]).label;
  const parts = [theme, s.feelColours !== false ? 'feel colours on' : 'feel colours off'];
  if (s.motion === 'less') parts.push('less motion');
  const country = countryName(s.region || 'AU');
  if (country) parts.push(country);
  if (s.dendy) parts.push('Dendy Newtown on');
  return parts.join(', ') + '. You can change these in Settings.';
}

/** Frame 8: the end, one button. */
export function Ready({ core, onOpen }) {
  const films = (core.counts && core.counts.films) || 0;
  return (
    <div class="onb-ready">
      <Posters />
      <h1 class="onb-ready-t">You're all set</h1>
      <p class="onb-ready-p">Your {pluralN(films, 'film', 'films')} {films === 1 ? 'is' : 'are'} in. Details keep filling in as you browse, and feelings get more accurate as more reviews come in.</p>
      <p class="onb-ready-s">{choicesSentence(core)}</p>
      <button type="button" class="btn btn-primary onb-btn" onClick={onOpen}>Open my library</button>
      <div class="onb-ready-fill"><FillBar core={core} /><span class="onb-small">{(() => { const f = fillOf(core); return `${f.done.toLocaleString('en-AU')} of ${pluralN(f.total, 'film', 'films')} filled in`; })()}</span></div>
    </div>
  );
}
