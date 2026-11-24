// A quiet pill above the load pill when fetching keeps failing. Not a toast: it stays until things recover or the user
// closes it (for this session; a different problem brings it back).
import { useState } from 'preact/hooks';
import { useCore } from '../state.js';
import { go } from '../router.js';
import Icon from './Icon.jsx';
import { noticeText, troubleId } from './trouble.js';
import './fetchnotice.css';

let dismissed = ''; // troubleId the user closed, kept for the session

export default function FetchNotice() {
  const core = useCore();
  const [, bump] = useState(0);
  const trouble = (core && core.trouble) || [];
  if (!trouble.length || dismissed === troubleId(trouble)) return null;
  const seeDetails = () => {
    go('settings');
    setTimeout(() => { const el = document.getElementById('set-sources'); if (el) el.scrollIntoView({ block: 'start' }); }, 80);
  };
  return (
    <div class="fetchnotice" role="status">
      <span class="fetchnotice-text">{noticeText(trouble)}</span>
      <button type="button" class="btn-link" onClick={seeDetails}>See details</button>
      <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => { dismissed = troubleId(trouble); bump(n => n + 1); }}><Icon name="close" size={16} /></button>
    </div>
  );
}
