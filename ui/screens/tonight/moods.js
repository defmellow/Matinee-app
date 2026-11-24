// The occasions on Tonight, in display order. The feelings behind each live in core/analysis/picks.js (MOODS);
// a unit test keeps the two lists in step.
export const MOOD_LABELS = [
  'Light and sweet', 'Make me laugh', 'Cosy and comforting', 'Black comedy', 'A good cry', 'Edge of my seat',
  'Unsettle me', 'Strange and dreamy', 'Quiet and poignant', 'Moody and atmospheric', 'Slow and beautiful', 'Something to think about',
];
// After 9pm these come first, since they're the ones people reach for late.
export const LATE_FIRST = ['Moody and atmospheric', 'Unsettle me', 'Strange and dreamy', 'Slow and beautiful', 'Edge of my seat'];
export const MIN_MATCHES = 3;   // a mood with fewer matching films tonight is hidden
export const SHOWN_MOODS = 12;  // the rest sit behind "More moods"

export const WEIGHTS = [
  { value: -1, label: 'Lighter' }, { value: 0, label: 'Either' }, { value: 1, label: 'Heavier' },
];

/** Per-pick nudges: [kind, button label]. "Not tonight" is separate (it remembers). */
export const NUDGES = [
  ['lighter', 'Lighter'], ['heavier', 'Heavier'], ['shorter', 'Shorter'], ['stranger', 'Stranger'], ['else', 'Something else'],
];

/** Why the user turned a "Choose for me" film down: [steer kind, button label]. Each one narrows the next pick without naming the film's details. */
export const REASONS = [
  ['lighter', 'Too heavy'], ['heavier', 'Too light'], ['plainer', 'Too strange'], ['bleak', 'Too bleak'],
  ['silly', 'Too silly'], ['intense', 'Too intense'], ['faster', 'Too slow'], ['scary', 'Too scary'], ['different', 'Seen something like it'],
];
