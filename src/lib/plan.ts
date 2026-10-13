import { AIRPORT, getFerryLeg, getLeg, getTrainLeg, type Leg } from '@/data/dataset';
import { DAY_COUNT, FLIGHT_DAY, NIGHT_COUNT } from '@/lib/trip';
import { legKey, type FerryLeg, type TrainLeg, type TransportMode } from '@/types/data';

/**
 * The plan is one entry per night, and nothing else.
 *
 * Stays, stops and legs are all derived from it, rather than stored beside it, so no edit can
 * leave them disagreeing: a stay is simply a run of nights with the same destination.
 */
export interface Night {
  destinationId: string | null;
  /**
   * How the traveller chose to get here, on the first night of a stay only; absent to take the
   * default. Kept on the stay rather than on the pair of places, so it moves with the stay and
   * the same pair can be travelled one way early in the trip and another way later.
   */
  arrival?: TransportMode;
}

export type Plan = Night[];

/** Everything a person plans, and everything undo steps through. */
export interface Trip {
  plan: Plan;
  /** How the last leg, back to the airport on the flight day, is travelled; null for the default. */
  homeMode: TransportMode | null;
  rental: Rental | null;
}

export const emptyPlan = (): Plan =>
  Array.from({ length: NIGHT_COUNT }, () => ({ destinationId: null }));

/** A run of consecutive nights with one destination; empty nights form them too. */
export interface Stay {
  start: number;
  nights: number;
  destinationId: string | null;
  arrival?: TransportMode;
}

export const staysOf = (plan: Plan): Stay[] => {
  const stays: Stay[] = [];
  plan.forEach((night, index) => {
    const last = stays[stays.length - 1];
    if (last && last.destinationId === night.destinationId) {
      last.nights++;
      // Two stays edited into one: the first choice made in it stands.
      last.arrival ??= night.arrival;
    } else {
      stays.push({
        start: index,
        nights: 1,
        destinationId: night.destinationId,
        ...(night.destinationId !== null && night.arrival && { arrival: night.arrival }),
      });
    }
  });
  return stays;
};

/** Nights from stays, each stay's way of arriving on its first night and nowhere else. */
const flatten = (stays: Stay[]): Plan =>
  stays.flatMap((stay) =>
    Array.from({ length: stay.nights }, (_, offset) => ({
      destinationId: stay.destinationId,
      ...(offset === 0 && stay.arrival && { arrival: stay.arrival }),
    })),
  );

/** The plan in its one canonical form, whatever an edit left behind. */
const normalize = (plan: Plan): Plan => flatten(staysOf(plan));

const clampNight = (index: number): number => Math.max(0, Math.min(NIGHT_COUNT - 1, index));

export const assignRange = (
  plan: Plan,
  first: number,
  last: number,
  destinationId: string | null,
): Plan =>
  normalize(
    plan.map((night, index) =>
      index >= clampNight(first) && index <= clampNight(last) ? { destinationId } : night,
    ),
  );

/** A stay may trade places with any other stay, empty runs of nights included. */
export const canMoveStay = (stays: Stay[], from: number, to: number): boolean =>
  from !== to && stays[from]?.destinationId != null && to >= 0 && to < stays.length;

/** Moves the stay at `from` to `to`'s place among the stays, shifting those between. */
export const moveStay = (plan: Plan, from: number, to: number): Plan => {
  const stays = staysOf(plan);
  if (!canMoveStay(stays, from, to)) return plan;
  const reordered = [...stays];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return flatten(reordered);
};

/**
 * Moves one edge of a stay to a boundary between nights: `boundary` is the night the stay now
 * starts on (`start` edge) or the first night after it (`end` edge), so 0–13 either way.
 *
 * A stay keeps at least one night. Growing takes over neighbouring nights. Shrinking leaves the
 * freed nights empty rather than handing them to the neighbour, which would be a guess.
 */
export const resizeStayTo = (
  plan: Plan,
  stay: Stay,
  edge: 'start' | 'end',
  boundary: number,
): Plan => {
  if (stay.destinationId === null) return plan;
  const end = stay.start + stay.nights;
  const first = edge === 'start' ? Math.min(end - 1, Math.max(0, boundary)) : stay.start;
  const last =
    edge === 'end' ? Math.max(stay.start + 1, Math.min(NIGHT_COUNT, boundary)) - 1 : end - 1;
  return normalize(
    plan.map((night, index) => {
      if (index >= first && index <= last) {
        return {
          destinationId: stay.destinationId,
          // The way of arriving moves with the stay's first night.
          ...(index === first && stay.arrival && { arrival: stay.arrival }),
        };
      }
      if (index >= stay.start && index < end) return { destinationId: null };
      return night;
    }),
  );
};

/** Grows (`delta` 1) or shrinks (-1) a stay by one night at either end. */
export const resizeStay = (plan: Plan, stay: Stay, edge: 'start' | 'end', delta: 1 | -1): Plan =>
  resizeStayTo(
    plan,
    stay,
    edge,
    edge === 'end' ? stay.start + stay.nights + delta : stay.start - delta,
  );

/**
 * The days a rental car is kept, picked up on `from` and returned on `to` (day indices, both
 * included). Driving on those days is in the rental, by the traveller; any other car leg is in
 * someone else's car. There is at most one rental per trip.
 */
export interface Rental {
  from: number;
  to: number;
}

const clampDay = (day: number): number => Math.max(0, Math.min(DAY_COUNT - 1, Math.round(day)));

/** A rental from either end to the other, whichever way round they are given. */
export const rentalBetween = (a: number, b: number): Rental => ({
  from: clampDay(Math.min(a, b)),
  to: clampDay(Math.max(a, b)),
});

