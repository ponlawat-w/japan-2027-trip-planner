import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { LonLat } from '../src/lib/polyline.ts';
import { createThrottle, mapConcurrent, request } from './http.ts';
import { CACHE_DIR } from './store.ts';

/**
 * Elevation from GSI's DEM10B PNG tiles (国土地理院 標高タイル), cached on disk.
 *
 * Tiles rather than GSI's one-point elevation API: a route sampled every 100 m is thousands of
 * points, and a single z14 tile answers every one of them within ~2.4 km, so a whole leg costs a
 * few hundred tile fetches the first time and nothing after. Valhalla's own elevation (~30 m SRTM)
 * is too coarse for mountain grades, which is why it is not built.
 *
 * Source: 国土地理院 (https://maps.gsi.go.jp/development/ichiran.html), credited in the app.
 */

const ZOOM = 14;
const TILE_SIZE = 256;
const TILE_URL = (x: number, y: number) =>
  `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${ZOOM}/${x}/${y}.png`;
const TILE_CACHE_DIR = path.join(CACHE_DIR, 'gsi-dem', String(ZOOM));
/** Decoded tiles kept in memory: ~256 KB each, so this bounds the cache at ~100 MB. */
const MEMORY_TILES = 400;

const throttle = createThrottle(50);

/** Elevations in metres, row-major; NaN where the tile has no data (sea, outside Japan). */
type Tile = Float32Array | null;

const memory = new Map<string, Tile>();

const decodeTile = (png: Buffer): Float32Array => {
  const { data } = PNG.sync.read(png);
  const heights = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < heights.length; i++) {
    const value = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    // GSI's encoding: 2^23 marks no data, above it the value is negative (two's complement).
    if (value === 1 << 23) heights[i] = Number.NaN;
    else heights[i] = (value < 1 << 23 ? value : value - (1 << 24)) * 0.01;
  }
  return heights;
};

const loadTile = async (x: number, y: number): Promise<Tile> => {
  const key = `${x}/${y}`;
  if (memory.has(key)) {
    const tile = memory.get(key)!;
    memory.delete(key);
    memory.set(key, tile);
    return tile;
  }

  const file = path.join(TILE_CACHE_DIR, String(x), `${y}.png`);
  const missingMarker = `${file}.missing`;
  let tile: Tile;
  if (existsSync(missingMarker)) {
    tile = null;
  } else if (existsSync(file)) {
    tile = decodeTile(await readFile(file));
  } else {
    // A missing tile is all sea: GSI answers it with 404, remembered so it is not asked again.
    const response = await request(TILE_URL(x, y), { throttle, acceptStatuses: [404] });
    await mkdir(path.dirname(file), { recursive: true });
    if (response.status === 404) {
      await writeFile(missingMarker, '');
      tile = null;
    } else {
      const png = Buffer.from(await response.arrayBuffer());
      await writeFile(file, png);
      tile = decodeTile(png);
    }
  }

  memory.set(key, tile);
  if (memory.size > MEMORY_TILES) memory.delete(memory.keys().next().value!);
  return tile;
};

const pixelOf = ([lon, lat]: LonLat): { x: number; y: number; px: number; py: number } => {
  const scale = TILE_SIZE * 2 ** ZOOM;
  const worldX = ((lon + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const worldY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return {
    x: Math.floor(worldX / TILE_SIZE),
    y: Math.floor(worldY / TILE_SIZE),
    px: Math.floor(worldX) % TILE_SIZE,
    py: Math.floor(worldY) % TILE_SIZE,
  };
};

/**
 * Elevation at each point, NaN where GSI has none.
 *
 * The tiles the points need are fetched first, a few at a time, so a cold leg is not one
 * round-trip per tile in series.
 */
export const elevationsM = async (points: LonLat[]): Promise<number[]> => {
  const pixels = points.map(pixelOf);
  const tileKeys = [...new Set(pixels.map(({ x, y }) => `${x}/${y}`))];
  await mapConcurrent(tileKeys, 6, async (key) => {
    const [x, y] = key.split('/').map(Number);
    await loadTile(x, y);
  });

  const elevations: number[] = [];
  for (const { x, y, px, py } of pixels) {
    const tile = await loadTile(x, y);
    elevations.push(tile ? tile[py * TILE_SIZE + px] : Number.NaN);
  }
  return elevations;
};
