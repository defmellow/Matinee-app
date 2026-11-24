// The tab strip: links, so Back and Forward step through the tabs. One pill slides under the current tab.
import { useEffect, useRef } from 'preact/hooks';

/** tabs: [{ id, label }]; `hrefFor(id)` gives each tab's link; `label` names the strip for screen readers. */
export default function Tabs({ tabs, current, hrefFor, label }) {
  const nav = useRef(null);
  useEffect(() => { // place the sliding pill under the current tab
    const el = nav.current, on = el && el.querySelector('[aria-current="page"]');
    if (!on) return;
    el.style.setProperty('--x', on.offsetLeft + 'px');
    el.style.setProperty('--w', on.offsetWidth + 'px');
    on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current, tabs.length]);
  const onKey = e => { // arrow keys move along the strip
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const links = [...nav.current.querySelectorAll('a')], i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    links[(i + (e.key === 'ArrowRight' ? 1 : links.length - 1)) % links.length].focus();
  };
  return (
    <nav class="tabs" aria-label={label} ref={nav} onKeyDown={onKey}>
      <span class="tabs-pill" aria-hidden="true" />
      {tabs.map(t => <a key={t.id} href={hrefFor(t.id)} aria-current={t.id === current ? 'page' : undefined}>{t.label}</a>)}
    </nav>
  );
}
