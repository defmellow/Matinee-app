// Tags and notes. Matinee only reads your Letterboxd data, with one exception: Letterboxd has no way to tag or
// annotate watchlist films, so those two things are editable here for films on your watchlist and nowhere else.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast, useLibrary } from '../../state.js';
import Icon from '../../components/Icon.jsx';
import { Chip } from '../../components/ui.jsx';
import { filterHref } from '../../components/chip.js';

const SAVED_CAP = 6;

export default function Tags({ film }) {
  const [allSaved, setAllSaved] = useState(false);
  const [wantLib, setWantLib] = useState(false); // tag suggestions need the whole library; load it only once you start typing
  const lib = useLibrary(wantLib);
  const editable = !!film.user?.watchlist;
  const saved = film.user?.tags || [];
  const [tags, setTags] = useState(saved);
  const [draft, setDraft] = useState('');
  const savedNote = film.user?.note || '';
  const [note, setNote] = useState(savedNote);
  const lastNote = useRef(savedNote);
  useEffect(() => { setTags(film.user?.tags || []); }, [(film.user?.tags || []).join('\u0000')]);

  const save = async next => {
    setTags(next);
    try { await call('setUserFilm', { key: film.key, tags: next }); } catch { toast("Couldn't save that tag. Try again."); setTags(saved); }
  };
  const add = () => {
    const t = draft.trim();
    setDraft('');
    if (t && !tags.some(x => x.toLowerCase() === t.toLowerCase())) save([...tags, t]);
  };
  // The note saves on blur, after ~1.5 s of idle typing, and when you leave the page. `latest` always holds the newest text,
  // and lastNote the text last sent, so blur + unmount never save the same thing twice.
  const latest = useRef({ key: film.key, note: savedNote, editable });
  latest.current = { key: film.key, note, editable };
  const saveNote = async (quiet = false) => {
    const { key, note: text, editable: ok } = latest.current;
    if (!ok || text === lastNote.current) return;
    lastNote.current = text; // claim it now so a second trigger skips
    try { await call('setUserFilm', { key, note: text }); if (!quiet) toast('Saved'); }
    catch { lastNote.current = null; toast("Couldn't save your note. Try again."); }
  };
  useEffect(() => {
    if (!editable || note === lastNote.current) return;
    const t = setTimeout(() => saveNote(true), 1500);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => () => { saveNote(true); }, []);
  const suggestions = (lib?.tags || []).map(t => t.name).filter(n => !tags.includes(n));
  const listId = 'film-tag-suggestions';

  if (!editable) { // watched films: show what came from Letterboxd, read-only
    if (!saved.length && !savedNote) return null;
    return (
      <section class="film-section">
        <h2>Your tags</h2>
        {saved.length > 0 && <div class="chips film-tags">{(allSaved ? saved : saved.slice(0, SAVED_CAP)).map(t => <Chip key={t} href={filterHref('tag', t)} title={`Your films tagged ${t}`}>{t}</Chip>)}{saved.length > SAVED_CAP && <Chip onClick={() => setAllSaved(!allSaved)} aria-expanded={allSaved}>{allSaved ? 'Show fewer' : `+ ${saved.length - SAVED_CAP} more`}</Chip>}</div>}
        {savedNote && <p class="film-note-read">{savedNote}</p>}
        <p class="faint film-hint">These come from your Letterboxd diary. Change them on Letterboxd and re-import to update.</p>
      </section>
    );
  }

  return (
    <section class="film-section">
      <h2>Watchlist tags</h2>
      <div class="chips film-tags">
        {tags.map(t => (
          <span key={t} class="chip-split">
            <Chip href={filterHref('tag', t)} title={`Your films tagged ${t}`}>{t}</Chip>
            <button type="button" class="icon-btn" onClick={() => save(tags.filter(x => x !== t))} aria-label={`Remove tag ${t}`} title="Remove this tag"><Icon name="close" size={12} /></button>
          </span>
        ))}
        <input class="input film-tag-input" list={listId} onFocus={() => setWantLib(true)} value={draft} placeholder={tags.length ? 'Add a tag' : 'Add your first tag'} aria-label="Add a tag"
          onInput={e => setDraft(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onChange={e => { if (suggestions.includes(e.currentTarget.value)) add(); }} />
        <datalist id={listId}>{suggestions.map(n => <option key={n} value={n} />)}</datalist>
      </div>
      {tags.length === 0 && <p class="faint film-hint">Letterboxd can't tag watchlist films, so do it here: “with mum”, “cinema only”, “when I'm up for something heavy”. Press Enter to add one.</p>}
      <label class="film-note">
        <span class="eyebrow">Note</span>
        <textarea class="input" value={note} placeholder="Why it's on your watchlist, who recommended it, where to watch it. Only you see this." onInput={e => setNote(e.currentTarget.value)} onBlur={() => saveNote()} />
      </label>
    </section>
  );
}
