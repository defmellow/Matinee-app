// Export an own list for Letterboxd's list importer, then paste the Letterboxd list's link so Matinee follows it from then on.
import { useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast } from '../../state.js';
import { download } from '../settings/format.js';

export function ExportPanel({ list }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await call('exportList', { id: list.id });
      download(r.filename, r.csv, 'text/csv;charset=utf-8');
      setDone(r);
      toast(`Saved ${r.filename}.`);
    } catch (e) { toast((e && e.message) || "Couldn't make the file. Please try again."); } finally { setBusy(false); }
  };
  return (
    <section class="ls-export" aria-label="Export for Letterboxd">
      <div class="ls-export-row">
        <button type="button" class="btn" disabled={busy} onClick={run}>Export for Letterboxd</button>
        <span class="faint ls-hint">Saves a file Letterboxd can read.</span>
      </div>
      {done && (
        <ol class="ls-steps">
          <li>On Letterboxd: make a new list, then choose Import and pick <strong>{done.filename}</strong>. Save the list.</li>
          <li>Paste the list's link below, and Matinee will follow it from then on.</li>
        </ol>
      )}
    </section>
  );
}

export function LinkField({ list, onLinked }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = async () => {
    if (!url.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await call('linkList', { id: list.id, url: url.trim() });
      toast(r.missing ? `Linked. ${r.missing} ${r.missing === 1 ? 'film' : 'films'} didn't make it onto Letterboxd; see the changes on the list.` : 'Linked. This list now follows Letterboxd.');
      setUrl('');
      onLinked && onLinked();
    } catch (e) { setError((e && e.message) || "Matinee couldn't read that list."); } finally { setBusy(false); }
  };
  return (
    <form class="ls-link" onSubmit={e => { e.preventDefault(); link(); }}>
      <label class="eyebrow" for="ls-linkfield">Link to the Letterboxd list</label>
      <div class="ls-form-row">
        <input id="ls-linkfield" class="input" value={url} placeholder="Paste the list's link after importing it" onInput={e => { setUrl(e.currentTarget.value); setError(''); }} />
        <button type="submit" class="btn" disabled={!url.trim() || busy}>{busy ? 'Reading the list…' : 'Link list'}</button>
      </div>
      {error ? <p class="ls-error" role="alert">{error}</p> : <p class="faint ls-hint">After linking, edit the list on Letterboxd and Matinee follows the changes. You can unlink it later and keep the films.</p>}
    </form>
  );
}
