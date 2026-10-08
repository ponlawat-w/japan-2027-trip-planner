import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createThrottle, HttpError, requestJson } from './http.ts';
import { CACHE_DIR } from './store.ts';

/**
 * February climate along a route, from Open-Meteo's historical-weather API (non-commercial free
 * tier, CC BY 4.0 — credited in the app).
 *
 * What is asked for is shaped by how the free tier counts calls: a request over more than 14 days
 * counts as several, so each past year is fetched for the trip's own window of 2–15 February (14
 * days, one call) rather than as whole months or one long range. Two variables keeps it under the
 * ten-variable weighting too.
 *
 * Points are snapped to a 0.1° grid (≈ the ~9–11 km model resolution) before fetching, so the
 * dozens of samples a route makes inside one model cell are one request, cached on disk for good.
 */

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const CLIMATE_CACHE_DIR = path.join(CACHE_DIR, 'open-meteo');
const FIRST_YEAR = 2016;
const LAST_YEAR = 2025;
const WINDOW = { start: '02-02', end: '02-15' };
/** Free tier: 600 calls a minute. 150 ms apart stays well inside it. */
const throttle = createThrottle(150);

/** Standard environmental lapse rate: air cools about 0.65 °C per 100 m of climb. */
const LAPSE_RATE_C_PER_M = 0.0065;
/** Snow on the ground deep enough to matter for driving off plowed roads. */
const SNOW_DEPTH_THRESHOLD_M = 0.05;

interface ArchiveResponse {
  elevation: number;
  daily: { time: string[]; temperature_2m_min: (number | null)[] };
  hourly: { time: string[]; snow_depth: (number | null)[] };
}

interface CachedYear {
  gridElevationM: number;
  minTemperaturesC: number[];
  maxSnowDepthsM: number[];
}

export interface CellClimate {
  gridElevationM: number;
  minTemperaturesC: number[];
  maxSnowDepthsM: number[];
}

const cellOf = (lat: number, lon: number): { lat: number; lon: number } => ({
  lat: Math.round(lat * 10) / 10,
  lon: Math.round(lon * 10) / 10,
});

export const cellKey = (lat: number, lon: number): string => {
  const cell = cellOf(lat, lon);
  return `${cell.lat.toFixed(1)}_${cell.lon.toFixed(1)}`;
};

const fetchYear = async (lat: number, lon: number, year: number): Promise<CachedYear> => {
  const file = path.join(CLIMATE_CACHE_DIR, `${lat.toFixed(1)}_${lon.toFixed(1)}_${year}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as CachedYear;

  const params = new URLSearchParams({
    latitude: lat.toFixed(1),
    longitude: lon.toFixed(1),
    start_date: `${year}-${WINDOW.start}`,
    end_date: `${year}-${WINDOW.end}`,
    daily: 'temperature_2m_min',
    hourly: 'snow_depth',
    timezone: 'Asia/Tokyo',
    // Downscaling off: the response then describes the grid cell, at the cell's mean height, and
    // the correction to the road's own height is made here, where that height is known.
    elevation: 'nan',
  });
  let response: ArchiveResponse;
  try {
    response = await requestJson<ArchiveResponse>(`${ARCHIVE_URL}?${params}`, { throttle });
  } catch (error) {
    if (error instanceof HttpError && /limit/i.test(error.body)) {
      throw new Error(
        `Open-Meteo's free-tier limit is reached (${error.body}). Everything fetched so far is ` +
          'cached; run the same command again later and it resumes where it stopped.',
        { cause: error },
      );
    }
    throw error;
  }

  const maxSnowDepthsM = response.daily.time.map((day) => {
    let max = 0;
    response.hourly.time.forEach((hour, i) => {
      if (hour.startsWith(day)) max = Math.max(max, response.hourly.snow_depth[i] ?? 0);
    });
    return max;
  });
  const result: CachedYear = {
    gridElevationM: response.elevation,
    minTemperaturesC: response.daily.temperature_2m_min.map((value) => value ?? Number.NaN),
    maxSnowDepthsM,
  };
  await mkdir(CLIMATE_CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(result));
  return result;
};

const cells = new Map<string, Promise<CellClimate>>();

/** Every trip-window day of every year, for the model cell containing the point. */
export const cellClimate = (lat: number, lon: number): Promise<CellClimate> => {
  const key = cellKey(lat, lon);
  if (!cells.has(key)) {
    const cell = cellOf(lat, lon);
    const load = async (): Promise<CellClimate> => {
      const years: CachedYear[] = [];
      for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
        years.push(await fetchYear(cell.lat, cell.lon, year));
      }
      return {
        gridElevationM: years[0].gridElevationM,
        minTemperaturesC: years.flatMap((year) => year.minTemperaturesC),
        maxSnowDepthsM: years.flatMap((year) => year.maxSnowDepthsM),
      };
    };
    const pending = load();
    // A failed fetch must not stay cached as a rejection, or a retry in the same run never refetches.
    pending.catch(() => cells.delete(key));
    cells.set(key, pending);
  }
  return cells.get(key)!;
};

export interface RoadClimate {
  freezeRatio: number;
  snowRatio: number;
}

/**
 * The share of days that froze and that had snow on the ground, at a road `roadElevationM` high.
 *
 * Temperatures are moved from the cell's mean height to the road's by the lapse rate: a pass
 * 600 m above its cell's average is about 4 °C colder than the cell reports. Snow depth is the
 * cell's as reported, which understates it on a road well above the cell's mean.
 */
export const roadClimate = (climate: CellClimate, roadElevationM: number): RoadClimate => {
  const correctionC = -LAPSE_RATE_C_PER_M * (roadElevationM - climate.gridElevationM);
  const temperatures = climate.minTemperaturesC.filter((value) => !Number.isNaN(value));
  const freezing = temperatures.filter((value) => value + correctionC < 0).length;
  const snowy = climate.maxSnowDepthsM.filter((depth) => depth >= SNOW_DEPTH_THRESHOLD_M).length;
  return {
    freezeRatio: temperatures.length > 0 ? freezing / temperatures.length : 0,
    snowRatio: climate.maxSnowDepthsM.length > 0 ? snowy / climate.maxSnowDepthsM.length : 0,
  };
};
