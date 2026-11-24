// Getting the Letterboxd export in, as a ZIP or as the folder a Mac unzips it into by itself.
// Both helpers hand back a File, so every import screen reads it the same way (file.arrayBuffer()).
import { packExportFiles } from '../core/parse/export.js';
import { reportProblem } from './debug/report.js';

const UNREADABLE = "Matinee couldn't read that folder. Try the ZIP from Letterboxd instead.";

const asZip = bytes => new File([bytes], 'letterboxd-export.zip', { type: 'application/zip' });

const readAll = reader => new Promise((resolve, reject) => {
  const out = [];
  const more = () => reader.readEntries(batch => { if (!batch.length) resolve(out); else { out.push(...batch); more(); } }, reject); // batches of ~100
  more();
});
const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));

async function folderFiles(dir, rel = '', depth = 0, out = []) {
  for (const e of await readAll(dir.createReader())) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory && depth < 4) await folderFiles(e, r, depth + 1, out);
    else if (e.isFile && e.name.toLowerCase().endsWith('.csv')) out.push({ path: r, bytes: new Uint8Array(await (await fileOf(e)).arrayBuffer()) });
  }
  return out;
}

/** What was dropped: the ZIP itself, or a dropped folder packed into one. Null when nothing usable was dropped. */
export async function exportFromDrop(dataTransfer) {
  if (!dataTransfer) return null;
  const item = dataTransfer.items && dataTransfer.items[0];
  const entry = item && typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
  if (entry && entry.isDirectory) {
    let files;
    try { files = await folderFiles(entry); }
    catch (e) { reportProblem({ area: 'Import', message: "Matinee couldn't read a dropped export folder.", detail: e }); throw new Error(UNREADABLE); }
    return asZip(packExportFiles(files)); // throws the friendly "isn't a Letterboxd export" when it holds no CSVs
  }
  return (dataTransfer.files && dataTransfer.files[0]) || null;
}

/**
 * "Click to choose": in the app, the system picker (on a Mac it also takes the unzipped folder). Resolves a File, or null when
 * the user cancelled. Outside the app (the dev browser) it opens the page's own file input and resolves null; its onChange does the rest.
 */
export async function chooseExport(input) {
  const pick = typeof window !== 'undefined' && window.matinee && window.matinee.pickExport;
  if (!pick) { if (input) input.click(); return null; }
  const r = await pick();
  if (r && r.error) throw new Error(r.error);
  return r && r.bytes ? asZip(r.bytes) : null;
}
