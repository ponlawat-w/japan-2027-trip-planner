import { execFile } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { LonLat } from '../src/lib/polyline.ts';
import { haversineM } from './geo.ts';
import { CACHE_DIR, ROOT } from './store.ts';

/**
 * Railway track from OpenStreetMap, for drawing train legs along the real line.
 *
 * Read from the Japan extract Valhalla already downloaded, not from Overpass: the public Overpass
 * servers time out often enough to make a run unrepeatable. `osmium` cuts the railways out once
 * (about 10 s), and the result is cached under `.cache/rail/`.
 */

const OSM_PBF =
  process.env.OSM_PBF ?? path.join(ROOT, 'valhalla', 'custom_files', 'japan-latest.osm.pbf');
const RAIL_DIR = path.join(CACHE_DIR, 'rail');
const RAIL_PBF = path.join(RAIL_DIR, 'japan-rail.osm.pbf');
const RAIL_LINES = path.join(RAIL_DIR, 'japan-rail.geojsonseq');

/** Way ends closer than this to another way are joined: OSM's lines do not always share a node. */
const BRIDGE_M = 30;
/**
 * How far from a station its track may start. Big stations spread over a few hundred metres, and
 * the vertex nearest the station's point is often a platform track OSM leaves unconnected.
 */
const SNAP_M = 400;
/** Each metre between a station and where its track starts counts as this much track. */
const SNAP_WEIGHT = 5;

interface RailWay {
  name: string;
  highspeed: boolean;
  line: LonLat[];
}

const run = promisify(execFile);
const RECORD_SEPARATOR = String.fromCharCode(0x1e);

const extractRailways = async (): Promise<void> => {
  if (!existsSync(OSM_PBF)) {
    throw new Error(
      `No OSM extract at ${OSM_PBF}. Start Valhalla once to download it (valhalla/README.md), ` +
        'or set OSM_PBF.',
    );
  }
  await mkdir(RAIL_DIR, { recursive: true });
  console.log('Extracting railways from the OSM file (once)…');
  try {
    await run('osmium', ['tags-filter', OSM_PBF, 'w/railway=rail', '-o', RAIL_PBF, '--overwrite']);
    await run('osmium', ['export', RAIL_PBF, '-f', 'geojsonseq', '-o', RAIL_LINES, '--overwrite']);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('osmium is not installed: `brew install osmium-tool`.', { cause: error });
    }
    throw error;
  }
};

let ways: Promise<RailWay[]> | undefined;

/** Every running line in Japan: yards, sidings and crossovers are left out. */
const loadRailWays = (): Promise<RailWay[]> => {
  ways ??= (async () => {
    if (!existsSync(RAIL_LINES)) await extractRailways();
    const result: RailWay[] = [];
    const lines = createInterface({ input: createReadStream(RAIL_LINES, 'utf8') });
    for await (const raw of lines) {
      // GeoJSON text sequences start every record with a record separator (U+001E).
      const feature = JSON.parse(raw.startsWith(RECORD_SEPARATOR) ? raw.slice(1) : raw) as {
        geometry: { type: string; coordinates: LonLat[] };
        properties: Record<string, string | undefined>;
      };
      const { geometry, properties } = feature;
      if (geometry.type !== 'LineString' || properties.service) continue;
      result.push({
        name: properties.name ?? '',
        highspeed: properties.highspeed === 'yes',
        line: geometry.coordinates,
      });
    }
    return result;
  })();
  return ways;
};

/** Which ways a ride may run on: a line-name pattern, and whether it must be high-speed track. */
export interface TrackFilter {
  track: string;
  highspeed?: boolean;
}

