import { encodePolyline6, type LonLat } from '../src/lib/polyline.ts';
import type { Difficulty, LegFactors, LegSection } from '../src/types/data.ts';
import { cellClimate, roadClimate, type RoadClimate } from './climate.ts';
import { elevationsM } from './dem.ts';
import { bearingDeg, cumulativeDistancesM, resample, simplify, sliceLine, turnDeg } from './geo.ts';
import type { TraceEdge } from './valhalla.ts';

/**
 * February driving difficulty for one route, after the handoff's outline: sample the line, grade
 * it from the DEM, attach road attributes and climate, score 1 km at a time, then roll up.
 *
 * Every weight below is a first draft meant to be tuned against routes whose difficulty is known.
 * They are gathered here, named, so that tuning is editing numbers rather than logic.
 */

const SAMPLE_STEP_M = 100;
const BIN_LENGTH_M = 1000;

const STEEP_GRADE = 0.08;
const STEEP_MIN_RUN_M = 300;
const HIGH_ELEVATION_M = 1000;
const VERY_HIGH_ELEVATION_M = 1400;
/** Above this, a road in Japan is very likely a pass that some winters close. */
const CLOSURE_CHECK_ELEVATION_M = 1600;

/**
 * How much of the snow and ice risk is left on each class of road, after plowing and salting.
 *
 * Expressways are cleared first and graded gently; 国道 (OSM `trunk` in Japan) and the main
 * prefectural roads (`primary`) are cleared next, but are still ordinary roads, often through
 * mountains; everything below is cleared last, if at all.
 */
const MOTORWAY_CLASS = 'motorway';
const MAJOR_CLASSES = new Set(['trunk', 'primary']);
const ROAD_WEIGHT = { motorway: 0.5, major: 0.75, other: 1 };
const MINOR_CLASSES = new Set(['unclassified', 'residential', 'service_other']);
const MINOR_USES = new Set(['track', 'driveway', 'alley', 'parking_aisle', 'living_street']);
const UNPAVED_SURFACES = new Set(['compacted', 'dirt', 'gravel', 'path', 'impassable']);

/** Time stretch by score: how much slower a careful driver goes on a 1 km of each difficulty. */
const WINTER_TIME_FACTOR: Record<Difficulty, number> = { 1: 1, 2: 1.05, 3: 1.15, 4: 1.3, 5: 1.5 };

export interface Bin {
  startM: number;
  endM: number;
  lengthM: number;
  timeS: number;
  meanElevationM: number;
  maxElevationM: number;
  steepM: number;
  motorwayM: number;
  majorM: number;
  minorM: number;
  tunnelM: number;
  ferryM: number;
  /** Bridge spans and tunnel mouths in this km: where road ices first or changes suddenly. */
  structures: number;
  turnDegPerKm: number;
  climate: RoadClimate;
  difficulty: Difficulty;
}

const isMinor = (edge: TraceEdge): boolean =>
  MINOR_CLASSES.has(edge.roadClass) ||
  MINOR_USES.has(edge.use) ||
  UNPAVED_SURFACES.has(edge.surface);

const isMotorway = (bin: Bin): boolean => bin.motorwayM > bin.lengthM / 2;

/**
 * The score for one km: 1 plus its points, rounded down.
 *
 * Rounded down so that a level is earned by a whole point: half-points are details (a bridge, a
 * bend) that should only lift a km together, not one at a time.
 *
 * Snow, and ice without snow (black-ice weather: freezing, but too dry to snow), are scaled by
 * {@link ROAD_WEIGHT}. Bridges and tunnel mouths count only in that black-ice weather — under
 * general snow cover the bridge is no worse than the road. Grades are not counted on expressways,
 * whose cuttings and embankments the DEM does not see: it reads the hillside beside the road.
 */
