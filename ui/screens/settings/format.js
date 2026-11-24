// Small pure helpers for the Settings screen.
const rtf = new Intl.RelativeTimeFormat('en-AU', { numeric: 'auto' });

/** "2 hours ago", "yesterday", or "never" for a missing time. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!t) return 'never';
  const s = Math.round((t - now) / 1000);
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  if (Math.abs(s) < 60) return 'just now';
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.trunc(s / n), u);
  return 'just now';
}

/** Group sync problems by source into plain sentences. problems: [{ provider?, step?, key?, message }] */
export function problemLines(problems, providers = []) {
  const label = id => (providers.find(p => p.id === id) || {}).label || id;
  const groups = new Map();
  for (const p of problems || []) {
    const id = p.provider || p.step || 'other';
    const g = groups.get(id) || { id, count: 0, films: new Set(), message: p.message };
    g.count++; if (p.key) g.films.add(p.key);
    groups.set(id, g);
  }
  return [...groups.values()].map(g => {
    if (g.id === 'import' || g.id === 'refresh' || !g.films.size && g.id !== 'other' && !providers.some(p => p.id === g.id)) {
      return { id: g.id, text: g.message || "Something didn't finish. Try Refresh now." };
    }
    const n = g.films.size || g.count;
    const who = label(g.id);
    return { id: g.id, text: g.films.size
      ? `${who} didn't answer for ${n} ${n === 1 ? 'film' : 'films'} — they'll be retried next time.`
      : `${who} didn't answer. It will be tried again next time.` };
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "412 MB", "1.3 GB", "36 KB": whole numbers from 10 up, one decimal below that. */
export function formatBytes(n) {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, Number(n) || 0), i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  if (i === 0) return `${Math.round(v)} bytes`;
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