/** A small binary min-heap of node indices, ordered by `cost`. */
class Heap {
  private readonly items: number[] = [];
  constructor(private readonly cost: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(item: number): void {
    const { items, cost } = this;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (cost[items[parent]] <= cost[items[i]]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): number {
    const { items, cost } = this;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && cost[items[left]] < cost[items[smallest]]) smallest = left;
        if (right < items.length && cost[items[right]] < cost[items[smallest]]) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

/** The track network of the lines a filter allows, as a graph of OSM vertices. */
class TrackGraph {
  private readonly points: LonLat[] = [];
  private readonly edges: { to: number; m: number }[][] = [];
  private readonly ids = new Map<string, number>();
  private readonly grid = new Map<string, number[]>();

  constructor(ways: RailWay[]) {
    const ends: { node: number; way: number }[] = [];
    ways.forEach((way, wayIndex) => {
      const nodes = way.line.map((point) => this.node(point));
      for (let i = 1; i < nodes.length; i++) this.link(nodes[i - 1], nodes[i]);
      ends.push(
        { node: nodes[0], way: wayIndex },
        { node: nodes[nodes.length - 1], way: wayIndex },
      );
    });
    // Dead ends next to another line are almost always a gap in the mapping, not in the track.
    for (const { node } of ends) {
      if (this.edges[node].length !== 1) continue;
      const near = this.nearest(this.points[node], BRIDGE_M, (other) => {
        return other !== node && !this.edges[node].some((edge) => edge.to === other);
      });
      if (near !== null) this.link(node, near);
    }
  }

  private static cell([lon, lat]: LonLat): string {
    return `${Math.floor(lon * 1000)},${Math.floor(lat * 1000)}`;
  }

  private node(point: LonLat): number {
    const key = `${point[0]},${point[1]}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = this.points.length;
      this.ids.set(key, id);
      this.points.push(point);
      this.edges.push([]);
      const cell = TrackGraph.cell(point);
      this.grid.set(cell, [...(this.grid.get(cell) ?? []), id]);
    }
    return id;
  }

  private link(a: number, b: number): void {
    if (a === b) return;
    const m = haversineM(this.points[a], this.points[b]);
    this.edges[a].push({ to: b, m });
    this.edges[b].push({ to: a, m });
  }

  /** Every vertex within `maxM` of the point, with its distance, from the grid cells around it. */
  within(point: LonLat, maxM: number): { node: number; m: number }[] {
    const reach = Math.ceil(maxM / 90) + 1;
    const [cx, cy] = [Math.floor(point[0] * 1000), Math.floor(point[1] * 1000)];
    const found: { node: number; m: number }[] = [];
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (const node of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const m = haversineM(point, this.points[node]);
          if (m <= maxM) found.push({ node, m });
        }
      }
    }
    return found;
  }

  private nearest(point: LonLat, maxM: number, accept: (node: number) => boolean): number | null {
    let best: { node: number; m: number } | null = null;
    for (const candidate of this.within(point, maxM)) {
      if (accept(candidate.node) && (!best || candidate.m < best.m)) best = candidate;
    }
    return best?.node ?? null;
  }

  /**
   * Dijkstra over track length, from any vertex near one station to any vertex near the other.
   * Starting and ending a little off the station costs extra, so the track through the station
   * wins whenever it is connected, and a dead-end platform track nearby never strands the search.
   */
  shortestPath(from: LonLat, to: LonLat): LonLat[] | null {
    const cost = new Float64Array(this.points.length).fill(Infinity);
    const previous = new Int32Array(this.points.length).fill(-1);
    const heap = new Heap(cost);
    for (const { node, m } of this.within(from, SNAP_M)) {
      cost[node] = m * SNAP_WEIGHT;
      heap.push(node);
    }
    const arrival = new Map(this.within(to, SNAP_M).map(({ node, m }) => [node, m * SNAP_WEIGHT]));
    let best = -1;
    let bestCost = Infinity;
    while (heap.size > 0) {
      const node = heap.pop();
      if (cost[node] >= bestCost) break;
      const end = arrival.get(node);
      if (end !== undefined && cost[node] + end < bestCost) {
        best = node;
        bestCost = cost[node] + end;
      }
      for (const { to: next, m } of this.edges[node]) {
        const candidate = cost[node] + m;
        if (candidate < cost[next]) {
          cost[next] = candidate;
          previous[next] = node;
          heap.push(next);
        }
      }
    }
    if (best < 0) return null;
    const path: LonLat[] = [];
    for (let node = best; node !== -1; node = previous[node]) path.push(this.points[node]);
    return path.reverse();
  }
}

/**
 * The track from one station to another, on the lines the filter allows.
 *
 * Shortest by length, which on a single named line is simply that line. Only the allowed lines
 * are in the graph, so a station on two operators' lines starts on the right one.
 */
export const trackBetween = async (
  from: { name: string; lat: number; lon: number },
  to: { name: string; lat: number; lon: number },
  filter: TrackFilter,
): Promise<LonLat[]> => {
  const pattern = new RegExp(filter.track);
  const allowed = (await loadRailWays()).filter(
    (way) => pattern.test(way.name) && (!filter.highspeed || way.highspeed),
  );
  if (allowed.length === 0) throw new Error(`no railway in OSM matches /${filter.track}/`);
  const graph = new TrackGraph(allowed);
  for (const station of [from, to]) {
    if (graph.within([station.lon, station.lat], SNAP_M).length === 0) {
      throw new Error(`${station.name} is not within ${SNAP_M} m of /${filter.track}/`);
    }
  }
  const path = graph.shortestPath([from.lon, from.lat], [to.lon, to.lat]);
  if (!path) {
    throw new Error(
      `/${filter.track}/ does not connect ${from.name} to ${to.name} in OSM: widen the pattern`,
    );
  }
  return path;
};
