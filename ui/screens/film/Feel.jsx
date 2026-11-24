// "How it feels": the film's feel profile (with whose voice each signal is), its nearest films by feel,
// and "like this, but…" shifts. Loads after the page renders; a failure says so here (and is recorded).
import { touchesKey } from '../../libraryPatch.js';
import './feel.css';
import { useState } from 'preact/hooks';
import { useCall, useCore } from '../../state.js';
import { go, href } from '../../router.js';
import { Poster } from '../../components/film.jsx';
import DebugInfo, { DebugError } from '../../debug/DebugInfo.jsx';
import { Chip as ActionChip } from '../../components/ui.jsx';
import { colourWords } from '../../feel-colours.js'; // TEMP feel colours: the headline's feeling words
import { h } from 'preact';
import { sectionsOf } from '../../../core/analysis/feel/sections.js';
import { VOICE_LABEL, FACET_LABEL, groupByFacet, chipTitle, caption, basisText, sureNote, rowView, showTmdbHint, shiftButtons, shiftHeading, isEmptyProfile, aboutChips, ABOUT_LIMIT } from './feelModel.js';

const FEEL_ROWS = ['mood', 'tone', 'pace', 'craft', 'impact'];
const ROW_NOUN = { mood: 'mood', tone: 'tone', pace: 'pace', craft: 'craft', impact: 'emotional impact' };
/** A row with nothing in it keeps its place and says so, so no category seems to vanish. */
const EmptyRow = ({ label, children }) => <div class="feel-group"><span class="feel-group-label">{label}</span><span class="faint feel-none">{children}</span></div>;

const LIMIT = 8;
// The Themes row: Letterboxd tags plus the engine themes. Up to twelve, so that a Letterboxd hint is not pushed off the end now that
// shade goes by a theme's own strength (at eight, ten films lost one). Twelve is the most any film of hers has.
const THEME_ROW_MAX = 12;

function Chip({ d }) {
  return (
    <a class={`feel-chip facet-${d.facet} w${d.weight}${d.fragile ? ' fragile' : ''}`} href={href('feel', `d:${d.id}`)} title={chipTitle(d)}>{d.label}</a>
  );
}

/** A tag from Letterboxd's theme groups; a light hint when the film's own words didn't confirm it. */
function LbChip({ d, cls }) {
  const tip = d.hint
    ? "A hint from Letterboxd's themes for this film. Click to find films in your library with it"
    : "From Letterboxd's themes for this film. Click to find films in your library with it";
  return <a class={`feel-chip ${cls} w${d.weight}`} href={href('feel', d.id)} title={tip}>{d.label}</a>;
}

function Skeleton() {
  return (
    <div class="feel-skel" aria-hidden="true">
      <div class="feel-skel-line" style={{ width: '60%' }} />
      <div class="feel-skel-chips">{[70, 90, 60, 80, 100, 66].map((w, i) => <span key={i} style={{ width: w }} />)}</div>
      <div class="feel-skel-row">{[0, 1, 2, 3, 4, 5].map(i => <span key={i} />)}</div>
    </div>
  );
}

function Tile({ r }) {
  const f = r.film;
  if (!f) return null;
  return (
    <a class="feel-tile" href={href('film', f.key)} title={`${f.title}${f.year ? ` (${f.year})` : ''}`}>
      <Poster film={f} />
      <span class="feel-tile-title">{f.title}</span>
      <span class="feel-tile-why">{caption(r)}</span>
    </a>
  );
}

function Rail({ filmKey, shift }) {
  const method = shift ? 'shiftFeel' : 'getFeelSimilar';
  const args = shift ? { key: filmKey, axis: shift.axis, dir: shift.dir, limit: LIMIT } : { key: filmKey, limit: LIMIT };
  const { data, loading } = useCall(method, args, [filmKey, shift?.id || '']);
  const rows = (data || []).filter(r => r.film);
  if (loading && !rows.length) return <div class="feel-skel-row" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(i => <span key={i} />)}</div>;
  if (!rows.length) return <p class="muted feel-note">{shift ? 'Nothing in your library moves that way from this film.' : 'No close matches in your library yet.'}</p>;
  return <div class="feel-rail">{rows.map(r => <Tile key={r.key} r={r} />)}</div>;
}

