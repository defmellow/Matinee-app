// A small politeness layer: at most `concurrency` jobs in flight, at least `gap` ms between starts,
// lower `priority` numbers first (FIFO inside a priority), an optional host-wide pause, and cancellable queued jobs.
// `clock` is injectable for tests: { now, setTimeout, clearTimeout }.
const realClock = { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: t => clearTimeout(t) };
const stopped = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });

export function createLimiter({ concurrency = 2, gap = 350, clock = realClock } = {}) {
  let active = 0, last = -Infinity, pausedTo = 0, wake = null;
  const queue = [];

  function pump() {
    if (wake) { clock.clearTimeout(wake); wake = null; }
    while (active < concurrency && queue.length) {
      const now = clock.now();
      const ready = Math.max(last + gap, pausedTo);
      if (now < ready) { wake = clock.setTimeout(() => { wake = null; pump(); }, ready - now); return; }
      const job = queue.shift();
      job.cleanup();
      if (job.signal && job.signal.aborted) { job.reject(stopped()); continue; }
      last = now;
      active++;
      (async () => {
        try { job.resolve(await job.fn()); } catch (e) { job.reject(e); }
        finally { active--; pump(); }
      })();
    }
  }

  function run(fn, { priority = 3, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(stopped());
      const job = { fn, resolve, reject, priority, signal, cleanup() {} };
      if (signal) {
        const onAbort = () => {
          const i = queue.indexOf(job);
          if (i >= 0) { queue.splice(i, 1); job.cleanup(); reject(stopped()); pump(); }
        };
        signal.addEventListener('abort', onAbort, { once: true });
        job.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      let i = queue.length;
      while (i > 0 && queue[i - 1].priority > priority) i--;
      queue.splice(i, 0, job);
      pump();
    });
  }
  /** No job starts before now + ms (jobs already running carry on). */
  run.pause = ms => { pausedTo = Math.max(pausedTo, clock.now() + Math.max(0, ms)); pump(); };
  run.pausedUntil = () => (pausedTo > clock.now() ? pausedTo : 0);
  run.pending = () => queue.length;
  /** Reject every job that has not started yet (a host that must be left alone shouldn't keep a queue waiting). `err` may be a function. */
  run.drop = err => {
    const jobs = queue.splice(0);
    for (const j of jobs) { j.cleanup(); j.reject(typeof err === 'function' ? err() : err); }
    return jobs.length;
  };
  return run;
}

export async function retry(fn, { attempts = 3, base = 800, shouldRetry = () => true } = {}) {
  let err;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(i); } catch (e) {
      err = e;
      if (i === attempts - 1 || !shouldRetry(e)) break;
      await new Promise(r => setTimeout(r, base * 2 ** i * (e && e.status === 429 ? 4 : 1)));
    }
  }
  throw err;
}

