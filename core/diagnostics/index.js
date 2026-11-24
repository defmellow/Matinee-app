// Settings → Test fetch. Runs every source over a handful of films, on in-memory copies, and writes down what really
// happened (status codes, timings, sizes, which fields came back, whether a plain request works where the page window
// does) so troubleshooting can see real behaviour on a real computer. The library is only ever read: copies are fetched, nothing is saved.
// core/ never imports Electron; the cookie check, the http object and the clock all come in through the options.
import { enrich } from '../enrich.js';
import { NO_PROBLEMS } from '../problems.js';
import { allProviders } from '../providers/all.js';
import { pickResult } from '../providers/allmovie.js';
import { parseImdbKeywords } from '../parse/imdbpage.js';
import { parseAllMovie, parseAllMovieSearch } from '../parse/allmovie.js';
import { parseLetterboxdFilm } from '../parse/lbpage.js';
import { collectSecrets, cookieNames, scrubDeep, scrubText, splitUrl } from './redact.js';
import { createRecorder, looksLikeCheckPage, notableHeaders } from './recorder.js';
import { freshClone, pickFilms } from './select.js';
import { feelSourceImpact } from './feel-impact.js';

export { feelSourceImpact } from './feel-impact.js';
export { formatReport } from './format.js';

const ID_STAGE = ['boxd', 'wikidata', 'tmdb'];
// Providers that read one film at a time, so a request can be matched to the film that was being read.
const SERIAL = new Set(['rt', 'metacritic', 'mcreviews', 'lbpage', 'imdbpage', 'allmovie']);
const PAGE_PROVIDERS = ['lbpage', 'imdbpage', 'allmovie'];
const COOKIE_DOMAINS = ['letterboxd.com', 'imdb.com', 'allmovie.com'];

/** What counts as "has this field", per field, on one provider's stored data. */
export const FIELD_TESTS = {
  poster: d => !!d.poster,
  synopsis: d => !!d.synopsis,
  runtime: d => Number(d.runtime) > 0,
  released: d => !!d.released,
  cast: d => d.people?.cast?.length > 0,
  director: d => d.people?.director?.length > 0,
  genres: d => d.genres?.length > 0,
  ratings: d => !!d.ratings && Object.keys(d.ratings).length > 0,
  keywords: d => d.keywords?.length > 0,
  reviews: d => d.reviews?.length > 0 || d.users?.length > 0 || d.critics?.length > 0,
  'feel text': d => !!(d.moods?.length || d.tone?.length || d.themes?.length || d.miniThemes?.length || d.categories?.length || d.consensus || d.sections),
  'australian date': d => !!d.ausRelease,
};
export const FIELDS = Object.keys(FIELD_TESTS);

const nonEmpty = v => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const dataKeys = d => Object.keys(d || {}).filter(k => nonEmpty(d[k]));
const fieldsOf = d => (d ? FIELDS.filter(f => { try { return !!FIELD_TESTS[f](d); } catch { return false; /* a field test on odd data just means the field isn't there: expected */ } }) : []);
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const rnd = x => (x == null ? null : Math.round(x));

/** Per-host figures from the recorded requests. The gap is the average time between one answer and the next on that host. */
export function hostTable(requests) {
  const hosts = new Map();
  for (const r of requests) {
    if (!r.host) continue;
    if (!hosts.has(r.host)) hosts.set(r.host, []);
    hosts.get(r.host).push(r);
  }
  return [...hosts].map(([host, rs]) => {
    const ends = rs.map(r => r.atMs + r.ms).sort((a, b) => a - b);
    const gaps = ends.slice(1).map((e, i) => e - ends[i]);
    const statuses = {};
    for (const r of rs) { const k = r.status ?? (r.error?.code || 'none'); statuses[k] = (statuses[k] || 0) + 1; }
    return {
      host, requests: rs.length,
      ok: rs.filter(r => r.status >= 200 && r.status < 300 && !r.challenge).length,
      blocked: rs.filter(r => r.status === 403 || r.status === 429 || r.challenge).length,
      errors: rs.filter(r => r.error && !r.error.held).length, heldBack: rs.filter(r => r.error?.held).length,
      avgMs: rnd(mean(rs.map(r => r.ms))), avgGapMs: rnd(mean(gaps)),
      bytes: rs.reduce((s, r) => s + (r.bytes || 0), 0), statuses,
    };
  }).sort((a, b) => b.requests - a.requests);
}

