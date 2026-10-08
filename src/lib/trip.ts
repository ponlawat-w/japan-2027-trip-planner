/**
 * The trip's fixed calendar: arrive 2 February 2027, fly home 15 February.
 *
 * Nights are indexed from 0 (the night of the 2nd) to 12 (the night of the 14th). Days are indexed
 * the same way with one more, 13, for the 15th: the flight day, which has no night.
 */

export const TRIP_YEAR = 2027;
export const TRIP_MONTH_INDEX = 1;
export const FIRST_DAY_OF_MONTH = 2;
export const NIGHT_COUNT = 13;
export const DAY_COUNT = NIGHT_COUNT + 1;
export const FLIGHT_DAY = NIGHT_COUNT;

export interface TripDay {
  index: number;
  date: Date;
  dayOfMonth: number;
  weekday: string;
}

export const DAYS: TripDay[] = Array.from({ length: DAY_COUNT }, (_, index) => {
  const date = new Date(TRIP_YEAR, TRIP_MONTH_INDEX, FIRST_DAY_OF_MONTH + index);
  return {
    index,
    date,
    dayOfMonth: date.getDate(),
    weekday: date.toLocaleDateString('en-GB', { weekday: 'short' }),
  };
});

export const dayLabel = (index: number): string =>
  `${DAYS[index].weekday} ${DAYS[index].dayOfMonth} Feb`;

/** "5–7 Feb" for the nights from `start` for `nights`: the check-in day to the check-out day. */
export const stayDateRange = (start: number, nights: number): string =>
  `${DAYS[start].dayOfMonth}–${DAYS[start + nights].dayOfMonth} Feb`;
