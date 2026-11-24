// Small formatting helpers for the film page.
export function money(n) {
  if (!n) return null;
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + n;
}

export function hueOf(str) {
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export const ROLE_LABELS = {
  director: 'Director', writer: 'Writer', cinematography: 'Cinematography', composer: 'Music',
  editor: 'Editing', producer: 'Producer', cast: 'Cast',
};

/** 'cast:Travis' -> 'as Travis'; 'director' -> 'Director'; plain 'cast' -> 'Actor'. */
export function roleText(role) {
  if (role.startsWith('cast:')) return 'as ' + role.slice(5);
  if (role === 'cast') return 'Actor';
  return ROLE_LABELS[role] || role;
}
