// SYNTHETIC Letterboxd RSS feed for tests, in the same shape as the real feed. Every film and review is made up.
import { VIEWING } from './export.js';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rfc = d => {
  const [y, m, day] = d.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, day)).toUTCString().slice(0, 5)}${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y} 20:15:00 +1000`;
};

/** An RSS item. `logged` is the pubDate day; `review` makes it a review item. */
export function item({ id, title, year, slug, date, logged = date, rating = null, liked = false, rewatch = false, tmdb = 900000, review = null, spoiler = false, poster = `https://img.example.invalid/${slug}.jpg` }) {
  const stars = rating == null ? '' : ` - ${'★'.repeat(Math.floor(rating))}${rating % 1 ? '½' : ''}`;
  const paras = (spoiler ? ['This review may contain spoilers.'] : []).concat(review ? [review] : []);
  const body = review ? paras.map(p => `<p>${esc(p)}</p>`).join(' ') : `<p>Watched on ${date}.</p>`;
  return `<item> <title>${esc(title)}, ${year}${stars}</title> <link>https://letterboxd.com/synth_user/film/${slug}/1/</link> <guid isPermaLink="false">letterboxd-${review ? 'review' : 'watch'}-${id}</guid> <pubDate>${rfc(logged)}</pubDate> <letterboxd:watchedDate>${date}</letterboxd:watchedDate> <letterboxd:rewatch>${rewatch ? 'Yes' : 'No'}</letterboxd:rewatch> <letterboxd:filmTitle>${esc(title)}</letterboxd:filmTitle> <letterboxd:filmYear>${year}</letterboxd:filmYear>${rating == null ? '' : ` <letterboxd:memberRating>${rating.toFixed(1)}</letterboxd:memberRating>`} <letterboxd:memberLike>${liked ? 'Yes' : 'No'}</letterboxd:memberLike> <tmdb:movieId>${tmdb}</tmdb:movieId> <description><![CDATA[ <p><img src="${poster}"/></p> ${body} ]]></description> <dc:creator>Sam</dc:creator> </item>`;
}

export function feed(items, name = 'Sam') {
  return `<?xml version='1.0' encoding='utf-8'?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:letterboxd="https://letterboxd.com" xmlns:tmdb="https://themoviedb.org">\n\t<channel>\n\t\t<title>Letterboxd - ${name}</title>\n\t\t<link>https://letterboxd.com/synth_user/</link>\n\t\t${items.join('\n\t\t')}\n\t</channel>\n</rss>\n`;
}

/** Items matching the synthetic export (so they must be recognised as already imported)... */
export const inExport = () => [
  item({ id: VIEWING.alphaFirst, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2025-03-01', logged: '2025-03-02', rating: 3.5, tmdb: 900001 }),
  item({ id: VIEWING.alphaRewatch, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2025-06-01', rating: 4, rewatch: true, tmdb: 900001, review: 'Better the second time.' }),
];

/** ...and newer ones the export doesn't have. */
export const newer = () => [
  item({ id: 1000000010, title: 'Synthetic Alpha', year: 2001, slug: 'synthetic-alpha', date: '2026-01-01', logged: '2026-01-02', rating: 4.5, liked: true, rewatch: true, tmdb: 900001 }),
  item({ id: 1000000011, title: 'Synthetic Omega & Sons', year: 2024, slug: 'synthetic-omega-and-sons', date: '2026-02-03', rating: 2.5, tmdb: 900002, review: 'Loud.', spoiler: true }),
];