const scoreBin = (bin: Bin): Difficulty => {
  if (bin.ferryM > bin.lengthM / 2) return 1;
  const motorway = isMotorway(bin);
  const weight = motorway
    ? ROAD_WEIGHT.motorway
    : bin.majorM > bin.lengthM / 2
      ? ROAD_WEIGHT.major
      : ROAD_WEIGHT.other;
  const { freezeRatio, snowRatio } = bin.climate;
  let points = 0;
  if (bin.meanElevationM > HIGH_ELEVATION_M) points += 0.5;
  if (bin.meanElevationM > VERY_HIGH_ELEVATION_M) points += 0.5;
  if (!motorway && bin.steepM >= STEEP_MIN_RUN_M) points += 1;
  points += (snowRatio >= 0.7 ? 2 : snowRatio >= 0.3 ? 1 : 0) * weight;
  const blackIce = freezeRatio >= 0.6 && snowRatio < 0.3;
  if (blackIce) points += 0.5 * weight;
  if (blackIce && bin.structures > 0) points += 0.5 * weight;
  if (bin.minorM > bin.lengthM / 2) points += 1;
  if (!motorway && bin.turnDegPerKm > 400) points += 0.5;
  if (!motorway && bin.turnDegPerKm > 800) points += 0.5;
  return Math.max(1, Math.min(5, Math.floor(1 + points + 1e-9))) as Difficulty;
};

/**
 * The leg's score: the highest difficulty sustained for a meaningful distance.
 *
 * Not the mean, which lets 300 km of easy expressway bury a 10 km pass that is the whole question,
 * and not the maximum, which lets one tight junction in a city decide it. "Meaningful" is 3 km, or
 * a tenth of a short leg.
 */
const legDifficulty = (bins: Bin[]): Difficulty => {
  const totalKm = bins.reduce((sum, bin) => sum + bin.lengthM, 0) / 1000;
  const thresholdKm = Math.min(3, totalKm / 10);
  for (let level = 5; level > 1; level--) {
    const km = bins
      .filter((bin) => bin.difficulty >= level)
      .reduce((sum, bin) => sum + bin.lengthM / 1000, 0);
    if (km >= thresholdKm) return level as Difficulty;
  }
  return 1;
};

/**
 * Fills in elevations that cannot be read off the ground: inside tunnels and on bridges (where
 * the DEM gives the hill above or the valley below), on ferries, and where GSI has no data. Each
 * gap is bridged linearly between the readable points on either side, which is how such roads are
 * built.
 */
const fillElevations = (raw: number[], unreadable: boolean[], distances: number[]): number[] => {
  const filled = raw.map((value, i) => (unreadable[i] || Number.isNaN(value) ? Number.NaN : value));
  const known = filled.map((value, i) => (Number.isNaN(value) ? -1 : i)).filter((i) => i >= 0);
  if (known.length === 0) return filled.map(() => 0);
  for (let i = 0; i < filled.length; i++) {
    if (!Number.isNaN(filled[i])) continue;
    const after = known.find((k) => k > i);
    const before = [...known].reverse().find((k) => k < i);
    if (before === undefined) filled[i] = filled[after!];
    else if (after === undefined) filled[i] = filled[before];
    else {
      const t = (distances[i] - distances[before]) / (distances[after] - distances[before]);
      filled[i] = filled[before] + (filled[after] - filled[before]) * t;
    }
  }
  return filled;
};

/** Runs of consecutive edges sharing a flag, as distances along the line: one per bridge or tunnel. */
const structureRuns = (
  edges: TraceEdge[],
  cumulative: number[],
  flag: 'bridge' | 'tunnel',
): { startM: number; endM: number }[] => {
  const runs: { startM: number; endM: number }[] = [];
  let open: { startM: number; endM: number } | null = null;
  for (const edge of edges) {
    if (edge[flag]) {
      const startM = cumulative[edge.beginShapeIndex];
      const endM = cumulative[edge.endShapeIndex];
      if (open && Math.abs(open.endM - startM) < 1) open.endM = endM;
      else {
        open = { startM, endM };
        runs.push(open);
      }
    } else open = null;
  }
  return runs;
};

export interface ScoredRoute {
  difficulty: Difficulty;
  factors: Omit<LegFactors, 'toll' | 'ferry'>;
  sections: LegSection[];
  /** Ratio of the winter-adjusted time to Valhalla's. */
  winterTimeFactor: number;
  warnings: string[];
  /** Every km as scored, for `explain`; not saved. */
  bins: Bin[];
}

