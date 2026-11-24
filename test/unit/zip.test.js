import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipBuffer, readZip, crc32 } from '../../core/zip.js';

test('crc32 matches the known value', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926));

const entries = () => [
  { name: 'a.txt', chunks: ['hello ', 'world\n'.repeat(5000)] },
  { name: 'empty.txt', chunks: [] },
  { name: 'ünï-名前.txt', chunks: [Buffer.from('café')] },
];

test('round trip through our reader', async () => {
  const m = readZip(await zipBuffer(entries()));
  assert.deepEqual([...m.keys()], ['a.txt', 'empty.txt', 'ünï-名前.txt']);
  assert.equal(m.get('a.txt').toString(), 'hello ' + 'world\n'.repeat(5000));
  assert.equal(m.get('empty.txt').length, 0);
  assert.equal(m.get('ünï-名前.txt').toString(), 'café');
});

test('the system unzip accepts it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const f = path.join(dir, 'x.zip');
  fs.writeFileSync(f, await zipBuffer(entries()));
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(sorted(z.namelist()))\nassert z.read("ünï-名前.txt")==b"caf\\xc3\\xa9"', f], { encoding: 'utf8' });
  if (py.error) return t.skip('no python3');
  assert.equal(py.status, 0, py.stderr);
  const un = spawnSync('unzip', ['-t', f], { encoding: 'utf8' });
  if (!un.error) assert.equal(un.status, 0, un.stdout + un.stderr);
});

test('a damaged zip is refused', async () => {
  const b = await zipBuffer(entries());
  b[40] ^= 0xff;
  assert.throws(() => readZip(b));
  assert.throws(() => readZip(Buffer.from('nope')));
});
