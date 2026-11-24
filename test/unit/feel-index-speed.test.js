// Feel index speed work (21 Nov): the sliced build, the counted latent layer, per-film reuse in core/api.js and the memo file
// written in parts and on close. Every speed-up must give exactly the old results. SYNTHETIC films only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { buildFeelIndex, buildFeelIndexAsync, inputSig, profileOf, similar } from '../../core/analysis/feel/index.js';
import { buildLatent, termCounts, mulberry32 } from '../../core/analysis/feel/latent.js';
import { createFeelMemoFile } from '../../core/feel-memo-file.js';
import { createCore } from '../../core/api.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'matinee-feelspeed-'));
const WORDS = ['tender', 'sad', 'grief', 'eerie', 'haunting', 'funny', 'silly', 'slow', 'tense', 'thrilling', 'moving', 'family', 'war', 'love', 'lonely', 'beautiful', 'violent', 'dreamlike', 'quiet', 'epic'];
function inputs(n, seed = 7) {
  const rnd = mulberry32(seed);
  const pick = () => WORDS[Math.floor(rnd() * WORDS.length)];
  return Array.from({ length: n }, (_, i) => ({
    key: 'k' + i, title: 'Film ' + i, year: 1990 + (i % 30),
    texts: [
      { voice: 'viewers', source: 'tmdb.reviews', text: `A ${pick()}, ${pick()} and ${pick()} film about ${pick()} and ${pick()}. Truly ${pick()}.` },
      { voice: 'critics', source: 'rt.consensus', text: `${pick()} and ${pick()}, with a ${pick()} heart.` },
    ],
    genres: [i % 3 ? 'Drama' : 'Comedy'], keywords: [pick()], categories: [], subjects: [], locations: [], people: { director: [{ id: 'd' + (i % 9), name: 'D' + (i % 9) }] },
  }));
}

