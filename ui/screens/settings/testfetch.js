// Pure helpers for the Settings "Test fetch" card.
export const MIN_FILMS = 8, MAX_FILMS = 40, DEFAULT_FILMS = 24;

export const clampFilms = n => Math.min(MAX_FILMS, Math.max(MIN_FILMS, Math.round(Number(n)) || DEFAULT_FILMS));

const PHASES = {
  providers: 'Trying each site',
  'plain-check': 'Comparing quick and full page reads',
  feel: 'Seeing what each site adds to the "by feel" results',
  done: 'Wrapping up',
};
export const phaseText = phase => PHASES[phase] || 'Working';

/** 83000 -> '1:23'; 3725000 -> '1:02:05'. */
export function elapsedText(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = n => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** Fold one testFetchStep event into { phase, current, done, failed } (done/failed count steps that finished). */
export function foldStep(prev, ev) {
  const next = { ...prev };
  if (!ev) return next;
  if (ev.phase && ev.phase !== prev.phase) { next.phase = ev.phase; next.done = 0; next.failed = 0; }
  const name = [ev.provider, ev.film || ev.ref].filter(Boolean).join(' · ');
  if (ev.state === 'start') next.current = name;
  else if (ev.state === 'done') next.done = (next.done || 0) + 1;
  else if (ev.state === 'failed') next.failed = (next.failed || 0) + 1;
  return next;
}

/** True when a step says a site asked for a "verify you're human" check and a window was opened. */
export const needsCheck = ev => !!ev && (ev.check === true || ev.window === true || ev.state === 'check');

/** The summary at the top of the report: the first `n` lines. */
export function headline(text, n = 40) {
  const lines = String(text || '').split('\n');
  return { text: lines.slice(0, n).join('\n').trimEnd(), more: Math.max(0, lines.length - n) };
}

export const reportFilename = (d = new Date()) => `matinee-test-fetch-${d.toISOString().slice(0, 10)}.txt`;
