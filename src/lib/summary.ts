import { getDestination } from '@/data/dataset';
import {
  legsOf,
  stopsOf,
  travelKm,
  travelMinutes,
  type ModeChoices,
  type Plan,
  type PlannedLeg,
} from '@/lib/plan';
import { NIGHT_COUNT } from '@/lib/trip';
import type { Difficulty } from '@/types/data';

export interface TripSummary {
  destinations: number;
  onsen: number;
  nightsPlanned: number;
  nightsEmpty: number;
  /** Every leg, driven or by train. */
  totalKm: number;
  trainKm: number;
  driveKm: number;
  totalDriveMin: number;
  totalWinterDriveMin: number;
  trainMin: number;
  trainLegs: number;
  trainChanges: number;
  /** Winter driving plus trains: the time spent getting from place to place. */
  totalTravelMin: number;
  /** The leg with the most time travelling, whichever way it is travelled. */
  longestLeg: PlannedLeg | null;
  /** Of the driven legs only. */
  hardest: Difficulty | null;
  ferries: number;
  /** Some legs are straight-line guesses: the totals are approximate. */
  hasEstimates: boolean;
  /** Plan problems worth fixing, phrased for the person planning. */
  issues: string[];
}

export const summarize = (plan: Plan, modes: ModeChoices): TripSummary => {
  const stops = stopsOf(plan);
  const legs = legsOf(plan, modes);
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
    if (planned.mode === 'road' && planned.road && planned.road.winterDurationMin > 6 * 60) {
      const from = getDestination(planned.from)?.name ?? planned.from;
      const to = getDestination(planned.to)?.name ?? planned.to;
      issues.push(`${from} → ${to} is over 6 hours of winter driving in one day.`);
    }
  }

  const driven = legs.flatMap((planned) =>
    planned.mode === 'road' && planned.road ? [planned.road] : [],
  );
  const trains = legs.flatMap((planned) =>
    planned.mode === 'train' && planned.train ? [planned.train] : [],
  );
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
    totalKm: legs.reduce((sum, planned) => sum + (travelKm(planned) ?? 0), 0),
    trainKm: trains.reduce((sum, leg) => sum + leg.distanceKm, 0),
    driveKm: driven.reduce((sum, leg) => sum + leg.distanceKm, 0),
    totalDriveMin: driven.reduce((sum, leg) => sum + leg.durationMin, 0),
    totalWinterDriveMin: driven.reduce((sum, leg) => sum + leg.winterDurationMin, 0),
    trainMin: trains.reduce((sum, leg) => sum + leg.durationMin, 0),
    trainLegs: trains.length,
    trainChanges: trains.reduce((sum, leg) => sum + leg.segments.length - 1, 0),
    totalTravelMin:
      driven.reduce((sum, leg) => sum + leg.winterDurationMin, 0) +
      trains.reduce((sum, leg) => sum + leg.durationMin, 0),
    longestLeg,
    hardest:
      driven.length > 0 ? (Math.max(...driven.map((leg) => leg.difficulty)) as Difficulty) : null,
    ferries: driven.filter((leg) => leg.factors.ferry).length,
    hasEstimates: driven.some((leg) => leg.estimated),
    issues,
  };
};
