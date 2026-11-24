// "Failed 2 sources": a small pill on the film page that opens a list of what didn't load, with Try again.
// Shows nothing when every source is fine. While a check is running it only says "Checking sources…".
import { Chip, Badge } from './ui.jsx';
import { split, pillText, reasonText, providerLabel } from '../screens/film/fetchModel.js';
import { useDebug } from '../debug/useDebug.js';
import './fetchpill.css';

export function FetchPillButton({ status, running, open, onToggle, panelId }) {
  const text = pillText(status);
  if (running && !text) return <Badge class="fetchpill-checking" role="status">Checking sources…</Badge>;
  if (!text) return null;
  const failed = split(status).failed.length > 0, missedOnly = !failed && split(status).deferred.length === 0;
  return (
    <Chip class={'fetchpill' + (failed ? '' : missedOnly ? ' is-missed' : ' is-waiting')} aria-expanded={String(!!open)} aria-controls={panelId} onClick={onToggle}
      title="See which sources didn't load">
      {text}{running ? ' · checking…' : ''}
    </Chip>
  );
}

export function FetchPanel({ status, busy = [], onRetry, id }) {
  const debug = useDebug();
  const { failed, deferred, missed } = split(status);
  const rows = [...failed, ...deferred, ...missed];
  if (!rows.length) return null;
  const isBusy = p => busy.includes(p);
  return (
    <div class="fetchpanel" id={id} role="region" aria-label="Sources that didn't load">
      <ul class="fetchpanel-list">
        {rows.map(o => (
          <li key={o.provider} class="fetchpanel-row">
            <div class="fetchpanel-text">
              <strong>{providerLabel(o.provider, o.label)}</strong>
              <span class="fetchpanel-state">{o.status === 'deferred' ? 'Waiting' : o.status === 'miss' ? 'Not found' : 'Failed'}</span>
              <span class="muted fetchpanel-why">{reasonText(o)}</span>
              {debug && <span class="debug-info debug-mono">{o.provider} · {o.status}{o.reason ? ` · ${o.reason}` : ''}{o.hollow ? ' · hollow page' : ''}</span>}
            </div>
            <button type="button" class="btn btn-small" disabled={isBusy(o.provider)} onClick={() => onRetry([o.provider])}>
              {isBusy(o.provider) ? 'Trying…' : 'Try again'}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 1 && <button type="button" class="btn btn-small" disabled={busy.length > 0} onClick={() => onRetry(null)}>Try all again</button>}
    </div>
  );
}
