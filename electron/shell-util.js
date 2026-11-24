// Small pure helpers for the main process (no Electron imports, so they are unit-tested).

/** One log argument as text. Never throws (circular objects, BigInt, throwing getters). */
export function formatLogArg(a) {
  try {
    if (a instanceof Error) return a.stack || a.message || String(a);
    if (typeof a === 'string') return a;
    const s = JSON.stringify(a);
    return s === undefined ? String(a) : s;
  } catch {
    try { return String(a); } catch { return '[unprintable]'; }
  }
}

export function formatLogLine(args, date = new Date()) {
  return `${date.toISOString()} ${args.map(formatLogArg).join(' ')}\n`;
}

/**
 * Allows `max` events per `windowMs`. allow() records one and says whether it is within the limit.
 * Used so a window that keeps crashing is reloaded a few times, then reported instead of looping.
 */
export function createRateGuard({ max = 3, windowMs = 60_000, now = Date.now } = {}) {
  let times = [];
  return {
    allow() {
      const t = now();
      times = times.filter(x => t - x < windowMs);
      if (times.length >= max) return false;
      times.push(t);
      return true;
    },
  };
}

/** Should a window process ending be recovered by reloading? A clean exit or a deliberate kill is left alone. */
export const shouldReloadAfter = reason => reason !== 'clean-exit' && reason !== 'killed';

export const THEMES = ['system', 'light', 'dark', 'neutral', 'neutral-light'];
export const isTheme = t => THEMES.includes(t);
/** What Electron's nativeTheme should follow: the grey Dark theme is dark, the grey Light theme is light. */
export const nativeSourceFor = theme => (theme === 'neutral' ? 'dark' : theme === 'neutral-light' ? 'light' : theme);
const DARK_BG = { neutral: '#1c1c1e' };
const LIGHT_BG = { 'neutral-light': '#f4f4f5' };
/** Window background before the page paints: matches --bg in tokens.css. `theme` is the in-app theme (the grey Dark and grey Light themes change the colour). */
export const backgroundFor = (dark, theme) => (dark ? DARK_BG[theme] || '#221d1d' : LIGHT_BG[theme] || '#faf5f2');

/** The Windows caption buttons drawn over our own top strip. Colours match --bg and --muted in tokens.css. */
export const TITLEBAR_HEIGHT = 36;
const SYMBOL = { neutral: '#c4c4c8', 'neutral-light': '#4a4a51' };
export const overlayFor = (dark, theme) => ({ color: backgroundFor(dark, theme), symbolColor: SYMBOL[theme] || (dark ? '#d4c6bc' : '#5b4d4b'), height: TITLEBAR_HEIGHT });

/** Windows draws our own top strip with the caption buttons over it. macOS and Linux keep the normal system title bar. */
export const usesTitleOverlay = (platform = process.platform) => platform === 'win32';

/** The window icon file: Windows takes the .ico (a picture per size), everywhere else the .png (macOS ignores it: the .app has its own). */
export const iconFileFor = (platform = process.platform) => (platform === 'win32' ? 'matinee.ico' : 'matinee.png');

/**
 * What to count as "Matinee itself" in Settings → Storage: the portable .exe, the AppImage file, the Mac .app bundle, or the
 * install folder. `exe` is the running binary.
 */
export function appDirFor({ platform = process.platform, env = process.env, exe = '', packaged = false } = {}) {
  if (env.PORTABLE_EXECUTABLE_FILE) return env.PORTABLE_EXECUTABLE_FILE;
  if (!packaged) return null;
  if (platform === 'linux' && env.APPIMAGE) return env.APPIMAGE;
  const sep = platform === 'win32' ? '\\' : '/';
  const parts = String(exe).split(sep);
  if (platform === 'darwin') {
    const i = parts.findIndex(p => p.endsWith('.app'));
    if (i >= 0) return parts.slice(0, i + 1).join(sep); // Matinee.app/Contents/MacOS/Matinee -> Matinee.app
  }
  parts.pop();
  return parts.join(sep);
}

/**
 * The macOS menu bar. Without an Edit menu, Cmd+C / V / A / Z do nothing in text fields. No dev tools or reload items:
 * the only shortcuts Matinee allows are zoom (also handled in the window) and the usual window ones.
 * Roles only, so the system supplies the labels and shortcuts.
 */
export function macMenuTemplate(appName = 'Matinee') {
  return [
    { label: appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { role: 'close' }] },
  ];
}
