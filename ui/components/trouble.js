// Pure helpers for the fetching-trouble notice and the Settings block.
/** "since 3:40 pm" in local time (en-AU), or '' when the time is missing. */
export function sinceText(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(+d)) return '';
  const t = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ /g, ' ').replace(/\s?(am|pm)$/i, (_, m) => ' ' + m.toLowerCase());
  return `since ${t}`;
}
/** One line for the notice: first message, then "+N more". */
export function noticeText(trouble) {
  const list = Array.isArray(trouble) ? trouble : [];
  if (!list.length) return '';
  return list[0].message + (list.length > 1 ? ` +${list.length - 1} more` : '');
}
/** Key that changes when the set of troubles changes, so a dismissed notice returns for a new problem. */
export const troubleId = trouble => (trouble || []).map(t => t.key).sort().join('|');
