import type { LonLat } from '../src/lib/polyline.ts';

const EARTH_RADIUS_M = 6371008.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const haversineM = ([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
};

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export const bearingDeg = ([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number => {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

/** The smallest turn between two bearings, 0–180°. */
export const turnDeg = (from: number, to: number): number => {
  const difference = Math.abs(to - from) % 360;
  return difference > 180 ? 360 - difference : difference;
};

/** Distance along the line to each of its vertices, starting at 0. */
export const cumulativeDistancesM = (line: LonLat[]): number[] => {
  const distances = [0];
  for (let i = 1; i < line.length; i++) {
    distances.push(distances[i - 1] + haversineM(line[i - 1], line[i]));
  }
  return distances;
};

const interpolate = (a: LonLat, b: LonLat, t: number): LonLat => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

export interface Sample {
  point: LonLat;
  /** Distance along the line. */
  distanceM: number;
  /** Index of the line segment (vertex `i` to `i + 1`) the sample falls on. */
  segment: number;
}

/**
 * Points every `stepM` along the line, plus its last vertex.
 *
 * Evenly spaced rather than the line's own vertices, which bunch up on bends and thin out on
 * straight road: grades and turn rates measured over equal distances are comparable everywhere.
 */
export const resample = (line: LonLat[], cumulative: number[], stepM: number): Sample[] => {
  const samples: Sample[] = [];
  const total = cumulative[cumulative.length - 1];
  let segment = 0;
  for (let distance = 0; distance < total; distance += stepM) {
    while (segment < line.length - 2 && cumulative[segment + 1] < distance) segment++;
    const length = cumulative[segment + 1] - cumulative[segment];
    const t = length > 0 ? (distance - cumulative[segment]) / length : 0;
    samples.push({
      point: interpolate(line[segment], line[segment + 1], t),
      distanceM: distance,
      segment,
    });
  }
  samples.push({ point: line[line.length - 1], distanceM: total, segment: line.length - 2 });
  return samples;
};

/** The part of the line between two distances along it, with interpolated end points. */
export const sliceLine = (
  line: LonLat[],
  cumulative: number[],
  startM: number,
  endM: number,
): LonLat[] => {
  const pointAt = (distance: number): LonLat => {
    let i = 0;
    while (i < line.length - 2 && cumulative[i + 1] < distance) i++;
    const length = cumulative[i + 1] - cumulative[i];
    return interpolate(line[i], line[i + 1], length > 0 ? (distance - cumulative[i]) / length : 0);
  };
  const inner = line.filter((_, i) => cumulative[i] > startM && cumulative[i] < endM);
  return [pointAt(startM), ...inner, pointAt(endM)];
};

/**
 * Douglas–Peucker simplification with a tolerance in metres.
 *
 * Distances are measured in a local equirectangular projection, which is exact enough over the
 * few kilometres a single tolerance check spans.
 */
export const simplify = (line: LonLat[], toleranceM: number): LonLat[] => {
  if (line.length <= 2) return line;
  const metresPerDegreeLat = 111320;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos(toRadians(line[0][1]));
  const xy = line.map(([lon, lat]) => [lon * metresPerDegreeLon, lat * metresPerDegreeLat]);

  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    let maxDistance = 0;
    let farthest = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy[i];
      const t =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
          : 0;
      const distance = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (maxDistance > toleranceM) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return line.filter((_, i) => keep[i]);
};
