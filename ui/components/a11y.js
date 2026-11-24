// Small keyboard/focus helpers for dialogs. Pure where possible so they can be tested without a DOM.

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Where Tab should land inside a dialog, or null to let the browser carry on. items: focusable elements in order. */
export function trapTarget(items, active, shift) {
  if (!items.length) return null;
  const first = items[0], last = items[items.length - 1];
  const i = items.indexOf(active);
  if (i === -1) return shift ? last : first;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  return null;
}

/** Make everything on the page except `node` (and its ancestors) inert. Returns a function that undoes it. */
export function inertAround(node) {
  const marked = [];
  for (let el = node; el && el.parentElement; el = el.parentElement) {
    for (const sib of el.parentElement.children) {
      if (sib !== el && !sib.hasAttribute('inert')) { sib.setAttribute('inert', ''); marked.push(sib); }
    }
  }
  return () => { for (const m of marked) m.removeAttribute('inert'); };
}
