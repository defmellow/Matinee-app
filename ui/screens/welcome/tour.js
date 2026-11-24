// "A quick look around": the welcome tour's cards, in order (23 Nov). Pictures are fixed screenshots of a full library,
// so they look right while your own is still filling in.
import library from '../../assets/onboarding/t-library.jpg';
import film from '../../assets/onboarding/t-film.jpg';
import colours from '../../assets/onboarding/t-colours.jpg';
import map from '../../assets/onboarding/t-map.jpg';
import upcoming from '../../assets/onboarding/t-upcoming.jpg';
import diary from '../../assets/onboarding/t-diary.jpg';
import insights from '../../assets/onboarding/t-insights.jpg';

export const TOUR = [
  { id: 'library', img: library, alt: 'The Library with a film\'s small card and More like this', title: 'Your library', text: 'All your films, with tabs for watched, watchlist, liked and not rated. Hover on a poster for a small card, or "More like this" to see similar films.' },
  { id: 'film', img: film, alt: 'A film page with its Matinee score and How it feels', title: 'Every film\'s page', text: 'Self explanatory. Matinee score is a blend of major review platforms. "How it feels" sums the film up from reviews and articles; click any feeling to find more like it. May be inaccurate at times.' },
  { id: 'colours', img: colours, alt: 'Posters with thin coloured lines under them', title: 'Feel colours', text: 'The thin line under a poster is the colour of how it feels. Hover to see what the colour means. If Matinee is unsure, it uses grey.', needsColours: true },
  { id: 'map', img: map, alt: 'The Map: dots coloured by feel, joined by fine lines', title: 'The Map', text: 'Every film is a dot, near the films that feel most like it. Click or scroll to zoom in and see posters.' },
  { id: 'upcoming', img: upcoming, alt: 'Upcoming: films opening soon', title: 'Upcoming', text: 'Films from your library opening soon in cinemas in your country.' },
  { id: 'diary', img: diary, alt: 'Diary: viewings by date', title: 'Your diary', text: 'Basically the same as Letterboxd.', noUser: 'Add your Letterboxd username in Settings to sync new entries directly from Letterboxd.' },
  { id: 'insights', img: insights, alt: 'Insights: numbers told in sentences', title: 'Insights', text: 'Your ratings, taste, people and habits. Year in review sums up each year in a card you can share.' },
];

/** The cards to show: the Feel colours card only while the colours are on. */
export const tourCards = coloursOn => TOUR.filter(c => coloursOn || !c.needsColours);
