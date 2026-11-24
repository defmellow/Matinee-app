// "Lists": the lists this film is on (each opens the list) and a small "Add to list" control for your own lists.
import { Chip } from '../../components/ui.jsx';
import { href } from '../../router.js';
import AddToList from '../lists/AddToList.jsx';

export default function Lists({ film }) {
  const on = film.lists || [];
  return (
    <section class="film-section film-lists">
      <h2>Lists</h2>
      {on.length > 0
        ? <div class="chips">{on.map(l => <Chip key={l.id} href={href('lists', l.id)} title={l.source === 'letterboxd' ? 'A Letterboxd list you follow' : 'Open this list'}>{l.name}</Chip>)}</div>
        : <p class="faint film-hint">Not on any of your lists yet.</p>}
      <div><AddToList keys={[film.key]} inLists={on.filter(l => l.source === 'matinee').map(l => l.id)} small /></div>
    </section>
  );
}
