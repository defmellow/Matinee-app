// Pick which poster Matinee uses for a film, everywhere. Opened by clicking the poster on the film page.
import { useEffect, useState } from 'preact/hooks';
import { Dialog, Badge } from './ui.jsx';
import { call, imageUrl } from '../api.js';
import { toast } from '../state.js';
import { optionLabel, tileState } from './posterOptions.js';
import './posterpicker.css';

export default function PosterPicker({ filmKey, title, onClose, onPick }) {
  const [opts, setOpts] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    call('getPosterOptions', { key: filmKey }).then(o => { if (live) setOpts(o); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, [filmKey]);

  const choose = async (source, url) => {
    if (saving) return;
    setSaving(true);
    onPick && onPick(source, url); // optimistic: the page changes at once
    try { await call('setPoster', { key: filmKey, source }); } catch { toast("Couldn't change the poster. Try again."); } // recorded by api.call; the library refresh puts back what is stored
    onClose();
  };
  const list = (opts && opts.options) || [];
  const autoUrl = (list.find(o => o.source === opts?.auto) || list[0] || {}).url;
  return (
    <Dialog title="Change poster" onClose={onClose}>
      <p class="muted posterpick-hint">Pick which poster Matinee uses for this film everywhere.</p>
      {!opts && !error && <p class="muted" aria-live="polite">Looking for posters…</p>}
      {error && <p class="muted">Couldn't load the poster choices just now. Try again in a moment.</p>}
      {opts && list.length === 0 && <p class="muted">No posters found for {title || 'this film'} yet.</p>}
      {opts && list.length === 1 && <p class="muted">Only one poster found so far.</p>}
      {opts && list.length > 0 && (
        <div class="posterpick-grid" role="group" aria-label="Posters">
          <button type="button" class="posterpick-tile posterpick-auto" aria-pressed={String(!opts.chosen)} disabled={saving} onClick={() => choose(null, autoUrl)}>
            <span class="posterpick-img">{autoUrl && <img src={imageUrl(autoUrl)} alt="" />}</span>
            <span class="posterpick-name">Automatic (best available)</span>
            {!opts.chosen && <Badge data-tone="accent">In use</Badge>}
          </button>
          {list.map(o => {
            const st = tileState(opts, o);
            return (
              <button type="button" key={o.source} class="posterpick-tile" aria-pressed={String(st.picked)} disabled={saving} onClick={() => choose(o.source, o.url)}>
                <span class="posterpick-img"><img src={imageUrl(o.url)} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} /></span>
                <span class="posterpick-name">{optionLabel(o)}</span>
                {st.picked && <Badge data-tone="accent">In use</Badge>}
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