/** The rental grown to take in `day`, or a one-day rental there if there is none yet. */
export const rentalWith = (rental: Rental | null, day: number): Rental =>
  rental
    ? rentalBetween(Math.min(rental.from, day), Math.max(rental.to, day))
    : rentalBetween(day, day);

export const isRentalDay = (rental: Rental | null, day: number): boolean =>
  !!rental && day >= rental.from && day <= rental.to;

/** A place on the route, with consecutive stays at the same destination merged into one visit. */
export interface Stop {
  destinationId: string;
  start: number;
  nights: number;
  arrival?: TransportMode;
}

export const stopsOf = (plan: Plan): Stop[] => {
  const stops: Stop[] = [];
  plan.forEach((night, index) => {
    if (night.destinationId === null) return;
    const last = stops[stops.length - 1];
    if (last && last.destinationId === night.destinationId && last.start + last.nights === index) {
      last.nights++;
    } else {
      stops.push({
        destinationId: night.destinationId,
        start: index,
        nights: 1,
        ...(night.arrival && { arrival: night.arrival }),
      });
    }
  });
  return stops;
};

/**
 * The car on a rental day: it is there to be driven. Otherwise the train where the CLI computed
 * one: less tiring than a winter drive, and usually faster. Never the ferry: it is an option to
 * choose, not something to fall into.
 */
export const defaultMode = (from: string, to: string, rentalDay: boolean): TransportMode =>
  !rentalDay && getTrainLeg(from, to) ? 'train' : 'road';

/** Whether a leg can be travelled this way: every leg by road, the others where computed. */
export const canTravelBy = (mode: TransportMode, from: string, to: string): boolean =>
  mode === 'road' || !!(mode === 'train' ? getTrainLeg(from, to) : getFerryLeg(from, to));

/** The mode a leg is travelled by: the person's choice if it is still possible, or the default. */
export const modeOf = (
  chosen: TransportMode | undefined,
  from: string,
  to: string,
  rentalDay: boolean,
): TransportMode =>
  chosen && canTravelBy(chosen, from, to) ? chosen : defaultMode(from, to, rentalDay);

/**
 * Records how the leg on `day` is travelled: on the stay it arrives at, or as the way home on the
 * flight day. Kept as chosen even where it is the default today, so a later change to the
 * rental's days does not undo a choice the person made.
 */
export const chooseMode = (trip: Trip, day: number, mode: TransportMode): Trip =>
  day === FLIGHT_DAY
    ? { ...trip, homeMode: mode }
    : {
        ...trip,
        plan: trip.plan.map((night, index) =>
          index === day ? { ...night, arrival: mode } : night,
        ),
      };

/**
 * Applies choices made the old way, per pair of places (`nagoya>tokyo`), to each leg between that
 * pair: for links and saved plans from before choices were kept on the stay.
 */
export const applyPairChoices = (trip: Trip, choices: Record<string, TransportMode>): Trip =>
  legsOf(trip).reduce((next, leg) => {
    const mode = choices[legKey(leg.from, leg.to)];
    return mode ? chooseMode(next, leg.day, mode) : next;
  }, trip);

/** One leg of the trip, on the day it is travelled. */
export interface PlannedLeg {
  index: number;
  from: string;
  to: string;
  /** Day index the leg happens on: the first night of the stop it arrives at. */
  day: number;
  mode: TransportMode;
  /** The drive, always there to fall back on (estimated if the CLI has not computed it). */
  road: Leg | undefined;
  /** The train option, where the CLI computed one. */
  train: TrainLeg | undefined;
  /** The ferry option, where one is listed. */
  ferry: FerryLeg | undefined;
  /**
   * The day is in the rental period, so any driving on it (the whole leg by road, or a ferry's
   * drive to its pier) is in the rental car; otherwise it is in someone else's car.
   */
  rental: boolean;
}

/** The leg's figures for the way it is travelled: the drive, the train or the ferry. */
const option = (planned: PlannedLeg) =>
  planned.mode === 'train' ? planned.train : planned.mode === 'ferry' ? planned.ferry : undefined;

/**
 * Time spent travelling the leg its chosen way: winter driving time, the train door to door, or
 * the ferry door to door (its drive, the wait at the pier and the crossing).
 */
export const travelMinutes = (planned: PlannedLeg): number | undefined =>
  planned.mode === 'road' ? planned.road?.winterDurationMin : option(planned)?.durationMin;

export const travelKm = (planned: PlannedLeg): number | undefined =>
  planned.mode === 'road' ? planned.road?.distanceKm : option(planned)?.distanceKm;

/**
 * Every leg, from the airport through each stop and back to the airport on the flight day.
 *
 * Two stops at the same destination with only empty nights between them make no leg: the empty
 * nights are a hole in the plan, not a trip away and back.
 */
export const legsOf = ({ plan, homeMode, rental }: Trip): PlannedLeg[] => {
  const stops = stopsOf(plan);
  const legs: PlannedLeg[] = [];
  const add = (from: string, to: string, day: number, chosen: TransportMode | undefined) =>
    legs.push({
      index: legs.length,
      from,
      to,
      day,
      mode: modeOf(chosen, from, to, isRentalDay(rental, day)),
      road: getLeg(from, to),
      train: getTrainLeg(from, to),
      ferry: getFerryLeg(from, to),
      rental: isRentalDay(rental, day),
    });
  let previous = AIRPORT.id;
  for (const stop of stops) {
    if (stop.destinationId !== previous) {
      add(previous, stop.destinationId, stop.start, stop.arrival);
    }
    previous = stop.destinationId;
  }
  if (stops.length > 0) add(previous, AIRPORT.id, FLIGHT_DAY, homeMode ?? undefined);
  return legs;
};
