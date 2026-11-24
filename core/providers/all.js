// Every provider the app knows about, in run order. Add new providers here.
import { sortProviders } from './index.js';
import boxd from './boxd.js';
import wikidata from './wikidata.js';
import tmdb from './tmdb.js';
import omdb from './omdb.js';
import wikipedia from './wikipedia.js';
import imdb from './imdb.js';
import rt from './rottentomatoes.js';
import metacritic from './metacritic.js';
import wikicats from './wikicats.js';
import mcreviews from './mcreviews.js';
import lbpage from './lbpage.js';
import imdbpage from './imdbpage.js';
import allmovie from './allmovie.js';

const ALL = sortProviders([boxd, wikidata, tmdb, omdb, wikipedia, imdb, rt, metacritic, wikicats, mcreviews, lbpage, imdbpage, allmovie]);

export function allProviders() { return ALL; }
export function providerById(id) { return ALL.find(p => p.id === id) || null; }
