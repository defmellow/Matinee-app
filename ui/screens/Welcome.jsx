// Onboarding: the first open and the export (frames 1-2), three optional steps while the films fill in
// (Your look, About you, A quick look around), and "You're all set". It belongs to the empty app: app.jsx sends a library-less app
// here. Opened again from Settings → Letterboxd (#/welcome/again) it starts at frame 1 with the library kept. Every choice is saved the moment it's made, so closing half way simply opens the Library next time.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../api.js';
import { go } from '../router.js';
import { refreshCore, reloadLibrary } from '../state.js';
import { reportProblem } from '../debug/report.js';
import { readFileBytes } from './welcome/counts.js';
import { systemRegion } from './welcome/countries.js';
import Start from './welcome/Start.jsx';
import { Head, Foot, Look, About, Tour, Ready } from './welcome/Setup.jsx';
import './settings.css'; // the theme tiles and check boxes are shared with Settings → Appearance
import './welcome.css';

// Start over (Settings → Your data) keeps look, country, username, code and keys, so after it the import leads straight in.
export const STARTED_OVER_KEY = 'matinee.startedOver';
const startedOver = () => { try { return localStorage.getItem(STARTED_OVER_KEY) === '1'; } catch { return false; } };
const forgetStartedOver = () => { try { localStorage.removeItem(STARTED_OVER_KEY); } catch { /* no storage: nothing to forget */ } };

export default function Welcome({ core, param }) {
  return <Onboarding core={core} again={param === 'again'} />;
}

function Onboarding({ core, again }) {
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState('start'); // start | look | about | tour | ready
  const [card, setCard] = useState(0);
  const over = useRef(startedOver());

  // Opened with a library in place and not from Debug (a reload half way through): there is nothing to do here.
  const arrived = useRef(core && core.ready && !again);
  useEffect(() => { if (arrived.current) go('library'); }, []);

  // Before the export is in, the country comes from the computer unless the user has chosen one, so the first fetches already use it.
  useEffect(() => {
    if (!core || core.ready || !core.settings || core.settings.regionChosen) return;
    const r = systemRegion();
    if (r && r !== core.settings.region) call('setSettings', { region: r, regionFromSystem: true }).then(refreshCore, () => { /* api.call recorded why; Australia stays */ });
  }, []);

  const onFile = async file => {
    setError(null); setBusy(true);
    try {
      const bytes = await readFileBytes(file);
      setSummary(await call('importExport', { bytes }));
      refreshCore();
    } catch (e) {
      setError(e.message || "That file didn't work.");
    } finally { setBusy(false); }
  };
  const onBackup = async file => {
    setError(null); setBusy(true);
    try {
      const json = await file.text();
      await call('importBackup', { json });
      forgetStartedOver();
      await refreshCore();
      reloadLibrary();
      go('library'); // they made their choices on the other computer
    } catch (e) {
      if (!e || e.code !== 'bad-request') reportProblem({ area: 'Backup', message: "Matinee couldn't restore a backup.", detail: e });
      setError((e && e.message) || "That file didn't work.");
    } finally { setBusy(false); }
  };
  const openLibrary = () => { forgetStartedOver(); go('library'); };

  if (arrived.current) return null;

  if (stage === 'start') {
    return (
      <div class="onb onb-first">
        <Start core={core} summary={summary} busy={busy} error={error} onFile={onFile} onError={setError} onBackup={onBackup} onClearError={() => setError(null)}
          onContinue={() => setStage('look')} onSkip={openLibrary} startedOver={over.current} />
      </div>
    );
  }
  if (stage === 'ready') {
    return (
      <div class="onb onb-steps-page">
        <Head right={null} />
        <main class="onb-mid onb-mid-centre"><Ready core={core} onOpen={openLibrary} /></main>
      </div>
    );
  }
  const back = { look: () => setStage('start'), about: () => setStage('look'), tour: () => setStage('about') }[stage];
  const next = { look: () => setStage('about'), about: () => setStage('tour'), tour: () => setStage('ready') }[stage];
  return (
    <div class="onb onb-steps-page">
      <Head step={stage} onSkip={openLibrary} />
      <main class={'onb-mid' + (stage === 'tour' ? ' onb-mid-tour' : '')}>
        {stage === 'look' && <Look core={core} />}
        {stage === 'about' && <About core={core} />}
        {stage === 'tour' && <Tour core={core} index={card} setIndex={setCard} onDone={() => setStage('ready')} />}
      </main>
      <Foot core={core} onBack={back} onNext={next} nextLabel={stage === 'tour' ? "I'm ready" : 'Next'}
        middle={stage === 'tour' ? "Don't worry if it's not fully filled out yet, films you open also fill on the fly." : null} />
    </div>
  );
}
