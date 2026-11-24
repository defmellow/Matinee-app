// Describe-a-feeling side panel: text box, scope, chip groups, active filters.
import { lessMotion } from '../../motion.js';
import { useMemo, useState, useRef, useEffect } from 'preact/hooks';
import Icon from '../../components/Icon.jsx';
import { Segmented, Chip } from '../../components/ui.jsx';
import { lbPillLabel } from '../../../core/analysis/feel/lbthemes.js';
import { SCOPES, facetSections, matchingTags, pickTag, capFacets, chipState, cycleChip, removeFilter, hasFilters, labelIndex } from './model.js';

const CHIP_HINT = 'Click to include, click again to leave out, once more to clear';

function FacetChip({ item, filters, onChange }) {
  const kind = item.kind;
  const st = chipState(filters, kind, item.id);
  return (
    <Chip class="byf-chip" data-state={st} pressed={st === 'in'} title={`${item.label}. ${CHIP_HINT}`}
      onClick={() => onChange(cycleChip(filters, kind, item.id))}>
      {st === 'out' && <Icon name="ban" size={12} />}
      <span class="byf-chip-l">{item.label}</span>
      <span class="byf-chip-n num">{item.count}</span>
    </Chip>
  );
}

function Group({ title, items, filters, onChange, open: startOpen = true }) {
  const [open, setOpen] = useState(startOpen);
  const [all, setAll] = useState(false);
  if (!items || !items.length) return null;
  const chosen = [...filters.descriptors, ...filters.themes, ...filters.avoid];
  // Long lists (subjects, places…) browse only tags on 2+ films, in their own scroll box; the search box finds the rest.
  const long = items.length > 40;
  const browse = long ? items.filter(it => it.count >= 2 || chosen.includes(it.id)) : items;
  const { shown, hidden } = capFacets(browse, { expanded: all, chosen });
  const findAll = () => { const box = document.querySelector('.byf-filters [data-search]'); if (box) { box.scrollIntoView({ block: 'center', behavior: lessMotion() ? 'auto' : 'smooth' }); box.focus({ preventScroll: true }); } };
  return (
    <section class="byf-group">
      <button type="button" class="byf-group-h" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
        <span class="byf-chev" data-open={String(open)}><Icon name="chevron" size={14} /></span>
        <span>{title}</span>
        <span class="faint num">{items.length}</span>
      </button>
      {open && (
        <>
          <div class={`chips byf-chips${all && long ? ' byf-scroll' : ''}`}>
            {shown.map(it => <FacetChip key={it.id} item={it} filters={filters} onChange={onChange} />)}
            {hidden > 0 && <Chip class="byf-more" onClick={() => setAll(true)}>Show {hidden} more</Chip>}
            {all && browse.length > 12 && <Chip class="byf-more" onClick={() => setAll(false)}>Show fewer</Chip>}
          </div>
          {long && (all || hidden > 0) && (
            <p class="byf-findall faint">Showing tags on 2 or more films. <button type="button" class="feel-link" onClick={findAll}>Search all {items.length}</button></p>
          )}
        </>
      )}
    </section>
  );
}

// Clear the old TEMP layout choice (the switch is gone; Dropdown stayed, 10 Nov).
try { localStorage.removeItem('matinee.feelSearchLayout'); } catch {}

