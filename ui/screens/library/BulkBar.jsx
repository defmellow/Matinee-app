// The action bar at the bottom of the Library while selecting: tag and untag.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast } from '../../state.js';
import Icon from '../../components/Icon.jsx';
import { Chip } from '../../components/ui.jsx';
import { suggestTags, watchedNote, tagToast } from './select.js';
import AddToList from '../lists/AddToList.jsx';
import { LISTS_ARCHIVED } from '../../archive.js';

const fail = e => toast((e && e.message) || 'Something went wrong. Please try again.');

function Pop({ label, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    const opener = document.activeElement;
    el && el.querySelector('input, button')?.focus();
    const away = e => { if (el && !el.contains(e.target) && !e.target.closest('[data-pop-btn]')) onClose(); };
    document.addEventListener('mousedown', away);
    return () => {
      document.removeEventListener('mousedown', away);
      // Hand focus back to the button that opened this, unless focus has already gone somewhere else on purpose.
      const a = document.activeElement;
      if (!a || a === document.body || (el && el.contains(a))) opener && opener.focus && opener.focus();
    };
  }, []);
  return <div class="lib-pop" role="dialog" aria-label={label} ref={ref}>{children}</div>;
}

function AddTag({ names, busy, onApply }) {
  const [text, setText] = useState('');
  const tag = text.trim();
  const sug = suggestTags(names, text);
  return (
    <>
      <div class="lib-pop-row">
        <input class="input" value={text} maxLength={60} placeholder="Type a tag, like rainy day" aria-label="Tag to add"
          onInput={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter' && tag) onApply(tag); }} />
        <button type="button" class="btn btn-primary" disabled={!tag || busy} onClick={() => onApply(tag)}>Add</button>
      </div>
      {sug.length > 0 && (
        <div class="lib-pop-chips" role="group" aria-label="Your existing tags">
          {sug.map(n => <Chip key={n} onClick={() => onApply(n)}>{n}</Chip>)}
        </div>
      )}
    </>
  );
}

function RemoveTag({ union, watchlistCount, busy, onApply }) {
  if (!union.length) return <p class="lib-pop-note">None of the {watchlistCount} selected watchlist {watchlistCount === 1 ? 'film has' : 'films have'} a tag yet.</p>;
  return (
    <>
      <p class="lib-pop-note">Pick a tag to take off the selected watchlist films.</p>
      <div class="lib-pop-chips">
        {union.map(t => <Chip key={t.name} disabled={busy} onClick={() => onApply(t.name)}>{t.name}<span class="lib-n">{t.count}</span></Chip>)}
      </div>
    </>
  );
}

export default function BulkBar({ summary, hidden, shownCount, allShown, tagNames, getKeys, onSelectAll, onClear, onWatchlistOnly }) {
  const [panel, setPanel] = useState(null);
  const [busy, setBusy] = useState(false);
  const { total, watchlistCount, tagUnion } = summary;
  const noTags = watchlistCount === 0;
  const note = watchedNote(summary);
  const toggle = p => setPanel(cur => (cur === p ? null : p));

  const run = async fn => {
    setBusy(true);
    try { toast(await fn()); setPanel(null); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const tag = (field, name) => run(async () => {
    const r = await call('tagFilms', { keys: getKeys(), [field]: [name] });
    return tagToast({ [field]: name }, r);
  });

  return (
    <div class="lib-bar" role="region" aria-label="Selected films" onKeyDown={e => { if (e.key === 'Escape' && panel) { e.stopPropagation(); setPanel(null); } }}>
      <div class="lib-bar-main">
        <span class="lib-bar-count num" aria-live="polite"><strong>{total}</strong> selected{hidden > 0 && <span class="faint"> ({hidden} hidden by filters)</span>}</span>
        <button type="button" class="btn btn-small btn-ghost" onClick={onSelectAll} disabled={allShown}>Select all {shownCount} shown</button>
        <button type="button" class="btn btn-small btn-ghost" onClick={onClear} disabled={total === 0}>Clear</button>
        <span class="lib-bar-actions">
          {!LISTS_ARCHIVED && <AddToList keys={total > 0 ? getKeys() : []} up />}
          <span class="lib-bar-slot">
            <button type="button" class="btn" data-pop-btn aria-expanded={String(panel === 'add')} disabled={total === 0 || noTags} onClick={() => toggle('add')}><Icon name="tag" size={16} />Add tag</button>
            {panel === 'add' && <Pop label="Add a tag" onClose={() => setPanel(null)}><AddTag names={tagNames} busy={busy} onApply={t => tag('add', t)} /></Pop>}
          </span>
          <span class="lib-bar-slot">
            <button type="button" class="btn" data-pop-btn aria-expanded={String(panel === 'remove')} disabled={total === 0 || noTags} onClick={() => toggle('remove')}>Remove tag</button>
            {panel === 'remove' && <Pop label="Remove a tag" onClose={() => setPanel(null)}><RemoveTag union={tagUnion} watchlistCount={watchlistCount} busy={busy} onApply={t => tag('remove', t)} /></Pop>}
          </span>
        </span>
      </div>
      {total > 0 && noTags && (
        <div class="lib-bar-note">Tags can only go on watchlist films, and none of these are on your watchlist.
          <button type="button" class="btn btn-small" onClick={onWatchlistOnly}>Show watchlist only</button></div>
      )}
      {note && !noTags && <div class="lib-bar-note">{note}</div>}
    </div>
  );
}
