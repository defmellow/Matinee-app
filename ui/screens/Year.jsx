// Year in review: a banner for the year, then tabs (highlights, films, taste, people, calendar) and a one-page keepsake card
// that saves as a picture.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCall, useLibrary, toast } from '../state.js';
import { Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import { Stack } from './insights/parts.jsx';
import Icon from '../components/Icon.jsx';
import Tabs from '../components/Tabs.jsx';
import { href, queryOf, useRoute } from '../router.js';
import { n as num, plural } from '../format.js';
import Card from './year/Card.jsx';
import { Highlights, Films, Taste, People, Calendar } from './year/tabs.jsx';
import './insights.css';
import './year.css';

import { reportFailure } from '../debug/report.js';
import DebugInfo from '../debug/DebugInfo.jsx';
import { dataSummary } from '../debug/model.js';
const CARD_W = 1080;
const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

/** The one-page card, scaled to fit, with the button that saves it as a picture. */
function Keepsake({ d, film, library }) {
  const stage = useRef(null);
  const card = useRef(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);
  const [saving, setSaving] = useState(false);

  // Scale the 1080 px card down to fit narrow windows; saving always captures it at full size.
  useLayoutEffect(() => {
    if (!stage.current || !card.current) return;
    const fit = () => {
      const s = Math.min(1, stage.current.clientWidth / CARD_W);
      setScale(s);
      setHeight(card.current.offsetHeight * s);
    };
    fit();
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); }); // a frame later: no resize loop
    ro.observe(stage.current); ro.observe(card.current);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [d, library]);

  const canSave = typeof window !== 'undefined' && window.matinee && typeof window.matinee.saveImage === 'function';
  async function save() {
    if (saving || !card.current) return;
    setSaving(true);
    try {
      card.current.classList.add('year-capture'); // unscaled, pinned top-left, above everything
      await nextFrame();
      const r = card.current.getBoundingClientRect();
      const res = await window.matinee.saveImage({ x: Math.round(r.left), y: Math.round(r.top), width: CARD_W, height: Math.ceil(r.height) }, `Matinee ${d.year} in review`);
      if (res && res.saved) toast('Saved');
    } catch (e) {
      reportFailure('Year in review', "Couldn't save the picture.", e);
      toast("Couldn't save the picture. Try again.");
    } finally {
      card.current.classList.remove('year-capture');
      setSaving(false);
    }
  }
  return (
    <div class="year-keep">
      <div class="year-keep-bar">
        <p class="muted">Your year on one page, ready to keep or share.</p>
        {canSave && <button type="button" class="btn btn-primary" onClick={save} disabled={saving}><Icon name="upload" /> {saving ? 'Saving…' : 'Save as image'}</button>}
      </div>
      <div class="year-stage" ref={stage} style={{ height: height || undefined }}>
        <div class="year-card" ref={card} style={{ width: CARD_W, transform: `scale(${scale})` }}>
          {library ? <Card data={d} film={film} /> : <Loading />}
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'highlights', label: 'Highlights', body: Highlights },
  { id: 'films', label: 'Films', body: Films },
  { id: 'taste', label: 'Taste', body: Taste },
  { id: 'people', label: 'People', body: People },
  { id: 'calendar', label: 'Calendar', body: Calendar },
  { id: 'card', label: 'Keepsake card', body: Keepsake },
];

export default function Year({ param }) {
  const year = Number(param) || undefined;
  const { data: d, error, loading, reload } = useCall('getYear', { year }, [year], { refreshOn: 'library' });
  const library = useLibrary();
  const lib = useMemo(() => new Map(((library && library.films) || []).map(f => [f.key, f])), [library]);
  const film = key => lib.get(key) || null;
  const route = useRoute();
  const want = queryOf(route.qs).t;
  const tab = TABS.find(t => t.id === want) || TABS[0];

  useEffect(() => { document.title = d ? `Matinee · ${d.year} in review` : 'Matinee'; }, [d]);

  if (loading && !d) return <div class="screen"><Loading /></div>;
  if (error || !d) return <div class="screen"><EmptyState title="Your year didn't load" action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Something went wrong reading your diary. Try again, or reopen Matinee.</EmptyState></div>;

  if (!d.years.length) {
    return (
      <div class="screen">
        <div class="screen-head"><h1>Year in review</h1></div>
        <EmptyState title="No diary entries yet" action={<a class="btn btn-primary" href="#/welcome">Import your Letterboxd export</a>}>
          Once you've logged some films, you'll get a recap of your year here, ready to save and share.
        </EmptyState>
      </div>
    );
  }

  const empty = !d.totals.entries;
  const t = d.totals;
  const i = d.years.indexOf(d.year);
  const newer = i > 0 ? d.years[i - 1] : null, older = i >= 0 && i < d.years.length - 1 ? d.years[i + 1] : null;
  const Body = tab.body;
  return (
    <div class="screen year ins">
      <DebugInfo title="Year in review" rows={dataSummary(d)} />
      <header class="year-banner">
        <Stack keys={d.mosaic.map(m => m.key)} lib={lib} max={5} />
        <div class="year-banner-body">
          <div class="year-banner-top">
            <a class="year-back" href={href('insights')}><Icon name="back" size={16} /> Insights</a>
            <div class="year-chips chips" role="group" aria-label="Choose a year">
              {d.years.map(y => <a key={y} class="chip" href={href('year', y)} aria-current={y === d.year ? 'page' : undefined}>{y}</a>)}
            </div>
          </div>
          <div class="year-banner-main">
            <h1 class="year-banner-num num" aria-label={`${d.year} in review`}>
              {older ? <a class="year-step" href={href('year', older)} title={`Back to ${older}`} aria-label={`Back to ${older}`}><Icon name="chevron" size={22} /></a> : <span class="year-step off" aria-hidden="true" />}
              <span>{d.year}</span>
              {newer ? <a class="year-step next" href={href('year', newer)} title={`On to ${newer}`} aria-label={`On to ${newer}`}><Icon name="chevron" size={22} /></a> : <span class="year-step off" aria-hidden="true" />}
            </h1>
            {!empty && (
              <p class="year-banner-line">
                <strong class="num">{plural(t.films, 'film', 'films')}</strong>
                {t.hours > 0 && <span class="num">{num(Math.round(t.hours))} hours</span>}
                {d.ratingAverage != null && <span class="num">{d.ratingAverage.toFixed(2)}★ average</span>}
                {t.reviews > 0 && <span class="num">{plural(t.reviews, 'review', 'reviews')}</span>}
              </p>
            )}
          </div>
        </div>
      </header>

      {empty && <EmptyState title={`Nothing logged in ${d.year}`}>Pick another year above, or log a film in your diary to start this one.</EmptyState>}

      {!empty && (
        <>
          <Tabs tabs={TABS} current={tab.id} label="Year in review sections" hrefFor={id => href('year', d.year, id === 'highlights' ? null : { t: id })} />
          <div class="ins-tab" key={tab.id + d.year}>{library ? <Body d={d} lib={lib} film={film} library={library} /> : <Loading />}</div>
        </>
      )}
    </div>
  );
}
