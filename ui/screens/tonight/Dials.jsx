// The three dials: how long you have, what you're in the mood for, lighter or heavier.
import { useState } from 'preact/hooks';
import { Segmented, ChipToggle } from '../../components/ui.jsx';
import RuntimeSlider from '../../components/RuntimeSlider.jsx';
import { MOOD_LABELS, WEIGHTS, LATE_FIRST, MIN_MATCHES, SHOWN_MOODS } from './moods.js';
import { LISTS_ARCHIVED } from '../../archive.js';

/** The moods worth offering right now: hide ones nothing on the watchlist matches, put late-night ones first after 9pm. */
function visibleMoods(counts, selected, hour) {
  let list = MOOD_LABELS.filter(m => m === selected || !counts || (counts[m] ?? 0) >= MIN_MATCHES);
  if (hour >= 21 || hour < 4) list = [...list.filter(m => LATE_FIRST.includes(m)), ...list.filter(m => !LATE_FIRST.includes(m))];
  return list;
}

export default function Dials({ dials, onChange, moodCounts, listsPool }) {
  const [all, setAll] = useState(false);
  const moods = visibleMoods(moodCounts, dials.mood, new Date().getHours());
  const shown = all ? moods : moods.slice(0, SHOWN_MOODS);
  if (dials.mood && !shown.includes(dials.mood)) shown.push(dials.mood);
  const set = patch => onChange({ ...dials, ...patch });
  return (
    <div class="tn-controls">
      <div class="tn-control"><span class="tn-label">How long have you got?</span><RuntimeSlider label="How long have you got?" value={dials.maxMinutes} onChange={v => set({ maxMinutes: v })} /></div>
      <div class="tn-control tn-moods"><span class="tn-label">In the mood for</span>
        <div class="chips">{shown.map(m => <ChipToggle key={m} on={dials.mood === m} title={moodCounts && moodCounts[m] != null ? `${moodCounts[m]} films on your watchlist` : undefined} onClick={() => set({ mood: dials.mood === m ? null : m })}>{m}</ChipToggle>)}
          {moods.length > SHOWN_MOODS && <button type="button" class="btn btn-small btn-ghost" onClick={() => setAll(v => !v)}>{all ? 'Fewer moods' : `More moods (${moods.length - SHOWN_MOODS})`}</button>}
        </div>
      </div>
      {!LISTS_ARCHIVED && listsPool && listsPool.extra > 0 && (
        <div class="tn-control"><span class="tn-label">Where from</span>
          <div class="chips"><ChipToggle on={listsPool.on} title={`${listsPool.extra} more films from your lists`} onClick={() => set({ includeLists: !listsPool.on })}>Include my lists ({listsPool.extra})</ChipToggle></div>
        </div>
      )}
      <div class="tn-control"><span class="tn-label">Lighter or heavier?</span><Segmented label="Lighter or heavier" value={dials.weight} options={WEIGHTS} onChange={v => set({ weight: v })} /></div>
    </div>
  );
}
