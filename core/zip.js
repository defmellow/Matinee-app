// A minimal ZIP writer and reader (deflate, no ZIP64, no encryption). Plain Node, no dependencies.
// Writer: async generator of Buffers; each entry's content is streamed through deflate, so memory stays modest.
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

/** Running CRC-32: crc32(buf, previous) -> number. */
export function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const FLAGS = 0x0808; // bit 3: sizes follow the data; bit 11: UTF-8 names
const dosTime = d => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = d => (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
const asBuffer = x => (Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8'));

/**
 * entries: [{ name, chunks: iterable of string|Buffer }]. Yields the zip file as Buffers.
 * Each chunk is written as it arrives, so a big file never has to be one string.
 */
export async function* zipChunks(entries, { now = new Date() } = {}) {
  const central = [];
  let offset = 0;
  const t = dosTime(now), dt = dosDate(now);
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(FLAGS, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(t, 10); head.writeUInt16LE(dt, 12); head.writeUInt16LE(name.length, 26);
    const start = offset;
    yield head; yield name; offset += 30 + name.length;
    let crc = 0, size = 0, csize = 0;
    const source = Readable.from((function* () { for (const c of e.chunks) { const b = asBuffer(c); if (b.length) { crc = crc32(b, crc); size += b.length; yield b; } } })(), { objectMode: false });
    for await (const out of source.pipe(zlib.createDeflateRaw({ level: 9 }))) { csize += out.length; offset += out.length; yield out; }
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(size, 12);
    yield dd; offset += 16;
    central.push({ name, crc, csize, size, start });
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(FLAGS, 8); h.writeUInt16LE(8, 10);
    h.writeUInt16LE(t, 12); h.writeUInt16LE(dt, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.start, 42);
    yield h; yield c.name; offset += 46 + c.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
  yield end;
}

/** Reads a zip made by zipChunks (or any plain deflate/stored zip). -> Map name -> Buffer. Checks every CRC. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Broken zip directory');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    const data0 = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(data0, data0 + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? raw : null;
    if (!data) throw new Error('Unsupported zip method ' + method);
    if (crc32(data) !== crc) throw new Error('Zip check failed for ' + name);
    out.set(name, data);
    p += 46 + nl + xl + cl;
  }
  return out;
}

/** Whole zip as one Buffer (tests and small files). */
export async function zipBuffer(entries, opts) { const parts = []; for await (const b of zipChunks(entries, opts)) parts.push(b); return Buffer.concat(parts); }