export const scoreRoute = async (shape: LonLat[], edges: TraceEdge[]): Promise<ScoredRoute> => {
  const cumulative = cumulativeDistancesM(shape);
  const segmentEdges: (TraceEdge | null)[] = new Array(shape.length - 1).fill(null);
  for (const edge of edges) {
    for (let i = edge.beginShapeIndex; i < edge.endShapeIndex; i++) segmentEdges[i] = edge;
  }

  const samples = resample(shape, cumulative, SAMPLE_STEP_M);
  const distances = samples.map((sample) => sample.distanceM);
  const sampleEdges = samples.map((sample) => segmentEdges[sample.segment]);
  const unreadable = sampleEdges.map(
    (edge) => !!edge && (edge.tunnel || edge.bridge || edge.use === 'ferry'),
  );
  const elevations = fillElevations(
    await elevationsM(samples.map((sample) => sample.point)),
    unreadable,
    distances,
  );

  // Grade over 200 m centred on each sample, which steadies the DEM's metre-level noise.
  const grades = samples.map((_, i) => {
    const before = Math.max(0, i - 1);
    const after = Math.min(samples.length - 1, i + 1);
    const run = distances[after] - distances[before];
    return run > 0 ? (elevations[after] - elevations[before]) / run : 0;
  });
  const steep = new Array<boolean>(samples.length).fill(false);
  for (let i = 0; i < samples.length;) {
    if (Math.abs(grades[i]) <= STEEP_GRADE) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < samples.length && Math.abs(grades[j + 1]) > STEEP_GRADE) j++;
    if (distances[j] - distances[i] + SAMPLE_STEP_M >= STEEP_MIN_RUN_M) steep.fill(true, i, j + 1);
    i = j + 1;
  }
  const turns = samples.map((sample, i) =>
    i === 0 || i === samples.length - 1
      ? 0
      : turnDeg(
          bearingDeg(samples[i - 1].point, sample.point),
          bearingDeg(sample.point, samples[i + 1].point),
        ),
  );

  const structureEdges = [
    ...structureRuns(edges, cumulative, 'bridge').map((run) => run.startM),
    ...structureRuns(edges, cumulative, 'tunnel').flatMap((run) => [run.startM, run.endM]),
  ];

  const totalM = distances[distances.length - 1];
  const bins: Bin[] = [];
  for (let startM = 0; startM < totalM; startM += BIN_LENGTH_M) {
    const endM = Math.min(totalM, startM + BIN_LENGTH_M);
    const bin: Bin = {
      startM,
      endM,
      lengthM: 0,
      timeS: 0,
      meanElevationM: 0,
      maxElevationM: 0,
      steepM: 0,
      motorwayM: 0,
      majorM: 0,
      minorM: 0,
      tunnelM: 0,
      ferryM: 0,
      structures: structureEdges.filter((distance) => distance >= startM && distance < endM).length,
      turnDegPerKm: 0,
      climate: { freezeRatio: 0, snowRatio: 0 },
      difficulty: 1,
    };
    let elevationSum = 0;
    let turnSum = 0;
    let curvyM = 0;
    let middle = samples[0].point;
    for (let i = 0; i < samples.length - 1; i++) {
      if (distances[i] < startM || distances[i] >= endM) continue;
      const lengthM = distances[i + 1] - distances[i];
      const edge = sampleEdges[i];
      bin.lengthM += lengthM;
      bin.timeS += lengthM / (((edge?.speedKph ?? 40) || 40) / 3.6);
      elevationSum += elevations[i] * lengthM;
      bin.maxElevationM = Math.max(bin.maxElevationM, elevations[i]);
      // Not on expressways, where the DEM reads the hillside beside the cutting, not the road.
      if (steep[i] && edge?.roadClass !== MOTORWAY_CLASS) bin.steepM += lengthM;
      if (edge && MAJOR_CLASSES.has(edge.roadClass)) bin.majorM += lengthM;
      if (edge?.roadClass === MOTORWAY_CLASS) bin.motorwayM += lengthM;
      else {
        turnSum += turns[i];
        curvyM += lengthM;
      }
      if (edge && isMinor(edge)) bin.minorM += lengthM;
      if (edge?.tunnel) bin.tunnelM += lengthM;
      if (edge?.use === 'ferry') bin.ferryM += lengthM;
      if (distances[i] <= (startM + endM) / 2) middle = samples[i].point;
    }
    if (bin.lengthM === 0) continue;
    bin.meanElevationM = elevationSum / bin.lengthM;
    bin.turnDegPerKm = curvyM >= 300 ? turnSum / (curvyM / 1000) : 0;
    // Inside a tunnel or on a ferry there is no road surface to freeze.
    if (bin.ferryM < bin.lengthM / 2 && bin.tunnelM < bin.lengthM * 0.8) {
      bin.climate = roadClimate(await cellClimate(middle[1], middle[0]), bin.meanElevationM);
    }
    bin.difficulty = scoreBin(bin);
    bins.push(bin);
  }

  const difficulty = legDifficulty(bins);
  const sections = buildSections(shape, cumulative, bins);

  const roadBins = bins.filter((bin) => bin.ferryM < bin.lengthM / 2);
  const roadM = roadBins.reduce((sum, bin) => sum + bin.lengthM, 0) || 1;
  const weighted = (value: (bin: Bin) => number): number =>
    roadBins.reduce((sum, bin) => sum + value(bin) * bin.lengthM, 0) / roadM;
  const km = (
    predicate: (bin: Bin) => boolean,
    length: (bin: Bin) => number = (bin) => bin.lengthM,
  ) => roadBins.filter(predicate).reduce((sum, bin) => sum + length(bin), 0) / 1000;
  const nonHighway = roadBins.filter((bin) => !isMotorway(bin));
  const nonHighwayM = nonHighway.reduce((sum, bin) => sum + bin.lengthM, 0);

  const factors: ScoredRoute['factors'] = {
    maxElevationM: Math.round(Math.max(0, ...bins.map((bin) => bin.maxElevationM))),
    kmAbove1000m: round1(km((bin) => bin.meanElevationM > HIGH_ELEVATION_M)),
    kmSteep: round1(
      km(
        () => true,
        (bin) => bin.steepM,
      ),
    ),
    freezeRatio: round2(weighted((bin) => bin.climate.freezeRatio)),
    snowRatio: round2(weighted((bin) => bin.climate.snowRatio)),
    kmSnowyMinorRoad: round1(
      km((bin) => bin.motorwayM + bin.majorM < bin.lengthM / 2 && bin.climate.snowRatio >= 0.5),
    ),
    bridges: structureRuns(edges, cumulative, 'bridge').length,
    tunnels: structureRuns(edges, cumulative, 'tunnel').length,
    kmMinorRoad: round1(
      km(
        () => true,
        (bin) => bin.minorM,
      ),
    ),
    curvinessDegPerKm: Math.round(
      nonHighwayM > 0
        ? nonHighway.reduce((sum, bin) => sum + bin.turnDegPerKm * bin.lengthM, 0) / nonHighwayM
        : 0,
    ),
  };

  const baseTime = bins.reduce((sum, bin) => sum + bin.timeS, 0);
  const winterTime = bins.reduce(
    (sum, bin) => sum + bin.timeS * WINTER_TIME_FACTOR[bin.difficulty],
    0,
  );

  return {
    difficulty,
    factors,
    sections,
    winterTimeFactor: baseTime > 0 ? winterTime / baseTime : 1,
    warnings: warningsFor(factors),
    bins,
  };
};

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

