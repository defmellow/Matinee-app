// Plain-words summary of what an import brought in: "135 films watched · 545 on your watchlist · 110 diary entries".
const n = v => Number(v || 0).toLocaleString('en-AU');

export function countsText(s) {
  if (!s) return '';
  const parts = [];
  if (s.watched) parts.push(`${n(s.watched)} ${s.watched === 1 ? 'film' : 'films'} watched`);
  if (s.watchlist) parts.push(`${n(s.watchlist)} on your watchlist`);
  if (s.entries) parts.push(`${n(s.entries)} diary ${s.entries === 1 ? 'entry' : 'entries'}`);
  return parts.join(' · ');
}

/** Read a chosen file and hand it to the core. Resolves with the import summary; throws the core's friendly message. */
export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}
