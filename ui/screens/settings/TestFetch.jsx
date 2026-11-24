// "Test fetch": tries a sample of films against every site so the troubleshooting scripts can see how each behaves on this computer.
// Nothing in the library changes. The report is plain text to copy or save.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { toast, useEvent } from '../../state.js';
import { Dialog } from '../../components/ui.jsx';
import { download } from './format.js';
import { DEFAULT_FILMS, MAX_FILMS, MIN_FILMS, clampFilms, elapsedText, foldStep, headline, needsCheck, phaseText, reportFilename } from './testfetch.js';

export default function TestFetch({ core }) {
  const resumed = !!(core && core.testFetch && core.testFetch.running);
  const [count, setCount] = useState(DEFAULT_FILMS);
  const [running, setRunning] = useState(resumed);
  const [step, setStep] = useState({});
  const [check, setCheck] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [report, setReport] = useState(null); // { text, startedAt }
  const [error, setError] = useState(null);
  const [manual, setManual] = useState(null); // report text when the clipboard is blocked
  const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now());
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Show the last report, and pick up a run that is already going.
  useEffect(() => {
    call('getLastTestReport').then(r => { if (alive.current && r && r.text) setReport(r); }).catch(() => {}); // recorded by api.call; an older report simply isn't shown
  }, []);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const finish = () => {
    setRunning(false); setStopping(false);
    call('getLastTestReport').then(r => { if (alive.current && r && r.text) setReport(r); }).catch(() => {}); // recorded by api.call; an older report simply isn't shown
  };
  useEvent('testFetchStep', ev => {
    setStep(s => foldStep(s, ev));
    if (needsCheck(ev)) setCheck(true);
    if (ev && ev.phase === 'done' && ev.state === 'finished' && resumed && !startedHere.current) finish();
  });
  const startedHere = useRef(false);

  const run = async () => {
    startedHere.current = true;
    started.current = Date.now(); setNow(started.current);
    setRunning(true); setStep({}); setCheck(false); setError(null); setStopping(false);
    try {
      const r = await call('runTestFetch', { count });
      if (alive.current && r) setReport({ text: r.text || '', startedAt: new Date(started.current).toISOString() });
    } catch { if (alive.current) setError("The test didn't finish. Nothing in your library was changed. You can run it again."); }
    startedHere.current = false;
    if (alive.current) { setRunning(false); setStopping(false); }
  };
  const cancel = async () => {
    setStopping(true);
    try { await call('cancelTestFetch'); } catch { setStopping(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(report.text); toast('Report copied.'); }
    catch { setManual(report.text); }
  };
  const save = () => { download(reportFilename(), report.text, 'text/plain'); toast('Report saved.'); };

  const head = report ? headline(report.text) : null;
  const total = (step.done || 0) + (step.failed || 0);

  return (
    <div class="set-test">
      <h3>Test fetch</h3>
      <p class="muted">Fetches a sample of your films to see how each site behaves on this PC. Nothing in your library changes. Takes several minutes; Matinee pauses normal fetching meanwhile.</p>
      {!running && (
        <div class="set-row">
          <div class="set-stepper" role="group" aria-label="How many films">
            <span class="set-stepper-label" id="set-test-n">How many films</span>
            <button type="button" class="btn btn-small" aria-label="Fewer films" disabled={count <= MIN_FILMS} onClick={() => setCount(clampFilms(count - 4))}>−</button>
            <output class="num set-stepper-val" aria-labelledby="set-test-n">{count}</output>
            <button type="button" class="btn btn-small" aria-label="More films" disabled={count >= MAX_FILMS} onClick={() => setCount(clampFilms(count + 4))}>+</button>
          </div>
          <button type="button" class="btn btn-small btn-primary" onClick={run}>Run test</button>
        </div>
      )}
      {running && (
        <div class="set-job" aria-live="polite">
          <div class="set-row set-between">
            <span><strong>{stopping ? 'Stopping…' : phaseText(step.phase)}</strong>{total > 0 && <span class="muted num"> · {total} done{step.failed ? `, ${step.failed} didn't answer` : ''}</span>}</span>
            <span class="num muted">{elapsedText(now - started.current)}</span>
          </div>
          {step.current && !stopping && <p class="set-small set-test-now">Now: {step.current}</p>}
          {(check || (core.trouble || []).some(t => String(t.key).startsWith('check:'))) && <p class="set-msg" data-tone="warn">A site asked for a check, so a window has opened for you.</p>}
          <div class="set-row"><button type="button" class="btn btn-small" disabled={stopping} onClick={cancel}>Cancel</button></div>
        </div>
      )}
      {error && <p class="set-msg" data-tone="bad" role="status">{error}</p>}
      {report && !running && (
        <div class="set-report">
          <p class="set-small">{report.startedAt ? `Last test: ${new Date(report.startedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Last test'}</p>
          <pre class="set-report-text" tabindex="0" aria-label="Test fetch report summary">{head.text}</pre>
          {head.more > 0 && <p class="set-small">The first 40 lines. Copy or save the report to get all {head.more + 40} lines.</p>}
          <div class="set-row">
            <button type="button" class="btn btn-small" onClick={copy}>Copy report</button>
            <button type="button" class="btn btn-small" onClick={save}>Save report</button>
          </div>
        </div>
      )}
      {manual != null && (
        <Dialog title="Test fetch report" onClose={() => setManual(null)} footer={<button type="button" class="btn" onClick={() => setManual(null)}>Done</button>}>
          <p class="muted">Select all, then copy.</p>
          <textarea class="input" rows="12" readOnly aria-label="Test fetch report" value={manual} onFocus={e => e.currentTarget.select()} style={{ width: '100%', fontFamily: 'inherit' }} />
        </Dialog>
      )}
    </div>
  );
}
