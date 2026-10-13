import { encodePolyline6 } from '../src/lib/polyline.ts';
import type {
  Destination,
  FerryAccess,
  FerryGeometry,
  FerryLeg,
  FerryPort,
  FerrySection,
} from '../src/types/data.ts';
import { cumulativeDistancesM, simplify } from './geo.ts';
import { computeLeg } from './leg.ts';
import type { FerryPortSpec, FerryRoutes, FerrySailingSpec, WinterClosure } from './store.ts';

/**
 * Ferry legs from `data/ferry-routes.json`: the crossing as the operator publishes it, and the drive
 * to or from the pier routed and scored like any other drive.
 *
 * A leg's time is the drive (in winter), or the walk where the pier belongs to the destination, then
 * being at the pier as early as the operator asks, then the crossing. There is no wait for the boat:
 * as with a train's first departure, the traveller picks the sailing and times the drive to it.
 */

const sailingKey = (a: string, b: string): string => [a, b].sort().join('|');

/** Checks the routes file, so a typo fails before anything is routed. */
export const validateFerryRoutes = (spec: FerryRoutes, destinations: Destination[]): void => {
  const destinationIds = new Set(destinations.map((destination) => destination.id));
  const sailings = new Set(spec.sailings.map((sailing) => sailingKey(...sailing.between)));
  const problems: string[] = [];
  for (const [id, port] of Object.entries(spec.ports)) {
    if (port.destination && !destinationIds.has(port.destination)) {
      problems.push(`port ${id}: no destination "${port.destination}"`);
    }
    if (port.destination && port.walkMin === undefined) {
      problems.push(`port ${id}: belongs to ${port.destination}, so needs walkMin`);
    }
  }
  for (const sailing of spec.sailings) {
    const label = sailing.between.join('–');
    for (const port of sailing.between) {
      if (!spec.ports[port]) problems.push(`sailing ${label}: unknown port "${port}"`);
      if (!sailing.departures[port]?.length)
        problems.push(`sailing ${label}: no departures from ${port}`);
    }
    if (sailing.path.length < 2) problems.push(`sailing ${label}: path needs at least two points`);
  }
  for (const route of spec.routes) {
    const label = `${route.from} ↔ ${route.to}`;
    for (const id of [route.from, route.to]) {
      if (!destinationIds.has(id)) problems.push(`${label}: no destination "${id}"`);
    }
    if (!sailings.has(sailingKey(...route.via))) {
      problems.push(`${label}: no sailing between ${route.via.join(' and ')}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`data/ferry-routes.json:\n  ${problems.join('\n  ')}`);
  }
};

const portOf = ({ name, nameJa, lat, lon, note }: FerryPortSpec): FerryPort => ({
  name,
  nameJa,
  lat,
  lon,
  ...(note && { note }),
});

/** Computes every route in both directions; each drive to or from a pier is routed once per direction. */
export const computeFerryLegs = async (
  spec: FerryRoutes,
  destinations: Destination[],
  closures: WinterClosure[],
  log: (line: string) => void,
): Promise<{ summary: FerryLeg; geometry: FerryGeometry }[]> => {
  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  const sailings = new Map<string, FerrySailingSpec>(
    spec.sailings.map((sailing) => [sailingKey(...sailing.between), sailing]),
  );
  /** A pier as a place Valhalla can route to; its id names it in the drive's `from` / `to`. */
  const asPlace = (id: string): Destination => {
    const port = spec.ports[id];
    return {
      id,
      name: port.name,
      nameJa: port.nameJa,
      kind: 'city',
      lat: port.lat,
      lon: port.lon,
      rating: 0,
    };
  };

  /** Walked where the pier belongs to the destination, otherwise driven, in the travel direction. */
  const access = async (
    destinationId: string,
    portId: string,
    toPort: boolean,
  ): Promise<{ access: FerryAccess; sections: FerrySection[] }> => {
    const port = spec.ports[portId];
    if (port.destination === destinationId) {
      return { access: { kind: 'walk', walkMin: port.walkMin!, port: portOf(port) }, sections: [] };
    }
    const destination = byId.get(destinationId)!;
    const [from, to] = toPort ? [destination, asPlace(portId)] : [asPlace(portId), destination];
    const { summary, geometry } = await computeLeg(from, to, closures);
    return {
      access: { kind: 'drive', drive: summary, port: portOf(port) },
      sections: geometry.sections.map((section) => ({ mode: 'road', ...section })),
    };
  };

  const accessMinutes = (leg: FerryAccess): number =>
    leg.kind === 'walk' ? leg.walkMin : leg.drive.winterDurationMin;
  const accessKm = (leg: FerryAccess): number => (leg.kind === 'walk' ? 0 : leg.drive.distanceKm);

  const computedAt = new Date().toISOString();
  const legs: { summary: FerryLeg; geometry: FerryGeometry }[] = [];
  for (const route of spec.routes) {
    for (const [from, to, [departPort, arrivePort]] of [
      [route.from, route.to, route.via],
      [route.to, route.from, [route.via[1], route.via[0]]],
    ] as const) {
      const sailing = sailings.get(sailingKey(departPort, arrivePort))!;
      const forward = sailing.between[0] === departPort;
      const path = forward ? sailing.path : [...sailing.path].reverse();
      const before = await access(from, departPort, true);
      const after = await access(to, arrivePort, false);
      const crossingKm = Math.round(cumulativeDistancesM(path).at(-1)! / 100) / 10;
      const summary: FerryLeg = {
        from,
        to,
        distanceKm:
          Math.round((accessKm(before.access) + crossingKm + accessKm(after.access)) * 10) / 10,
        durationMin:
          accessMinutes(before.access) +
          sailing.boardingMin +
          sailing.rideMin +
          accessMinutes(after.access),
        before: before.access,
        crossing: {
          line: sailing.line,
          lineJa: sailing.lineJa,
          from: portOf(spec.ports[departPort]),
          to: portOf(spec.ports[arrivePort]),
          distanceKm: crossingKm,
          rideMin: sailing.rideMin,
          boardingMin: sailing.boardingMin,
          fareYen: sailing.fareYen,
          departures: sailing.departures[departPort],
          ...(sailing.note && { note: sailing.note }),
        },
        after: after.access,
        sources: sailing.sources,
        computedAt,
      };
      const sections: FerrySection[] = [
        ...before.sections,
        { mode: 'sea', line: encodePolyline6(simplify(path, 15)) },
        ...after.sections,
      ];
      legs.push({ summary, geometry: { from, to, sections } });
      log(
        `${from} → ${to}: ${summary.distanceKm} km, ${summary.durationMin} min, ` +
          [summary.before, summary.after]
            .map((leg) =>
              leg.kind === 'walk'
                ? `walk ${leg.walkMin} min (${leg.port.name})`
                : `drive ${leg.drive.winterDurationMin} min, difficulty ${leg.drive.difficulty} (${leg.port.name})`,
            )
            .join(' · boat · '),
      );
    }
  }
  return legs;
};
