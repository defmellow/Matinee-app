import { useEffect, useRef, useState } from 'preact/hooks';
import './tooltip.css';

const DELAY = 300;
const OFFSET_Y = 14; // gap between the pointer and the box

// The one hover box for the whole app. It replaces the browser's plain `title` box, listens on the whole
// document (so every existing `title="…"` and SVG <title> picks it up), and sits just above the pointer,
// following it while it moves. A native title becomes data-tip the first time it is hovered (else both boxes show).
export default function Tooltip() {
  const [tip, setTip] = useState(null); // { text, below }
  const box = useRef(null);
  const s = useRef({ el: null, timer: 0, x: 0, y: 0, restore: null, focus: false }).current;

  const place = () => {
    const b = box.current; if (!b) return;
    const w = b.offsetWidth, h = b.offsetHeight;
    const below = s.y - OFFSET_Y - h < 8;
    const left = Math.min(Math.max(s.x - w / 2, 8), window.innerWidth - w - 8);
    const top = below ? s.y + 22 : s.y - OFFSET_Y - h;
    b.style.left = `${left}px`; b.style.top = `${top}px`;
    b.classList.toggle('tip-below', below);
  };

  useEffect(() => {
    const hide = () => {
      clearTimeout(s.timer);
      if (s.restore) { s.restore(); s.restore = null; }
      s.el = null; s.focus = false;
      setTip(null);
    };
    // A native title is turned into data-tip for good (never put back), on the element and every ancestor, so the browser's own box
    // can't appear beside ours: putting it back on mouseout let it show whenever the pointer drifted to a neighbour. Text that only
    // lived in the title stays available to screen readers as aria-label (no visible text) or aria-description.
    const settle = (el) => {
      const attr = el.getAttribute?.('title');
      if (!attr) return;
      el.removeAttribute('title');
      el.dataset.tip = attr; // a title set again by a re-render is the fresher text
      if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', attr);
      else if (!el.hasAttribute('aria-description') && el.textContent.trim() !== attr) el.setAttribute('aria-description', attr);
    };
    // A box that only repeats what is already on screen is noise ("Travis Henderson" over "Travis Henderson"): it shows only when
    // the text is cut off (ellipsis or line clamp). THE rule for the whole app, so screens never need to think about it.
    const flat = t => String(t || '').toLowerCase().replace(/[·/]/g, ' ').replace(/\s+/g, ' ').trim();
    const cutOff = el => [el, ...el.querySelectorAll('*')].some(n => n.clientWidth > 0
      && (n.scrollWidth > n.clientWidth + 1 || (n.clientHeight > 0 && n.scrollHeight > n.clientHeight + 1)));
    const repeats = (el, text) => flat(el.textContent) === flat(text) && !cutOff(el);
    // Hovers that already open their own box (rating notes, poster cards) get no second box from here.
    const ownsHover = (el) => el.classList?.contains('src-pop-host') || el.hasAttribute?.('data-pop') || (el.localName === 'a' && el.querySelector?.('.poster'));
    // Find what to show for the pointer's target.
    const lift = (t) => {
      for (let el = t; el && el !== document.body; el = el.parentElement) settle(el);
      for (let el = t; el && el !== document.body; el = el.parentElement) {
        // a feel colour (a poster's line or ring, a coloured word) names its colour, only while the colours are on
        if (el.dataset?.feelTip) return document.documentElement.dataset.feelColours === 'on' ? { el, text: el.dataset.feelTip, restore: null } : null;
        if (ownsHover(el)) return null;
        if (el.dataset?.tip) return repeats(el, el.dataset.tip) ? null : { el, text: el.dataset.tip, restore: null };
        const svgTitle = [...(el.children || [])].find(c => c.localName === 'title' && c.namespaceURI?.includes('svg'));
        if (svgTitle) {
          el.removeChild(svgTitle);
          return { el, text: svgTitle.textContent, restore: () => el.prepend(svgTitle) };
        }
      }
      return null;
    };
    const over = (e) => {
      // still inside what the box is about: keep it, unless the pointer reached a feel colour inside it (a poster ring in its button)
      const feel = e.target.closest?.('[data-feel-tip]');
      if (s.el && s.el.contains(e.target) && !(feel && feel !== s.el)) return;
      hide();
      const hit = lift(e.target);
      if (!hit || !hit.text) { hit?.restore?.(); return; }
      s.el = hit.el; s.restore = hit.restore; s.x = e.clientX; s.y = e.clientY;
      s.timer = setTimeout(() => setTip({ text: hit.text }), DELAY);
    };
    const move = (e) => { if (s.focus) return; s.x = e.clientX; s.y = e.clientY; if (box.current && box.current.classList.contains('tip-on')) place(); };
    const out = (e) => { if (s.el && !(e.relatedTarget && s.el.contains(e.relatedTarget))) hide(); };
    // Keyboard focus shows the same box, anchored to the element (mouse clicks that focus a control are skipped).
    const focusin = (e) => {
      if (!e.target.matches?.(':focus-visible')) return;
      hide();
      const hit = lift(e.target);
      if (!hit || !hit.text) { hit?.restore?.(); return; }
      const r = hit.el.getBoundingClientRect();
      s.el = hit.el; s.restore = hit.restore; s.focus = true; s.x = r.left + r.width / 2; s.y = r.top;
      s.timer = setTimeout(() => setTip({ text: hit.text }), DELAY);
    };
    const focusout = () => { if (s.focus) hide(); };
    document.addEventListener('focusin', focusin);
    document.addEventListener('focusout', focusout);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('mousemove', move);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  const last = useRef('');
  if (tip) last.current = tip.text;
  useEffect(() => { if (tip) place(); }, [tip]);
  return <div ref={box} role="tooltip" class={`tip${tip ? ' tip-on' : ''}`}>{last.current}</div>;
}
