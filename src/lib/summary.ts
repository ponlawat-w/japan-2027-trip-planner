import { getDestination, type Leg } from '@/data/dataset';
import { legsOf, stopsOf, travelMinutes, type PlannedLeg, type Trip } from '@/lib/plan';
import { NIGHT_COUNT } from '@/lib/trip';
import { ferryDrives, type Difficulty } from '@/types/data';

/** Driving in one kind of car: the rental the traveller drives, or someone else's. */
export interface CarTotals {
  /** Drives, a ferry's drive to its pier included. */
  drives: number;
  km: number;
  winterMin: number;
  dryMin: number;
  hardest: Difficulty | null;
  /** Drives with a crossing in them, as routed by road. */
  withFerry: number;
}

export interface TripSummary {
  destinations: number;
  onsen: number;
  nightsPlanned: number;
  nightsEmpty: number;
  /** Every leg, however it is travelled. */
  totalKm: number;
  /** Winter driving, trains and ferries: the time spent getting from place to place. */
  totalTravelMin: number;
  /** The leg with the most time travelling, whichever way it is travelled. */
  longestLeg: PlannedLeg | null;
  /** Driving on the rental's days, and how many days it is kept (null without one). */
  rental: CarTotals & { days: number | null };
  /** Driving on any other day: in someone else's car. */
  car: CarTotals;
  train: { legs: number; km: number; minutes: number; changes: number };
  /**
   * Ferry legs without their drives, which count under the car that made them: the crossing, the
   * time at the pier, and any walk.
   */
  ferry: { legs: number; km: number; minutes: number; boatMin: number; fareYen: number };
  /** Some drives are straight-line guesses: the totals are approximate. */
  hasEstimates: boolean;
  /** Plan problems worth fixing, phrased for the person planning. */
  issues: string[];
}

const carTotals = (drives: Leg[]): CarTotals => ({
  drives: drives.length,
  km: drives.reduce((sum, leg) => sum + leg.distanceKm, 0),
  winterMin: drives.reduce((sum, leg) => sum + leg.winterDurationMin, 0),
  dryMin: drives.reduce((sum, leg) => sum + leg.durationMin, 0),
  hardest:
    drives.length > 0 ? (Math.max(...drives.map((leg) => leg.difficulty)) as Difficulty) : null,
  withFerry: drives.filter((leg) => leg.factors.ferry).length,
});

/** The driving a leg involves: all of it by road, a ferry's drive to or from its pier, or none. */
const drivesOf = (planned: PlannedLeg): Leg[] => {
  if (planned.mode === 'road') return planned.road ? [planned.road] : [];
  if (planned.mode === 'ferry' && planned.ferry) {
    return ferryDrives(planned.ferry).map((drive) => ({ ...drive, estimated: false }));
  }
  return [];
};

export const summarize = (trip: Trip): TripSummary => {
  const { plan, rental } = trip;
  const stops = stopsOf(plan);
  const legs = legsOf(trip);
  const uniqueIds = new Set(stops.map((stop) => stop.destinationId));
  const unique = [...uniqueIds].map(getDestination).filter((d) => d !== undefined);

  const issues: string[] = [];
  const revisited = unique.filter(
    (destination) => stops.filter((stop) => stop.destinationId === destination.id).length > 1,
  );
  for (const destination of revisited) {
    if (destination.kind !== 'city') {
      issues.push(`${destination.name} is visited more than once.`);
    }
  }
  for (const planned of legs) {
    // Only where the traveller drives: someone else's car is theirs to judge.
    if (planned.mode === 'road' && planned.rental && planned.road!.winterDurationMin > 6 * 60) {
      const from = getDestination(planned.from)?.name ?? planned.from;
      const to = getDestination(planned.to)?.name ?? planned.to;
      issues.push(`${from} → ${to} is over 6 hours of winter driving in one day.`);
    }
  }

  const rentalDrives = legs.filter((planned) => planned.rental).flatMap(drivesOf);
  const otherDrives = legs.filter((planned) => !planned.rental).flatMap(drivesOf);
  const trains = legs.flatMap((planned) =>
    planned.mode === 'train' && planned.train ? [planned.train] : [],
  );
  const ferries = legs.flatMap((planned) =>
    planned.mode === 'ferry' && planned.ferry ? [planned.ferry] : [],
  );
  const rentalTotals = carTotals(rentalDrives);
  const carTotalsOther = carTotals(otherDrives);
  const train = {
    legs: trains.length,
    km: trains.reduce((sum, leg) => sum + leg.distanceKm, 0),
    minutes: trains.reduce((sum, leg) => sum + leg.durationMin, 0),
    changes: trains.reduce((sum, leg) => sum + leg.segments.length - 1, 0),
  };
  const ferry = {
    legs: ferries.length,
    km: ferries.reduce((sum, leg) => sum + leg.crossing.distanceKm, 0),
    minutes: ferries.reduce(
      (sum, leg) =>
        sum +
        leg.durationMin -
        ferryDrives(leg).reduce((driving, drive) => driving + drive.winterDurationMin, 0),
      0,
    ),
    boatMin: ferries.reduce((sum, leg) => sum + leg.crossing.rideMin, 0),
    fareYen: ferries.reduce((sum, leg) => sum + leg.crossing.fareYen, 0),
  };

  const longestLeg = legs.reduce<PlannedLeg | null>(
    (longest, planned) =>
      (travelMinutes(planned) ?? 0) > (longest ? (travelMinutes(longest) ?? 0) : 0)
        ? planned
        : longest,
    null,
  );
  const nightsPlanned = plan.filter((night) => night.destinationId !== null).length;

  return {
    destinations: unique.length,
    onsen: unique.filter((destination) => destination.kind === 'onsen').length,
    nightsPlanned,
    nightsEmpty: NIGHT_COUNT - nightsPlanned,
    totalKm: rentalTotals.km + carTotalsOther.km + train.km + ferry.km,
    totalTravelMin:
      rentalTotals.winterMin + carTotalsOther.winterMin + train.minutes + ferry.minutes,
    longestLeg,
    rental: { ...rentalTotals, days: rental ? rental.to - rental.from + 1 : null },
    car: carTotalsOther,
    train,
    ferry,
    hasEstimates: [...rentalDrives, ...otherDrives].some((leg) => leg.estimated),
    issues,
  };
};
