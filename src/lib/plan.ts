import { AIRPORT, getLeg, type Leg } from '@/data/dataset';
import { FLIGHT_DAY, NIGHT_COUNT } from '@/lib/trip';

/**
 * The plan is one entry per night, and nothing else.
 *
 * Stays, stops and legs are all derived from it, rather than stored beside it, so no edit can
 * leave them disagreeing: a stay is simply a run of nights with the same destination.
 */
export interface Night {
  destinationId: string | null;
  /** Kept as it is by auto-fill, and by reordering around it. */
  pinned: boolean;
}

export type Plan = Night[];

export const emptyPlan = (): Plan =>
  Array.from({ length: NIGHT_COUNT }, () => ({ destinationId: null, pinned: false }));

/** A run of consecutive nights with one destination and one pin state; empty nights form them too. */
export interface Stay {
  start: number;
  nights: number;
  destinationId: string | null;
  pinned: boolean;
}

export const staysOf = (plan: Plan): Stay[] => {
  const stays: Stay[] = [];
  plan.forEach((night, index) => {
    const last = stays[stays.length - 1];
    if (last && last.destinationId === night.destinationId && last.pinned === night.pinned) {
      last.nights++;
    } else {
      stays.push({
        start: index,
        nights: 1,
        destinationId: night.destinationId,
        pinned: night.pinned,
      });
    }
  });
  return stays;
};

const flatten = (stays: Stay[]): Plan =>
  stays.flatMap((stay) =>
    Array.from({ length: stay.nights }, () => ({
      destinationId: stay.destinationId,
      pinned: stay.destinationId !== null && stay.pinned,
    })),
  );

const clampNight = (index: number): number => Math.max(0, Math.min(NIGHT_COUNT - 1, index));

export const assignRange = (
  plan: Plan,
  first: number,
  last: number,
  destinationId: string | null,
  pinned = false,
): Plan =>
  plan.map((night, index) =>
    index >= clampNight(first) && index <= clampNight(last)
      ? { destinationId, pinned: destinationId !== null && pinned }
      : night,
  );

export const setPinned = (plan: Plan, first: number, last: number, pinned: boolean): Plan =>
  plan.map((night, index) =>
    index >= first && index <= last && night.destinationId !== null ? { ...night, pinned } : night,
  );

export const clearUnpinned = (plan: Plan): Plan =>
  plan.map((night) => (night.pinned ? night : { destinationId: null, pinned: false }));

/**
 * The stays a stay may trade places with: the unbroken run of unpinned stays around it.
 *
 * Reordering inside such a run never changes its total length, so every pinned night keeps its
 * date — which is the point of pinning it.
 */
export const reorderWindow = (stays: Stay[], index: number): [number, number] => {
  let first = index;
  let last = index;
  while (first > 0 && !stays[first - 1].pinned) first--;
  while (last < stays.length - 1 && !stays[last + 1].pinned) last++;
  return [first, last];
};

export const canMoveStay = (stays: Stay[], from: number, to: number): boolean => {
  if (from === to || stays[from]?.pinned || stays[to]?.pinned) return false;
  if (stays[from].destinationId === null) return false;
  const [first, last] = reorderWindow(stays, from);
  return to >= first && to <= last;
};

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
 * A stay keeps at least one night. Growing takes over neighbouring nights, but stops at the first
 * night pinned to somewhere else. Shrinking leaves the freed nights empty rather than handing them
 * to the neighbour, which would be a guess.
 */
export const resizeStayTo = (
  plan: Plan,
  stay: Stay,
  edge: 'start' | 'end',
  boundary: number,
): Plan => {
  if (stay.destinationId === null) return plan;
  const end = stay.start + stay.nights;
  const blocked = (index: number) =>
    plan[index].pinned && plan[index].destinationId !== stay.destinationId;
  let first = stay.start;
  let last = end - 1;
  if (edge === 'end') {
    let newEnd = Math.max(stay.start + 1, Math.min(NIGHT_COUNT, boundary));
    for (let i = end; i < newEnd; i++) {
      if (blocked(i)) {
        newEnd = i;
        break;
      }
    }
    last = newEnd - 1;
  } else {
    let newStart = Math.min(end - 1, Math.max(0, boundary));
    for (let i = stay.start - 1; i >= newStart; i--) {
      if (blocked(i)) {
        newStart = i + 1;
        break;
      }
    }
    first = newStart;
  }
  return plan.map((night, index) => {
    if (index >= first && index <= last) {
      return { destinationId: stay.destinationId, pinned: stay.pinned };
    }
    if (index >= stay.start && index < end) return { destinationId: null, pinned: false };
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

/** One drive of the trip, on the day it is driven. */
export interface PlannedLeg {
  index: number;
  from: string;
  to: string;
  /** Day index the drive happens on: the first night of the stop it arrives at. */
  day: number;
  leg: Leg | undefined;
}

/**
 * Every drive, from the airport through each stop and back to the airport on the flight day.
 *
 * Two stops at the same destination with only empty nights between them make no drive: the empty
 * nights are a hole in the plan, not a trip away and back.
 */
export const legsOf = (plan: Plan): PlannedLeg[] => {
  const stops = stopsOf(plan);
  const legs: PlannedLeg[] = [];
  let previous = AIRPORT.id;
  for (const stop of stops) {
    if (stop.destinationId !== previous) {
      legs.push({
        index: legs.length,
        from: previous,
        to: stop.destinationId,
        day: stop.start,
        leg: getLeg(previous, stop.destinationId),
      });
    }
    previous = stop.destinationId;
  }
  if (stops.length > 0) {
    legs.push({
      index: legs.length,
      from: previous,
      to: AIRPORT.id,
      day: FLIGHT_DAY,
      leg: getLeg(previous, AIRPORT.id),
    });
  }
  return legs;
};
