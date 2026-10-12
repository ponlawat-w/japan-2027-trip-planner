import { AIRPORT, getLeg, getTrainLeg, type Leg } from '@/data/dataset';
import { FLIGHT_DAY, NIGHT_COUNT } from '@/lib/trip';
import { legKey, type TrainLeg, type TransportMode } from '@/types/data';

/**
 * The plan is one entry per night, and nothing else.
 *
 * Stays, stops and legs are all derived from it, rather than stored beside it, so no edit can
 * leave them disagreeing: a stay is simply a run of nights with the same destination.
 */
export interface Night {
  destinationId: string | null;
}

export type Plan = Night[];

export const emptyPlan = (): Plan =>
  Array.from({ length: NIGHT_COUNT }, () => ({ destinationId: null }));

/** A run of consecutive nights with one destination; empty nights form them too. */
export interface Stay {
  start: number;
  nights: number;
  destinationId: string | null;
}

export const staysOf = (plan: Plan): Stay[] => {
  const stays: Stay[] = [];
  plan.forEach((night, index) => {
    const last = stays[stays.length - 1];
    if (last && last.destinationId === night.destinationId) {
      last.nights++;
    } else {
      stays.push({ start: index, nights: 1, destinationId: night.destinationId });
    }
  });
  return stays;
};

const flatten = (stays: Stay[]): Plan =>
  stays.flatMap((stay) =>
    Array.from({ length: stay.nights }, () => ({ destinationId: stay.destinationId })),
  );

const clampNight = (index: number): number => Math.max(0, Math.min(NIGHT_COUNT - 1, index));

export const assignRange = (
  plan: Plan,
  first: number,
  last: number,
  destinationId: string | null,
): Plan =>
  plan.map((night, index) =>
    index >= clampNight(first) && index <= clampNight(last) ? { destinationId } : night,
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
  return plan.map((night, index) => {
    if (index >= first && index <= last) return { destinationId: stay.destinationId };
    if (index >= stay.start && index < end) return { destinationId: null };
    return night;
  });
};

/** Grows (`delta` 1) or shrinks (-1) a stay by one night at either end. */
export const resizeStay = (plan: Plan, stay: Stay, edge: 'start' | 'end', delta: 1 | -1): Plan =>
  resizeStayTo(
    plan,
    stay,
    edge,
    edge === 'end' ? stay.start + stay.nights + delta : stay.start - delta,
  );

/** A place on the route, with consecutive stays at the same destination merged into one visit. */
export interface Stop {
  destinationId: string;
  start: number;
  nights: number;
}

export const stopsOf = (plan: Plan): Stop[] => {
  const stops: Stop[] = [];
  plan.forEach((night, index) => {
    if (night.destinationId === null) return;
    const last = stops[stops.length - 1];
    if (last && last.destinationId === night.destinationId && last.start + last.nights === index) {
      last.nights++;
    } else {
      stops.push({ destinationId: night.destinationId, start: index, nights: 1 });
    }
  });
  return stops;
};

/**
 * How each leg is travelled, where a person chose something other than the default: keyed by
 * {@link legKey}, so the choice follows the pair of places wherever the plan puts them.
 */
export type ModeChoices = Record<string, TransportMode>;

/** Train where the CLI computed one: less tiring than a winter drive, and usually faster. */
export const defaultMode = (from: string, to: string): TransportMode =>
  getTrainLeg(from, to) ? 'train' : 'road';

/** The mode a leg is travelled by: the person's choice if it is still possible, or the default. */
export const modeOf = (modes: ModeChoices, from: string, to: string): TransportMode => {
  const chosen = modes[legKey(from, to)];
  if (chosen === 'train' && !getTrainLeg(from, to)) return 'road';
  return chosen ?? defaultMode(from, to);
};

/** Records a choice, keeping only those that differ from the default. */
export const chooseMode = (
  modes: ModeChoices,
  from: string,
  to: string,
  mode: TransportMode,
): ModeChoices => {
  const key = legKey(from, to);
  const rest = Object.fromEntries(Object.entries(modes).filter(([other]) => other !== key));
  return mode === defaultMode(from, to) ? rest : { ...rest, [key]: mode };
};

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
}

/** Time spent travelling the leg its chosen way: winter driving time, or the train door to door. */
export const travelMinutes = (planned: PlannedLeg): number | undefined =>
  planned.mode === 'train' ? planned.train?.durationMin : planned.road?.winterDurationMin;

export const travelKm = (planned: PlannedLeg): number | undefined =>
  planned.mode === 'train' ? planned.train?.distanceKm : planned.road?.distanceKm;

/**
 * Every leg, from the airport through each stop and back to the airport on the flight day.
 *
 * Two stops at the same destination with only empty nights between them make no leg: the empty
 * nights are a hole in the plan, not a trip away and back.
 */
export const legsOf = (plan: Plan, modes: ModeChoices = {}): PlannedLeg[] => {
  const stops = stopsOf(plan);
  const legs: PlannedLeg[] = [];
  const add = (from: string, to: string, day: number) =>
    legs.push({
      index: legs.length,
      from,
      to,
      day,
      mode: modeOf(modes, from, to),
      road: getLeg(from, to),
      train: getTrainLeg(from, to),
    });
  let previous = AIRPORT.id;
  for (const stop of stops) {
    if (stop.destinationId !== previous) add(previous, stop.destinationId, stop.start);
    previous = stop.destinationId;
  }
  if (stops.length > 0) add(previous, AIRPORT.id, FLIGHT_DAY);
  return legs;
};
