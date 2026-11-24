// Pure placement for the poster hover card. All numbers are viewport pixels.
export const POP_W = 300;

/**
 * Where to put a card of `size` {w,h} next to `anchor` {left,top,right,bottom} inside `vp` {w,h}.
 * Prefers the right of the poster, then the left, then below, then above; always clamped on screen.
 * Returns { left, top, side, ox, oy } where ox/oy are the transform origin (px inside the card) pointing back at the poster.
 */
export function placePop(anchor, size, vp, { gap = 12, margin = 8 } = {}) {
  const { w, h } = size;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const midY = (anchor.top + anchor.bottom) / 2, midX = (anchor.left + anchor.right) / 2;
  let side, left, top;
  if (anchor.right + gap + w + margin <= vp.w) side = 'right';
  else if (anchor.left - gap - w >= margin) side = 'left';
  else if (anchor.bottom + gap + h + margin <= vp.h) side = 'below';
  else if (anchor.top - gap - h >= margin) side = 'above';
  else side = anchor.right + gap + w <= vp.w ? 'right' : 'left';

  if (side === 'right' || side === 'left') {
    left = side === 'right' ? anchor.right + gap : anchor.left - gap - w;
    top = clamp(anchor.top, margin, vp.h - h - margin);
  } else {
    left = clamp(midX - w / 2, margin, vp.w - w - margin);
    top = side === 'below' ? anchor.bottom + gap : anchor.top - gap - h;
  }
  left = clamp(left, margin, vp.w - w - margin);
  const ox = side === 'right' ? 0 : side === 'left' ? w : clamp(midX - left, 0, w);
  const oy = side === 'below' ? 0 : side === 'above' ? h : clamp(midY - top, 0, h);
  return { left, top, side, ox, oy };
}

/** First sentence-ish of a synopsis, cut to `max` characters at a word end. */
export function oneLine(text, max = 140) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /^.+?[.!?](?=\s|$)/.exec(t);
  const first = m && m[0].length >= 30 ? m[0] : t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:.-]+$/, '') + '…';
}

/** "Directed by A" or "Directed by A and B" from a film's people ({ director: [{ name }] }); '' when there is no director. */
export function directedBy(people) {
  const names = [...new Set(((people && people.director) || []).map(p => p && p.name).filter(Boolean))].slice(0, 2);
  return names.length ? `Directed by ${names.join(' and ')}` : '';
}
