// "Less motion": on when the Settings switch is on (data-motion="less" on <html>, set in app.jsx) or Windows asks for fewer animations.
// CSS checks the same two things (base.css); JS animations ask lessMotion() at the moment they start.
export function lessMotion() {
  try { if (document.documentElement.dataset.motion === 'less') return true; } catch { /* no document (tests) */ }
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
