import { getDestination } from '@/data/dataset';
import { DAYS, NIGHT_COUNT } from '@/lib/trip';
import { applyPairChoices, rentalBetween, type Plan, type Rental, type Trip } from '@/lib/plan';
import { legKey, type TransportMode } from '@/types/data';

/**
 * The trip in the URL's fragment, readable by eye: one entry per night, the destination's id or
 * `_` when empty — `#plan=nagoya.suzuka.suzuka=osaka.osaka:gero._.…`
 *
 * The mark between two nights is how the traveller gets to the second: `.` the default (or no leg
 * at all, within a stay), `=` by train (two rails), `~` by ferry (waves), `:` by car. A mark before
 * the first entry is the leg from the airport, and one after the last is the leg back to it. Ids
 * use letters, digits and `-`, so none of these can be mistaken for part of one.
 *
 * The rental car, if any, is its pick-up and return dates in February — `&rental=4-9`.
 *
 * Older links still load: a `!` before or after an id (from when stays could be pinned) is
 * ignored, and choices given per pair of places (`&road=nagoya~tokyo`) apply to every leg
 * between that pair.
 *
 * In the fragment rather than the query, so it is never sent to the server hosting the page.
 */

const PARAMETER = 'plan';
const RENTAL = 'rental';
const EMPTY = '_';
const OLD_PIN_MARK = /^!|!$/g;
const DEFAULT_MARK = '.';
const MODE_MARKS: Record<TransportMode, string> = { road: ':', train: '=', ferry: '~' };
const MARK_MODES = Object.fromEntries(
  Object.entries(MODE_MARKS).map(([mode, mark]) => [mark, mode as TransportMode]),
);
const MARKS = /([.:=~])/;
const OLD_PAIR = '~';

const markOf = (mode: TransportMode | null | undefined): string =>
  mode ? MODE_MARKS[mode] : DEFAULT_MARK;

export const encodePlan = ({ plan, homeMode }: Trip): string => {
  const entries = plan.map((night, index) => {
    const mark = markOf(night.arrival);
    const id = night.destinationId ?? EMPTY;
    // The first entry has no mark before it unless the leg from the airport was chosen.
    return index === 0 ? (night.arrival ? mark + id : id) : mark + id;
  });
  return entries.join('') + (homeMode ? markOf(homeMode) : '');
};

/** The nights and the way home in `encoded`, read entry by entry with the mark before each. */
const decodeNights = (encoded: string): Pick<Trip, 'plan' | 'homeMode'> => {
  // Splitting on a captured pattern keeps the marks: [entry, mark, entry, mark, …].
  let parts = encoded.split(MARKS);
  let leading: string | undefined;
  let trailing: string | undefined;
  if (parts.length > 1 && parts[0] === '') {
    leading = parts[1];
    parts = parts.slice(2);
  }
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    trailing = parts[parts.length - 2];
    parts = parts.slice(0, -2);
  }
  const entries = parts.filter((_, i) => i % 2 === 0);
  const marks = [leading, ...parts.filter((_, i) => i % 2 === 1)];
  const plan: Plan = Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const id = (entries[index] ?? EMPTY).replace(OLD_PIN_MARK, '');
    const destinationId = id !== EMPTY && getDestination(id) ? id : null;
    const arrival = marks[index] && MARK_MODES[marks[index]];
    return { destinationId, ...(destinationId && arrival && { arrival }) };
  });
  return { plan, homeMode: (trailing && MARK_MODES[trailing]) || null };
};

/** Choices from links made before they were written into the plan: one parameter per mode. */
const decodeOldPairs = (parameters: URLSearchParams): Record<string, TransportMode> => {
  const choices: Record<string, TransportMode> = {};
  for (const mode of Object.keys(MODE_MARKS) as TransportMode[]) {
    for (const pair of parameters.get(mode)?.split('.') ?? []) {
      const [from, to] = pair.split(OLD_PAIR);
      if (getDestination(from) && getDestination(to)) choices[legKey(from, to)] = mode;
    }
  }
  return choices;
};

/** The rental in `parameters`, or null if there is none or it names dates outside the trip. */
const decodeRental = (parameters: URLSearchParams): Rental | null => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(parameters.get(RENTAL) ?? '');
  if (!match) return null;
  const [from, to] = [match[1], match[2]].map((date) =>
    DAYS.findIndex((day) => day.dayOfMonth === Number(date)),
  );
  return from >= 0 && to >= 0 ? rentalBetween(from, to) : null;
};

/** The trip in `hash`, or null if there is none. Unknown destinations read as empty nights. */
export const decodeTrip = (hash: string): Trip | null => {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  const encoded = parameters.get(PARAMETER);
  if (!encoded) return null;
  const trip: Trip = { ...decodeNights(encoded), rental: decodeRental(parameters) };
  return applyPairChoices(trip, decodeOldPairs(parameters));
};

const encodeRental = (rental: Rental | null): string =>
  rental ? `&${RENTAL}=${DAYS[rental.from].dayOfMonth}-${DAYS[rental.to].dayOfMonth}` : '';

export const planHash = (trip: Trip): string =>
  `#${PARAMETER}=${encodePlan(trip)}${encodeRental(trip.rental)}`;

export const shareUrl = (trip: Trip): string => {
  const url = new URL(window.location.href);
  url.hash = planHash(trip);
  return url.toString();
};
