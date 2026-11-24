// Lists: lists you follow on Letterboxd, lists you make here (and export back to Letterboxd) and lists from your export.
// #/lists shows the tiles; #/lists/<id> opens one. Data: getLists, getList (core/api.js).
import './lists.css';
import { useCall } from '../state.js';
import { Loading } from '../components/ui.jsx';
import { EmptyState } from '../components/film.jsx';
import { DebugError } from '../debug/DebugInfo.jsx';
import Tiles from './lists/Tiles.jsx';
import ListPage from './lists/ListPage.jsx';

export default function Lists({ param }) {
  return param ? <ListPage id={param} /> : <Overview />;
}

function Overview() {
  const { data, error, reload } = useCall('getLists', {}, [], { refreshOn: 'library' });
  if (error && !data) {
    return (
      <div class="screen">
        <EmptyState title="Your lists didn't load" action={<button type="button" class="btn btn-primary" onClick={reload}>Try again</button>}>Something went wrong while opening them. Your lists are safe.</EmptyState>
        <DebugError error={error} what="getLists" />
      </div>
    );
  }
  if (!data) return <div class="screen"><Loading label="Opening your lists…" /></div>;
  return <Tiles lists={data} />;
}
