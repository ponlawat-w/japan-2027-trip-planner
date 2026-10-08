import { getDestination } from '@/data/dataset';
import { legsOf, stopsOf, type Plan, type PlannedLeg } from '@/lib/plan';
import { NIGHT_COUNT } from '@/lib/trip';
import type { Difficulty } from '@/types/data';

export interface TripSummary {
  destinations: number;
  onsen: number;
  nightsPlanned: number;
  nightsEmpty: number;
  pinnedNights: number;
  totalKm: number;
  totalDriveMin: number;
  totalWinterDriveMin: number;
  longestLeg: PlannedLeg | null;
  hardest: Difficulty | null;
  ferries: number;
  /** Some legs are straight-line guesses: the totals are approximate. */
  hasEstimates: boolean;
  /** Plan problems worth fixing, phrased for the person planning. */
  issues: string[];
}

export const summarize = (plan: Plan): TripSummary => {
  const stops = stopsOf(plan);
  const legs = legsOf(plan);
  const uniqueIds = new Set(stops.map((stop) => stop.destinationId));
  const unique = [...uniqueIds].map(getDestination).filter((d) => d !== undefined);

  const issues: string[] = [];
  for (const stop of stops) {
    const destination = getDestination(stop.destinationId);
    if (destination && destination.maxNights > 0 && stop.nights > destination.maxNights) {
      issues.push(
        `${destination.name}: ${stop.nights} nights, above its suggested maximum of ${destination.maxNights}.`,
      );
    }
  }
  const revisited = unique.filter(
    (destination) => stops.filter((stop) => stop.destinationId === destination.id).length > 1,
  );
  for (const destination of revisited) {
    if (destination.kind !== 'city') {
      issues.push(`${destination.name} is visited more than once.`);
    }
  }
  for (const planned of legs) {
    if (planned.leg && planned.leg.winterDurationMin > 6 * 60) {
      const from = getDestination(planned.from)?.name ?? planned.from;
      const to = getDestination(planned.to)?.name ?? planned.to;
      issues.push(`${from} → ${to} is over 6 hours of winter driving in one day.`);
    }
  }

  const known = legs.flatMap((planned) => (planned.leg ? [planned.leg] : []));
  const longestLeg = legs.reduce<PlannedLeg | null>(
    (longest, planned) =>
      planned.leg &&
      (!longest?.leg || planned.leg.winterDurationMin > longest.leg.winterDurationMin)
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
    pinnedNights: plan.filter((night) => night.pinned).length,
    totalKm: known.reduce((sum, leg) => sum + leg.distanceKm, 0),
    totalDriveMin: known.reduce((sum, leg) => sum + leg.durationMin, 0),
    totalWinterDriveMin: known.reduce((sum, leg) => sum + leg.winterDurationMin, 0),
    longestLeg,
    hardest:
      known.length > 0 ? (Math.max(...known.map((leg) => leg.difficulty)) as Difficulty) : null,
    ferries: known.filter((leg) => leg.factors.ferry).length,
    hasEstimates: known.some((leg) => leg.estimated),
    issues,
  };
};
