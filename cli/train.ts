import { encodePolyline6, type LonLat } from '../src/lib/polyline.ts';
import type { Destination, TrainGeometry, TrainLeg, TrainSegment } from '../src/types/data.ts';
import { cumulativeDistancesM, simplify } from './geo.ts';
import { trackBetween } from './railway.ts';
import type { TrainRoutes, TrainSegmentSpec } from './store.ts';

/**
 * Train legs from `data/train-routes.json`: times from the cited timetables, track from OSM.
 *
 * A route's time is its rides plus, at each 乗り換え, the walk between platforms and half the usual
 * gap between the next trains — the average wait for someone who arrives without timing it. The
 * first departure has no wait: the traveller picks it. So a route changing onto an hourly train
 * takes longer one way than the other, as it does in practice.
 */

const segmentKey = (a: string, b: string): string => [a, b].sort().join('|');

/** Checks the routes file, so a typo fails before any track is computed. */
export const validateTrainRoutes = (spec: TrainRoutes, destinations: Destination[]): void => {
  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const segments = new Map(
    spec.segments.map((segment) => [segmentKey(...segment.between), segment]),
  );
  const problems: string[] = [];
  for (const segment of spec.segments) {
    for (const station of segment.between) {
      if (!spec.stations[station]) problems.push(`segment uses unknown station "${station}"`);
    }
  }
  for (const route of spec.routes) {
    const label = `${route.from} ↔ ${route.to}`;
    for (const id of [route.from, route.to]) {
      if (!destinationIds.has(id)) problems.push(`${label}: no destination "${id}"`);
    }
    if (route.via.length < 2) problems.push(`${label}: needs at least two stations`);
    for (let i = 1; i < route.via.length; i++) {
      const segment = segments.get(segmentKey(route.via[i - 1], route.via[i]));
      if (!segment) {
        problems.push(`${label}: no segment between ${route.via[i - 1]} and ${route.via[i]}`);
        continue;
      }
      // Changing trains needs both numbers, in both directions: the walk here, and the next train.
      if (i > 1 && spec.stations[route.via[i - 1]]?.transferWalkMin === undefined) {
        problems.push(`${label}: changes at ${route.via[i - 1]}, which has no transferWalkMin`);
      }
      const first = i === 1;
      const last = i === route.via.length - 1;
      if ((!first || !last) && segment.everyMin === undefined) {
        problems.push(`${label}: changes onto ${segment.between.join('–')}, which has no everyMin`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`data/train-routes.json:\n  ${problems.join('\n  ')}`);
  }
};

interface Ride {
  spec: TrainSegmentSpec;
  from: string;
  to: string;
}

/** Computes every route in both directions; each segment's track is found once and reused. */
export const computeTrainLegs = async (
  spec: TrainRoutes,
  log: (line: string) => void,
): Promise<{ summary: TrainLeg; geometry: TrainGeometry }[]> => {
  const segments = new Map(
    spec.segments.map((segment) => [segmentKey(...segment.between), segment]),
  );
  const tracks = new Map<string, Promise<LonLat[]>>();
  /** The track in the riding direction, found the first time either direction asks for it. */
  const trackOf = async ({ spec: segment, from, to }: Ride): Promise<LonLat[]> => {
    const key = segmentKey(from, to);
    if (!tracks.has(key)) {
      const [a, b] = segment.between;
      tracks.set(key, trackBetween(spec.stations[a], spec.stations[b], segment));
    }
    const track = await tracks.get(key)!;
    return from === segment.between[0] ? track : [...track].reverse();
  };

  const computedAt = new Date().toISOString();
  const legs: { summary: TrainLeg; geometry: TrainGeometry }[] = [];
  for (const route of spec.routes) {
    for (const [from, to, via] of [
      [route.from, route.to, route.via],
      [route.to, route.from, [...route.via].reverse()],
    ] as const) {
      const rides: Ride[] = via.slice(1).map((station, i) => ({
        spec: segments.get(segmentKey(via[i], station))!,
        from: via[i],
        to: station,
      }));
      const trainSegments: TrainSegment[] = [];
      const sections: TrainGeometry['sections'] = [];
      for (const [i, ride] of rides.entries()) {
        const track = await trackOf(ride);
        const lengthM = cumulativeDistancesM(track).at(-1)!;
        const { name, nameJa, lat, lon } = spec.stations[ride.from];
        const end = spec.stations[ride.to];
        trainSegments.push({
          service: ride.spec.service,
          line: ride.spec.line,
          lineJa: ride.spec.lineJa,
          from: { name, nameJa, lat, lon },
          to: { name: end.name, nameJa: end.nameJa, lat: end.lat, lon: end.lon },
          distanceKm: Math.round(lengthM / 100) / 10,
          rideMin: ride.spec.rideMin,
          transferMin:
            i === 0
              ? 0
              : Math.round(spec.stations[ride.from].transferWalkMin! + ride.spec.everyMin! / 2),
        });
        sections.push({
          service: ride.spec.service,
          line: encodePolyline6(simplify(track, 15)),
        });
      }
      const summary: TrainLeg = {
        from,
        to,
        distanceKm:
          Math.round(trainSegments.reduce((sum, segment) => sum + segment.distanceKm, 0) * 10) / 10,
        durationMin: trainSegments.reduce(
          (sum, segment) => sum + segment.transferMin + segment.rideMin,
          0,
        ),
        segments: trainSegments,
        sources: [...new Set(rides.flatMap((ride) => ride.spec.sources))],
        computedAt,
      };
      legs.push({ summary, geometry: { from, to, sections } });
      log(
        `${from} → ${to}: ${summary.distanceKm} km, ${summary.durationMin} min, ` +
          trainSegments
            .map((segment) => `${segment.service} ${segment.from.name}–${segment.to.name}`)
            .join(' › '),
      );
    }
  }
  return legs;
};
