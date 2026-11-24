// Letterboxd list pages (seen live 10 Nov 2026) mark each film li.posteritem, not li.griditem; the site logo is the first <h1>.
// Synthetic markup shaped like the real page (no real list data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePosterGrid } from '../../core/parse/letterboxd.js';

const poster = (slug, name, id) => `<li class="posteritem"><div class="react-component" data-component-class="LazyPoster" data-item-name="${name}" data-item-slug="${slug}" data-item-link="/film/${slug}/" data-item-full-display-name="${name}" data-postered-identifier='{&quot;lid&quot;:&quot;x&quot;,&quot;uid&quot;:&quot;film:${id}&quot;,&quot;type&quot;:&quot;film&quot;}' data-target-link="/film/${slug}/"></div></li>`;
export const LIST_PAGE = `<html><head><title>&lrm;Quiet films, a list of films by someone • Letterboxd</title><meta property="og:title" content="Quiet films"></head><body>
<h1 class="site-logo"><a href="/">Letterboxd</a></h1><div data-owner="someone"></div><h1 class="title-1 prettify">Quiet films</h1>
<ul class="poster-list -p125 -grid">${poster('paterson', 'Paterson (2016)', 1)}${poster('flow-2024', 'Flow (2024)', 2)}</ul></body></html>`;

test('list pages: li.posteritem items are read like grid items', () => {
  const g = parsePosterGrid(LIST_PAGE);
  assert.deepEqual(g.items.map(i => [i.slug, i.title, i.year]), [['paterson', 'Paterson', 2016], ['flow-2024', 'Flow', 2024]]);
});

test('list page: name from h1.title-1 (not the site logo), owner from data-owner', async () => {
  const { parseListPage } = await import('../../core/parse/list-page.js');
  const r = parseListPage(LIST_PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.name, 'Quiet films');
  assert.equal(r.owner, 'someone');
  assert.equal(r.items.length, 2);
});
