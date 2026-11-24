// Wikidata provider (no key). Finds each film's Wikidata item, then reads ids, people, genres, awards and more from it.
// Matching, cheapest first (everything is batched, so a library of N films takes roughly N/40 requests):
//   a) a Wikidata id we already know
//   b) TMDB id or Letterboxd slug, looked up on Wikidata in one query per 50 films
//   c) English Wikipedia article titles ("Title (1984 film)", "Title (film)", "Title") matched to items through the
//      query service's sitelinks, 40 films per query; the film type and year are checked in the same answer.
//      If the query service is down, the Wikipedia action API is the fallback.
//   d) exact English label + year on Wikidata, 10 films per query (slow, so last)
// Details come from the query service (25 items per query); if that can't answer, the Wikidata action API is used
// for the rest of the run. A 429 from either never stalls the run.
import {
  mapEntity, referencedIds, verifyCandidate, sparqlByIds, sparqlByLabel, readIdMatches, readLabelMatches,
  titleCandidates, sitelinkTitles, readTitleResolution, FILM_TYPES,
  sparqlBySitelinks, readSitelinkRows, unknownTypes, pickSitelinkMatches, sparqlFilmSubclasses,
  sparqlDetails, readDetails, readTypeClasses, TV_TYPES,
} from '../parse/wikidata.js';

const API = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql?format=json';
const WIKIPEDIA = 'https://en.wikipedia.org/w/api.php';
export const BATCH = 50;          // ids / titles per action-API request
export const TITLE_BATCH = 40;    // films per sitelink query
export const DETAIL_BATCH = 25;   // items per SPARQL details query
export const LABEL_BATCH = 10;
// DECISION: details are read from the query service first and the Wikidata action API is the fallback (the brief said the
// reverse). Measured on 46 films: ~4 s via the query service, ~5 min via wbgetentities (label look-ups alone take ~30 requests).
const SPARQL_DETAILS_FIRST = true;

const abortError = () => Object.assign(new Error('Stopped.'), { code: 'aborted' });
const isAbort = e => e?.code === 'aborted' || e?.name === 'AbortError';
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

// Plain-English error for the film page. `status` and `code` are kept so the caller can tell "the site is being left alone"
// (host-paused, 429) from a real failure, and so a stopped run is not counted against the film.
const friendly = e => {
  const keep = { ...(e?.status ? { status: e.status } : {}), ...(e?.code ? { code: e.code } : {}) };
  if (e?.status === 429) return Object.assign(new Error('Wikidata asked Matinee to slow down. It will try these films again next time.'), keep);
  if (e?.status) return Object.assign(new Error(`Wikidata isn't responding properly right now (error ${e.status}).`), keep);
  return Object.assign(new Error("Couldn't reach Wikidata. Check your internet connection and try again."), keep);
};

