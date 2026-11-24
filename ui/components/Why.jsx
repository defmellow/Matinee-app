// "Why this one": at most two reasons that name whose voice they come from, then how sure we are, then a caution if one applies.
// Takes a pick from getPicks: { why: [{ voice, text }], confidence: { tier, text }, caution: { text } | null }.
import './why.css';

const SHORT = { know: 'We know this one well', fair: 'A fair guess', guess: 'A guess' };

export default function Why({ pick, compact = false }) {
  const lines = (pick.why || []).slice(0, compact ? 1 : 2);
  const conf = pick.confidence;
  return (
    <div class={compact ? 'why why-compact' : 'why'}>
      {lines.length > 0 && <ul class="why-lines">{lines.map((w, i) => <li key={i} class="why-line" data-voice={w.voice}>{w.text}</li>)}</ul>}
      {conf && <p class="why-conf" data-tier={conf.tier} title={conf.text}>{compact ? SHORT[conf.tier] : conf.text}</p>}
      {!compact && pick.caution && <p class="why-caution">{pick.caution.text}</p>}
    </div>
  );
}
