// Generic UI pieces: Dialog, Segmented, Chip, Badge, ChipToggle, BarChart, Loading.
import { useEffect, useRef } from 'preact/hooks';
import Icon from './Icon.jsx';
import { FOCUSABLE, trapTarget, inertAround } from './a11y.js';
import { chipTag } from './chip.js';

export function Dialog({ title, onClose, children, footer }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const box = ref.current;
    // Capture phase + stopPropagation so Escape only closes the dialog, not a handler on the screen behind it.
    const k = e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'Tab' && box) {
        const items = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
        const to = trapTarget(items, document.activeElement, e.shiftKey);
        if (to) { e.preventDefault(); to.focus(); }
      }
    };
    addEventListener('keydown', k, true);
    const undo = box ? inertAround(box.parentElement) : () => {};
    box && box.querySelector('input, textarea, select, button:not(.icon-btn)')?.focus();
    return () => { removeEventListener('keydown', k, true); undo(); prev && prev.focus && prev.focus(); };
  }, []);
  return (
    <div class="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div class="dialog-head"><h2>{title}</h2><button type="button" class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>{footer}</div>}
      </div>
    </div>
  );
}

/** options: [{ value, label }] */
export function Segmented({ value, options, onChange, label }) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map(o => <button type="button" key={o.value} aria-pressed={String(value === o.value)} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

/**
 * The one interactive pill. With `href` it is a link (navigates); otherwise a button (`pressed` makes it a toggle).
 * Anything that only informs is a Badge, never a Chip.
 */
export function Chip({ href, pressed, class: cls = '', children, ...rest }) {
  const Tag = chipTag({ href });
  const props = { class: ('chip ' + cls).trim(), ...rest };
  if (Tag === 'a') props.href = href;
  else { props.type = 'button'; if (pressed != null) props['aria-pressed'] = String(!!pressed); }
  return <Tag {...props}>{children}</Tag>;
}

/** A flat, static label: no border, no hover, not clickable. */
export function Badge({ class: cls = '', children, ...rest }) {
  return <span class={('badge ' + cls).trim()} {...rest}>{children}</span>;
}

export function ChipToggle({ on, onClick, children, title }) {
  return <Chip pressed={on} onClick={onClick} title={title}>{children}</Chip>;
}

export function Loading({ label = 'Loading…' }) {
  return <div class="empty" aria-live="polite"><div class="spinner" /><span>{label}</span></div>;
}

/**
 * Vertical bar chart. data: [{ label, value, title? }]. Scales to the max value; labels every Nth bar when crowded.
 */
export function BarChart({ data, height = 160, format = v => v, highlightLast = false }) {
  if (!data || !data.length) return null;
  const max = Math.max(1, ...data.map(d => d.value));
  const w = 1000, h = height, pad = 22, bw = w / data.length;
  const every = Math.ceil(data.length / 14);
  return (
    <svg class="chart" viewBox={`0 0 ${w} ${h + pad}`} preserveAspectRatio="none" style={{ width: '100%', height: h + pad }} role="img">
      <line class="grid" x1="0" x2={w} y1={h} y2={h} />
      {data.map((d, i) => {
        const bh = (d.value / max) * (h - 14);
        return (
          <g key={i}>
            <rect class={'bar-fill' + (highlightLast && i === data.length - 1 ? '' : (highlightLast ? ' alt' : ''))} x={i * bw + bw * 0.15} y={h - bh} width={bw * 0.7} height={Math.max(bh, d.value ? 1 : 0)} rx="2"><title>{d.title || `${d.label}: ${format(d.value)}`}</title></rect>
            {i % every === 0 && <text x={i * bw + bw / 2} y={h + 15} text-anchor="middle" style={{ fontSize: '22px' }}>{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}
