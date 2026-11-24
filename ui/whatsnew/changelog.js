// Pure helpers for the "What's new" popup: read the bundled changelog and pick the versions the user hasn't seen.
// Heading format (both changelogs):  ## v0.15 — 8 Nov 2026   or   ## v0.15 — 8 Nov 2026 (hotfix)
// Experimental builds:               ## v0.15-exp.3 — 8 Nov 2026   (also read: "v0.15 exp 3", "v0.15 exp.3")
// A heading without a version ("Next build (v0.15)") is not a release and is ignored.

const HEAD = /^##\s+v(\d+(?:\.\d+)*)(?:\s*-?\s*exp\.?\s*(\d+))?(?:\s+[—–-]+\s*(.*?))?\s*$/i;

/** "v0.15" -> "0.15.0", "0.15.0-exp.3" stays. Returns '' when it isn't a version. */
export function normalizeVersion(v) {
  const m = /^v?(\d+(?:\.\d+)*)(?:\s*-?\s*exp\.?\s*(\d+))?/i.exec(String(v == null ? '' : v).trim());
  if (!m) return '';
  const nums = m[1].split('.');
  while (nums.length < 3) nums.push('0');
  return nums.join('.') + (m[2] ? `-exp.${Number(m[2])}` : '');
}

/** Negative, 0 or positive. A pre-release ranks below its own stable version. */
export function compareVersions(a, b) {
  const split = v => { const s = normalizeVersion(v); const i = s.indexOf('-'); return { nums: (i < 0 ? s : s.slice(0, i)).split('.').map(Number), pre: i < 0 ? null : Number(s.slice(i + 1).replace(/\D+/g, '')) }; };
  const x = split(a), y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre == null) return 1;
  if (y.pre == null) return -1;
  return x.pre - y.pre;
}

/** @returns {{version: string, date: string, title: string, items: string[]}[]} in file order (newest first in our files). */
export function parseChangelog(md) {
  const out = [];
  let cur = null, item = null;
  const flush = () => { if (cur && item != null) cur.items.push(item.trim()); item = null; };
  for (const raw of String(md || '').split(/\r?\n/)) {
    if (/^##\s/.test(raw)) {
      flush();
      const m = HEAD.exec(raw.trim());
      cur = null;
      if (m) {
        const rest = (m[3] || '').trim();
        const paren = /\(([^)]*)\)\s*$/.exec(rest);
        cur = { version: normalizeVersion(m[1] + (m[2] ? `-exp.${m[2]}` : '')), date: (paren ? rest.slice(0, paren.index) : rest).trim(), title: paren ? paren[1].trim() : '', items: [] };
        out.push(cur);
      }
    } else if (!cur) continue;
    else if (/^\s*[-*]\s+/.test(raw)) { flush(); item = raw.replace(/^\s*[-*]\s+/, ''); }
    else if (item != null && /^\s+\S/.test(raw)) item += ' ' + raw.trim();
    else flush();
  }
  flush();
  return out.filter(s => s.items.length);
}

/** Which changelog the running build reads: early-test builds ("-exp") the experimental one, stable builds the main one. */
export function pickSections(version, mainSections, experimentalSections) {
  return /-exp/.test(normalizeVersion(version)) && experimentalSections.length ? experimentalSections : mainSections;
}

/** Versions newer than lastSeen and not newer than current, newest first. Unknown lastSeen: just the newest one that is <= current. */
export function sectionsSince(sections, lastSeen, current) {
  const ok = sections.filter(s => compareVersions(s.version, current) <= 0).sort((a, b) => compareVersions(b.version, a.version));
  if (!normalizeVersion(lastSeen)) return ok.slice(0, 1);
  return ok.filter(s => compareVersions(s.version, lastSeen) > 0);
}

/** Split text into [{ text, bold }] for **bold** runs; everything else is plain (no HTML is ever produced). */
export function inlineParts(s) {
  const parts = [];
  String(s || '').split(/(\*\*[^*]+\*\*)/).forEach(p => {
    if (!p) return;
    const m = /^\*\*([^*]+)\*\*$/.exec(p);
    parts.push(m ? { text: m[1], bold: true } : { text: p.replace(/`/g, ''), bold: false });
  });
  return parts;
}
