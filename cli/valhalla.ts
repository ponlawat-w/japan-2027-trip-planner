import { decodePolyline6, type LonLat } from '../src/lib/polyline.ts';
import { HttpError, requestJson } from './http.ts';
import type { WinterClosure } from './store.ts';

export const VALHALLA_URL = process.env.VALHALLA_URL ?? 'http://localhost:8002';

interface ValhallaRouteResponse {
  trip: {
    summary: { length: number; time: number; has_toll: boolean; has_ferry: boolean };
    legs: { shape: string }[];
  };
}

export interface Route {
  distanceKm: number;
  durationS: number;
  hasToll: boolean;
  hasFerry: boolean;
  /** Polyline6, as Valhalla returned it — handed straight back to `traceAttributes`. */
  encodedShape: string;
}

export interface TraceEdge {
  beginShapeIndex: number;
  endShapeIndex: number;
  lengthKm: number;
  speedKph: number;
  roadClass: string;
  surface: string;
  use: string;
  bridge: boolean;
  tunnel: boolean;
  toll: boolean;
}

export interface Trace {
  shape: LonLat[];
  edges: TraceEdge[];
}

interface ValhallaTraceResponse {
  shape: string;
  edges: {
    begin_shape_index: number;
    end_shape_index: number;
    length?: number;
    speed?: number;
    road_class?: string;
    surface?: string;
    use?: string;
    bridge?: boolean;
    tunnel?: boolean;
    toll?: boolean;
  }[];
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  requestJson<T>(`${VALHALLA_URL}${path}`, {
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    retries: 1,
  });

export const assertValhallaReachable = async (): Promise<void> => {
  try {
    await requestJson(`${VALHALLA_URL}/status`, { retries: 0 });
  } catch (error) {
    throw new Error(
      `Valhalla is not reachable at ${VALHALLA_URL} (${(error as Error).message}).\n` +
        'Start it with `docker compose -f valhalla/docker-compose.yml up -d` and wait for the ' +
        'tile build to finish (see valhalla/README.md), or set VALHALLA_URL.',
      { cause: error },
    );
  }
};

/**
 * The fastest drive from `from` to `to`, avoiding roads closed in winter.
 *
 * The closures go in as `exclude_polygons`: Valhalla's OSM data does not know a road shuts every
 * winter, and would otherwise happily send a February drive over a pass that is under snow until
 * April.
 */
export const route = async (
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  closures: WinterClosure[],
): Promise<Route> => {
  const response = await post<ValhallaRouteResponse>('/route', {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: 'auto',
    units: 'kilometers',
    directions_type: 'none',
    exclude_polygons: closures.map((closure) => closure.polygon),
  });
  const { summary, legs } = response.trip;
  return {
    distanceKm: summary.length,
    durationS: summary.time,
    hasToll: summary.has_toll,
    hasFerry: summary.has_ferry,
    encodedShape: legs[0].shape,
  };
};

const TRACE_ATTRIBUTES = [
  'shape',
  'edge.begin_shape_index',
  'edge.end_shape_index',
  'edge.length',
  'edge.speed',
  'edge.road_class',
  'edge.surface',
  'edge.use',
  'edge.bridge',
  'edge.tunnel',
  'edge.toll',
];

/**
 * The road under each stretch of a route: class, surface, bridge, tunnel, speed.
 *
 * `edge_walk` follows the given line edge by edge, which is exact for a line Valhalla itself just
 * produced. It is retried as `map_snap` only if the walk fails, which happens when the graph has
 * been rebuilt since the line was made.
 */
export const traceAttributes = async (encodedShape: string): Promise<Trace> => {
  const call = (shapeMatch: string) =>
    post<ValhallaTraceResponse>('/trace_attributes', {
      encoded_polyline: encodedShape,
      shape_match: shapeMatch,
      costing: 'auto',
      filters: { attributes: TRACE_ATTRIBUTES, action: 'include' },
    });
  let response: ValhallaTraceResponse;
  try {
    response = await call('edge_walk');
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (/exceeded|limit/i.test(error.body)) {
      throw new Error(
        `Valhalla refused the trace as too long: ${error.body}\n` +
          'Raise service_limits.trace.max_distance and max_shape in ' +
          'valhalla/custom_files/valhalla.json (see valhalla/README.md).',
        { cause: error },
      );
    }
    response = await call('map_snap');
  }
  return {
    shape: decodePolyline6(response.shape),
    edges: response.edges.map((edge) => ({
      beginShapeIndex: edge.begin_shape_index,
      endShapeIndex: edge.end_shape_index,
      lengthKm: edge.length ?? 0,
      speedKph: edge.speed ?? 40,
      roadClass: edge.road_class ?? 'unclassified',
      surface: edge.surface ?? 'paved',
      use: edge.use ?? 'road',
      bridge: edge.bridge ?? false,
      tunnel: edge.tunnel ?? false,
      toll: edge.toll ?? false,
    })),
  };
};
