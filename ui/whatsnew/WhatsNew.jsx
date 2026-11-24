// "What's new" popup. Self-contained: decides for itself whether to open (first run after an update), and reopens on demand
// from Settings via openWhatsNew(). Reads the changelog bundled into the app, so it works offline.
import { useEffect, useState } from 'preact/hooks';
import { Dialog } from '../components/ui.jsx';
import { useCore } from '../state.js';
import { parseChangelog, pickSections, sectionsSince, inlineParts, compareVersions, normalizeVersion } from './changelog.js';
import './whatsnew.css';

import { reportFailure } from '../debug/report.js';
// Both changelogs are bundled (main carries the experimental file after a merge). The RUNNING version picks one: an early-test
// build ("0.36.0-exp.48") reads the experimental changelog, a stable build reads the main one. Choosing by file presence made
// stable v0.38 read the experimental list and show nothing.
const files = import.meta.glob(['../../docs/CHANGELOG-experimental.md', '../../docs/CHANGELOG.md'], { query: '?raw', import: 'default', eager: true });
const raw = name => files[`../../docs/${name}`] || '';
const EXPERIMENTAL = parseChangelog(raw('CHANGELOG-experimental.md'));
const MAIN = parseChangelog(raw('CHANGELOG.md'));
export const sectionsFor = version => pickSections(version, MAIN, EXPERIMENTAL);

const KEY = 'matinee.lastSeenVersion';
const EVENT = 'matinee:whatsnew';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode: it just shows again next time */ } };

/** Ask the popup to open (Settings > Updates). */
export function openWhatsNew() { dispatchEvent(new CustomEvent(EVENT)); }

/** The running app's version, or '' when not in the installed app. */
function useVersion() {
  const [v, setV] = useState('');
  useEffect(() => {
    const b = typeof window !== 'undefined' && window.matinee && window.matinee.updates;
    if (!b) return;
    let live = true;
    b.status().then(s => { if (live && s && s.current && s.current !== '0.0.0') setV(s.current); }).catch(e => reportFailure('Matinee', "Couldn't read the app version.", e, { level: 'warning' }));
    return () => { live = false; };
  }, []);
  return v;
}

export function Notes({ sections }) {
  const many = sections.length > 1;
  return sections.map(s => (
    <section class="wn-section" key={s.version}>
      {many && <h3 class="wn-version">{headingOf(s)}</h3>}
      <ul class="wn-list">
        {s.items.map((it, i) => <li key={i}>{inlineParts(it).map((p, j) => (p.bold ? <strong key={j}>{p.text}</strong> : p.text))}</li>)}
      </ul>
    </section>
  ));
}

const headingOf = s => `Version ${s.version.replace(/\.0$/, '').replace(/\.0-exp/, '-exp').replace('-exp.', ' early test ')}${s.date ? ` · ${s.date}` : ''}`;

export default function WhatsNew() {
  const core = useCore();
  const version = useVersion();
  const [shown, setShown] = useState(null); // { sections, all }
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!core || !version || shown) return;
    const last = read();
    // Never opened before: a fresh install (this popup isn't mounted during the welcome steps, so it first runs once the library is
    // in) has nothing to catch up on. Every copy that has opened Matinee since the key was added already has a version stored.
    if (!last) { write(version); return; }
    if (!core.ready || (last && compareVersions(version, last) <= 0)) return;
    const list = sectionsSince(sectionsFor(version), last, version);
    if (list.length) setShown({ sections: list });
    else write(version);
  }, [core && core.ready, version]);

  useEffect(() => {
    const open = () => {
      const upto = sectionsFor(version).filter(s => !version || compareVersions(s.version, version) <= 0).sort((a, b) => compareVersions(b.version, a.version));
      if (upto.length) { setMore(false); setShown({ sections: upto.slice(0, 1), manual: true }); }
    };
    addEventListener(EVENT, open);
    return () => removeEventListener(EVENT, open);
  }, [version]);

  if (!shown) return null;
  const close = () => { if (version) write(version); setShown(null); };
  const top = shown.sections[0];
  const sections = more ? sectionsFor(version).filter(s => !version || compareVersions(s.version, version) <= 0).sort((a, b) => compareVersions(b.version, a.version)) : shown.sections;
  const earlier = sectionsFor(version).length > shown.sections.length;
  return (
    <Dialog title="What's new" onClose={close} footer={<>
      {shown.manual && earlier && !more && <button type="button" class="btn btn-ghost" onClick={() => setMore(true)}>Earlier versions</button>}
      <button type="button" class="btn btn-primary" onClick={close}>Got it</button>
    </>}>
      <p class="wn-sub">{shown.sections.length > 1 && !shown.manual ? `${shown.sections.length} updates since you last opened Matinee` : headingOf(top)}</p>
      <div class="wn-body"><Notes sections={sections} /></div>
    </Dialog>
  );
}
