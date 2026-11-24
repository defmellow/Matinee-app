// PROTOTYPE copy of library/FilterPanel.jsx without its Feel group (feelings have their own place in each design).
// `layout`: 'panel' (the Library's bar) or 'column' (stacked, for a side column).
// `only`: one section id from FILM_SECTIONS (the Add picker shows one at a time, each in full); omitted, all of them.
import { useState } from 'preact/hooks';
import { ChipToggle, Chip } from '../../../components/ui.jsx';
import RuntimeSlider from '../../../components/RuntimeSlider.jsx';

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

/** Your rating, runtime and Matinee score live on the Library's top bar, not in the panel. */
export function RatingRange({ q, set }) {
  return (
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
  );
}
export const SCORE_STEPS = [60, 70, 80];
export const ratingText = q => (q.ratingMin != null && q.ratingMax != null ? `Rated ${starsLabel(q.ratingMin)}–${starsLabel(q.ratingMax)} ★`
  : q.ratingMin != null ? `Rated ${starsLabel(q.ratingMin)} ★ and up` : q.ratingMax != null ? `Rated up to ${starsLabel(q.ratingMax)} ★` : 'Any rating');

/** The sections, in order, with how many of each are chosen; a section with nothing to offer is left out. */
export function filmSections(q, data) {
  const { facets, tags, autoTags } = data;
  const autoOn = g => q.autoTags.filter(id => autoTags.some(t => t.id === id && t.group === g)).length;
  return [
    { id: 'genres', label: 'Genres', has: facets.genres.length > 0, on: q.genres.length },
    { id: 'decades', label: 'Decades', has: facets.decades.length > 0, on: q.decade != null ? 1 : 0 },
    { id: 'countries', label: 'Countries', has: facets.countries.length > 0, on: q.countries.length },
    { id: 'languages', label: 'Languages', has: (facets.languages || []).length > 0, on: q.languages.length },
    { id: 'tags', label: 'Your tags', has: tags.some(t => t.count > 0), on: q.tags.length },
    ...AUTO_GROUPS.map(([g, label]) => ({ id: g, label, has: autoTags.some(t => t.group === g), on: autoOn(g) })),
  ].filter(x => x.has);
}
const RATING_STEPS = Array.from({ length: 10 }, (_, i) => i + 1); // 1..10 half-stars
const starsLabel = v => `${v / 2}`;

export default function LibFilters({ q, set, data, layout = 'panel', bare = false, only = null }) {
  const [moreGenres, setMoreGenres] = useState(!!only);
  const [moreLangs, setMoreLangs] = useState(!!only);
  const show = id => !only || only === id;
  const { facets, tags, autoTags } = data;
  const genres = moreGenres ? facets.genres : facets.genres.slice(0, 14);
  const countries = only ? facets.countries : facets.countries.slice(0, 12);
  // Languages: the most common first; Silent and No dialogue always show when any film has them (they're rare but asked for).
  const allLangs = facets.languages || [];
  const special = allLangs.filter(l => l.name === 'Silent' || l.name === 'No dialogue');
  const langs = moreLangs ? allLangs : [...allLangs.filter(l => !special.includes(l)).slice(0, 12), ...special];
  const shownLangs = [...langs, ...q.languages.filter(l => !langs.some(x => x.name === l)).map(l => ({ name: l }))];
  // keep a chosen genre visible even when it's past the top 14
  const shownGenres = moreGenres ? genres : [...genres, ...q.genres.filter(g => !genres.some(x => x.name === g)).map(g => ({ name: g }))];
  const myTags = tags.filter(t => t.count > 0).slice(0, only ? Infinity : 40);

  return (
    <div class={`lib-filters pl-lf-${layout}${bare ? '' : ' panel'}`} id="lib-filters">
      {show('genres') && <Group title="Genres">
        {shownGenres.map(g => <ChipToggle key={g.name} on={q.genres.includes(g.name)} onClick={() => set({ genres: toggle(q.genres, g.name) })}>{g.name}{g.count != null && <span class="lib-n">{g.count}</span>}</ChipToggle>)}
        {!only && facets.genres.length > 14 && <Chip class="lib-more" onClick={() => setMoreGenres(v => !v)}>{moreGenres ? 'Fewer' : `More (${facets.genres.length - 14})`}</Chip>}
      </Group>}
      {show('decades') && <Group title="Decades">
        {facets.decades.map(d => <ChipToggle key={d.name} on={q.decade === d.yearMin} onClick={() => set({ decade: q.decade === d.yearMin ? null : d.yearMin })}>{d.name}<span class="lib-n">{d.count}</span></ChipToggle>)}
      </Group>}
      {show('countries') && <Group title="Countries">
        {countries.map(c => <ChipToggle key={c.name} on={q.countries.includes(c.name)} onClick={() => set({ countries: toggle(q.countries, c.name) })}>{c.name}<span class="lib-n">{c.count}</span></ChipToggle>)}
      </Group>}
      {show('languages') && allLangs.length > 0 && (
        <Group title="Languages">
          {shownLangs.map(l => <ChipToggle key={l.name} on={q.languages.includes(l.name)} onClick={() => set({ languages: toggle(q.languages, l.name) })}>{l.name}{l.count != null && <span class="lib-n">{l.count}</span>}</ChipToggle>)}
          {!only && allLangs.length > 14 && <Chip class="lib-more" onClick={() => setMoreLangs(v => !v)}>{moreLangs ? 'Fewer' : `More (${allLangs.length - langs.length})`}</Chip>}
        </Group>
      )}
      {show('tags') && myTags.length > 0 && (
        <Group title="Your tags">
          {myTags.map(t => <ChipToggle key={t.name} on={q.tags.includes(t.name)} onClick={() => set({ tags: toggle(q.tags, t.name) })}>{t.name}<span class="lib-n">{t.count}</span></ChipToggle>)}
        </Group>
      )}
      {AUTO_GROUPS.map(([g, label]) => {
        const list = autoTags.filter(t => t.group === g).slice(0, only ? Infinity : 16);
        return show(g) && list.length ? (
          <Group key={g} title={label}>
            {list.map(t => <ChipToggle key={t.id} on={q.autoTags.includes(t.id)} onClick={() => set({ autoTags: toggle(q.autoTags, t.id) })}>{t.label}<span class="lib-n">{t.count}</span></ChipToggle>)}
          </Group>
        ) : null;
      })}
      {show('ranges') && <div class="lib-ranges">
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
      </div>}
    </div>
  );
}
