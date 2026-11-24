// How much disk space Matinee uses, in a few plain groups. Walks folders asynchronously; a missing folder counts as 0.
// Layout (see electron/main.js): <userData>/data (library.json, films.json, cache.json), <userData>/image-cache, <userData>/matinee.log(.old).
// The updater keeps downloads in <app>-updater under %LOCALAPPDATA% (Windows) or ~/.cache (Linux, the AppImage). Mac and .deb
// copies never download an update themselves.
import fs from 'node:fs/promises';
import path from 'node:path';
import { NO_PROBLEMS } from '../problems.js';

// A folder or file that isn't there (yet) is normal and counts as 0 bytes; anything else (permissions, a locked file) is reported.
const missing = (e, what, problems) => { if (e?.code !== 'ENOENT') problems.report({ area: 'Storage', message: `Matinee couldn't ${what}, so the storage figures may be low.`, error: e, level: 'warning' }); };

/** Total size in bytes of a file, or of everything under a folder. Missing or unreadable paths give 0. */
export async function sizeOf(target, problems = NO_PROBLEMS) {
  let st;
  try { st = await fs.lstat(target); } catch (e) { missing(e, `check the size of ${path.basename(target)}`, problems); return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let names;
  try { names = await fs.readdir(target); } catch (e) { missing(e, `look inside ${path.basename(target)}`, problems); return 0; }
  const sizes = await Promise.all(names.map(n => sizeOf(path.join(target, n), problems)));
  return sizes.reduce((a, b) => a + b, 0);
}

/** Folders inside `dir` whose name matches `re`; [] when `dir` is missing. */
async function matching(dir, re, problems = NO_PROBLEMS) {
  try { return (await fs.readdir(dir)).filter(n => re.test(n)).map(n => path.join(dir, n)); } catch (e) { missing(e, `look inside ${path.basename(dir)}`, problems); return []; }
}


/** Where electron-updater keeps its downloads, or null. */
const updaterHome = env => env.LOCALAPPDATA || env.XDG_CACHE_HOME || (env.APPIMAGE && env.HOME ? path.join(env.HOME, '.cache') : null);

/**
 * @param {{ dataDir: string, appDir?: string|null, env?: object }} o  appDir: the installed app (folder, or the portable .exe file); null in dev
 * @returns {Promise<{ total: number, parts: { id: string, label: string, bytes: number }[] }>}
 */
export async function measureStorage({ dataDir, appDir = null, env = process.env, problems = NO_PROBLEMS }) {
  const sum = async paths => (await Promise.all(paths.map(p => sizeOf(p, problems)))).reduce((a, b) => a + b, 0);
  const userData = path.dirname(dataDir);
  const inData = n => path.join(dataDir, n);
  let names = [];
  try { names = await fs.readdir(dataDir); } catch (e) { missing(e, 'look inside the data folder', problems); }
  const isLibrary = n => /^(library|films)\.json$/.test(n);
  const isBackup = n => /\.bak$|^matinee-(share|for-[a-z]+)\./.test(n); // safety copies and the last share file: kept by Clear cache
  // Chromium's own folders (Partitions for the page window, Cache, GPUCache…): every folder in userData except ours.
  let top = [];
  try { top = await fs.readdir(userData, { withFileTypes: true }); } catch (e) { missing(e, 'look inside the app folder', problems); }
  const ours = new Set([path.basename(dataDir), 'image-cache']);
  const browserDirs = top.filter(e => e.isDirectory() && !ours.has(e.name)).map(e => path.join(userData, e.name));
  const [app, library, cache, backups, images, browser, logs, updates] = await Promise.all([
    appDir ? sizeOf(appDir, problems) : 0,
    sum([inData('library.json'), inData('films.json')]),
    // everything else in the data folder: cache.json and other re-fetchable files
    sum(names.filter(n => !isLibrary(n) && !isBackup(n)).map(inData)),
    sum(names.filter(isBackup).map(inData)),
    sum([path.join(userData, 'image-cache')]),
    sum(browserDirs),
    sum(await matching(userData, /^matinee\.log/, problems)),
    updaterHome(env) ? sum(await matching(updaterHome(env), /^matinee.*-updater$/i, problems)) : 0,
  ]);
  const parts = [
    { id: 'app', label: 'Matinee itself', bytes: app },
    { id: 'library', label: 'Your library', bytes: library },
    { id: 'cache', label: 'Saved lookups and pages', bytes: cache },
    { id: 'backups', label: 'Backups', bytes: backups },
    { id: 'images', label: 'Posters and images', bytes: images },
    { id: 'browser', label: 'Built-in browser', bytes: browser },
    { id: 'logs', label: 'Logs', bytes: logs },
    { id: 'updates', label: 'Downloaded updates', bytes: updates },
  ];
  return { total: parts.reduce((a, p) => a + p.bytes, 0), parts };
}

/** measureStorage with a short memory so reopening Settings is instant. */
export function createStorageMeter({ dataDir, appDir, env, problems = NO_PROBLEMS, ttlMs = 60_000, now = Date.now }) {
  let at = 0, last = null, pending = null;
  return async function get({ fresh = false } = {}) {
    if (!fresh && last && now() - at < ttlMs) return last;
    if (fresh) pending = null;
    if (!pending) pending = measureStorage({ dataDir, appDir, env, problems }).then(r => { last = r; at = now(); return r; }).finally(() => { pending = null; });
    return pending;
  };
}

/**
 * Clear only what Matinee can fetch again: the saved lookups (cache.json, through `clearLookups`, which empties the store's copy too),
 * everything inside the image cache folder, and the previous log (matinee.log.old). Never library.json, films.json, their backups,
 * settings, the running log or downloaded updates.
 * @param {{ dataDir: string, clearLookups?: () => void }} o
 * @returns {Promise<{ freed: number }>} bytes freed (approximate)
 */
export async function clearCache({ dataDir, clearLookups, problems = NO_PROBLEMS }) {
  const userData = path.dirname(dataDir);
  const before = await sizeOf(path.join(dataDir, 'cache.json'), problems) + await sizeOf(path.join(userData, 'matinee.log.old'), problems);
  if (clearLookups) clearLookups();
  let freed = before;
  const imageDir = path.join(userData, 'image-cache');
  let names = [];
  try { names = await fs.readdir(imageDir); } catch (e) { missing(e, 'look inside the image cache', problems); }
  for (const n of names) {
    const target = path.join(imageDir, n);
    freed += await sizeOf(target, problems);
    await fs.rm(target, { recursive: true, force: true }).catch(e => problems.report({ area: 'Storage', message: `Matinee couldn't clear ${n} from the image cache.`, error: e, level: 'warning' }));
  }
  await fs.rm(path.join(userData, 'matinee.log.old'), { force: true }).catch(e => problems.report({ area: 'Storage', message: "Matinee couldn't clear the old log file.", error: e, level: 'warning' }));
  return { freed };
}
