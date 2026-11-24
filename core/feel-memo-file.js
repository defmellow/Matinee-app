// The feel engine's per-film work kept on disk (feel-memo.bin in the data folder), so after a restart the first feel build
// takes about a second instead of ten. It is derived data: never shared, safe to delete, rebuilt when anything is doubtful.
// File: 4 bytes (header length) + JSON header { v, stamp, parts } + the memo as V8 blobs of PART films each (`parts` holds their
// byte lengths). The header is read first, so a file made by other code is turned away without unpacking megabytes. The
// stamp is a hash of every .js file in core/analysis/feel/ plus the V8 version, so a code change can never serve stale feel
// results. The memo is tens of MB: one blob took 130-230 ms to pack or unpack, time in which the core answered nothing, so it is
// packed and unpacked a part at a time with a turn of the event loop in between (save() and load(); saveSync() for close()).
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FILE = 'feel-memo.bin';
const FORMAT = 2;
const PART = 25; // films per blob: a few ms each to pack or unpack
const FEEL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'analysis', 'feel');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

let stampPromise = null;
/** sha1 over the feel engine's source files and the V8 version. Rejects if the sources can't be read. */
export function codeStamp() {
  if (!stampPromise) {
    stampPromise = (async () => {
      const names = (await fs.promises.readdir(FEEL_DIR)).filter(n => n.endsWith('.js')).sort();
      if (!names.length) throw new Error('no feel engine source files found in ' + FEEL_DIR);
      const h = createHash('sha1').update(`v8 ${process.versions.v8} format ${FORMAT}\n`);
      for (const n of names) h.update(n + '\n').update(await fs.promises.readFile(path.join(FEEL_DIR, n))).update('\n');
      return h.digest('hex');
    })();
    stampPromise.catch(() => { stampPromise = null; });
  }
  return stampPromise;
}

/** The file's bytes, as steps: it yields after each part, so save() can let other work run in between. */
function* packSteps(stamp, memo) {
  const entries = [...memo]; // taken now: a build that runs between parts replaces entries, it never changes one
  const parts = [];
  for (let i = 0; i < entries.length; i += PART) {
    parts.push(v8.serialize(entries.slice(i, i + PART)));
    yield;
  }
  const head = Buffer.from(JSON.stringify({ v: FORMAT, stamp, parts: parts.map(p => p.length) }), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length);
  return Buffer.concat([len, head, ...parts]);
}

/** The header, or null when the file was made by other code (another engine, another format). Throws when it is damaged. */
function readHeader(buf, want) {
  const len = buf.readUInt32LE(0);
  const header = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
  if (header.v !== FORMAT || header.stamp !== want) return null; // the engine changed since: expected, rebuilt and saved again
  const parts = header.parts;
  if (!Array.isArray(parts) || !parts.every(n => Number.isInteger(n) && n > 0)) throw new Error('the saved feel work has no list of parts');
  if (4 + len + parts.reduce((a, b) => a + b, 0) !== buf.length) throw new Error('the saved feel work is cut short or too long');
  return { start: 4 + len, parts };
}

function addPart(memo, entries) {
  if (!Array.isArray(entries) || !entries.every(e => Array.isArray(e) && e.length === 2)) throw new Error('the saved feel work is not a list of films');
  for (const [k, v] of entries) memo.set(k, v);
}

/**
 * @param dir     the data folder
 * @param report  problems.report-like function
 * @param stamp   () => Promise<string>  (tests only; defaults to the real code stamp)
 * @param pause   () => Promise          (tests only; what load and save wait for between parts)
 */
export function createFeelMemoFile({ dir, report = () => {}, stamp = codeStamp, pause = nextTurn }) {
  const file = path.join(dir, FILE);
  let unusable = false; // the sources can't be read: nothing is kept on disk, and that is said once
  let known = null;     // the stamp once worked out, for saveSync (close() can't wait for a promise)
  let writes = 0;       // saves started; a save that a newer one overtook does not put its older copy in place
  const stampOrNull = async () => {
    if (unusable) return null;
    try { return (known = await stamp()); } catch (error) {
      unusable = true;
      report({ area: 'Feel', level: 'warning', message: "Couldn't read the feel engine's files, so its work isn't kept between launches. Opening a film may be slower after a restart.", error });
      return null;
    }
  };
  const drop = async () => { try { await fs.promises.unlink(file); } catch { /* already gone */ } };
  const failedSave = (error) => report({ area: 'Feel', level: 'warning', message: "Couldn't save the feel work for next time.", error });
  return {
    file,
    /** @returns Map | null  (null: no file, made by other code, or damaged: build from scratch) */
    async load() {
      const want = await stampOrNull();
      if (!want) return null;
      let buf;
      try { buf = await fs.promises.readFile(file); } catch (error) {
        if (error && error.code === 'ENOENT') return null; // first run, or never saved: not a problem
        report({ area: 'Feel', level: 'warning', message: "Couldn't read the saved feel work, so it is rebuilt.", error });
        return null;
      }
      try {
        const head = readHeader(buf, want);
        if (!head) return null;
        const memo = new Map();
        let at = head.start;
        for (const n of head.parts) {
          addPart(memo, v8.deserialize(buf.subarray(at, at + n)));
          at += n;
          await pause();
        }
        return memo;
      } catch (error) {
        report({ area: 'Feel', level: 'warning', message: 'The saved feel work was damaged, so it is rebuilt.', error });
        await drop();
        return null;
      }
    },
    /** Written to a temp file and renamed, so a crash never leaves half a file. Failures are reported, never thrown. */
    async save(memo) {
      const want = await stampOrNull();
      if (!want) return false;
      const me = ++writes;
      const tmp = file + '.tmp';
      try {
        const steps = packSteps(want, memo);
        let s;
        while (!(s = steps.next()).done) await pause();
        const fh = await fs.promises.open(tmp, 'w');
        try { await fh.writeFile(s.value); await fh.sync(); } finally { await fh.close(); }
        if (me !== writes) { await fs.promises.unlink(tmp); return false; } // a newer save (close()) has the newer work: keep that
        await fs.promises.rename(tmp, file);
        return true;
      } catch (error) {
        failedSave(error);
        try { await fs.promises.unlink(tmp); } catch { /* nothing to clean */ }
        return false;
      }
    },
    /**
     * save() for close(): the app stops the core straight after, so this one has written the file when it returns. Needs the
     * code stamp worked out already (load() or save() ran); without it nothing was built with this engine, so nothing is kept.
     * Its own temp file, so a save still being written can't mix with it.
     */
    saveSync(memo) {
      if (!known || unusable) return false;
      ++writes;
      const tmp = file + '.closing.tmp';
      try {
        const steps = packSteps(known, memo);
        let s;
        while (!(s = steps.next()).done);
        const fd = fs.openSync(tmp, 'w');
        try { fs.writeFileSync(fd, s.value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(tmp, file);
        return true;
      } catch (error) {
        failedSave(error);
        try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
        return false;
      }
    },
  };
}
