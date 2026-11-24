// Calendar day in the machine's local time zone. Diary dates are local days, so "today" must be too (UTC is
// yesterday for the first 10-11 hours of an Australian day). String dates are never shifted: only a Date is converted.
const pad = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of `d` in local time. Strings pass through as their first 10 characters. */
export function localDay(d = new Date()) {
  if (typeof d === 'string') return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return localDay(new Date());
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
