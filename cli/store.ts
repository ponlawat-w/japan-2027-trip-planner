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
} from '../src/types/data.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CACHE_DIR = path.join(ROOT, '.cache');
const DESTINATIONS_FILE = path.join(DATA_DIR, 'destinations.json');
const MATRIX_FILE = path.join(DATA_DIR, 'matrix.json');
const CLOSURES_FILE = path.join(DATA_DIR, 'winter-closures.json');
const LEGS_DIR = path.join(DATA_DIR, 'legs');

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

export const removeLegsOf = async (id: string): Promise<number> => {
  const matrix = await readMatrix();
  let removed = 0;
  for (const [key, leg] of Object.entries(matrix.legs)) {
    if (leg.from !== id && leg.to !== id) continue;
    delete matrix.legs[key];
    await rm(path.join(LEGS_DIR, legFileName(leg.from, leg.to)), { force: true });
    removed++;
  }
  await writeMatrix(matrix);
  return removed;
};
