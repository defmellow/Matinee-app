// PROTOTYPES ONLY (branch proto/library-feel): the merged Library + By feel designs, one per folder.
// #/proto lists them; #/proto/<id> opens one; #/proto/<id>/<link> opens it filtered (Library link forms, or feel:<By feel param>).
import { href } from '../../router.js';

const modules = import.meta.glob('./*/Screen.jsx', { eager: true });
const designs = Object.entries(modules).map(([path, m]) => ({ id: path.split('/')[1], name: m.NAME || path.split('/')[1], why: m.WHY || '', Screen: m.default }))
  .sort((a, b) => a.id.localeCompare(b.id));

const SHOWN = new Set(['e-sentence', 'f-shelves']); // A-D were turned down (21 Nov); still reachable by address

export default function Proto({ param, core }) {
  const [id, ...rest] = String(param || '').split('/');
  const link = rest.join('/') || null;
  const d = designs.find(x => x.id === id);
  if (d) return <d.Screen core={core} link={link} onLinkUsed={() => history.replaceState(null, '', href('proto', id))} />;
  return (
    <div class="screen" style={{ padding: '24px 32px' }}>
      <h1>Library prototypes</h1>
      <p class="muted">Each one merges Library and By feel in a different way.</p>
      <ul>
        {designs.filter(x => SHOWN.has(x.id)).map(x => <li key={x.id}><a href={href('proto', x.id)}>{x.name}</a> <span class="muted">{x.why}</span></li>)}
      </ul>
    </div>
  );
}
