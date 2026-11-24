// Fetches every source for the open film once, and keeps a live status for the pill.
import { useEffect, useState, useRef } from 'preact/hooks';
import { call } from '../../api.js';
import { useEvent } from '../../state.js';
import { shouldFetch, applyEvent, eventIsFor } from './fetchModel.js';

export function useFilmFetch(key, initial) {
  const [status, setStatus] = useState(initial || null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState([]); // sources being retried
  const keyRef = useRef(key); keyRef.current = key;
  const seeded = useRef(null);
  // A fresh film (route change) starts from what getFilm said; later refreshes of the same film don't overwrite live status.
  useEffect(() => { setStatus(initial || null); setRunning(false); seeded.current = key; }, [key]);
  useEffect(() => { if (initial && !status) setStatus(initial); }, [initial]);

  const finish = res => {
    if (keyRef.current !== key) return;
    if (res && Array.isArray(res.outcomes)) setStatus(res);
    setRunning(false);
  };
  useEffect(() => {
    if (!key || !shouldFetch(key)) return;
    setRunning(true);
    call('fetchFilmAll', { key }).then(finish, () => { if (keyRef.current === key) setRunning(false); });
  }, [key]);

  useEvent('film', ev => {
    if (!eventIsFor(ev, keyRef.current)) return;
    if (ev.done) return; // the fetchFilmAll / retry call resolves with the full status
    setStatus(s => applyEvent(s, ev));
  });

  const retry = async providerIds => {
    const ids = providerIds && providerIds.length ? providerIds : (status?.outcomes || []).filter(o => o.status === 'failed' || o.status === 'deferred').map(o => o.provider);
    if (!ids.length) return;
    setRunning(true); setBusy(ids);
    try { finish(await call('retryFilmSources', { key, providerIds: ids })); } catch { if (keyRef.current === key) setRunning(false); } // recorded by api.call; the pill keeps showing the source states
    setBusy([]);
  };
  return { status, running, busy, retry };
}
