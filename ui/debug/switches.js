// Debug switches, kept on this computer only. The Film Map and Discover are archived: each stays hidden from the sidebar until it's turned on in Settings.
import { useEffect, useState } from 'preact/hooks';

function makeSwitch(key, fallback = false) {
  const subs = new Set();
  const read = () => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } };
  let on = read();
  const set = v => {
    on = !!v;
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ }
    subs.forEach(f => f(on));
  };
  const use = () => {
    const [v, setV] = useState(on);
    useEffect(() => { subs.add(setV); setV(on); return () => subs.delete(setV); }, []);
    return v;
  };
  return [set, use];
}

// The Map was rebuilt in Nov 2026 and shows by default again (it can still be hidden in Settings → Debug).
export const [setDebugMap, useDebugMap] = makeSwitch('debug:map', true);
export const [setDebugDiscover, useDebugDiscover] = makeSwitch('debug:discover');
