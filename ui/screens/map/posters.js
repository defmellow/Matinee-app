// Poster images for the zoomed-in Map: loaded lazily, a few at a time, a small number kept. Pure apart from the image factory.
// get(url) answers the picture when it is ready, null while it is loading or waiting, and false if it could not load.
export function createPosterCache({ make, onReady = () => {}, maxLoading = 6, keep = 220, maxQueue = 90 } = {}) {
  const have = new Map();   // url -> img | false, oldest first
  const loading = new Set();
  let queue = [];
  const pump = () => {
    while (loading.size < maxLoading && queue.length) {
      const url = queue.pop(); // the most recently wanted first: what is on screen now
      if (have.has(url) || loading.has(url)) continue;
      loading.add(url);
      let img;
      const done = ok => {
        loading.delete(url);
        have.set(url, ok ? img : false);
        while (have.size > keep) have.delete(have.keys().next().value);
        onReady(url, ok);
        pump();
      };
      try {
        img = make(url);
        img.onload = () => done(true);
        img.onerror = () => done(false);
      } catch { done(false); }
    }
  };
  return {
    get(url) {
      if (!url) return false;
      if (have.has(url)) { const v = have.get(url); have.delete(url); have.set(url, v); return v; } // kept as recently used
      if (!loading.has(url) && !queue.includes(url)) { queue.push(url); if (queue.length > maxQueue) queue = queue.slice(-maxQueue); pump(); }
      return null;
    },
    get loading() { return loading.size; },
    get size() { return have.size; },
  };
}
