// Keeps the test-fetch report safe to paste: no keys, no tokens, no cookie values, no query strings.
// Pure helpers, no I/O.

const SECRET_PARAM = /([?&;\s](?:api[_-]?key|apikey|key|token|access[_-]?token|auth|authorization|password|secret|sid|session)[=:])[^&\s"'<>]*/gi;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s"'<>]+/gi;

// A web address in running text: the query goes, and punctuation that ended the sentence stays.
const cutUrl = m => {
  const tail = /[.,;:!?)\]]+$/.exec(m)?.[0] || '';
  const body = tail ? m.slice(0, -tail.length) : m;
  const { host, path } = splitUrl(body);
  return (host ? host + path : body.split(/[?#]/)[0]) + tail;
};

/** Host and path of a web address, with the query and fragment dropped. Never throws. */
export function splitUrl(url) {
  try {
    const u = new URL(String(url));
    return { host: u.host, path: u.pathname || '/' };
  } catch {
    return { host: '', path: String(url || '').split(/[?#]/)[0].slice(0, 120) };
  }
}

/** Values of the keys in settings.keys (and anything else listed), for scrubbing. Short values are ignored (too likely to clash with plain words). */
export function collectSecrets(settings, extra = []) {
  const out = new Set();
  const add = v => { if (typeof v === 'string' && v.trim().length >= 4) out.add(v.trim()); };
  for (const v of Object.values(settings?.keys || {})) add(v);
  for (const v of extra) add(v);
  return [...out].sort((a, b) => b.length - a.length);
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Like scrubText but leaves spacing and length alone (for aligned report lines). */
export function stripSecrets(text, secrets = []) {
  let s = String(text ?? '');
  s = s.replace(URL_IN_TEXT, cutUrl);
  s = s.replace(SECRET_PARAM, '$1[redacted]');
  for (const secret of secrets) s = s.replace(new RegExp(escapeRe(secret), 'g'), '[redacted]');
  return s;
}

/** Text with web addresses cut back to host + path, key-like parameters blanked and any known secret value replaced. */
export function scrubText(text, secrets = [], max = 200) {
  let s = String(text ?? '');
  s = s.replace(URL_IN_TEXT, cutUrl);
  s = s.replace(SECRET_PARAM, '$1[redacted]');
  for (const secret of secrets) s = s.replace(new RegExp(escapeRe(secret), 'g'), '[redacted]');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** Cookie list from a probe, reduced to names and flags. Values are never copied. */
export function cookieNames(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(c => c && typeof c.name === 'string').map(c => ({
    name: c.name.slice(0, 60),
    domain: String(c.domain || '').slice(0, 60),
    secure: !!c.secure,
    session: c.session != null ? !!c.session : c.expirationDate == null && c.expires == null,
  }));
}

/** Walks any value and scrubs every string in it (used on the finished report as a last line of defence). */
export function scrubDeep(value, secrets = [], max = 400) {
  if (typeof value === 'string') return scrubText(value, secrets, max);
  if (Array.isArray(value)) return value.map(v => scrubDeep(v, secrets, max));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v, secrets, max);
    return out;
  }
  return value;
}