// The latent layer as it was before 21 Nov (dense rows, counted per build), to prove the new one bit for bit.
function denseLatent(docs, dims = 48, seed = 0x5eed) {
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rowOf = (t) => { const rnd = mulberry32(hash(t) ^ seed); const r = new Float32Array(dims); const r3 = Math.sqrt(3); for (let i = 0; i < dims; i++) { const u = rnd(); if (u < 1 / 6) r[i] = r3; else if (u < 2 / 6) r[i] = -r3; } return r; };
  const N = docs.length, df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const maxDf = Math.max(3, 0.4 * N), idf = new Map();
  for (const [t, c] of df) if (c >= 2 && c <= maxDf) idf.set(t, Math.log(1 + N / c));
  return docs.map(tokens => {
    const tf = new Map();
    for (const t of tokens) if (idf.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    const v = new Float32Array(dims);
    for (const [t, c] of tf) { const w = (1 + Math.log(c)) * idf.get(t); const r = rowOf(t); for (let i = 0; i < dims; i++) v[i] += w * r[i]; }
    let s = 0; for (let i = 0; i < dims; i++) s += v[i] * v[i];
    if (s > 0) { const k = 1 / Math.sqrt(s); for (let i = 0; i < dims; i++) v[i] *= k; }
    return v;
  });
}

test('the latent layer gives exactly the old dense vectors, from tokens or from counts, and twice in a row', () => {
  const rnd = mulberry32(3);
  const docs = Array.from({ length: 60 }, () => Array.from({ length: 40 }, () => 'w' + Math.floor(rnd() * 90)));
  const want = denseLatent(docs);
  const a = buildLatent(docs), b = buildLatent(docs.map(termCounts)), c = buildLatent(docs);
  for (let i = 0; i < docs.length; i++) {
    assert.deepEqual([...a.vecs[i]], [...want[i]]);
    assert.deepEqual([...b.vecs[i]], [...want[i]]);
    assert.deepEqual([...c.vecs[i]], [...want[i]], 'rows kept from the first build change nothing');
  }
  assert.deepEqual([...a.project(docs[4])], [...want[4]]);
  assert.deepEqual(termCounts(['b', 'a', 'b', 'c']), { terms: ['b', 'a', 'c'], counts: [2, 1, 1] }, 'first appearance order');
});

test('the sliced build pauses and gives the same index as the plain one, with or without a memo', async () => {
  const ins = inputs(80);
  const plain = buildFeelIndex(ins);
  let pauses = 0;
  const memo = new Map();
  const sliced = await buildFeelIndexAsync(ins, { memo }, { sliceMs: 0, pause: async () => { pauses++; } });
  assert.ok(pauses >= 80, 'it let other work in after each film at least');
  const again = await buildFeelIndexAsync(ins, { memo }); // from the memo
  for (const idx of [sliced, again]) {
    for (const i of ins) {
      assert.deepEqual(profileOf(idx, i.key), profileOf(plain, i.key));
      assert.deepEqual(similar(idx, i.key, { limit: 8 }), similar(plain, i.key, { limit: 8 }));
      assert.deepEqual([...idx.byKey.get(i.key).latent], [...plain.byKey.get(i.key).latent]);
    }
  }
});

test('inputSig is worked out once per input object and follows the content', () => {
  const [a] = inputs(1);
  const b = structuredClone(a);
  assert.equal(inputSig(a), inputSig(b));
  assert.equal(inputSig(a), inputSig(a));
  const c = { ...b, title: 'Other' };
  assert.notEqual(inputSig(c), inputSig(a));
});

test('the memo file round-trips in parts, pausing between them, and saveSync writes before it returns', async () => {
  const dir = tmp();
  try {
    const problems = [];
    let pauses = 0;
    const memo = new Map(Array.from({ length: 60 }, (_, i) => ['k' + i, { sig: 's' + i, rec: { key: 'k' + i, n: i, m: new Map([['x', i]]) } }]));
    const f = createFeelMemoFile({ dir, report: p => problems.push(p), pause: async () => { pauses++; } });
    assert.equal(f.saveSync(memo), false, 'no code stamp yet: nothing built with this engine, nothing kept');
    assert.equal(await f.save(memo), true);
    assert.ok(pauses >= 3, 'packed a part at a time');
    pauses = 0;
    assert.deepEqual(await f.load(), memo);
    assert.ok(pauses >= 3, 'unpacked a part at a time');
    memo.set('late', { sig: 'z', rec: { key: 'late' } });
    assert.equal(f.saveSync(memo), true);
    const back = await createFeelMemoFile({ dir }).load();
    assert.equal(back.size, 61);
    assert.deepEqual(back.get('late'), { sig: 'z', rec: { key: 'late' } });
    assert.equal(fs.existsSync(f.file + '.closing.tmp'), false);
    assert.deepEqual(await createFeelMemoFile({ dir }).load(), memo, 'an empty-part-free file reads back whole');
    assert.deepEqual(problems, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a save overtaken by saveSync (close) does not put its older copy in place', async () => {
  const dir = tmp();
  try {
    let release;
    const gate = new Promise(r => { release = r; });
    const f = createFeelMemoFile({ dir, pause: () => gate });
    await f.load(); // works out the stamp, as the core does before any build
    const old = new Map(Array.from({ length: 30 }, (_, i) => ['k' + i, { sig: 'old' }]));
    const saving = f.save(old); // held between its parts
    await new Promise(r => setImmediate(r));
    assert.equal(f.saveSync(new Map([['new', { sig: 'new' }]])), true);
    release();
    assert.equal(await saving, false);
    const back = await createFeelMemoFile({ dir }).load();
    assert.deepEqual([...back.keys()], ['new']);
    assert.equal(fs.existsSync(f.file + '.tmp'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- through core/api.js ----------
const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const exportZip = () => zipSync({
  'profile.csv': strToU8(csv([['Date Joined', 'Username', 'Given Name', 'Family Name', 'Email Address', 'Location', 'Website', 'Bio', 'Pronoun', 'Favorite Films'], ['2024-01-01', 'testuser', 'Tess', '', '', '', '', '', '', '']])),
  'watched.csv': strToU8(csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ['2024-02-01', 'Alpha Film', '1999', 'https://boxd.it/aaa'], ['2024-02-02', 'Beta Film', '2005', 'https://boxd.it/bbb'], ['2024-02-03', 'Delta Film', '2001', 'https://boxd.it/ddd']])),
});
const fake404 = async () => new Response('not found', { status: 404 });

test('getFeel: a source read that changes no text keeps the index; changed text rebuilds it; close() keeps the work', async () => {
  const dir = tmp();
  const core = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
  try {
    await core.call('importExport', { bytes: exportZip() });
    const films = (await core.call('getLibrary')).films;
    const key = t => films.find(f => f.title === t).key;
    const [a, b] = [key('Alpha Film'), key('Beta Film')];
    const st = core.store;
    const review = (k, text) => { const f = st.films[k]; f.src.tmdb = { ...(f.src.tmdb || {}), reviews: [{ text }] }; f.checked = { ...f.checked, tmdb: new Date().toISOString() }; st.touch('films'); };
    review(a, 'A tender, sad and moving film about grief and family. Heartbreaking.');
    review(b, 'A silly, funny and chaotic comedy. Hilarious.');
    await core.call('deleteView', { id: 'none' }); // a library event, as a landing source sends
    const p1 = (await core.call('getFeel', { key: a })).profile;

    // a score source lands for Beta: new checked time and a new data object, the same text
    st.films[b].checked = { ...st.films[b].checked, rt: new Date().toISOString() };
    st.films[b].src.rt = { ratings: { tomatometer: 90 } };
    await core.call('deleteView', { id: 'none' });
    assert.equal((await core.call('getFeel', { key: a })).profile, p1, 'the same index is handed back, not rebuilt');

    // Beta's reviews change: rebuilt, and Beta's feel follows
    review(b, 'An eerie, haunting and terrifying horror film. Deeply unsettling.');
    await core.call('deleteView', { id: 'none' });
    const [pa, pb] = await Promise.all([core.call('getFeel', { key: a }), core.call('getFeel', { key: b })]);
    assert.notEqual(pa.profile, p1, 'a new index');
    assert.deepEqual(pa.profile.descriptors, p1.descriptors, "Alpha's own feel is unchanged");
    assert.ok(pb.profile.descriptors.some(d => d.id === 'eerie' || d.id === 'terrifying'), 'the new text shows');

    core.close();
    assert.ok(fs.existsSync(path.join(dir, 'feel-memo.bin')), 'close() saved the unsaved work');
    const core2 = createCore({ dataDir: dir, fetch: fake404, onEvent: () => {} });
    try {
      const again = await core2.call('getFeel', { key: b });
      assert.deepEqual(again.profile, pb.profile, 'the next launch reads the same feel from the saved work');
    } finally { core2.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
