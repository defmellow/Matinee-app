// Letterboxd links: the export only gives short links (boxd.it/<code>). boxd.it answers with a plain redirect to the
// film's page (no Cloudflare check), so one request per film reveals its Letterboxd slug — which Wikidata indexes
// (P6127), turning title guessing into an exact match.
const SLUG = /letterboxd\.com\/film\/([^/?#]+)\//;

export function slugFromLocation(location) {
  const m = SLUG.exec(location || '');
  return m ? decodeURIComponent(m[1]) : null;
}

export default {
  id: 'boxd',
  label: 'Letterboxd links',
  progressLabel: 'Linking your films to Letterboxd',
  gives: ['exact film matching'],
  needsKey: false,
  requires: f => !!f.lid && !f.slug && !f.ids?.letterboxd,
  retryMissDays: 30,
  async enrich(films, ctx) {
    let done = 0, blocked = 0;
    // A small worker pool, so the breaker is re-checked before every request instead of once up front.
    const queue = [...films];
    const one = async film => {
      if (ctx.skip?.(film)) { ctx.progress(++done, films.length); return; } // an on-demand run already did this film
      try {
        const res = await ctx.http.response(`https://boxd.it/${film.lid}`, { method: 'HEAD', redirect: 'manual', signal: ctx.signal, retry429: false });
        const slug = res.status >= 300 && res.status < 400 ? slugFromLocation(res.headers.get('location')) : null;
        if (slug) { film.slug = film.slug || slug; ctx.done(film, { slug }, { letterboxd: slug }); }
        else if (res.status === 404) ctx.done(film, null);
        else if (res.status === 403 || res.status === 429) { blocked++; ctx.fail(film, new Error(`Letterboxd links answered ${res.status}`)); }
        else ctx.done(film, null);
      } catch (e) {
        if (e.code === 'aborted') return;
        if (e.status === 429) blocked++;
        ctx.fail(film, e);
      } finally { ctx.progress(++done, films.length); }
    };
    const worker = async () => {
      while (queue.length && !ctx.signal?.aborted && blocked < 3) await one(queue.shift());
    };
    await Promise.all(Array.from({ length: Math.min(4, films.length) }, worker));
    if (blocked >= 3) ctx.log('Letterboxd links are busy right now; the rest will be linked next time.');
  },
};
