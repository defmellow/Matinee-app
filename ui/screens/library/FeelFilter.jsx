// The "Feel" group in the Library filter bar: pick how films feel (wistful, slow-burn, tense…). A film must match every pick.
import { useState } from 'preact/hooks';
import { ChipToggle, Chip } from '../../components/ui.jsx';
import { feelGroups } from './model.js';

const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

export default function FeelFilter({ q, set, facets }) {
  const [all, setAll] = useState(false);
  const groups = feelGroups(facets, q.feel, { expanded: all });
  const hidden = groups.reduce((n, g) => n + g.hidden, 0);
  const empty = facets && !groups.length;
  return (
    <section class="lib-fgroup lib-feel">
      <h3 class="eyebrow">Feel</h3>
      <div class="lib-feel-body">
        {!facets && <p class="muted lib-feel-note">Loading the list of feelings…</p>}
        {empty && <p class="muted lib-feel-note">Feel profiles fill in as films are fetched. They will show up here soon.</p>}
        {groups.map(g => (
          <div class="lib-feel-row" key={g.id}>
            <span class="lib-feel-h faint">{g.title}</span>
            <div class="chips">
              {g.items.map(d => <ChipToggle key={d.id} on={q.feel.includes(d.id)} onClick={() => set({ feel: toggle(q.feel, d.id) })}>{d.label}<span class="lib-n">{d.count}</span></ChipToggle>)}
            </div>
          </div>
        ))}
        {(hidden > 0 || all) && <div class="chips"><Chip class="lib-more" onClick={() => setAll(v => !v)}>{all ? 'Fewer' : `More feelings (${hidden})`}</Chip></div>}
        {q.feel.length > 1 && <p class="faint lib-feel-note">Showing films that match all {q.feel.length} feelings.</p>}
      </div>
    </section>
  );
}
