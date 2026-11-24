// "Choose for me": one film with almost nothing said about it. Turn it down with a reason and the next one moves that way.
import { useEffect, useRef, useState } from 'preact/hooks';
import { call } from '../../api.js';
import { Poster, runtimeText } from '../../components/film.jsx';
import { Loading } from '../../components/ui.jsx';
import { href } from '../../router.js';
import { MOOD_LABELS, REASONS } from './moods.js';

export default function Choose({ args, onExit }) {
  const [rejected, setRejected] = useState([]);
  const [steers, setSteers] = useState([]);
  const [res, setRes] = useState(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(false);
  const gen = useRef(0);

  const load = async (rej, st) => {
    const at = ++gen.current;
    setError(false);
    try {
      const r = await call('getPicks', { ...args, choose: { rejected: rej, steers: st } });
      if (at === gen.current) setRes(r);
    } catch { if (at === gen.current) setError(true); }
  };
  const mem = useRef({ rejected, steers, pick: null }); mem.current = { rejected, steers, pick: res && res.pick };
  const was = useRef(null);
  // The first look starts afresh. Changing the time keeps what the user has said, and only picks again when this film no longer fits.
  useEffect(() => {
    const max = args.dials.maxMinutes;
    if (was.current === null) { setRes(null); load([], []); }
    else {
      const cur = mem.current.pick && mem.current.pick.film;
      if (cur && max && cur.runtime && cur.runtime > max) load(mem.current.rejected, mem.current.steers);
      else if (!max && !cur) load(mem.current.rejected, mem.current.steers);
    }
    was.current = max;
  }, [args.dials.maxMinutes]);

  const pick = res && res.pick;
  const reroll = steer => {
    setAsking(false);
    const rej = [...rejected, pick.key];
    const st = steer ? [...steers, steer.kind === 'mood' ? steer : { ...steer, key: pick.key }] : steers;
    setRejected(rej); setSteers(st); load(rej, st);
  };
  const startOver = () => { setRejected([]); setSteers([]); setAsking(false); load([], []); };

  if (error) return <div class="tn-choose"><p class="muted">Couldn't choose just now.</p><button type="button" class="btn" onClick={() => load(rejected, steers)}>Try again</button></div>;
  if (!res) return <div class="tn-choose"><Loading label="Choosing…" /></div>;
  if (!pick) {
    return (
      <div class="tn-choose">
        <p>{res.miss || (res.empty && res.empty.text) || 'Nothing left to suggest.'}</p>
        <div class="tn-choose-actions">
          <button type="button" class="btn btn-primary" onClick={startOver}>Start again</button>
          <button type="button" class="btn" onClick={onExit}>Back to Tonight</button>
        </div>
      </div>
    );
  }
  const f = pick.film;
  const meta = [f.year, runtimeText(f.runtime)].filter(Boolean).join(' · ');
  const last = steers[steers.length - 1];
  return (
    <div class="tn-choose">
      <p class="muted tn-choose-lead">How about this one?</p>
      <a class="tn-choose-poster" href={href('film', f.key)} title={f.title}><Poster film={f} eager /></a>
      <h2 class="tn-choose-title">{f.title}</h2>
      {meta && <p class="muted num">{meta}</p>}
      {res.relaxed && <p class="faint tn-choose-note">Not much left that fits everything you've said, so I loosened your earliest answers.</p>}
      {!asking && last && last.kind !== 'mood' && <p class="faint tn-choose-note">{REASONS.find(r => r[0] === last.kind)?.[1] ? `Going on what you said: ${REASONS.find(r => r[0] === last.kind)[1].toLowerCase()}.` : ''}</p>}
      <div class="tn-choose-actions">
        <a class="btn btn-primary" href={href('film', f.key)}>Sounds good</a>
        <button type="button" class="btn" onClick={() => setAsking(a => !a)} aria-expanded={asking}>Not this one</button>
      </div>
      {asking && (
        <div class="tn-choose-why">
          <p class="tn-label">What put you off?</p>
          <div class="chips">
            {REASONS.map(([kind, label]) => <button type="button" key={kind} class="chip" onClick={() => reroll({ kind })}>{label}</button>)}
          </div>
          <p class="tn-label">Or what are you in the mood for?</p>
          <div class="chips">
            {MOOD_LABELS.map(m => <button type="button" key={m} class="chip" onClick={() => reroll({ kind: 'mood', label: m })}>{m}</button>)}
          </div>
        </div>
      )}
      {(steers.length > 0 || rejected.length > 0) && <button type="button" class="btn-link tn-choose-reset" onClick={startOver}>Start over</button>}
    </div>
  );
}
