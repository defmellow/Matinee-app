// The Lists overview: add a Letterboxd list by link, make a list, and a tile for each list.
import { useState } from 'preact/hooks';
import { call, imageUrl } from '../../api.js';
import { toast } from '../../state.js';
import { go, href } from '../../router.js';
import { Badge } from '../../components/ui.jsx';
import { EmptyState } from '../../components/film.jsx';
import DebugInfo from '../../debug/DebugInfo.jsx';
import { STATUS_BADGE, countText } from './model.js';

const SECTIONS = [
  ['matinee', 'Made here', 'Lists you make in Matinee. Export one to put it on Letterboxd.'],
  ['letterboxd', 'Following on Letterboxd', 'Matinee checks these for changes each day.'],
  ['export', 'From your Letterboxd export', 'Read-only copies from your last import.'],
];

// A cover picture that doesn't load leaves its quiet empty cell instead of the browser's broken-image icon.
function CoverImg({ src }) {
  const [bad, setBad] = useState(false);
  return bad ? <span class="ls-cover-empty" /> : <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

function Cover({ list }) {
  const urls = list.covers.map(p => p.thumb || p.url).filter(Boolean);
  return (
    <div class="ls-cover" aria-hidden="true">
      {[0, 1, 2, 3].map(i => urls[i] ? <CoverImg key={i} src={imageUrl(urls[i])} /> : <span key={i} class="ls-cover-empty" />)}
    </div>
  );
}

export function Tile({ list }) {
  const badge = STATUS_BADGE[list.status];
  return (
    <a class="ls-tile" href={href('lists', list.id)} style={{ textDecoration: 'none' }}>
      <Cover list={list} />
      <span class="ls-tile-name">{list.name}</span>
      <span class="ls-tile-meta faint">{list.owner ? `${list.owner} · ` : ''}<span class="num">{countText(list.count)}</span></span>
      {badge && <Badge class="ls-badge-warn">{badge}</Badge>}
    </a>
  );
}

function AddForms() {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const follow = async () => {
    if (!link.trim()) return;
    setBusy('follow'); setError('');
    try {
      const r = await call('followList', { url: link.trim() });
      toast(r.existing ? 'You already follow that list.' : 'Following that list. Its films are being filled in.');
      setLink('');
      go('lists', r.id);
    } catch (e) { setError((e && e.message) || "Matinee couldn't read that list."); } finally { setBusy(null); }
  };
  const make = async () => {
    if (!name.trim()) return;
    setBusy('make');
    try { const r = await call('saveList', { name: name.trim(), films: [] }); setName(''); go('lists', r.id); }
    catch (e) { toast((e && e.message) || "Couldn't make that list."); } finally { setBusy(null); }
  };
  return (
    <div class="ls-forms">
      <form class="ls-form" onSubmit={e => { e.preventDefault(); follow(); }}>
        <label class="eyebrow" for="ls-link">Add a Letterboxd list</label>
        <div class="ls-form-row">
          <input id="ls-link" class="input" value={link} placeholder="Paste a link, like boxd.it/abc12" onInput={e => { setLink(e.currentTarget.value); setError(''); }} aria-describedby={error ? 'ls-link-err' : undefined} />
          <button type="submit" class="btn btn-primary" disabled={!link.trim() || !!busy}>{busy === 'follow' ? 'Reading the list…' : 'Follow list'}</button>
        </div>
        {error ? <p id="ls-link-err" class="ls-error" role="alert">{error}</p> : <p class="faint ls-hint">Any public list works, yours or someone else's. Its films join your library so you can search, filter and pick from them.</p>}
      </form>
      <form class="ls-form" onSubmit={e => { e.preventDefault(); make(); }}>
        <label class="eyebrow" for="ls-new">Make a list</label>
        <div class="ls-form-row">
          <input id="ls-new" class="input" value={name} maxLength={80} placeholder="Name it, like rainy day" onInput={e => setName(e.currentTarget.value)} />
          <button type="submit" class="btn" disabled={!name.trim() || !!busy}>Make list</button>
        </div>
        <p class="faint ls-hint">Add films from any film page or from the Library. Export it when you want it on Letterboxd.</p>
      </form>
    </div>
  );
}

export default function Tiles({ lists }) {
  return (
    <div class="screen ls">
      <header class="screen-head">
        <div>
          <h1>Lists</h1>
          <p class="sub">Follow lists from Letterboxd, or make your own. Their films count as part of your library.</p>
        </div>
      </header>
      <DebugInfo title="Lists" rows={{ lists: lists.length, followed: lists.filter(l => l.source === 'letterboxd').length, 'not ok': lists.filter(l => l.status !== 'ok').length }} />
      <AddForms />
      {lists.length === 0 && (
        <EmptyState title="No lists yet">Paste a Letterboxd list link above to follow it, or make a list of your own. Lists you made on Letterboxd show here after you import your export in Settings.</EmptyState>
      )}
      {SECTIONS.map(([source, title, note]) => {
        const mine = lists.filter(l => l.source === source);
        if (!mine.length) return null;
        return (
          <section key={source} class="ls-section" aria-label={title}>
            <div><h2>{title}</h2><p class="faint ls-hint">{note}</p></div>
            <div class="ls-tiles">{mine.map(l => <Tile key={l.id} list={l} />)}</div>
          </section>
        );
      })}
    </div>
  );
}
