/**
 * The shape of everything under `data/`: written by the CLI, read by the frontend.
 *
 * Shared by both rather than declared twice, so a field the CLI renames is a type error in the
 * component that reads it, not a silent `undefined` on the page.
 */

/**
 * What a destination is, which decides how it is drawn and whether auto-fill may choose it.
 *
 * - `airport` — where the trip starts and ends; never a place to spend a night.
 * - `city` / `onsen` — places worth visiting.
 */
export type DestinationKind = 'airport' | 'city' | 'onsen';

export interface Destination {
  /** Short slug, also the key in the matrix and in shared links. Never renamed once used. */
  id: string;
  name: string;
  nameJa: string;
  kind: DestinationKind;
  lat: number;
  lon: number;
  /** How worth visiting it is, 1–5. Auto-fill weighs every night spent here by this. */
  rating: number;
  /** Nights beyond which another night here is worth much less to auto-fill. */
  idealNights: number;
  /** Nights auto-fill will never exceed. A plan made by hand may, and is warned about it. */
  maxNights: number;
  note?: string;
}

/** The difficulty scale, 1 (easy) to 5 (avoid in February without real winter experience). */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

/**
 * Why a leg scored what it did: the inputs to the score, in units a person can check.
 *
 * Climate ratios are the share of days, over the trip's own dates in past years, on which the
 * condition held — weighted by route length, so a long valley floor and a short pass each count
 * for the distance they cover.
 */
export interface LegFactors {
  maxElevationM: number;
  kmAbove1000m: number;
  /** Length of road inside sustained climbs or descents steeper than 8% (at least 300 m long). */
  kmSteep: number;
  /** Share of days with a minimum below 0 °C, corrected to the road's own elevation. */
  freezeRatio: number;
  /** Share of days with at least 5 cm of snow on the ground. */
  snowRatio: number;
  /** Road below 国道 and main prefectural roads (cleared last) with snow cover on most days. */
  kmSnowyMinorRoad: number;
  bridges: number;
  tunnels: number;
  /** Narrow, minor or unpaved road (`unclassified`, `residential`, `service`, `track`, unpaved). */
  kmMinorRoad: number;
  /** Mean heading change per km off the expressways, in degrees: a proxy for winding road. */
  curvinessDegPerKm: number;
  ferry: boolean;
  toll: boolean;
}

/** One directed A → B drive, as the matrix holds it. */
export interface LegSummary {
  from: string;
  to: string;
  distanceKm: number;
  /** Valhalla's estimate, which runs short on mountain roads where OSM lacks speed limits. */
  durationMin: number;
  /** The same time stretched section by section for difficulty: slower on snow and steep road. */
  winterDurationMin: number;
  difficulty: Difficulty;
  factors: LegFactors;
  /** Things to check by hand before driving it, such as a pass high enough to be closed. */
  warnings: string[];
  computedAt: string;
}

/** `data/matrix.json`: every computed leg, keyed by {@link legKey}. */
export interface Matrix {
  legs: Record<string, LegSummary>;
}

/** A stretch of a leg's line that shares one difficulty, so the map can colour it. */
export interface LegSection {
  difficulty: Difficulty;
  /** Google polyline at precision 6 (Valhalla's own encoding), simplified for display. */
  line: string;
}

/** `data/legs/<from>__<to>.json`: one leg's line, loaded only when the leg is on the plan. */
export interface LegGeometry {
  from: string;
  to: string;
  sections: LegSection[];
}

export const legKey = (from: string, to: string): string => `${from}>${to}`;

export const legFileName = (from: string, to: string): string => `${from}__${to}.json`;