/** For each page-reading source: how plain requests did next to the page window. */
export function plainVsWindow(requests, probes) {
  const out = [];
  for (const id of new Set([...PAGE_PROVIDERS, ...requests.filter(r => r.method === 'window').map(r => r.provider)])) {
    const plainProbes = probes.filter(p => p.provider === id && p.step !== 'search');
    const plainReqs = requests.filter(r => r.provider === id && r.role === 'provider' && r.method !== 'window');
    const winReqs = requests.filter(r => r.provider === id && r.role === 'provider' && r.method === 'window');
    if (!plainProbes.length && !plainReqs.length && !winReqs.length) continue;
    const statuses = list => { const s = {}; for (const r of list) { const k = r.status ?? 'none'; s[k] = (s[k] || 0) + 1; } return s; };
    const plainTried = plainProbes.length + plainReqs.length;
    const plainUsable = plainProbes.filter(p => p.verdict === 'usable').length + plainReqs.filter(r => r.status >= 200 && r.status < 300 && !r.challenge).length;
    const plainBlocked = plainProbes.filter(p => p.verdict === 'blocked').length + plainReqs.filter(r => r.status === 403 || r.status === 429 || r.challenge).length;
    const winOk = winReqs.filter(r => r.status >= 200 && r.status < 300 && !r.challenge).length;
    const winBlocked = winReqs.filter(r => r.status === 403 || r.status === 429 || r.challenge).length;
    out.push({
      provider: id,
      plain: { tried: plainTried, usable: plainUsable, blocked: plainBlocked, statuses: statuses([...plainProbes, ...plainReqs]), avgMs: rnd(mean([...plainProbes, ...plainReqs].map(r => r.ms))), checkedForContent: plainProbes.length > 0 },
      window: { tried: winReqs.length, ok: winOk, blocked: winBlocked, statuses: statuses(winReqs), avgMs: rnd(mean(winReqs.map(r => r.ms))) },
    });
  }
  return out;
}

/** Fields by film, which sources supplied each field, and which of those was quickest per film. */
export function coverageTable(rows, providerStats) {
  const speed = id => providerStats.find(p => p.id === id)?.msPerFilm ?? Infinity;
  const redundancy = {};
  for (const f of FIELDS) {
    const sources = {};
    for (const row of rows) for (const id of row.fields[f] || []) sources[id] = (sources[id] || 0) + 1;
    const ids = Object.keys(sources);
    redundancy[f] = { sources, fastest: ids.length ? ids.sort((a, b) => speed(a) - speed(b))[0] : null };
  }
  return { fields: FIELDS, rows, redundancy };
}

const fail = (e, secrets) => ({ code: e?.code || e?.name || 'error', status: e?.status ?? null, message: scrubText(e?.message || '', secrets, 160) });

/**
 * @param {object} o
 * @param {{ films: object, library?: object }} o.store  the real library: read only, never saved (touch and flush are not called)
 * @param {object[]} [o.providers]  default: every provider
 * @param {object} o.http  from createHttp (the app's own, so pacing and breakers are shared with real fetching)
 * @param {object} [o.settings]  library settings (keys live here); default store.library.settings. Never copied into the report.
 * @param {Array<string|object>|null} [o.films]  film keys or records to use instead of the default mix
 * @param {number} [o.count]  films to test (8)
 * @param {AbortSignal} [o.signal]
 * @param {(step: object) => void} [o.onStep]  { phase, provider?, film?, state, ... } as work goes
 * @param {() => number} [o.now]
 * @param {(domain: string) => Promise<Array<{name,domain,secure,session}>>} [o.cookieProbe]  from the browser session; only names are kept
 * @param {number} [o.lane]  request priority (0 = the lane for a film the user has opened)
 * @param {boolean} [o.hasWindow]  true when http.page opens a real page window (Electron), false when it falls back to a plain request
 * @param {number} [o.probes]  films per page source for the plain-request check (3; 0 turns it off)
 * @param {boolean} [o.includeBulk]  also run bulk-download sources (IMDb ratings file, about 9 MB). Off by default.
 * @param {boolean} [o.freshIds]  forget stored ids too, so the id stage is tested as well
 * @param {boolean} [o.showChecks]  DECISION: true = like opening a film, a "verify you're human" page may show the window to the user. false = give up on it at once.
 * @param {boolean} [o.feel]  also work out how much each source changes the feel results (a few seconds)
 */
