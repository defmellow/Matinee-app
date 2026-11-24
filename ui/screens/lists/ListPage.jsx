// One list: its films (the usual film cards), sort and filter, what changed, and the actions that fit where the list comes from.
import { useMemo, useRef, useState } from 'preact/hooks';
import { call, openExternal } from '../../api.js';
import { toast, useCall } from '../../state.js';
import { back, go, href } from '../../router.js';
import { useFetchNow } from '../../components/fetchnow.js';
import { Loading, Segmented } from '../../components/ui.jsx';
import { FilmCard, EmptyState } from '../../components/film.jsx';
import Icon from '../../components/Icon.jsx';
import DebugInfo, { DebugError } from '../../debug/DebugInfo.jsx';
import { arrange, changeSummary, entryLine, statusNotice, SORTS, FILTERS, countText } from './model.js';
import { ExportPanel, LinkField } from './Export.jsx';

const fail = e => toast((e && e.message) || 'Something went wrong. Please try again.');
const ask = (text) => typeof confirm === 'function' ? confirm(text) : true;

function Changes({ list }) {
  const [open, setOpen] = useState(false);
  const line = changeSummary(list.history);
  if (!list.history.length) return null;
  const name = k => (k.year ? `${k.title} (${k.year})` : k.title);
  return (
    <div class="ls-changes">
      {line && <span class="faint">{line}</span>}{' '}
      <button type="button" class="btn-link ls-more" aria-expanded={String(open)} onClick={() => setOpen(o => !o)}>{open ? 'Hide changes' : 'Show changes'}</button>
      {open && (
        <ul class="ls-history">
          {list.history.map((h, i) => (
            <li key={i}>
              <span>{entryLine(h)}</span>
              {h.added.length > 0 && <span class="faint"> Added: {h.added.map(name).join(', ')}.</span>}
              {h.removed.length > 0 && <span class="faint"> {h.linked ? "Didn't make it" : 'Removed'}: {h.removed.map(name).join(', ')}.</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Rename({ list, onDone }) {
  const [name, setName] = useState(list.name);
  const save = async () => {
    if (!name.trim() || name.trim() === list.name) return onDone();
    try { await call('saveList', { id: list.id, name }); onDone(); } catch (e) { fail(e); }
  };
  return (
    <form class="ls-form-row" onSubmit={e => { e.preventDefault(); save(); }}>
      <input class="input" aria-label="List name" value={name} maxLength={80} onInput={e => setName(e.currentTarget.value)} ref={el => el && el.focus()} />
      <button type="submit" class="btn btn-primary">Save</button>
      <button type="button" class="btn btn-ghost" onClick={onDone}>Cancel</button>
    </form>
  );
}

function Item({ film, list, onChanged }) {
  const own = list.editable;
  const note = list.notes[film.key] || '';
  const [text, setText] = useState(note);
  const [editing, setEditing] = useState(false);
  const saveNote = async () => {
    setEditing(false);
    if (text.trim() === note) return;
    try { await call('setListNote', { id: list.id, key: film.key, text }); onChanged(); } catch (e) { fail(e); }
  };
  const remove = async () => { try { await call('setInList', { id: list.id, key: film.key, on: false }); onChanged(); } catch (e) { fail(e); } };
  return (
    <div class="ls-item">
      <FilmCard film={film} show="rating" />
      {!own && note && <p class="ls-note">{note}</p>}
      {own && (editing
        ? <textarea class="input ls-note-input" aria-label={`Note on ${film.title}`} value={text} placeholder="A note on this film (it goes to Letterboxd as the film's note)" ref={el => el && el.focus()}
            onInput={e => setText(e.currentTarget.value)} onBlur={saveNote} />
        : <button type="button" class="btn-link ls-note-btn" onClick={() => setEditing(true)}>{note ? note : 'Add a note'}</button>)}
      {own && <button type="button" class="icon-btn ls-remove" onClick={remove} aria-label={`Take ${film.title} off this list`} title="Take off this list"><Icon name="close" size={14} /></button>}
    </div>
  );
}

export default function ListPage({ id }) {
  const { data: list, error, loading, reload } = useCall('getList', { id }, [id], { refreshOn: 'library' });
  const [sort, setSort] = useState('order');
  const [filter, setFilter] = useState('all');
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef();
  const films = useMemo(() => (list ? arrange(list.films, sort, filter) : []), [list, sort, filter]);
  useFetchNow(gridRef, [films]);

  const backBtn = <button type="button" class="btn btn-ghost ls-back" onClick={back}><Icon name="back" />Back</button>;
  if (!list && loading) return <div class="screen">{backBtn}<Loading /></div>;
  if (!list) {
    return (
      <div class="screen">
        {backBtn}
        <EmptyState title={error?.code === 'not-found' || !error ? "That list isn't here any more." : "Couldn't open that list."} action={<a class="btn btn-primary" href={href('lists')}>Back to Lists</a>}>
          {error && error.code !== 'not-found' ? error.message : 'It may have been deleted or unfollowed. Your other lists are still here.'}
        </EmptyState>
        <DebugError error={error} what="getList" />
      </div>
    );
  }

  const act = async (fn, done) => {
    setBusy(true);
    try { const r = await fn(); if (done) toast(done(r)); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const refresh = () => act(() => call('refreshList', { id }), r => (r.status === 'ok' ? (r.added || r.removed ? `Updated: ${r.added} added, ${r.removed} removed.` : 'Up to date.') : 'Matinee couldn\'t update this list. Showing the last copy.'));
  const unfollow = () => { if (ask(`Stop following “${list.name}”? Its films stay in your library.`)) act(() => call('unfollowList', { id }), () => 'Stopped following.').then(() => go('lists')); };
  const unlink = () => act(() => call('unlinkList', { id }), () => 'Kept as your own list.');
  const del = () => { if (ask(`Delete “${list.name}”? The films stay in your library.`)) act(() => call('deleteList', { id }), () => 'List deleted.').then(() => go('lists')); };
  const copy = () => act(async () => { const r = await call('copyList', { id }); go('lists', r.id); }, () => 'Made a copy you can edit.');
  const followIt = () => act(async () => { const r = await call('followList', { url: list.url }); go('lists', r.id); });
  const notice = list.source === 'letterboxd' ? statusNotice(list) : null;
  const refetch = () => reload();

  return (
    <div class="screen ls">
      <div>{backBtn}</div>
      <header class="screen-head ls-head">
        <div>
          {renaming ? <Rename list={list} onDone={() => setRenaming(false)} /> : <h1>{list.name}</h1>}
          <p class="sub">
            {list.owner ? <>A list by {list.owner} · </> : null}<span class="num">{countText(list.films.length)}</span>
            {list.source === 'letterboxd' && list.fetchedAt ? <> · read {new Date(list.fetchedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</> : null}
          </p>
          {list.description && <p class="ls-desc">{list.description}</p>}
        </div>
        <div class="ls-actions">
          {list.source === 'letterboxd' && <>
            <button type="button" class="btn" disabled={busy} onClick={refresh}><Icon name="refresh" size={16} />Refresh</button>
            {list.url && <button type="button" class="btn btn-ghost" onClick={() => openExternal(list.url)}>Open on Letterboxd <Icon name="external" size={14} /></button>}
          </>}
          {list.source === 'matinee' && <>
            <button type="button" class="btn btn-ghost" onClick={() => setRenaming(r => !r)}>Rename</button>
            <button type="button" class="btn btn-ghost" disabled={busy} onClick={del}>Delete</button>
          </>}
          {list.source === 'export' && <button type="button" class="btn" disabled={busy} onClick={copy}>Make a copy to edit</button>}
        </div>
      </header>

      <DebugInfo title="List" rows={{ source: list.source, url: list.debug.url, 'short link': list.debug.shortUrl, 'last read': list.debug.fetchedAt, 'last checked': list.debug.checkedAt, 'pages read': list.debug.pagesRead, status: list.debug.status, 'missed checks': list.debug.missCount, reason: list.debug.reason, 'cut at page limit': list.truncated ? 'yes' : null, 'load error': error && error.message }} />

      {notice && (
        <div class="ls-notice" role="status">
          <span>{notice}</span>
          <button type="button" class="btn btn-small" disabled={busy} onClick={refresh}>Try again</button>
          <button type="button" class="btn btn-small" disabled={busy} onClick={unfollow}>Unfollow</button>
        </div>
      )}
      {list.truncated && <p class="faint ls-hint">This list is longer than Matinee reads in one go, so the newest films past the limit may be missing. Nothing was removed.</p>}

      {list.source === 'letterboxd' && (
        <div class="ls-follows">
          <p class="faint ls-hint">This list follows Letterboxd. Edit it there; changes show up here when Matinee refreshes.</p>
          <span class="ls-follow-actions">
            <button type="button" class="btn-link" disabled={busy} onClick={unlink} title="Keep the films as a list you can edit here">Unlink</button>
            <button type="button" class="btn-link" disabled={busy} onClick={unfollow}>Unfollow</button>
          </span>
        </div>
      )}
      {list.source === 'letterboxd' && <Changes list={list} />}
      {list.source === 'matinee' && list.films.length > 0 && <ExportPanel list={list} />}
      {list.source === 'matinee' && list.films.length > 0 && <LinkField list={list} onLinked={refetch} />}
      {list.source === 'export' && (
        <div class="ls-follows">
          <p class="faint ls-hint">From your Letterboxd export, so it can't be changed here.{list.url ? '' : ' Paste the list\'s link on the Lists page to follow it instead.'}</p>
          {list.url && <button type="button" class="btn" disabled={busy} onClick={followIt}>Follow on Letterboxd</button>}
        </div>
      )}

      {list.films.length > 0 && (
        <div class="ls-toolbar">
          <Segmented label="Show" value={filter} options={FILTERS.map(([value, label]) => ({ value, label }))} onChange={setFilter} />
          <label class="lib-sort"><span class="sr-only">Sort by</span>
            <select class="select" value={sort} onChange={e => setSort(e.currentTarget.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
      )}

      {list.films.length === 0 ? (
        <EmptyState title={list.source === 'matinee' ? 'Nothing on this list yet' : 'No films on this list'} action={list.source === 'matinee' ? <a class="btn btn-primary" href={href('library')}>Pick films in the Library</a> : undefined}>
          {list.source === 'matinee' ? 'Open a film and use “Add to list”, or choose Select in the Library and add several at once.' : 'The list is empty on Letterboxd right now.'}
        </EmptyState>
      ) : films.length === 0 ? (
        <EmptyState title="No films match" action={<button type="button" class="btn btn-primary" onClick={() => setFilter('all')}>Show all films</button>}>Try a different filter.</EmptyState>
      ) : (
        <div ref={gridRef} class="film-grid ls-grid">
          {films.map(f => <Item key={f.key} film={f} list={list} onChanged={refetch} />)}
        </div>
      )}
    </div>
  );
}
