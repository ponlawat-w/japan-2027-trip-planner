import destinationsJson from '@data/destinations.json';
import matrixJson from '@data/matrix.json';
import {
  legKey,
  type Destination,
  type Difficulty,
  type LegGeometry,
  type LegSummary,
  type Matrix,
} from '@/types/data';

/**
 * Everything the CLI computed, bundled into the build.
 *
 * Destinations and the matrix are small and needed at once, so they are imported outright. Each
 * leg's line is its own lazily loaded chunk: only the legs on the current plan are ever fetched.
 */

export const DESTINATIONS = destinationsJson as Destination[];
const MATRIX = matrixJson as Matrix;

const byId = new Map(DESTINATIONS.map((destination) => [destination.id, destination]));

export const getDestination = (id: string): Destination | undefined => byId.get(id);

/** Where the trip starts on 2 February and ends on the 15th. */
export const AIRPORT: Destination = DESTINATIONS.find((d) => d.kind === 'airport') ?? {
  id: 'ngo',
  name: 'Chubu Centrair Airport (NGO)',
  nameJa: '中部国際空港',
  kind: 'airport',
  lat: 34.8599,
  lon: 136.8162,
  rating: 0,
  idealNights: 0,
  maxNights: 0,
};

/** Places a night can be spent: every destination but the airport. */
export const STAYABLE = DESTINATIONS.filter((destination) => destination.kind !== 'airport');

/**
 * A drive between two destinations: the computed leg, or a straight-line guess when the CLI has
 * not yet computed this pair (`estimated: true`), so a fresh destination is usable at once.
 */
export interface Leg extends LegSummary {
  estimated: boolean;
}

const ESTIMATE_DETOUR = 1.35;
const ESTIMATE_SPEED_KPH = 55;

const haversineKm = (a: Destination, b: Destination): number => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const estimates = new Map<string, Leg>();

export const getLeg = (from: string, to: string): Leg | undefined => {
  const key = legKey(from, to);
  const computed = MATRIX.legs[key];
  if (computed) return { ...computed, estimated: false };
  if (estimates.has(key)) return estimates.get(key);
  const a = byId.get(from);
  const b = byId.get(to);
  if (!a || !b) return undefined;
  const distanceKm = Math.round(haversineKm(a, b) * ESTIMATE_DETOUR);
  const durationMin = Math.round((distanceKm / ESTIMATE_SPEED_KPH) * 60);
  const estimate: Leg = {
    from,
    to,
    distanceKm,
    durationMin,
    winterDurationMin: durationMin,
    difficulty: 2 as Difficulty,
    factors: {
      maxElevationM: 0,
      kmAbove1000m: 0,
      kmSteep: 0,
      freezeRatio: 0,
      snowRatio: 0,
      kmSnowyMinorRoad: 0,
      bridges: 0,
      tunnels: 0,
      kmMinorRoad: 0,
      curvinessDegPerKm: 0,
      ferry: false,
      toll: false,
    },
    warnings: ['Not computed yet: a straight-line guess. Run `npm run cli -- compute`.'],
    computedAt: '',
    estimated: true,
  };
  estimates.set(key, estimate);
  return estimate;
};

const geometryLoaders = import.meta.glob<LegGeometry>('../../data/legs/*.json', {
  import: 'default',
});
const geometries = new Map<string, Promise<LegGeometry | null>>();

export const loadLegGeometry = (from: string, to: string): Promise<LegGeometry | null> => {
  const key = legKey(from, to);
  if (!geometries.has(key)) {
    const loader = geometryLoaders[`../../data/legs/${from}__${to}.json`];
    geometries.set(key, loader ? loader() : Promise.resolve(null));
  }
  return geometries.get(key)!;
};
