// The five theme tiles (Settings → Appearance and onboarding's "Your look"): each a tiny picture of the app in its own colours.
import Icon from '../../components/Icon.jsx';

// Preview cards in this order. Ids are kept so saved settings still work: 'dark' is pink Blush, 'light' is Blush light,
// 'neutral' is the plain grey Dark, 'neutral-light' the plain grey Light. 'system' follows the computer with the Blush pair.
export const THEMES = [{ value: 'dark', label: 'Blush' }, { value: 'light', label: 'Blush light' }, { value: 'neutral', label: 'Dark' }, { value: 'neutral-light', label: 'Light' }, { value: 'system', label: 'Match system' }];

/** A tiny picture of the app (rail, panel, two posters, an accent pill, a text line) painted with the tokens of data-theme `id`. */
function ThemeMini({ id }) {
  return (
    <span class="set-mini" data-theme={id} aria-hidden="true">
      <i class="set-mini-rail" />
      <i class="set-mini-panel"><b class="set-mini-line" /><b class="set-mini-pill" /></i>
      <i class="set-mini-poster p1" /><i class="set-mini-poster p2" />
    </span>
  );
}

export function ThemePicker({ value, onChange }) {
  const current = THEMES.some(t => t.value === value) ? value : 'system';
  const key = e => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = THEMES.findIndex(t => t.value === current);
    const next = THEMES[(i + d + THEMES.length) % THEMES.length];
    const group = e.currentTarget.parentElement; // e.currentTarget is gone by the time the frame runs
    onChange(next.value);
    requestAnimationFrame(() => group.querySelector(`[data-theme-id="${next.value}"]`)?.focus());
  };
  return (
    <div class="set-themes" role="radiogroup" aria-label="Theme">
      {THEMES.map(t => {
        const on = t.value === current;
        return (
          <button type="button" key={t.value} class="set-theme" role="radio" aria-checked={String(on)} tabIndex={on ? 0 : -1} data-theme-id={t.value}
            onClick={() => onChange(t.value)} onKeyDown={key}>
            <span class="set-theme-pic">
              {t.value === 'system'
                ? <><ThemeMini id="dark" /><span class="set-mini-half"><ThemeMini id="light" /></span></>
                : <ThemeMini id={t.value} />}
              {on && <span class="set-theme-check"><Icon name="check" /></span>}
            </span>
            <span class="set-theme-name">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

