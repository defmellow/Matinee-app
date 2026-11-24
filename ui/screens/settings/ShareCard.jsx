// "Share data": makes one file of this library's real data and logs (for someone helping with a problem), then shows it in the file manager.
import { useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast } from '../../state.js';

import { reportFailure } from '../../debug/report.js';
const megabytes = bytes => `${Math.max(0.1, Math.round(bytes / 1e5) / 10)} MB`;

export default function ShareCard() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { path, films, bytes }
  const [error, setError] = useState(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const bridge = window.matinee;
      const dir = bridge?.share ? await bridge.share.documentsDir() : null; // null: the core falls back to the data folder
      let appVersion = null;
      try { const s = bridge?.updates ? await bridge.updates.status() : null; appVersion = (s && s.current) || null; } catch (e) { reportFailure('Settings', "Couldn't read the app version for the share file.", e, { level: 'warning' }); } // the file is still made
      const r = await call('exportShare', { dir, appVersion });
      setDone(r);
      if (bridge?.share) bridge.share.reveal(r.path);
      toast('File created.');
    } catch (e) {
      if (!e || !e.reported) reportFailure('Settings', "Couldn't create the share file.", e);
      setError("Couldn't create the file. Nothing in your library was changed. You can try again.");
    }
    setBusy(false);
  };

  return (
    <section class="panel set-panel" aria-labelledby="set-share">
      <h2 id="set-share">Share data</h2>
      <p class="muted">Makes one file with your library, settings and logs, to send to someone helping you with a problem. Your keys are never included.</p>
      <div class="set-row">
        <button type="button" class="btn btn-small" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create the file'}</button>
      </div>
      {done && (
        <p class="set-msg" role="status">
          Saved {done.films} films ({megabytes(done.bytes)}) to <span class="num">{done.path}</span>.
        </p>
      )}
      {error && <p class="set-msg" data-tone="bad" role="status">{error}</p>}
    </section>
  );
}
