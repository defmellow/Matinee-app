// Film page → "Debug" panel (Debug mode only, collapsed, at the bottom): ids, one row per source, which source gave each field,
// and the problems recorded for this film. Data: getFilmDebug({ key }) from the core.
import { useCall } from '../state.js';
import { openExternal } from '../api.js';
import { useDebug } from './useDebug.js';
import { ageText, fieldsByProvider, idLink, problemTime } from './model.js';
import { Flag } from './ProblemsPanel.jsx';
import './debug.css';

// A time becomes "19 d ago"; anything else the core sent (a count, a note) is shown as it is.
const when = (v, now) => {
  if (v == null || v === '' || v === false) return '';
  if (typeof v === 'object') return [v.at && when(v.at, now), v.n > 1 && `×${v.n}`, v.why].filter(Boolean).join(' · '); // film.failed: { at, n, why }
  return ageText(v, now) ? ageText(v, now) + ' ago' : String(v);
};
const cell = v => (v == null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : String(v));

export default function FilmDebug({ film, stamp = '' }) {
  const on = useDebug();
  if (!on) return null;
  return <Panel film={film} stamp={stamp} />;
}

function Panel({ film, stamp }) {
  const key = film.key;
  const { data, error, loading, reload } = useCall('getFilmDebug', { key }, [key, stamp], { refreshOn: { event: 'library', when: p => !p || !p.keys || p.keys.includes(key) } });
  const ids = (data && data.ids) || film.ids || {};
  const now = Date.now();
  return (
    <details class="fdebug">
      <summary>Debug{data && data.problems ? ` · ${data.problems.length} ${data.problems.length === 1 ? 'problem' : 'problems'} for this film` : ''}</summary>
      <div class="fdebug-body">
        {loading && !data && <p class="muted">Loading…</p>}
        {error && <p class="set-msg" data-tone="bad" role="alert">Couldn't load the debug details: {error.message} <button type="button" class="btn btn-small" onClick={reload}>Try again</button></p>}
        <div>
          <h3>Film</h3>
          <table><tbody>
            <tr><th>key</th><td>{key}</td></tr>
            <tr><th>title</th><td>{film.title}{film.year ? ` (${film.year})` : ''}</td></tr>
            {Object.entries(ids).filter(([, v]) => v).map(([k, v]) => {
              const link = idLink(k, v);
              return <tr key={k}><th>{k}</th><td>{link ? <a href={link} onClick={e => { e.preventDefault(); openExternal(link); }}>{String(v)}</a> : String(v)}</td></tr>;
            })}
            {film.checked && <tr><th>checked</th><td>{typeof film.checked === 'object' ? Object.entries(film.checked).map(([p, t]) => `${p} ${ageText(t, now)}`).join(', ') : String(film.checked)}</td></tr>}
          </tbody></table>
        </div>
        {data && data.providers && (
          <div>
            <h3>Sources</h3>
            <table>
              <thead><tr><th>source</th><th>status</th><th>reason</th><th>checked</th><th>missed</th><th>failed</th><th>note</th><th>gave</th></tr></thead>
              <tbody>
                {data.providers.map(p => (
                  <tr key={p.id}>
                    <td>{p.label || p.id}</td>
                    <td class="nw" data-status={p.status}>{cell(p.status)}</td>
                    <td>{cell(p.reason)}</td>
                    <td class="nw">{when(p.checked, now)}</td>
                    <td class="nw">{when(p.missed, now)}</td>
                    <td>{when(p.failed, now)}</td>
                    <td>{cell(p.missNote)}{p.reread ? ` · reread ${cell(p.reread)}` : ''}</td>
                    <td>{p.hasData === false ? 'nothing' : cell(p.fields)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.fieldSources && (
          <div>
            <h3>Which source supplied what</h3>
            <table><tbody>
              {fieldsByProvider(data.fieldSources).map(g => <tr key={g.provider}><th>{g.provider}</th><td>{g.fields.join(', ')}</td></tr>)}
            </tbody></table>
          </div>
        )}
        {data && (
          <div>
            <h3>Problems for this film</h3>
            {data.problems && data.problems.length ? (
              <ul class="prob-list">
                {data.problems.map(p => (
                  <li key={p.id} class="prob-row">
                    <div class="prob-head"><Flag level={p.level} /><span class="num">{problemTime(p.at)}</span><span class="prob-area">{p.area}</span>{p.count > 1 && <span class="num">×{p.count}</span>}</div>
                    <div class="prob-msg">{p.message}</div>
                    {p.detail && <pre class="debug-mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{p.detail}</pre>}
                  </li>
                ))}
              </ul>
            ) : <p class="muted">None recorded.</p>}
          </div>
        )}
      </div>
    </details>
  );
}
