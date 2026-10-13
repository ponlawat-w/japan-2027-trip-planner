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

/** "4–9 Feb" for the days `from` to `to`, both included, or "4 Feb" for one day. */
export const dayRange = (from: number, to: number): string =>
  from === to
    ? `${DAYS[from].dayOfMonth} Feb`
    : `${DAYS[from].dayOfMonth}–${DAYS[to].dayOfMonth} Feb`;

/** One square of the calendar: a trip day, or a date before or after the trip shown for context. */
export interface CalendarCell {
  date: Date;
  /** The trip day this date is (0–13), or null outside the trip. */
  tripDay: number | null;
  week: number;
  column: number;
}

/**
 * Dates shown before the trip's first day, to fill its first week. Weeks start on Sunday, as
 * calendars do in Japan and the US.
 */
const LEAD = DAYS[0].date.getDay();

/** The whole weeks that hold the trip: three for 2–15 February 2027, 31 January to 20 February. */
export const calendarWeeks = (): CalendarCell[][] => {
  const weekCount = Math.ceil((LEAD + DAY_COUNT) / 7);
  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (_, column) => {
      const offset = week * 7 + column - LEAD;
      return {
        date: new Date(TRIP_YEAR, TRIP_MONTH_INDEX, FIRST_DAY_OF_MONTH + offset),
        tripDay: offset >= 0 && offset < DAY_COUNT ? offset : null,
        week,
        column,
      };
    }),
  );
};

/** Where a trip day falls in {@link calendarWeeks}. */
export const calendarPosition = (day: number): { week: number; column: number } => ({
  week: Math.floor((LEAD + day) / 7),
  column: (LEAD + day) % 7,
});

/** A stretch of nights within one calendar week: a stay that crosses a week is drawn in pieces. */
export interface CalendarSegment {
  week: number;
  column: number;
  start: number;
  nights: number;
  /** Whether this piece holds the stay's first or last night, where its edges can be dragged. */
  isFirst: boolean;
  isLast: boolean;
}

export const calendarSegments = (start: number, nights: number): CalendarSegment[] => {
  const segments: CalendarSegment[] = [];
  const end = start + nights;
  for (let day = start; day < end;) {
    const { week, column } = calendarPosition(day);
    const span = Math.min(7 - column, end - day);
    segments.push({
      week,
      column,
      start: day,
      nights: span,
      isFirst: day === start,
      isLast: day + span === end,
    });
    day += span;
  }
  return segments;
};