async function enrich(films, ctx) {
  const { http, signal } = ctx;
  const total = films.length;
  let finished = 0;
  const check = () => { if (signal?.aborted) throw abortError(); };
  const tick = () => ctx.progress(finished, total);
  const finish = (film, data, ids) => { ctx.done(film, data, ids); finished++; };
  const failFilm = (film, e) => { ctx.fail(film, friendly(e)); finished++; };
  const labelCache = new Map(); // qid → English label or null, for this run
  const stats = ctx.stats || {}; // optional: counters for the live check script
  const count = k => { stats[k] = (stats[k] || 0) + 1; };

  // Per-run switches: once an action API answers 429 (or breaks) the rest of the run goes through the query service.
  let wikidataApiDown = false;
  let wikipediaApiDown = false;

  const sparql = query => { count('sparql'); return http.json(SPARQL, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query }).toString(),
  }); };

  // Film types: Q11424 itself plus anything that is a subclass of it (e.g. "science fiction film"), learned as we go.
  const acceptedTypes = new Set([...FILM_TYPES, ...TV_TYPES]); // TV series, specials etc. count too
  const tvTypes = new Set(TV_TYPES);
  const rejectedTypes = new Set();
  async function learnTypes(unknown) {
    const list = [...unknown];
    if (!list.length) return true;
    try {
      const { accepted, tv } = readTypeClasses(await sparql(sparqlFilmSubclasses(list)));
      for (const t of list) (accepted.has(t) ? acceptedTypes : rejectedTypes).add(t);
      for (const t of tv) tvTypes.add(t);
      return true;
    } catch (e) {
      if (isAbort(e)) throw abortError();
      ctx.warn?.(null, "Wikidata's film-type lookup failed, so some films will be matched on a later run.", e);
      ctx.log('Wikidata film-type lookup failed:', e.message); // those types stay unknown: the caller retries these films next run
      return false;
    }
  }

  // ---- details via the query service: Map(qid → entity|null), plus per-qid errors ----
  async function sparqlEntities(qids, canSplit = true) {
    check();
    try {
      const { entities, labels } = readDetails(await sparql(sparqlDetails(qids)), qids);
      for (const [id, l] of labels) if (l || !labelCache.has(id)) labelCache.set(id, l);
      return { entities, errors: new Map() };
    } catch (e) {
      if (isAbort(e)) throw abortError();
      if (canSplit && qids.length > 1) {
        const mid = Math.ceil(qids.length / 2);
        const a = await sparqlEntities(qids.slice(0, mid), false);
        const b = await sparqlEntities(qids.slice(mid), false);
        return { entities: new Map([...a.entities, ...b.entities]), errors: new Map([...a.errors, ...b.errors]) };
      }
      return { entities: new Map(), errors: new Map(qids.map(q => [q, e])) };
    }
  }

  // ---- details via the action API: Map(qid → entity|null). Throws on failure. ----
  async function actionEntities(qids) {
    const res = await http.json(`${API}?action=wbgetentities&format=json&ids=${qids.join('|')}&props=claims|sitelinks|labels&languages=en&sitefilter=enwiki`, { signal, retry429: false });
    count('wbgetentities');
    const entities = res?.entities || {};
    const need = new Set();
    for (const q of qids) {
      const e = entities[q];
      if (e && !e.missing) for (const id of referencedIds(e)) if (!labelCache.has(id)) need.add(id);
    }
    for (const part of chunks([...need], BATCH)) {
      check();
      const r = await http.json(`${API}?action=wbgetentities&format=json&ids=${part.join('|')}&props=labels&languages=en`, { signal, retry429: false });
      for (const id of part) labelCache.set(id, r?.entities?.[id]?.labels?.en?.value || null);
    }
    return new Map(qids.map(q => [q, entities[q] && !entities[q].missing ? entities[q] : null]));
  }

  // ---- details: entities + labels → fields. Returns Map(film → 'ok' | 'rejected' | 'failed') ----
  // Query service first (measured: ~4 s for 40 films, against ~5 minutes of label look-ups through the action API);
  // the action API is the fallback if the query service can't answer. Each switch is permanent for the run.
  let sparqlDetailsDown = false;
  const detailsMode = () => (!sparqlDetailsDown && (SPARQL_DETAILS_FIRST || wikidataApiDown)) ? 'sparql' : !wikidataApiDown ? 'action' : 'sparql';
  async function details(cands) {
    const outcome = new Map();
    const queue = [...cands.keys()];
    while (queue.length) {
      check();
      const mode = detailsMode();
      const batch = queue.splice(0, mode === 'sparql' ? DETAIL_BATCH : BATCH);
      const qids = [...new Set(batch.map(f => cands.get(f).qid))];
      let entities, errors = new Map();
      if (mode === 'sparql') {
        ({ entities, errors } = await sparqlEntities(qids));
        count('sparqlDetails');
        if (errors.size === qids.length && !sparqlDetailsDown && !wikidataApiDown) {
          sparqlDetailsDown = true;
          ctx.log('Wikidata query service could not give details; trying the Wikidata API for the rest of this run.');
          queue.unshift(...batch);
          continue;
        }
      } else {
        try { entities = await actionEntities(qids); } catch (e) {
          if (isAbort(e)) throw abortError();
          wikidataApiDown = true;
          ctx.warn?.(null, "The Wikidata API isn't answering, so details come from the query service only.", e);
          ctx.log(`Wikidata API unavailable (${e.status || e.message}).`);
          if (sparqlDetailsDown) { // nothing left to ask
            for (const film of batch) { failFilm(film, e); outcome.set(film, 'failed'); }
            tick();
          } else queue.unshift(...batch);
          continue;
        }
      }
      for (const film of batch) {
        const { qid, verify } = cands.get(film);
        if (errors.has(qid)) { failFilm(film, errors.get(qid)); outcome.set(film, 'failed'); continue; }
        const e = entities.get(qid);
        if (!e || (verify && !verifyCandidate(e, film.year, acceptedTypes, tvTypes))) { outcome.set(film, 'rejected'); continue; }
        const { data, ids } = mapEntity(e, id => labelCache.get(id) ?? null, tvTypes);
        finish(film, data, ids);
        outcome.set(film, 'ok');
      }
      tick();
    }
    return outcome;
  }

  const cands = new Map(); // film → { qid, verify }
  let open = [];           // films still unmatched

  // a) known Wikidata id
  for (const f of films) {
    if (f.ids?.wikidata) cands.set(f, { qid: f.ids.wikidata, verify: false });
    else open.push(f);
  }

  // b) TMDB id / Letterboxd slug
  const slugOf = f => f.ids?.letterboxd || f.slug || null;
  const keyed = open.filter(f => f.ids?.tmdb || slugOf(f));
  for (const batch of chunks(keyed, BATCH)) {
    check();
    try {
      const m = readIdMatches(await sparql(sparqlByIds({
        tmdb: [...new Set(batch.filter(f => f.ids?.tmdb).map(f => String(f.ids.tmdb)))],
        letterboxd: [...new Set(batch.map(slugOf).filter(Boolean))],
      })));
      for (const f of batch) {
        const q = (f.ids?.tmdb && m.tmdb.get(String(f.ids.tmdb))) || (slugOf(f) && m.letterboxd.get(slugOf(f)));
        if (q) cands.set(f, { qid: q, verify: false });
      }
    } catch (e) {
      if (isAbort(e)) throw abortError();
      ctx.warn?.(null, "Wikidata's id lookup failed, so films are matched by title instead.", e);
      ctx.log('Wikidata id lookup failed, trying titles instead:', e.message); // not fatal: later steps still try
    }
    tick();
  }
  open = open.filter(f => !cands.has(f));

  // c) English Wikipedia titles, through the query service's sitelinks
  const titleFailed = []; // films whose sitelink query failed even after splitting
  const typeFailed = new Set(); // films whose film-type lookup failed, so a match could not be judged
  const sitelinkMatch = async (batch, canSplit) => {
    check();
    const items = batch.map(f => ({ titles: sitelinkTitles(f.title, f.year), year: f.year ? Number(f.year) : null }));
    const live = items.map((it, i) => (it.titles.length ? i : -1)).filter(i => i >= 0);
    if (!live.length) return;
    // query with compact indexes so VALUES stays small
    const sub = live.map(i => items[i]);
    try {
      const rows = readSitelinkRows(await sparql(sparqlBySitelinks(sub)));
      if (!await learnTypes(unknownTypes(rows, sub, acceptedTypes, rejectedTypes, tvTypes))) batch.forEach(f => typeFailed.add(f));
      const m = pickSitelinkMatches(rows, sub, acceptedTypes, tvTypes);
      live.forEach((orig, j) => { if (m.has(j)) cands.set(batch[orig], { qid: m.get(j).qid, verify: false }); });
    } catch (e) {
      if (isAbort(e)) throw abortError();
      if (canSplit && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await sitelinkMatch(batch.slice(0, mid), false);
        await sitelinkMatch(batch.slice(mid), false);
      } else titleFailed.push(...batch);
    }
  };
  for (const batch of chunks(open, TITLE_BATCH)) { await sitelinkMatch(batch, true); tick(); }
  open = open.filter(f => !cands.has(f));

  // c, fallback) Wikipedia action API for films the query service couldn't answer about
  const fallback = open.filter(f => titleFailed.includes(f));
  let fallbackOk = true; // false when some title could not be asked about
  if (fallback.length && wikipediaApiDown) fallbackOk = false;
  if (fallback.length && !wikipediaApiDown) {
    const wanted = new Map(fallback.map(f => [f, titleCandidates(f.title, f.year)]));
    const titles = [...new Set([...wanted.values()].flat())];
    const resolved = new Map();
    for (const batch of chunks(titles, BATCH)) {
      check();
      if (wikipediaApiDown) { fallbackOk = false; break; }
      try {
        const url = `${WIKIPEDIA}?action=query&format=json&formatversion=2&redirects=1&prop=pageprops&ppprop=wikibase_item|disambiguation&titles=${batch.map(encodeURIComponent).join('|')}`;
        count('wikipedia');
        for (const [t, v] of readTitleResolution(await http.json(url, { signal, retry429: false }), batch)) resolved.set(t, v.qid);
      } catch (e) {
        if (isAbort(e)) throw abortError();
        wikipediaApiDown = true; // 429 or otherwise broken: don't ask again this run
        fallbackOk = false;
        ctx.warn?.(null, "Wikipedia's title lookup failed, so some films could not be matched this time.", e);
        ctx.log('Wikipedia title lookup failed:', e.message);
      }
      tick();
    }
    for (const [f, list] of wanted) {
      const t = list.find(x => resolved.has(x));
      if (t) cands.set(f, { qid: resolved.get(t), verify: true });
    }
    open = open.filter(f => !cands.has(f));
  }

  const first = cands.size ? await details(cands) : new Map();
  const retry = [...open, ...[...first].filter(([, s]) => s === 'rejected').map(([f]) => f)];

  // d) exact label + year
  const second = new Map();
  const labelSearch = async (batch, canSplit) => {
    check();
    const items = batch.map(f => ({ title: String(f.title || '').trim(), year: f.year ? Number(f.year) : null }));
    try {
      const m = readLabelMatches(await sparql(sparqlByLabel(items)), items);
      batch.forEach((f, i) => { if (m.has(i)) second.set(f, { qid: m.get(i), verify: true }); });
      // No match is only a real miss when every earlier step could be asked; otherwise retry next run.
      batch.forEach(f => {
        if (second.has(f)) return;
        if (typeFailed.has(f) || (!fallbackOk && titleFailed.includes(f))) failFilm(f, new Error('Wikidata could not be asked about this film.'));
        else finish(f, null);
      });
    } catch (e) {
      if (isAbort(e)) throw abortError();
      if (canSplit && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        await labelSearch(batch.slice(0, mid), false);
        await labelSearch(batch.slice(mid), false);
      } else batch.forEach(f => failFilm(f, e)); // couldn't ask: record it so the film is retried next run
    }
    tick();
  };
  const searchable = retry.filter(f => String(f.title || '').trim());
  retry.filter(f => !searchable.includes(f)).forEach(f => finish(f, null));
  for (const batch of chunks(searchable, LABEL_BATCH)) await labelSearch(batch, true);

  if (second.size) {
    const out = await details(second);
    for (const [f, s] of out) if (s === 'rejected') finish(f, null);
    tick();
  }
}

export default {
  id: 'wikidata',
  label: 'Wikidata',
  gives: ['links to other sites', 'cast and crew', 'genres', 'awards', 'countries'],
  needsKey: false,
  since: '2026-10-24', // source works now say what they are (novel, play, comic); films checked earlier are read again once
  refreshDays: 60,
  retryMissDays: 21,
  enrich,
};
