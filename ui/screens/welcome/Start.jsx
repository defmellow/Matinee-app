// Onboarding frames 1 and 2: the first open (how to get the Letterboxd export, the drop zone, restoring a Matinee backup), then
// "Found N films" in the same place once the ZIP is read, with the slim filling bar and the fork: Continue or Skip.
import { useRef, useState } from 'preact/hooks';
import { openExternal } from '../../api.js';
import Icon from '../../components/Icon.jsx';
import { pluralN } from '../../format.js';
import { fillOf } from './fill.js';
import { exportFromDrop, chooseExport } from '../../export-file.js';

const EXPORT_URL = 'https://letterboxd.com/settings/data/';

function DropZone({ busy, onFile, onError }) {
  const input = useRef();
  const [over, setOver] = useState(false);
  // A Mac unzips the download by itself, so the export may arrive as a folder: both ways take it.
  const got = p => p.then(f => { if (f) onFile(f); }, e => onError(e && e.message ? e.message : "That didn't work. Try again."));
  const drop = e => { e.preventDefault(); setOver(false); got(exportFromDrop(e.dataTransfer)); };
  return (
    <button
      type="button" class="wel-drop onb-drop" data-over={String(over)} disabled={busy}
      onClick={() => got(chooseExport(input.current))}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {busy ? <div class="spinner" /> : <Icon name="upload" size={36} />}
      <span class="wel-drop-title">{busy ? 'Reading your export…' : 'Drop your Letterboxd ZIP here'}</span>
      <span class="wel-drop-sub">{busy ? 'This only takes a moment.' : 'or click to choose the file'}</span>
      <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} />
    </button>
  );
}

function StepList({ done }) {
  const Num = ({ n }) => <span class={'onb-num' + (done ? ' done' : '')} aria-hidden="true">{done ? <Icon name="check" size={14} /> : n}</span>;
  return (
    <ol class={'onb-steps' + (done ? ' is-done' : '')}>
      <li><Num n={1} /><div>
        <h2>Open Letterboxd's export page</h2>
        {!done && <>
          <p>Sign in if it asks you</p>
          <div class="onb-link">
            <button type="button" class="btn" onClick={() => openExternal(EXPORT_URL)}><Icon name="external" size={16} />Open Letterboxd</button>
            <span class="onb-url">letterboxd.com/settings/data</span>
          </div>
        </>}
      </div></li>
      <li><Num n={2} /><div><h2>Choose "Export your data"</h2>{!done && <p>You'll get a ZIP file.</p>}</div></li>
      <li><Num n={3} /><div><h2>Drop the ZIP here</h2>{!done && <p>Leave it zipped. Matinee does the rest.</p>}</div></li>
    </ol>
  );
}

/** "137 watched, 556 on your watchlist and 113 diary entries." */
export function foundSentence(s) {
  if (!s) return '';
  const parts = [];
  if (s.watched) parts.push(`${pluralN(s.watched, 'watched', 'watched')}`);
  if (s.watchlist) parts.push(`${Number(s.watchlist).toLocaleString('en-AU')} on your watchlist`);
  if (s.entries) parts.push(pluralN(s.entries, 'diary entry', 'diary entries'));
  if (!parts.length) return '';
  return (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + '.';
}

export function FillBar({ core, text, total }) {
  const f = fillOf(core, total);
  return (
    <div class="onb-prog">
      {text && <p>{text(f)}</p>}
      <div class="onb-trk" role="progressbar" aria-label="Filling in your films" aria-valuemin="0" aria-valuemax="100" aria-valuenow={f.pct}><b style={{ width: Math.max(f.pct, 2) + '%' }} /></div>
    </div>
  );
}

/** Frame 1: the first open, and frame 2 in the same spot once the export is in. */
export default function Start({ core, summary, busy, error, onFile, onError, onBackup, onClearError, onContinue, onSkip, startedOver }) {
  const backupInput = useRef();
  const pick = e => { const f = e.target.files[0]; e.target.value = ''; if (f) onBackup(f); };
  return (
    <div class="onb-start">
      <div class="onb-copy">
        <div>
          <div class="onb-mark">Matinee</div>
          <p class="onb-promise">{summary ? 'PS. All your data is saved locally, remember to export it if you go to another device!' : 'A cosy home for your Letterboxd library, made with love <3'}</p>
        </div>
        <StepList done={!!summary} />
        {!summary && <p class="onb-note">Matinee will read updates to your films from Letterboxd, such as logged films and new films added to watchlist</p>}
      </div>
      <div class="onb-side">
        {summary ? (
          <div class="onb-found" key="found">
            <h1>Found {pluralN(summary.films, 'film', 'films')}</h1>
            <p class="onb-found-counts">{foundSentence(summary)}</p>
            <div class="onb-found-fill">
              <p>Matinee is now filling in posters, ratings and reviews for each film. That takes a while.{startedOver ? '' : ' You can customise Matinee in the meantime.'}</p>
              <FillBar core={core} total={summary.films} />
              <span class="onb-small">{(() => { const f = fillOf(core, summary.films); return `${f.done.toLocaleString('en-AU')} of ${pluralN(f.total, 'film', 'films')} so far`; })()}</span>
            </div>
            <div class="onb-grow" />
            {startedOver ? (
              <div class="onb-found-cta"><button type="button" class="btn btn-primary onb-btn" onClick={onSkip}>Open my library</button></div>
            ) : (
              <div class="onb-found-cta">
                <button type="button" class="btn btn-primary onb-btn" onClick={onContinue}>Continue</button>
                <button type="button" class="btn btn-ghost onb-btn onb-push" onClick={onSkip}>Skip, open my library</button>
              </div>
            )}
          </div>
        ) : (
          <DropZone busy={busy} onFile={onFile} onError={onError} />
        )}
        {error && (
          <div class="wel-error" role="alert">
            <p>{error}</p>
            <button type="button" class="btn btn-small" onClick={onClearError}>Try another file</button>
          </div>
        )}
        {summary
          ? (!startedOver && <p class="onb-under">About a minute of small choices, all optional. Everything can be changed later in Settings.</p>)
          : !error && (
            <p class="onb-under">Not your first time? <button type="button" class="btn-link" disabled={busy} onClick={() => backupInput.current.click()}>Import data from Matinee on another device</button>
              <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={pick} />
            </p>
          )}
      </div>
    </div>
  );
}