export async function runTestFetch({ store, providers = allProviders(), http, settings, films = null, count = 24, signal, onStep = () => {}, now = Date.now,
  cookieProbe = null, lane = 0, hasWindow = true, probes = 3, includeBulk = false, freshIds = false, showChecks = true, feel = true, problems = NO_PROBLEMS } = {}) {
  const slip = (message, error) => { if (error?.code !== 'aborted') problems.report({ area: 'Test fetch', message, error, level: 'warning' }); }; // the report keeps it too
  const t0 = now();
  const runSettings = structuredClone(settings ?? store.library?.settings ?? {});
  const secrets = collectSecrets(runSettings);
  const step = s => { try { onStep({ ...s, atMs: now() - t0 }); } catch (e) { slip('Something showing the test fetch progress failed. The test carried on.', e); } };
  const aborted = () => !!(signal && signal.aborted);
  const rec = createRecorder({ now, secrets, t0 });
  const notes = [
    'Times include the polite pause between requests to the same site and any automatic retries, so they are longer than one bare request.',
    'Nothing here was saved: films were fetched into copies and the library was not changed.',
  ];

  // ---- the films, as copies that look never fetched ----
  let picked;
  if (Array.isArray(films) && films.length) {
    picked = films.map(f => (typeof f === 'string' ? store.films[f] : f)).filter(Boolean).map(film => ({ film, role: 'chosen' }));
  } else picked = pickFilms(store, { count, now: t0 });
  const clones = picked.map(p => freshClone(p.film, { freshIds }));
  const refs = clones.map((c, i) => `F${i + 1}`);
  const refOfKey = new Map(clones.map((c, i) => [c.key, refs[i]]));
  const user = store.library?.films || {};
  const filmRows = clones.map((c, i) => ({
    ref: refs[i], title: c.title, year: c.year ?? null, role: picked[i].role,
    status: user[c.key]?.watched ? 'watched' : user[c.key]?.watchlist ? 'watchlist' : 'neither',
    idsKnown: { letterboxd: !!(c.slug || c.ids?.letterboxd || c.lid), imdb: !!c.ids?.imdb, wikipedia: !!c.ids?.enwiki, metacritic: !!c.ids?.metacritic },
  }));
  const refsByTitle = new Map();
  clones.forEach((c, i) => { if (!refsByTitle.has(c.title)) refsByTitle.set(c.title, []); refsByTitle.get(c.title).push(refs[i]); });

  // A throwaway store for enrich(): plain objects, no files, touch and flush do nothing.
  const scratch = {
    dir: null,
    library: { settings: runSettings, films: {}, entries: {}, lists: {}, tags: {}, views: {}, sync: {} },
    films: Object.fromEntries(clones.map(c => [c.key, c])),
    cache: {},
    cached: () => undefined,
    setCached(name, value) { this.cache[name] = { at: new Date(now()).toISOString(), value }; return value; },
    touch() {}, flush() {},
  };
  const keys = clones.map(c => c.key);

  // ---- notices from the network layer (waits, pauses, breakers) ----
  const hostEvents = [];
  const stopObserving = typeof http.observe === 'function' ? http.observe(n => {
    if (hostEvents.length < 100) hostEvents.push({ atMs: now() - t0, host: n.host, kind: n.kind, text: scrubText(n.text || '', secrets, 160) });
  }) : null;
  const hostStatusAt = () => { try { return (http.hostStatus ? http.hostStatus() : []).map(h => ({ host: h.host, state: h.state, reason: h.reason || '', untilInMs: h.until ? Math.max(0, h.until - now()) : 0, blocks: h.blocks || 0 })); } catch (e) { slip("The test fetch couldn't read the sites' status.", e); return []; } };
  const hostStatus = { start: hostStatusAt(), end: [] };

  // ---- cookie names before and after ----
  const cookies = cookieProbe ? Object.fromEntries(COOKIE_DOMAINS.map(d => [d, {}])) : null;
  const cookiesAt = async label => {
    if (!cookieProbe) return;
    for (const d of COOKIE_DOMAINS) {
      try { cookies[d][label] = cookieNames(await cookieProbe(d)); } catch (e) { slip(`The cookie check for ${d} failed.`, e); cookies[d][label] = []; cookies[d][label + 'Error'] = scrubText(e?.message || 'failed', secrets, 120); }
    }
  };

  // ---- providers ----
  const provRows = [];            // one per provider, in run order
  const perFilm = new Map();      // providerId -> Map(ref -> { outcome, ms, error })
  const active = [];
  for (const p of providers) {
    const row = { id: p.id, label: p.label, state: 'ran', reason: '', filmsOk: 0, filmsNothing: 0, filmsFailed: 0, filmsNotNeeded: 0, elapsedMs: 0, msPerFilm: null, requests: 0, problems: [], perFilm: [] };
    provRows.push(row);
    if (p.enabled && !p.enabled(runSettings)) { row.state = 'skipped'; row.reason = p.needsKey ? 'no key' : 'switched off'; continue; }
    if (p.bulk && !includeBulk) { row.state = 'skipped'; row.reason = 'bulk download (a whole data file), left out of the test'; continue; }
    active.push(p);
  }
  const rowOf = id => provRows.find(r => r.id === id);
  const logs = [];

  async function runOne(p) {
    const row = rowOf(p.id);
    const results = new Map();
    perFilm.set(p.id, results);
    const started = now();
    let lastMark = started;
    let unclaimed = rec.requests.length; // requests recorded since the last film mark (only used for one-film-at-a-time sources)
    const tagged = rec.wrap(http, { provider: p.id, lane, hasWindow, page: showChecks ? undefined : { failOnChallenge: true } });
    const claim = ref => {
      if (!SERIAL.has(p.id)) return;
      for (let i = unclaimed; i < rec.requests.length; i++) if (rec.requests[i].provider === p.id && !rec.requests[i].film) rec.requests[i].film = ref;
      unclaimed = rec.requests.length;
    };
    const refFor = title => {
      const list = refsByTitle.get(title) || [];
      return list.find(r => !results.has(r)) || list[0] || null;
    };
    const mark = (title, outcome, error) => {
      const ref = refFor(title);
      if (!ref) return;
      const t = now();
      results.set(ref, { outcome, ms: SERIAL.has(p.id) ? t - lastMark : null, error: error ? fail(error, secrets) : null });
      lastMark = t;
      claim(ref);
      step({ phase: 'providers', provider: p.id, film: title, ref, state: outcome === 'failed' ? 'failed' : 'done' });
    };
    const trouble = { ok: (pr, title) => mark(title, 'seen'), fail: (pr, title, error) => mark(title, 'failed', error) };
    step({ phase: 'providers', provider: p.id, film: null, state: 'start' });
    try {
      const res = await enrich({ store: scratch, providers: [p], http: tagged, only: keys, keepOrder: true, lane, ignoreBackoff: true, inflight: new Map(), signal, trouble,
        emit: (event, payload) => { if (event === 'log' && logs.length < 60) logs.push({ provider: p.id, message: scrubText(payload.message, secrets, 200) }); } });
      row.problems = res.problems.slice(0, 5).map(x => scrubText(x.message, secrets, 160));
    } catch (e) { slip(`The test fetch of ${p.label} stopped unexpectedly.`, e); row.problems.push(scrubText(e?.message || 'stopped', secrets, 160)); }
    row.elapsedMs = now() - started;
    // Work out each film's outcome from what the provider left on the copy.
    clones.forEach((c, i) => {
      const ref = refs[i], r = results.get(ref);
      let outcome, error = null, ms = r?.ms ?? null;
      if (r?.outcome === 'failed') { outcome = 'failed'; error = r.error; }
      else if (c.failed?.[p.id]) { outcome = 'failed'; error = { code: 'error', status: null, message: 'failed (no detail)' }; } // enrich recorded it on the copy even if the trouble hook was not called
      else if (c.src?.[p.id]) outcome = 'ok';
      else if (c.missed?.[p.id]) outcome = 'nothing';
      else if (r) outcome = 'nothing';
      else outcome = 'not-needed';
      const data = c.src?.[p.id];
      row.perFilm.push({ film: ref, outcome, ms, ...(error ? { error } : {}), keys: dataKeys(data), fields: fieldsOf(data) });
      if (outcome === 'ok') row.filmsOk++; else if (outcome === 'nothing') row.filmsNothing++; else if (outcome === 'failed') row.filmsFailed++; else row.filmsNotNeeded++;
    });
    const worked = row.filmsOk + row.filmsNothing + row.filmsFailed;
    row.msPerFilm = worked ? Math.round(row.elapsedMs / worked) : null;
    if (aborted()) row.state = 'stopped';
    step({ phase: 'providers', provider: p.id, film: null, state: 'finished' });
  }

  // ---- plain request check for the page sources that only ever use the window ----
  const probeResults = [];
  async function runProbes() {
    if (!probes || typeof http.browserText !== 'function') { if (probes) notes.push('The plain-request check was skipped: this http object has no plain browser-style request.'); return; }
    const probeWrap = id => rec.wrap(http, { provider: id, role: 'probe', lane, hasWindow });
    const verdictOf = (res, parsed) => {
      if (res.status === 404 || res.status === 410) return 'missing';
      if (res.status === 403 || res.status === 429 || res.status === 202 || looksLikeCheckPage(res.text, res.headers, res.challenge)) return 'blocked';
      return res.status >= 200 && res.status < 300 && parsed ? 'usable' : 'unreadable';
    };
    const one = async (id, ref, stepName, url, parse, tagged) => {
      const started = now();
      let res;
      try { res = await tagged.browserText(url, { signal, priority: lane }); } catch (e) {
        if (e?.code === 'aborted') throw e;
        const r = { provider: id, film: ref, step: stepName, host: splitUrl(url).host, path: splitUrl(url).path, status: e?.status ?? null, ms: now() - started, bytes: null, challenge: false,
          verdict: e?.status === 429 || e?.status === 403 ? 'blocked' : 'error', usable: false, error: fail(e, secrets) };
        probeResults.push(r); return r;
      }
      let parsed = false;
      try { parsed = !!parse(res.text); } catch (e) { slip(`The ${id} reader failed on a page it was given during the test fetch.`, e); parsed = false; }
      const verdict = verdictOf(res, parsed);
      const r = { provider: id, film: ref, step: stepName, host: splitUrl(url).host, path: splitUrl(url).path, status: res.status, ms: now() - started, bytes: Buffer.byteLength(res.text || ''),
        challenge: looksLikeCheckPage(res.text, res.headers, res.challenge), headers: notableHeaders(res.headers), verdict, usable: verdict === 'usable', text: res.text };
      probeResults.push(r);
      return r;
    };
    try {
      // Letterboxd first, so the cookie check after the plain requests really follows a plain Letterboxd GET.
      if (providers.some(p => p.id === 'lbpage')) {
        const tagged = probeWrap('lbpage');
        const list = clones.map((c, i) => [c, refs[i], String(c.slug || c.ids?.letterboxd || '').replace(/^\/+|\/+$/g, '')]).filter(([, , slug]) => slug).slice(0, Math.min(probes, 2));
        for (const [c, ref, slug] of list) {
          if (aborted()) return;
          step({ phase: 'plain-check', provider: 'lbpage', film: c.title, ref, state: 'start' });
          const r = await one('lbpage', ref, 'film page', `https://letterboxd.com/film/${encodeURIComponent(slug)}/`, t => !!parseLetterboxdFilm(t), tagged);
          if (r.verdict === 'blocked') { notes.push('Plain-request check for Letterboxd stopped after the first refusal.'); break; }
        }
      }
      if (providers.some(p => p.id === 'imdbpage')) {
        const tagged = probeWrap('imdbpage');
        const list = clones.map((c, i) => [c, refs[i]]).filter(([c]) => /^tt\d+$/.test(String(c.ids?.imdb || ''))).slice(0, probes);
        for (const [c, ref] of list) {
          if (aborted()) return;
          step({ phase: 'plain-check', provider: 'imdbpage', film: c.title, ref, state: 'start' });
          const r = await one('imdbpage', ref, 'keywords', `https://www.imdb.com/title/${c.ids.imdb}/keywords/`, t => parseImdbKeywords(t).length > 0 || /__NEXT_DATA__/.test(t || ''), tagged);
          if (r.verdict === 'blocked') { notes.push('Plain-request check for IMDb stopped after the first refusal.'); break; }
        }
      }
      if (providers.some(p => p.id === 'allmovie')) {
        const tagged = probeWrap('allmovie');
        const list = clones.map((c, i) => [c, refs[i]]).filter(([c]) => c.title && c.year).slice(0, probes);
        for (const [c, ref] of list) {
          if (aborted()) return;
          step({ phase: 'plain-check', provider: 'allmovie', film: c.title, ref, state: 'start' });
          let hit = null;
          const s = await one('allmovie', ref, 'search', `https://www.allmovie.com/search/movies/${encodeURIComponent(c.title)}`, t => { const r = parseAllMovieSearch(t); hit = pickResult(r, c); return r.length > 0; }, tagged);
          if (s.verdict === 'blocked') { notes.push('Plain-request check for AllMovie stopped after the first refusal.'); break; }
          if (s.verdict === 'usable' && hit) {
            const f = await one('allmovie', ref, 'film', `https://www.allmovie.com/movie/${hit.slug}`, t => !!parseAllMovie(t), tagged);
            if (f.verdict === 'blocked') { notes.push('Plain-request check for AllMovie stopped after the first refusal.'); break; }
          }
        }
      }
    } catch (e) { slip('The plain-request check in the test fetch stopped early.', e); if (e?.code !== 'aborted') notes.push('The plain-request check stopped early: ' + scrubText(e?.message || '', secrets, 120)); }
  }

  // ---- go ----
  await cookiesAt('start');
  const stageA = ID_STAGE.map(id => active.find(p => p.id === id)).filter(Boolean);
  const stageB = active.filter(p => !ID_STAGE.includes(p.id));
  try {
    for (const p of stageA) { if (aborted()) break; await runOne(p); }
    if (!aborted()) { step({ phase: 'plain-check', state: 'start' }); await runProbes(); }
    await cookiesAt('afterPlainRequests');
    if (!aborted()) await Promise.all(stageB.map(runOne));
    await cookiesAt('end');
  } finally { if (stopObserving) stopObserving(); }
  hostStatus.end = hostStatusAt();

  for (const row of provRows) row.requests = rec.requests.filter(r => r.provider === row.id && r.role === 'provider').length;
  const probeOut = probeResults.map(({ text, ...rest }) => rest);
  const coverage = coverageTable(clones.map((c, i) => ({
    film: refs[i],
    fields: Object.fromEntries(FIELDS.map(f => [f, provRows.filter(r => r.perFilm.find(x => x.film === refs[i])?.fields.includes(f)).map(r => r.id)])),
  })), provRows);

  let feelImpact = null;
  if (feel && !aborted() && clones.some(c => c.src && Object.keys(c.src).length)) {
    step({ phase: 'feel', state: 'start' });
    try { feelImpact = await feelSourceImpact({ films: clones, store, signal }); } catch (e) { slip('The feel-impact part of the test fetch failed.', e); feelImpact = { error: scrubText(e?.message || 'failed', secrets, 160) }; }
  }
  if (rec.droppedCount()) notes.push(`${rec.droppedCount()} more requests happened than are listed (only the first ${rec.requests.length} are kept).`);

  const report = {
    version: 1,
    startedAt: new Date(t0).toISOString(),
    elapsedMs: now() - t0,
    aborted: aborted(),
    options: { count: clones.length, lane, hasWindow, probes, includeBulk, freshIds, showChecks, cookieCheck: !!cookieProbe, keysPresent: Object.fromEntries(Object.entries(runSettings.keys || {}).map(([k, v]) => [k, !!v])) },
    films: filmRows,
    providers: provRows,
    requests: [...rec.requests].sort((a, b) => a.n - b.n),
    hosts: hostTable(rec.requests),
    hostStatus,
    hostEvents,
    cookies,
    plainChecks: probeOut,
    plainVsWindow: plainVsWindow(rec.requests, probeOut),
    coverage,
    redundancy: coverage.redundancy,
    feelImpact,
    logs,
    notes,
  };
  step({ phase: 'done', state: 'finished' });
  return scrubDeep(report, secrets);
}