const warningsFor = (factors: ScoredRoute['factors']): string[] => {
  const warnings: string[] = [];
  if (factors.maxElevationM > CLOSURE_CHECK_ELEVATION_M) {
    warnings.push(
      `Climbs to ${factors.maxElevationM} m: check this pass is open in February and add it to ` +
        'data/winter-closures.json if it is not.',
    );
  }
  if (factors.kmSnowyMinorRoad >= 5) {
    warnings.push(
      `${factors.kmSnowyMinorRoad} km of minor road (below 国道 and main prefectural roads) with snow on the ground on most ` +
        'days: winter tyres, and carry chains.',
    );
  }
  if (factors.kmSteep >= 2 && factors.freezeRatio >= 0.6) {
    warnings.push(`${factors.kmSteep} km of sustained grades over 8% where most nights freeze.`);
  }
  return warnings;
};

/**
 * The line cut into runs of one difficulty, for the map.
 *
 * Each km's score is first smoothed with its neighbours (a 3-wide median), so a single odd km does
 * not chop the line into slivers of alternating colour. The leg's own score is taken from the raw
 * values, before this.
 */
const buildSections = (shape: LonLat[], cumulative: number[], bins: Bin[]): LegSection[] => {
  const smoothed = bins.map((bin, i) => {
    const window = [bins[i - 1], bin, bins[i + 1]].filter(Boolean).map((b) => b.difficulty);
    return window.sort((a, b) => a - b)[Math.floor(window.length / 2)] as Difficulty;
  });
  const sections: LegSection[] = [];
  let start = 0;
  for (let i = 1; i <= bins.length; i++) {
    if (i < bins.length && smoothed[i] === smoothed[start]) continue;
    const line = sliceLine(shape, cumulative, bins[start].startM, bins[i - 1].endM);
    sections.push({ difficulty: smoothed[start], line: encodePolyline6(simplify(line, 15)) });
    start = i;
  }
  return sections;
};
