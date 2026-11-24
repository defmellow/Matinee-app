// Small shared display formatters.

/** A count with en-AU thousands separators: 1234 -> "1,234". Non-numbers come back as given. */
export const n = v => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-AU') : v);

/** "1 film" / "3 films". `many` defaults to `one` + "s". */
export const plural = (count, one, many = one + 's') => `${count} ${count === 1 ? one : many}`;

/** Like plural, with en-AU thousands separators on the count: (1234, 'film') -> "1,234 films". */
export const pluralN = (count, one, many = one + 's') => `${n(count)} ${count === 1 ? one : many}`;

/** Three-letter month names, January first. */
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
