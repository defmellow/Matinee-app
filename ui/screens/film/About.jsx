// "Details": facts, then the film's auto tags (first 12, the rest behind a "+ N more" chip).
import { useState } from 'preact/hooks';
import { Chip } from '../../components/ui.jsx';
import { filterHref } from '../../components/chip.js';
import { money } from './format.js';

function Fact({ label, children }) {
  return <div class="film-fact"><dt class="eyebrow">{label}</dt><dd>{children}</dd></div>;
}

const TAG_CAP = 12;

export default function About({ film }) {
  const [allTags, setAllTags] = useState(false);
  const list = a => (a && a.length ? a.join(', ') : null);
  // Countries, languages and the series name open the Library filtered by them; studios and sources stay plain text.
  const links = (a, mk) => (a && a.length ? a.map((v, i) => <span key={v}>{i > 0 && ', '}<a class="film-link" href={mk(v)} title={`Films in your library: ${v}`}>{v}</a></span>) : null);
  const quote = v => (/\s/.test(v) ? `"${v}"` : v);
  const col = film.collection && (typeof film.collection === 'string' ? film.collection : film.collection.name);
  const budget = money(film.budget), box = money(film.boxOffice);
  const facts = [
    ['Countries', links(film.countries, v => filterHref('country', v))], ['Languages', links(film.languages, v => filterHref('language', v))], ['Studios', list(film.studios)],
    ['Based on', list(film.basedOn)], ['Part of', col && <a class="film-link" href={filterHref('text', col)} title="Films from this series in your library">{col}</a>], ['Budget', budget], ['Box office', box],
  ].filter(f => f[1]);
  // Countries and languages already have their own linked rows below, so their tags aren't repeated as chips.
  const autoTags = (film.autoTags || []).filter(t => t.group !== 'country' && t.group !== 'language');
  const hasAny = autoTags.length || facts.length;
  const shownTags = allTags ? autoTags : autoTags.slice(0, TAG_CAP);
  return (
    <section class="film-section">
      <h2>Details</h2>
      {!hasAny && <p class="muted">Nothing more is known about this film yet. Matinee fills in details from other sources whenever you refresh.</p>}
      {facts.length > 0 && <dl class="film-facts">{facts.map(([l, v]) => <Fact key={l} label={l}>{v}</Fact>)}</dl>}
      {autoTags.length > 0 && (
        <div class="film-subsection">
          <h3 class="film-sub">Tags</h3>
          <div class="chips film-autotags">
            {shownTags.map(t => <Chip key={t.id} href={filterHref('auto', t.id)} title={`See more films tagged ${t.label}`}>{t.label}</Chip>)}
            {autoTags.length > TAG_CAP && <Chip onClick={() => setAllTags(!allTags)} aria-expanded={allTags}>{allTags ? 'Show fewer' : `+ ${autoTags.length - TAG_CAP} more`}</Chip>}
          </div>
        </div>
      )}
    </section>
  );
}