// Debug mode: the numbers behind the chips (score and facet for each descriptor), strongest first.
function feelDebug(profile, summary) {
  const ds = [...(profile.descriptors || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
  const rows = {
    descriptors: ds.length, 'Letterboxd tags': (profile.lbTags || []).length, themes: (profile.themes || []).length, places: (profile.settings || []).length,
    voices: profile.voices && (typeof profile.voices === 'object' ? JSON.stringify(profile.voices) : profile.voices),
    'text volume': profile.words || profile.textWords || (profile.volume && JSON.stringify(profile.volume)),
    headline: summary && summary.headline,
    'how sure': profile.certainty && `${profile.certainty.label} (${profile.certainty.score}) · ${profile.certainty.words} words · ${(profile.certainty.voices || []).join(', ')} · ${profile.certainty.agreed}/${profile.certainty.feelings} feelings agreed`,
  };
  const top = ds.slice(0, 30).map(d => `${d.label} ${d.facet}${d.score != null ? ' ' + Number(d.score).toFixed(2) : ''}${d.weight != null ? ' w' + d.weight : ''}`);
  return { ...rows, 'strongest first': top };
}

export default function Feel({ film }) {
  const key = film.key;
  const core = useCore();
  const { data: feel, loading, error: feelError, reload: reloadFeel } = useCall('getFeel', { key }, [key], { refreshOn: { event: 'library', when: p => touchesKey(p, key) } });
  const { data: axes } = useCall('getFeelAxes', {}, []);
  const [shift, setShift] = useState(null);
  const [lastKey, setLastKey] = useState(key);
  const [allAbout, setAllAbout] = useState(false);
  const [allFeel, setAllFeel] = useState(false); // every feeling row opened out ("Show more")
  if (lastKey !== key) { setLastKey(key); setShift(null); setAllAbout(false); setAllFeel(false); }

  if (loading && !feel) return <section class="film-section feel"><h2>How it feels</h2><Skeleton /></section>;
  if (!feel) {
    if (!feelError) return null;
    return (
      <section class="film-section feel">
        <h2>How it feels</h2>
        <p class="muted">Couldn't work out how this film feels just now. <button type="button" class="btn btn-small" onClick={reloadFeel}>Try again</button></p>
        <DebugError error={feelError} what="getFeel" />
      </section>
    );
  }

  const hasKey = !!core?.settings?.keys?.tmdb;
  const empty = isEmptyProfile(feel);
  const { profile, summary } = feel;
  const groups = groupByFacet(profile.descriptors).map(g => g.facet === 'pace' ? { ...g, items: g.items.slice(0, 3) } : g);
  // Themes row = the big ideas the engine found in the words (theme descriptors). Subjects = specific topics, Kind of film = genre/form/source, eras join Set in.
  const themeItems = groups.filter(g => g.facet === 'theme').flatMap(g => g.items);
  const themeLabels = themeItems.map(d => d.label);
  // Letterboxd's theme groups arrive split into short tags, each for its own row (core/analysis/feel/lbthemes.js).
  const lbTags = (profile.lbTags || []).filter(t => t.shown);
  const lbOf = row => lbTags.filter(t => t.row === row).map((t, i) => ({
    id: 'lb:' + t.label, label: t.label, lb: true, hint: !t.confirmed, weight: !t.confirmed ? 1 : i < 2 ? 3 : 2,
  }));
  const lbThemes = lbTags.filter(t => t.row === 'theme').map(t => t.label);
  const lbWords = new Set(lbThemes.flatMap(l => String(l).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3).map(w => w.replace(/(ing|es|s)$/, ''))));
  // Short labels ("War") are skipped by the word check, so also hide one that appears whole in a group name ("War and historical adventure").
  const lbText = ' ' + lbThemes.map(l => String(l).toLowerCase().replace(/[^a-z]+/g, ' ')).join(' | ') + ' ';
  const sayAlready = d => lbText.includes(' ' + String(d.label).toLowerCase().replace(/[^a-z]+/g, ' ').trim() + ' ')
    || String(d.label).toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3).some(w => lbWords.has(w.replace(/(ing|es|s)$/, '')));
  const ideaChips = themeItems.filter(d => !sayAlready(d));
  const themeRow = [...lbOf('theme'), ...ideaChips]
    .map((d, i) => ({ d, i })).sort((a, b) => (b.d.weight - a.d.weight) || (a.i - b.i)).map(x => x.d).slice(0, THEME_ROW_MAX); // strongest first; Letterboxd groups win ties
  const sec = sectionsOf(profile.themes, themeLabels, (profile.settings || []).map(x => x.label), (profile.descriptors || []).filter(d => d.facet !== 'theme' && !d.fragile).map(d => d.label)); // a fragile chip never takes a label out of Subjects
  const themes = aboutChips(sec.subjects);
  const kind = aboutChips(sec.kind).slice(0, 4);
  const notIn = (list, items) => list.filter(x => !items.some(y => String(y.label).toLowerCase() === x.label.toLowerCase()));
  // Strongest first in every row; on a tie an unconfirmed hint goes last, otherwise the order given is kept (Letterboxd's first).
  const byStrength = list => list.map((d, i) => ({ d, i })).sort((a, b) => (b.d.weight - a.d.weight) || (!!a.d.hint - !!b.d.hint) || (a.i - b.i)).map(x => x.d);
  const lbSubjects = notIn(lbOf('subject'), themes);
  const subjectRow = byStrength([...lbSubjects, ...themes]);
  const shownSubjects = allAbout ? subjectRow : subjectRow.slice(0, ABOUT_LIMIT + lbSubjects.length); // Letterboxd's tags don't use up the limit
  const kindRow = byStrength([...notIn(lbOf('kind'), kind), ...kind]);
  const settings = [...(profile.settings || []), ...sec.eras];
  const headline = summary?.headline;
  // Every feeling row stays on the page once the film shows any feeling: a row with only unsure chips shows
  // them dashed, and an empty row says so, so nothing seems to disappear. Pace was the first such row (12 Nov).
  const byFacet = new Map(groups.map(g => [g.facet, g]));
  const lbTone = lbOf('tone');
  const baseRows = [
    ...FEEL_ROWS.map(f => byFacet.get(f) || { facet: f, label: FACET_LABEL[f], items: [] })
      .map(g => (g.facet === 'tone' ? { ...g, items: byStrength([...notIn(lbTone, g.items), ...g.items]) } : g)),
    ...groups.filter(g => g.facet !== 'theme' && !FEEL_ROWS.includes(g.facet) && g.items.length),
  ];
  const thin = profile.certainty?.level !== 'high';
  const showsSomething = baseRows.some(g => rowView(g.items, g.facet, { thin }).shown.length > 0);
  const noun = g => ROW_NOUN[g.facet] || 'feel';
  const lonely = showsSomething; // a row with only unsure chips shows them, dashed, rather than vanishing
  const feelRows = baseRows.map(g => (!showsSomething || g.items.length ? g : { ...g, note: `Reviews don't say enough about its ${noun(g)}` }));
  const rows = [...feelRows, themeRow.length ? { facet: 'theme', label: 'Themes', items: themeRow } : { facet: 'theme', label: 'Themes', items: [], note: 'No clear themes found yet' }];
  // Feeling rows show their confident chips, top a thin row up with dashed ones, and keep the rest behind "Show more".
  // One "Show more" opens every feeling row (a button on each row put four or five on a page).
  const viewOf = g => (g.facet === 'theme' || allFeel ? { shown: g.items, more: [] } : rowView(g.items, g.facet, { thin, lonely }));
  const anyDashed = rows.some(g => viewOf(g).shown.some(d => d.fragile));
  const lastFeelRow = [...feelRows].reverse().find(g => g.note || rowView(g.items, g.facet, { thin, lonely }).shown.length || allFeel)?.facet;
  const moreCount = feelRows.reduce((n, g) => n + rowView(g.items, g.facet, { thin, lonely }).more.length, 0);
  const buttons = shiftButtons(axes);
  const sure = sureNote(profile);

  return (
    <section class="film-section feel">
      <h2>How it feels</h2>
      <DebugInfo title="Feel profile" rows={feelDebug(profile, summary)} />
      <WhyCameUp filmKey={key} />
      {empty ? (
        <p class="muted feel-note">We don't have enough text about this film yet to describe how it feels. As reviews and articles arrive, this will fill in.
          {!hasKey && <> A free TMDB key in <a href={href('settings')}>Settings</a> brings in more viewer reviews.</>}</p>
      ) : (
        <>
          {headline && <p class="feel-headline">{colourWords(headline, h)}</p>}
          {/* A rough guess is said up front, under the headline, where it is read before the chips (the line at the bottom was too easy to miss). */}
          {sure?.level === 'low' && <p class="feel-rough" title={sure.title}><strong>Rough guess.</strong> Little has been written about this film, so take what's below lightly.</p>}
          {!showsSomething && <p class="faint feel-note">Not enough reviews yet to say how it feels. What's below comes from articles and keywords.</p>}
          {rows.length > 0 && (
            <div class="feel-groups">
              {rows.map(g => {
                const shown = viewOf(g).shown;
                if (!g.note && !shown.length) return null; // a row with only unsure chips appears when "Show more" opens it
                return (
                  <div class="feel-group" key={g.facet}>
                    <span class="feel-group-label">{g.label}</span>
                    {g.note ? <span class="faint feel-none">{g.note}</span> : (
                      <div class="feel-chips">
                        {shown.map(d => d.lb
                          ? <LbChip key={d.id} d={d} cls={`facet-${g.facet}`} />
                          : <Chip key={d.id} d={d} />)}
                      </div>
                    )}
                    {g.facet === lastFeelRow && moreCount > 0 && (
                      <button type="button" class="btn feel-link feel-more" aria-expanded={allFeel} onClick={() => setAllFeel(!allFeel)}
                        title="Weaker feelings, and ones only a single review, tag or list mentions">
                        {allFeel ? 'Show fewer' : `Show ${moreCount} more`}
                      </button>
                    )}
                  </div>
                );
              })}
              {!lastFeelRow && moreCount > 0 && (
                <div class="feel-group">
                  <span class="feel-group-label">Feelings</span>
                  <button type="button" class="btn feel-link feel-more" onClick={() => setAllFeel(true)} title="Feelings only a single review, tag or list mentions">Show {moreCount} unsure</button>
                </div>
              )}
            </div>
          )}
          {subjectRow.length === 0 && <EmptyRow label="Subjects">No subjects found yet</EmptyRow>}
          {subjectRow.length > 0 && (
            <div class="feel-group">
              <span class="feel-group-label">Subjects</span>
              <div class="feel-chips">
                {shownSubjects.map(t => (t.lb ? <LbChip key={t.id} d={t} cls="feel-theme" />
                  : <a key={t.id} class={`feel-chip feel-theme w${t.weight}`} href={href('feel', `t:${t.id}`)} title={t.title}>{t.label}</a>))}
                {subjectRow.length > shownSubjects.length && (
                  <button type="button" class="btn feel-link" onClick={() => setAllAbout(true)}>Show {subjectRow.length - shownSubjects.length} more</button>
                )}
              </div>
            </div>
          )}
          {kindRow.length === 0 && <EmptyRow label="Kind of film">Not sure what kind of film it is yet</EmptyRow>}
          {kindRow.length > 0 && (
            <div class="feel-group">
              <span class="feel-group-label">Kind of film</span>
              <div class="feel-chips">
                {kindRow.map(t => (t.lb ? <LbChip key={t.id} d={t} cls="feel-theme" />
                  : <a key={t.id} class={`feel-chip feel-theme w${t.weight}`} href={href('feel', `t:${t.id}`)} title={t.title}>{t.label}</a>))}
              </div>
            </div>
          )}
          {settings.length === 0 && <EmptyRow label="Set in">No setting found yet</EmptyRow>}
          {settings.length > 0 && (
            <div class="feel-group">
              <span class="feel-group-label">Set in</span>
              <div class="feel-chips">{settings.map(s => <a key={s.id} class="feel-chip feel-setting" href={href('feel', `set:${s.id}`)} title="Find films in your library set here">{s.label}</a>)}</div>
            </div>
          )}
          <p class="faint feel-basis">
            {sure && sure.level !== 'low' && <span class="feel-sure" title={sure.title}>{sure.text}.</span>}
            {basisText(summary)}
            {rows.some(g => g.items.length) && <span class="feel-key">Darker means stronger{anyDashed ? '. Dashed means very unsure: only one thing says it' : ''}</span>}
          </p>
          {showTmdbHint(summary, hasKey) && (
            <p class="faint feel-hint">A free TMDB key in <a href={href('settings')}>Settings</a> brings in more viewer reviews.</p>
          )}
        </>
      )}

      <div class="feel-similar">
        <div class="feel-similar-head">
          <h3>{shift ? shiftHeading(shift) : 'Similar in feel'}</h3>
          {shift
            ? <button type="button" class="btn feel-link" onClick={() => setShift(null)}>Back to similar</button>
            : <a class="feel-link" href={href('feel', `film:${key}`)} onClick={e => { e.preventDefault(); go('feel', `film:${key}`); }}>See more like this</a>}
        </div>
        <Rail filmKey={key} shift={shift} />
        {buttons.length > 0 && (
          <div class="feel-shift">
            <span class="feel-group-label">Like this, but…</span>
            <div class="feel-chips">
              {buttons.map(b => (
                <ActionChip key={b.id} pressed={shift?.id === b.id} onClick={() => setShift(shift?.id === b.id ? null : b)}>{b.label}</ActionChip>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Shown when you arrived from a By feel result: why this film matched, in words (the card only had room for a clipped line).
function WhyCameUp({ filmKey }) {
  let w = null;
  try { w = JSON.parse(sessionStorage.getItem('feelWhy:' + filmKey) || 'null'); } catch { /* ignore */ }
  if (!w || !w.lines || !w.lines.length) return null;
  return (
    <aside class="feel-why">
      <strong>{w.heading ? `Why it came up under “${w.heading}”` : 'Why it came up'}{w.tier ? ` (${w.tier})` : ''}</strong>
      <ul>{w.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </aside>
  );
}
