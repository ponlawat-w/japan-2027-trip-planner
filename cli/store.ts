import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LonLat } from '../src/lib/polyline.ts';
import {
  legFileName,
  legKey,
  type Destination,
  type LegGeometry,
  type LegSummary,
  type Matrix,
  type RailService,
  type TrainGeometry,
  type TrainLeg,
  type TrainMatrix,
} from '../src/types/data.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(ROOT, '.cache');
const DESTINATIONS_FILE = path.join(DATA_DIR, 'destinations.json');
const MATRIX_FILE = path.join(DATA_DIR, 'matrix.json');
const CLOSURES_FILE = path.join(DATA_DIR, 'winter-closures.json');
const LEGS_DIR = path.join(DATA_DIR, 'legs');
const TRAIN_ROUTES_FILE = path.join(DATA_DIR, 'train-routes.json');
const TRAIN_MATRIX_FILE = path.join(DATA_DIR, 'train-matrix.json');
const TRAIN_LEGS_DIR = path.join(DATA_DIR, 'train-legs');

/** A road closed every winter, kept out of routing as a polygon across it. */
export interface WinterClosure {
  name: string;
  /** One closed ring of `[lon, lat]`, as Valhalla's `exclude_polygons` takes it. */
  polygon: LonLat[];
}

const readJson = async <T>(file: string, fallback: T): Promise<T> =>
  existsSync(file) ? (JSON.parse(await readFile(file, 'utf8')) as T) : fallback;

const writeJson = async (file: string, value: unknown, pretty = true): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
};

export const readDestinations = (): Promise<Destination[]> =>
  readJson<Destination[]>(DESTINATIONS_FILE, []);

export const writeDestinations = (destinations: Destination[]): Promise<void> =>
  writeJson(DESTINATIONS_FILE, destinations);

export const readMatrix = (): Promise<Matrix> => readJson<Matrix>(MATRIX_FILE, { legs: {} });

/** Keys sorted, so adding one destination is a diff of its own legs and nothing else. */
export const writeMatrix = (matrix: Matrix): Promise<void> => {
  const legs = Object.fromEntries(
    Object.keys(matrix.legs)
      .sort()
      .map((key) => [key, matrix.legs[key]]),
  );
  return writeJson(MATRIX_FILE, { legs });
};

export const readClosures = (): Promise<WinterClosure[]> =>
  readJson<WinterClosure[]>(CLOSURES_FILE, []);

export const writeLegGeometry = (geometry: LegGeometry): Promise<void> =>
  writeJson(path.join(LEGS_DIR, legFileName(geometry.from, geometry.to)), geometry, false);

export const hasLegGeometry = (from: string, to: string): boolean =>
  existsSync(path.join(LEGS_DIR, legFileName(from, to)));

/** Saves one computed leg at once, so an interrupted run keeps every leg it finished. */
export const saveLeg = async (summary: LegSummary, geometry: LegGeometry): Promise<void> => {
  await writeLegGeometry(geometry);
  const matrix = await readMatrix();
  matrix.legs[legKey(summary.from, summary.to)] = summary;
  await writeMatrix(matrix);
};

/** A station in `train-routes.json`, where the walk between platforms is known if it matters. */
export interface TrainStationSpec {
  name: string;
  nameJa: string;
  lat: number;
  lon: number;
  /** The walk between platforms when changing trains here. Needed only where a route changes. */
  transferWalkMin?: number;
  note?: string;
}

/** One ride between two stations, in either direction, with its typical time and its sources. */
export interface TrainSegmentSpec {
  between: [string, string];
  service: RailService;
  line: string;
  lineJa: string;
  rideMin: number;
  /** The usual gap between trains. Needed only where a route changes onto this ride. */
  everyMin?: number;
  /** Pattern for the OSM `name` of the ways the ride runs on. */
  track: string;
  highspeed?: boolean;
  note?: string;
  sources: string[];
}

/** A train option between two destinations, both ways, as the stations it passes through. */
export interface TrainRouteSpec {
  from: string;
  to: string;
  via: string[];
}

/** `data/train-routes.json`: written by hand, from timetables, and read by the `train` command. */
export interface TrainRoutes {
  stations: Record<string, TrainStationSpec>;
  segments: TrainSegmentSpec[];
  routes: TrainRouteSpec[];
}

export const readTrainRoutes = (): Promise<TrainRoutes> =>
  readJson<TrainRoutes>(TRAIN_ROUTES_FILE, { stations: {}, segments: [], routes: [] });

export const readTrainMatrix = (): Promise<TrainMatrix> =>
  readJson<TrainMatrix>(TRAIN_MATRIX_FILE, { legs: {} });

/**
 * Replaces every train leg at once: the routes file is the whole truth, so a route taken out of it
 * leaves no stale leg or line behind.
 */
export const writeTrainLegs = async (
  legs: { summary: TrainLeg; geometry: TrainGeometry }[],
): Promise<void> => {
  await rm(TRAIN_LEGS_DIR, { recursive: true, force: true });
  for (const { geometry } of legs) {
    await writeJson(
      path.join(TRAIN_LEGS_DIR, legFileName(geometry.from, geometry.to)),
      geometry,
      false,
    );
  }
  const sorted = [...legs].sort((a, b) =>
    legKey(a.summary.from, a.summary.to).localeCompare(legKey(b.summary.from, b.summary.to)),
  );
  await writeJson(TRAIN_MATRIX_FILE, {
    legs: Object.fromEntries(
      sorted.map(({ summary }) => [legKey(summary.from, summary.to), summary]),
    ),
  });
};

/** Train legs to or from a removed destination. Its routes in `train-routes.json` stay for a person to edit. */
const removeTrainLegsOf = async (id: string): Promise<void> => {
  const matrix = await readTrainMatrix();
  for (const [key, leg] of Object.entries(matrix.legs)) {
    if (leg.from !== id && leg.to !== id) continue;
    delete matrix.legs[key];
    await rm(path.join(TRAIN_LEGS_DIR, legFileName(leg.from, leg.to)), { force: true });
  }
  await rm(path.join(TRAIN_LEGS_DIR, id), { recursive: true, force: true });
  if (existsSync(TRAIN_MATRIX_FILE)) await writeJson(TRAIN_MATRIX_FILE, matrix);
};

export const removeLegsOf = async (id: string): Promise<number> => {
  await removeTrainLegsOf(id);
  const matrix = await readMatrix();
  let removed = 0;
  for (const [key, leg] of Object.entries(matrix.legs)) {
    if (leg.from !== id && leg.to !== id) continue;
    delete matrix.legs[key];
    await rm(path.join(LEGS_DIR, legFileName(leg.from, leg.to)), { force: true });
    removed++;
  }
  await rm(path.join(LEGS_DIR, id), { recursive: true, force: true });
  await writeMatrix(matrix);
  return removed;
};