/** The matching tags as a floating list under the search box. Nothing below it moves. */
function FoundDropdown({ tags, active, setActive, onPick }) {
  const optId = i => `byf-opt-${i}`;
  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(optId(active));
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div class="byf-drop" onMouseDown={e => e.preventDefault()}>
      <ul class="byf-drop-list" role="listbox" id="byf-listbox" aria-label="Matching tags">
        {tags.map((t, i) => (
          <li key={t.section + t.id} id={optId(i)} role="option" aria-selected={String(i === active)} data-active={String(i === active)}
            onMouseEnter={() => setActive(i)} onClick={() => onPick(t)}>
            <span class="byf-drop-l">{t.label}</span>
            <span class="byf-drop-s">{t.section}</span>
            {t.count > 0 && <span class="byf-drop-n num">{t.count}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Filters({ facets, filters, onChange, scope, onScope }) {
  const labels = labelIndex(facets);
  const sections = useMemo(() => facetSections(facets), [facets]);
  const chosenIds = [...filters.descriptors, ...filters.themes, ...filters.avoid];
  const found = useMemo(() => matchingTags(sections, filters.text, { exclude: chosenIds }), [sections, filters.text, chosenIds.join('|')]);
  const active = [
    ...filters.descriptors.map(id => ({ id, out: false })), ...filters.themes.map(id => ({ id, out: false })),
    ...filters.avoid.map(id => ({ id, out: true })),
  ];
  const [open, setOpen] = useState(false);
  const [activeRow, setActiveRow] = useState(-1);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => setActiveRow(-1), [found]);
  const showing = open && found.tags.length > 0;
  const pick = t => {
    const f = pickTag(filters, t);
    onChange(f);
    if (inputRef.current) inputRef.current.focus();
    setOpen(false); // after focus(), which would reopen it
  };
  const onKeyDown = e => {
    if (e.key === 'Escape') {
      if (showing) { e.preventDefault(); e.stopPropagation(); setOpen(false); } // keep the typed text
      return;
    }
    if (!showing) return;
    const n = found.tags.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveRow(activeRow < 0 ? 0 : (activeRow + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveRow(activeRow <= 0 ? n - 1 : activeRow - 1); }
    else if (e.key === 'Enter' && activeRow >= 0 && found.tags[activeRow]) { e.preventDefault(); pick(found.tags[activeRow]); }
  };
  return (
    <div class="byf-filters">
      <div class="byf-searchbox">
        <div class="byf-inputwrap" ref={boxRef} onFocusIn={() => setOpen(true)}
          onFocusOut={e => { if (!boxRef.current || !boxRef.current.contains(e.relatedTarget)) setOpen(false); }}>
        <label class="search byf-search">
          <Icon name="search" />
          <input class="input" data-search type="search" value={filters.text} placeholder="A feeling, e.g. quietly sad" ref={inputRef}
            aria-label="Describe a feeling" autocomplete="off"
            role="combobox" aria-expanded={String(showing)} aria-controls={showing ? 'byf-listbox' : undefined}
            aria-activedescendant={showing && activeRow >= 0 ? `byf-opt-${activeRow}` : undefined}
            onClick={() => setOpen(true)} onKeyDown={onKeyDown}
            onInput={e => { setOpen(true); onChange({ ...filters, text: e.currentTarget.value }); }} />
        </label>
        {showing && <FoundDropdown tags={found.tags} active={activeRow} setActive={setActiveRow} onPick={pick} />}
        </div>
      </div>
      <Segmented label="Which films" value={scope} options={SCOPES} onChange={onScope} />
      {(active.length > 0 || filters.text) && (
        <div class="byf-active" aria-label="Active filters">
          <div class="chips">
            {active.map(a => (
              <Chip key={a.id} class="byf-chip" data-state={a.out ? 'out' : 'in'} pressed={!a.out}
                title="Remove this filter" onClick={() => onChange(removeFilter(filters, a.id))}>
                {a.out && <span class="byf-not">not</span>}
                <span class="byf-chip-l">{labels.get(a.id) || (a.id.startsWith('lb:') ? lbPillLabel(a.id.slice(3)) : a.id.replace(/^set:/, ''))}</span>
                <Icon name="close" size={12} className="x" />
              </Chip>
            ))}
          </div>
          {hasFilters(filters) && <button type="button" class="btn btn-ghost btn-small" onClick={() => onChange({ text: '', descriptors: [], themes: [], avoid: [] })}>Clear all</button>}
        </div>
      )}
      {!facets && <p class="muted">Loading the list of feelings…</p>}
      {sections.map((g, i) => {
        return <Group key={g.id} title={g.label} items={g.items} filters={filters} onChange={onChange} open={i < 3} />;
      })}
    </div>
  );
}
