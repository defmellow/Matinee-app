// The Test fetch report as plain text the user can copy, save, or paste into a bug report. No keys, no cookie values, no query strings.
import { stripSecrets } from './redact.js';

const pad = (s, n) => { s = String(s ?? ''); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const padL = (s, n) => String(s ?? '').padStart(n);
const secs = ms => (ms == null ? '-' : (ms / 1000).toFixed(1) + 's');
const ms = v => (v == null ? '-' : v + 'ms');
const kb = b => (b == null ? '-' : b >= 1048576 ? (b / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB');
const list = a => (a && a.length ? a.join(', ') : '-');
const obj = o => Object.entries(o || {}).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
const MAX_REQUEST_LINES = 150;

export function formatReport(report) {
  const r = report || {};
  const L = [];
  const h = t => { L.push('', `== ${t} ==`); };
  L.push('Matinee test fetch report');
  L.push(`Started ${r.startedAt || '-'} (UTC). Took ${secs(r.elapsedMs)}.${r.aborted ? ' STOPPED EARLY.' : ''}`);
  L.push(`Films ${r.films?.length ?? 0}, requests ${r.requests?.length ?? 0}, request lane ${r.options?.lane ?? '-'}, page window ${r.options?.hasWindow ? 'available' : 'not available'}, check pages ${r.options?.showChecks ? 'may be shown' : 'skipped'}.`);
  const keys = r.options?.keysPresent || {};
  L.push(`Keys: ${Object.keys(keys).length ? Object.entries(keys).map(([k, v]) => `${k} ${v ? 'present' : 'missing'}`).join(', ') : 'none set'} (values are never included).`);

  h('Films');
  for (const f of r.films || []) L.push(`${pad(f.ref, 4)} ${pad(f.title + (f.year ? ` (${f.year})` : ''), 46)} ${pad(f.role, 10)} ${pad(f.status, 10)} ids known: ${Object.entries(f.idsKnown || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);

  h('Sources');
  L.push(`${pad('source', 16)} ${pad('state', 8)} ${padL('ok', 3)} ${padL('none', 4)} ${padL('fail', 4)} ${padL('skip', 4)} ${padL('reqs', 5)} ${padL('time', 7)} ${padL('per film', 9)}  notes`);
  for (const p of r.providers || []) {
    const note = p.state === 'ran' ? list(p.problems) === '-' ? '' : p.problems.join(' | ') : p.reason;
    L.push(`${pad(p.id, 16)} ${pad(p.state, 8)} ${padL(p.filmsOk, 3)} ${padL(p.filmsNothing, 4)} ${padL(p.filmsFailed, 4)} ${padL(p.filmsNotNeeded, 4)} ${padL(p.requests, 5)} ${padL(secs(p.elapsedMs), 7)} ${padL(ms(p.msPerFilm), 9)}  ${note}`);
  }
  const fails = (r.providers || []).flatMap(p => p.perFilm.filter(x => x.outcome === 'failed').map(x => `${p.id} on ${x.film}: ${x.error?.status ? 'HTTP ' + x.error.status + ' ' : ''}${x.error?.code || ''} ${x.error?.message || ''}`.trim()));
  if (fails.length) { L.push('Failures:'); for (const f of fails) L.push('  ' + f); }

  h('Hosts');
  L.push(`${pad('host', 26)} ${padL('reqs', 5)} ${padL('ok', 4)} ${padL('blocked', 8)} ${padL('errors', 7)} ${padL('held', 5)} ${padL('avg', 8)} ${padL('avg gap', 8)} ${padL('size', 7)}  statuses`);
  for (const x of r.hosts || []) L.push(`${pad(x.host, 26)} ${padL(x.requests, 5)} ${padL(x.ok, 4)} ${padL(x.blocked, 8)} ${padL(x.errors, 7)} ${padL(x.heldBack, 5)} ${padL(ms(x.avgMs), 8)} ${padL(ms(x.avgGapMs), 8)} ${padL(kb(x.bytes), 7)}  ${obj(x.statuses)}`);
  const bad = [...(r.hostStatus?.start || []).map(x => ({ ...x, when: 'start' })), ...(r.hostStatus?.end || []).map(x => ({ ...x, when: 'end' }))].filter(x => x.state !== 'ok' || x.blocks);
  L.push(bad.length ? 'Site status (not fully ok):' : 'Site status: every site ok at the start and at the end.');
  for (const x of bad) L.push(`  ${x.when}: ${x.host} ${x.state}${x.reason ? ' (' + x.reason + ')' : ''}${x.untilInMs ? ', ' + secs(x.untilInMs) + ' left' : ''}, recent blocks ${x.blocks}`);
  if (r.hostEvents?.length) { L.push('Notices from the network layer:'); for (const e of r.hostEvents.slice(0, 40)) L.push(`  +${secs(e.atMs)} ${e.host} ${e.kind} ${e.text}`); }

  h('Plain request or page window?');
  if (!(r.plainVsWindow || []).length) L.push('No page sources were read.');
  for (const x of r.plainVsWindow || []) {
    L.push(`${x.provider}: plain ${x.plain.usable}/${x.plain.tried} usable${x.plain.checkedForContent ? ' (page parsed)' : ' (status only)'}, blocked ${x.plain.blocked}, avg ${ms(x.plain.avgMs)}, statuses ${obj(x.plain.statuses)}`);
    L.push(`${' '.repeat(x.provider.length)}  window ${x.window.ok}/${x.window.tried} ok, blocked ${x.window.blocked}, avg ${ms(x.window.avgMs)}, statuses ${obj(x.window.statuses)}`);
  }
  for (const p of r.plainChecks || []) L.push(`  check ${p.provider}/${p.step} ${p.film}: ${p.verdict}, HTTP ${p.status ?? '-'}, ${ms(p.ms)}, ${kb(p.bytes)}${p.challenge ? ', check page' : ''}${p.headers?.cfMitigated ? ', cf-mitigated ' + p.headers.cfMitigated : ''}${p.headers?.cfRay ? ', cf-ray' : ''}${p.error ? ', ' + p.error.message : ''}`);

  h('Cookies (names only)');
  if (!r.cookies) L.push('Not checked.');
  else for (const [d, v] of Object.entries(r.cookies)) {
    for (const [when, label] of [['start', 'before'], ['afterPlainRequests', 'after plain requests'], ['end', 'at the end']]) {
      if (v[when] == null) continue;
      L.push(`${d} ${label}: ${v[when].length ? v[when].map(c => c.name + (c.session ? ' (session)' : '')).join(', ') : 'none'}${v[when + 'Error'] ? ' [' + v[when + 'Error'] + ']' : ''}`);
    }
  }

  h('Which source supplied what');
  const fields = r.coverage?.fields || [];
  const rows = r.coverage?.rows || [];
  for (const fld of fields) {
    const cells = rows.map(row => `${row.film}: ${list(row.fields[fld])}`);
    L.push(`${pad(fld, 16)} ${cells.join(' | ')}`);
  }
  L.push('', 'Backups per field (films each source covered; quickest first):');
  for (const fld of fields) {
    const red = r.redundancy?.[fld];
    const srcs = Object.entries(red?.sources || {});
    L.push(`  ${pad(fld, 16)} ${srcs.length ? srcs.map(([id, n]) => `${id} ${n}`).join(', ') : 'nobody'}${red?.fastest ? `  (quickest: ${red.fastest})` : ''}`);
  }

  h('How much each source changes the feel results');
  const fi = r.feelImpact;
  if (!fi) L.push('Not worked out.');
  else if (fi.error) L.push('Failed: ' + fi.error);
  else {
    L.push(`Library ${fi.library} films, ${fi.films} tested, nearest ${fi.limit} compared, worked out in ${secs(fi.ms)}${fi.stopped ? ' (stopped early)' : ''}. Each row removes one source from the films that have it.`);
    L.push(`${pad('source', 40)} ${padL('films', 5)} ${padL('profile', 8)} ${padL('overlap', 8)} ${padL('thin', 5)}  verdict`);
    for (const g of fi.groups) L.push(`${pad(g.label, 40)} ${padL(g.films, 5)} ${padL(g.profileSimilarity ?? '-', 8)} ${padL(g.neighbourOverlap ?? '-', 8)} ${padL(g.becameThin, 5)}  ${g.verdict}${g.slow ? ' (slow source)' : ''}`);
  }

  h('Every request');
  const reqs = r.requests || [];
  for (const q of reqs.slice(0, MAX_REQUEST_LINES)) {
    const extra = [q.challenge ? 'CHECK PAGE' : '', q.headers?.cfMitigated ? 'cf-mitigated ' + q.headers.cfMitigated : '', q.headers?.retryAfter ? 'retry-after ' + q.headers.retryAfter : '', q.headers?.cfRay ? 'cf-ray' : '', q.headers?.server || '', q.error ? `${q.error.held ? 'held back (site paused)' : q.error.code} ${q.error.held ? '' : q.error.message}`.trim() : ''].filter(Boolean).join(', ');
    L.push(`#${pad(q.n, 3)} +${padL(secs(q.atMs), 6)} ${pad(q.provider + (q.role === 'probe' ? '*' : ''), 11)} ${pad(q.method, 14)} ${pad(q.host + q.path, 52)} ${padL(q.status ?? '-', 3)} ${padL(ms(q.ms), 8)} ${padL(kb(q.bytes), 6)} ${q.film || ''} ${extra}`.trimEnd());
  }
  if (reqs.length > MAX_REQUEST_LINES) L.push(`... ${reqs.length - MAX_REQUEST_LINES} more not shown`);
  L.push('(* = the extra plain-request check. page-plain = the page call was served by a plain request because no page window is available. Times include pacing waits and retries.)');

  if (r.logs?.length) { h('Messages from sources'); for (const l of r.logs.slice(0, 30)) L.push(`${l.provider}: ${l.message}`); }
  if (r.notes?.length) { h('Notes'); for (const n of r.notes) L.push('- ' + n); }
  // Last line of defence: no web address keeps its query, and key-looking parameters are blanked.
  return L.map(line => stripSecrets(line)).join('\n');
}
