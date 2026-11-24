// The collapsible filter bar: chip groups for genres, decades, countries, tags, auto tags, plus rating/runtime/score.
import { useState } from 'preact/hooks';
import { ChipToggle, Chip } from '../../components/ui.jsx';
import RuntimeSlider from '../../components/RuntimeSlider.jsx';
import FeelFilter from './FeelFilter.jsx';

const toggle = (list, v) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

function Group({ title, children }) {
  return (
    <section class="lib-fgroup">
      <h3 class="eyebrow">{title}</h3>
      <div class="chips">{children}</div>
    </section>
  );
}

const AUTO_GROUPS = [['award', 'Awards'], ['length', 'Length'], ['source', 'Based on'], ['series', 'Series']];
const RATING_STEPS = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10 half-stars
const starsLabel = v => `${v / 2}`;

export default function FilterPanel({ q, set, data, feelFacets }) {
  const [moreGenres, setMoreGenres] = useState(false);
  const [moreLangs, setMoreLangs] = useState(false);
  const { facets, tags, autoTags } = data;
  const genres = moreGenres ? facets.genres : facets.genres.slice(0, 14);
  const countries = facets.countries.slice(0, 12);
  // Languages: the most common first; Silent and No dialogue always show when any film has them (they're rare but asked for).
  const allLangs = facets.languages || [];
  const special = allLangs.filter(l => l.name === 'Silent' || l.name === 'No dialogue');
  const langs = moreLangs ? allLangs : [...allLangs.filter(l => !special.includes(l)).slice(0, 12), ...special];
  const shownLangs = [...langs, ...q.languages.filter(l => !langs.some(x => x.name === l)).map(l => ({ name: l }))];
  // keep a chosen genre visible even when it's past the top 14
  const shownGenres = moreGenres ? genres : [...genres, ...q.genres.filter(g => !genres.some(x => x.name === g)).map(g => ({ name: g }))];
  const myTags = tags.filter(t => t.count > 0).slice(0, 40);

  return (
    <div class="lib-filters panel" id="lib-filters">
      <Group title="Genres">
        {shownGenres.map(g => <ChipToggle key={g.name} on={q.genres.includes(g.name)} onClick={() => set({ genres: toggle(q.genres, g.name) })}>{g.name}{g.count != null && <span class="lib-n">{g.count}</span>}</ChipToggle>)}
        {facets.genres.length > 14 && <Chip class="lib-more" onClick={() => setMoreGenres(v => !v)}>{moreGenres ? 'Fewer' : `More (${facets.genres.length - 14})`}</Chip>}
      </Group>
      <Group title="Decades">
        {facets.decades.map(d => <ChipToggle key={d.name} on={q.decade === d.yearMin} onClick={() => set({ decade: q.decade === d.yearMin ? null : d.yearMin })}>{d.name}<span class="lib-n">{d.count}</span></ChipToggle>)}
      </Group>
      <Group title="Countries">
        {countries.map(c => <ChipToggle key={c.name} on={q.countries.includes(c.name)} onClick={() => set({ countries: toggle(q.countries, c.name) })}>{c.name}<span class="lib-n">{c.count}</span></ChipToggle>)}
      </Group>
      {allLangs.length > 0 && (
        <Group title="Languages">
          {shownLangs.map(l => <ChipToggle key={l.name} on={q.languages.includes(l.name)} onClick={() => set({ languages: toggle(q.languages, l.name) })}>{l.name}{l.count != null && <span class="lib-n">{l.count}</span>}</ChipToggle>)}
          {allLangs.length > 14 && <Chip class="lib-more" onClick={() => setMoreLangs(v => !v)}>{moreLangs ? 'Fewer' : `More (${allLangs.length - langs.length})`}</Chip>}
        </Group>
      )}
      {myTags.length > 0 && (
        <Group title="Your tags">
          {myTags.map(t => <ChipToggle key={t.name} on={q.tags.includes(t.name)} onClick={() => set({ tags: toggle(q.tags, t.name) })}>{t.name}<span class="lib-n">{t.count}</span></ChipToggle>)}
        </Group>
      )}
      {AUTO_GROUPS.map(([g, label]) => {
        const list = autoTags.filter(t => t.group === g).slice(0, 16);
        return list.length ? (
          <Group key={g} title={label}>
            {list.map(t => <ChipToggle key={t.id} on={q.autoTags.includes(t.id)} onClick={() => set({ autoTags: toggle(q.autoTags, t.id) })}>{t.label}<span class="lib-n">{t.count}</span></ChipToggle>)}
          </Group>
        ) : null;
      })}
      <FeelFilter q={q} set={set} facets={feelFacets} />
      <div class="lib-ranges">
        <label class="lib-field">
          <span class="eyebrow">Your rating</span>
          <span class="lib-pair">
            <select class="select" aria-label="Lowest rating" value={q.ratingMin ?? ''} onChange={e => set({ ratingMin: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">Any</option>
              {RATING_STEPS.map(v => <option key={v} value={v}>{starsLabel(v)} ★ and up</option>)}
            </select>
            <span class="muted">to</span>
            <select class="select" aria-label="Highest rating" value={q.ratingMax ?? ''} onChange={e => set({ ratingMax: e.currentTarget.value ? Number(e.currentTarget.value) : null })}>
              <option value="">Any</option>
              {RATING_STEPS.map(v => <option key={v} value={v}>up to {starsLabel(v)} ★</option>)}
            </select>
          </span>
        </label>
        <div class="lib-field">
          <span class="eyebrow">Runtime under</span>
          <RuntimeSlider label="Longest runtime" value={q.runtimeMax} zero={null} onChange={v => set({ runtimeMax: v })} />
        </div>
        <div class="lib-field">
          <span class="eyebrow">Matinee score at least</span>
          <div class="chips">{[60, 70, 80].map(m => <ChipToggle key={m} on={q.scoreMin === m} onClick={() => set({ scoreMin: q.scoreMin === m ? null : m })}>{m}</ChipToggle>)}</div>
        </div>
      </div>
    </div>
  );
}
