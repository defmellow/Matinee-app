// A quiet "Watched" / "Watchlist" marker. Same look everywhere a film appears; the tooltip says what it means.
import './statusbadge.css';

import { STATUS_TEXT, statusOf } from './status.js';
import { Chip } from './ui.jsx';

/** Flat label by default. Give it an `href` and it becomes a link (a Chip) to the Library filtered by that status. */
export default function StatusBadge({ user, href, class: cls = '' }) {
  const s = statusOf(user);
  if (!s) return null;
  if (href) return <Chip class={`status-chip ${cls}`} href={href} data-status={s} title={`${STATUS_TEXT[s].tip} Click to see them all.`}>{STATUS_TEXT[s].label}</Chip>;
  return <span class={`status-badge ${cls}`} data-status={s} title={STATUS_TEXT[s].tip}>{STATUS_TEXT[s].label}</span>;
}
