/**
 * The shape of everything under `data/`: written by the CLI, read by the frontend.
 *
 * Shared by both rather than declared twice, so a field the CLI renames is a type error in the
 * component that reads it, not a silent `undefined` on the page.
 */

/**
 * What a destination is, which decides how it is drawn and whether a night can be spent there.
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
  /** How worth visiting it is, 1–5, shown as stars. */
  rating: number;
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

/** `data/legs/<from>/<to>.json`: one leg's line, loaded only when the leg is on the plan. */
export interface LegGeometry {
  from: string;
  to: string;
  sections: LegSection[];
}

/**
 * How a leg is travelled. Every leg can be driven; a train is an option only where the CLI has
 * computed one, and is then the default. A ferry is an option where one is listed, never the default.
 */
export type TransportMode = 'road' | 'train' | 'ferry';

/**
 * The kind of train, as far as planning a day goes: `shinkansen`, or `local` for any conventional
 * line — limited expresses such as Rapid Mie and μSKY included.
 */
export type RailService = 'shinkansen' | 'local';

export interface TrainStation {
  name: string;
  nameJa: string;
  lat: number;
  lon: number;
}

/** One ride without changing trains. */
export interface TrainSegment {
  service: RailService;
  line: string;
  lineJa: string;
  from: TrainStation;
  to: TrainStation;
  /** Along the track, measured on OpenStreetMap's railway lines. */
  distanceKm: number;
  /** A typical ride, averaged over the trains a traveller would take. */
  rideMin: number;
  /**
   * The 乗り換え before this ride: the walk between platforms plus, on average, half the usual
   * gap between trains. Zero on the first ride, whose departure the traveller picks.
   */
  transferMin: number;
}

/** One directed A → B train journey, station to station, as `train-matrix.json` holds it. */
export interface TrainLeg {
  from: string;
  to: string;
  distanceKm: number;
  /** Every ride and every transfer, from the first departure to the last arrival. */
  durationMin: number;
  segments: TrainSegment[];
  /** Where each ride's typical time comes from, for checking it by hand. */
  sources: string[];
  computedAt: string;
}

/** `data/train-matrix.json`: every computed train leg, keyed by {@link legKey}. */
export interface TrainMatrix {
  legs: Record<string, TrainLeg>;
}

/** One ride's track, so the map can draw shinkansen and local lines apart. */
export interface TrainSection {
  service: RailService;
  /** Google polyline at precision 6, simplified for display. */
  line: string;
}

/** `data/train-legs/<from>/<to>.json`: one train leg's track, one section per ride. */
export interface TrainGeometry {
  from: string;
  to: string;
  sections: TrainSection[];
}

export interface FerryPort {
  name: string;
  nameJa: string;
  lat: number;
  lon: number;
  note?: string;
}

/** One boat between two ports, with its timetable as published. */
export interface FerryCrossing {
  line: string;
  lineJa: string;
  from: FerryPort;
  to: FerryPort;
  /** Along the boat's course, as OpenStreetMap draws it. */
  distanceKm: number;
  rideMin: number;
  /** How early to be at the pier before departure, as the operator asks. */
  boardingMin: number;
  /** One way, one adult. */
  fareYen: number;
  /** Departures from `from`, "HH:MM", every day. */
  departures: string[];
  note?: string;
}

/**
 * Getting between a destination and its pier: driven (routed and scored like any drive, from or to
 * the pier) or, where the pier is part of the destination itself, walked.
 */
export type FerryAccess =
  | { kind: 'drive'; drive: LegSummary; port: FerryPort }
  | { kind: 'walk'; walkMin: number; port: FerryPort };

/** One directed A → B journey by boat, door to door, as `ferry-matrix.json` holds it. */
export interface FerryLeg {
  from: string;
  to: string;
  /** The drives and the crossing together. */
  distanceKm: number;
  /** Winter driving, walking, being at the pier in time, and the crossing. */
  durationMin: number;
  /** From the destination to the boat. */
  before: FerryAccess;
  crossing: FerryCrossing;
  /** From the boat to the destination. */
  after: FerryAccess;
  sources: string[];
  computedAt: string;
}

/** `data/ferry-matrix.json`: every computed ferry leg, keyed by {@link legKey}. */
export interface FerryMatrix {
  legs: Record<string, FerryLeg>;
}

/** A ferry leg's line, in travel order: drives coloured by difficulty, and the boat's course. */
export type FerrySection =
  { mode: 'road'; difficulty: Difficulty; line: string } | { mode: 'sea'; line: string };

/** `data/ferry-legs/<from>/<to>.json`: one ferry leg's line (lazy-loaded). */
export interface FerryGeometry {
  from: string;
  to: string;
  sections: FerrySection[];
}

/** The drive a ferry leg includes, if any: the stretch on land that is not walked. */
export const ferryDrives = (leg: FerryLeg): LegSummary[] =>
  [leg.before, leg.after].flatMap((access) => (access.kind === 'drive' ? [access.drive] : []));

/** The services a train leg uses, in riding order, each named once. */
export const trainServices = (leg: TrainLeg): RailService[] => [
  ...new Set(leg.segments.map((segment) => segment.service)),
];

export const legKey = (from: string, to: string): string => `${from}>${to}`;

/** A leg's file under `data/legs/`: one folder per origin. */
export const legFileName = (from: string, to: string): string => `${from}/${to}.json`;
