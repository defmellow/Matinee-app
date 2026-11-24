// Countries for Settings → Country and onboarding's "About you": every ISO 3166 code the browser can name, sorted by name.
const CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

let names = null;
function display() {
  if (names) return names;
  try { names = new Intl.DisplayNames(['en-AU', 'en'], { type: 'region' }); } catch { names = { of: c => c }; }
  return names;
}

/** "Australia" for 'AU'; the code itself when the browser can't name it. */
export function countryName(code) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  try { return display().of(c) || c; } catch { return c; }
}

let list = null;
/** [{ code, name }] sorted by name. */
export function countryOptions() {
  if (list) return list;
  list = CODES.map(code => ({ code, name: countryName(code) })).filter(c => c.name && c.name !== c.code)
    .sort((a, b) => a.name.localeCompare(b.name, 'en-AU'));
  return list;
}

/** The computer's own country, from its language setting ('en-AU' → 'AU'); Australia when it doesn't say. */
export function systemRegion(lang = typeof navigator !== 'undefined' ? (navigator.languages && navigator.languages[0]) || navigator.language : '') {
  try {
    const loc = new Intl.Locale(lang || 'en-AU');
    const r = loc.region; // only a country the language tag names: 'en' alone says nothing about where the user is
    if (r && /^[A-Z]{2}$/.test(r) && CODES.includes(r)) return r;
  } catch { /* not a language tag the browser knows: fall back below */ }
  const m = /[-_]([A-Za-z]{2})\b/.exec(String(lang || ''));
  return m && CODES.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : 'AU';
}

// Country names that read with "the" in a sentence ("opening in cinemas in the United Kingdom").
const WITH_THE = new Set(['GB', 'US', 'AE', 'NL', 'PH', 'DO', 'CF', 'BS', 'GM', 'MV', 'SB', 'MH', 'KY', 'VG', 'VI', 'FO', 'FK', 'TC', 'CK', 'CD', 'CG', 'KM', 'VA', 'UM']);
/** The country as it reads inside a sentence: "Australia", "the United Kingdom". */
export function countryInSentence(code) {
  const name = countryName(code);
  return name && WITH_THE.has(String(code).toUpperCase()) ? 'the ' + name : name;
}
