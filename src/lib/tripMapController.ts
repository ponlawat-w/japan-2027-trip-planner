import Map from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { defaults as defaultControls } from 'ol/control/defaults';
import type { FeatureLike } from 'ol/Feature';
import { decodePolyline6 } from '@/lib/polyline';
import { DIFFICULTY_COLORS, FERRY_COLOR, KIND_COLORS, SERVICE_COLORS } from '@/lib/styles';
import type {
  Destination,
  Difficulty,
  FerryGeometry,
  FerryLeg,
  LegGeometry,
  RailService,
  TrainGeometry,
  TrainLeg,
} from '@/types/data';

/** Japan's main islands, for the first view before anything is planned. */
const JAPAN_CENTER = fromLonLat([137.5, 36.2]);
const MAX_FIT_ZOOM = 10;
/** Zoomed in further than this (metres per pixel), unplanned destinations are labelled too. */
const CANDIDATE_LABEL_RESOLUTION = 1500;
const HOVER_TOLERANCE_PX = 6;
/** Room between the legend's top and the lowest stop, its label included. */
const LEGEND_CLEARANCE_PX = 32;

const LABEL_FONT = '600 12px ui-sans-serif, system-ui, sans-serif';
const HALO = new Stroke({ color: 'rgba(10, 12, 16, 0.9)', width: 3 });

const ESRI_ATTRIBUTION = 'Esri, HERE, Garmin, © OpenStreetMap contributors';

/**
 * Esri's Dark Gray Canvas, as two layers: the muted base, and its labels drawn above the route so
 * place names stay readable over a line passing through them. No API key, from the same Esri host
 * the streetview platform's satellite basemap uses.
 */
const createEsriCanvas = (layer: 'Base' | 'Reference'): XYZ =>
  new XYZ({
    url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_${layer}/MapServer/tile/{z}/{y}/{x}`,
    attributions: layer === 'Base' ? ESRI_ATTRIBUTION : undefined,
    maxZoom: 16,
  });

export interface MapStop {
  destination: Destination;
  /** The stop's place(s) in the visiting order, e.g. ["1", "9"] for a place visited twice. */
  orders: string[];
}

export type MapLeg =
  | {
      mode: 'road';
      index: number;
      from: Destination;
      to: Destination;
      /** Null until loaded, or when the leg has not been computed: drawn as a dashed straight line. */
      geometry: LegGeometry | null;
      difficulty: Difficulty;
    }
  | {
      mode: 'train';
      index: number;
      train: TrainLeg;
      /** Null until loaded: each ride is drawn station to station meanwhile. */
      geometry: TrainGeometry | null;
    }
  | {
      mode: 'ferry';
      index: number;
      ferry: FerryLeg;
      /** Null until loaded: the crossing is drawn pier to pier meanwhile. */
      geometry: FerryGeometry | null;
    };

/**
 * The trip map: every destination, the planned stops in order, drives coloured by difficulty,
 * trains by service with the stations they stop at, and ferries' crossings with their piers. A train leg ends at its own station, which may
 * be off the destination's point (Shin-Osaka for Osaka): only the drive goes to the door.
 *
 * Imperative behind a small React wrapper, the same split as the streetview platform's maps:
 * OpenLayers owns its own render loop, and is told what changed rather than re-created.
 */
export class TripMapController {
  private readonly map: Map;
  private readonly candidateSource = new VectorSource();
  private readonly routeSource = new VectorSource();
  private readonly stationSource = new VectorSource();
  private readonly stopSource = new VectorSource();
  private readonly routeLayer: VectorLayer<VectorSource>;
  private highlightedLeg: number | null = null;
  private fittedKey = '';

  /**
   * @param legendHeight The height of whatever sits over the map's bottom edge (the legend), read
   *   at each fit so the stops are framed above it rather than under it.
   */
  constructor(
    target: HTMLElement,
    onHoverLeg: (index: number | null) => void,
    private readonly legendHeight: () => number = () => 0,
  ) {
    this.routeLayer = new VectorLayer({
      source: this.routeSource,
      style: (feature) => this.routeStyle(feature),
      updateWhileInteracting: true,
    });
    this.map = new Map({
      target,
      controls: defaultControls({ rotate: false, attributionOptions: { collapsible: true } }),
      layers: [
        new TileLayer({ source: createEsriCanvas('Base') }),
        new VectorLayer({
          source: this.candidateSource,
          style: (feature, resolution) => this.candidateStyle(feature, resolution),
        }),
        this.routeLayer,
        new TileLayer({ source: createEsriCanvas('Reference'), opacity: 0.8 }),
        new VectorLayer({
          source: this.stationSource,
          style: (feature) => this.stationStyle(feature),
          declutter: true,
        }),
        new VectorLayer({
          source: this.stopSource,
          style: (feature) => this.stopStyle(feature),
        }),
      ],
      view: new View({ center: JAPAN_CENTER, zoom: 6, minZoom: 4, maxZoom: 16 }),
    });

    this.map.on('pointermove', (event) => {
      if (event.dragging) return;
      let hovered: number | null = null;
      this.map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => {
          hovered = feature.get('legIndex') as number;
          return true;
        },
        { layerFilter: (layer) => layer === this.routeLayer, hitTolerance: HOVER_TOLERANCE_PX },
      );
      target.style.cursor = hovered !== null ? 'pointer' : '';
      onHoverLeg(hovered);
    });
  }

  dispose(): void {
    this.map.setTarget(undefined);
  }

  setCandidates(destinations: Destination[]): void {
    this.candidateSource.clear();
    this.candidateSource.addFeatures(
      destinations.map(
        (destination) =>
          new Feature({
            geometry: new Point(fromLonLat([destination.lon, destination.lat])),
            name: destination.name,
          }),
      ),
    );
  }

  setStops(stops: MapStop[]): void {
    this.stopSource.clear();
    this.stopSource.addFeatures(
      stops.map(
        ({ destination, orders }) =>
          new Feature({
            geometry: new Point(fromLonLat([destination.lon, destination.lat])),
            name: destination.name,
            kind: destination.kind,
            orders: orders.join('·'),
          }),
      ),
    );
    this.fitStops(stops);
  }

  setLegs(legs: MapLeg[]): void {
    this.routeSource.clear();
    this.stationSource.clear();
    const features: Feature[] = [];
    const line = (coordinates: [number, number][]) =>
      new LineString(coordinates.map((coordinate) => fromLonLat(coordinate)));
    for (const leg of legs) {
      if (leg.mode === 'train') {
        features.push(...this.trainFeatures(leg));
      } else if (leg.mode === 'ferry') {
        features.push(...this.ferryFeatures(leg));
      } else if (leg.geometry) {
        for (const section of leg.geometry.sections) {
          features.push(
            new Feature({
              geometry: line(decodePolyline6(section.line)),
              legIndex: leg.index,
              difficulty: section.difficulty,
            }),
          );
        }
      } else {
        features.push(
          new Feature({
            geometry: line([
              [leg.from.lon, leg.from.lat],
              [leg.to.lon, leg.to.lat],
            ]),
            legIndex: leg.index,
            difficulty: leg.difficulty,
            estimated: true,
          }),
        );
      }
    }
    this.routeSource.addFeatures(features);
  }

  /** A train leg's rides, and a ring at each station it stops at, labelled where trains change. */
  private trainFeatures(leg: Extract<MapLeg, { mode: 'train' }>): Feature[] {
    const { segments } = leg.train;
    const features = segments.map((segment, i) => {
      const section = leg.geometry?.sections[i];
      const coordinates: [number, number][] = section
        ? decodePolyline6(section.line)
        : [
            [segment.from.lon, segment.from.lat],
            [segment.to.lon, segment.to.lat],
          ];
      return new Feature({
        geometry: new LineString(coordinates.map((coordinate) => fromLonLat(coordinate))),
        legIndex: leg.index,
        service: segment.service,
        estimated: !section,
      });
    });
    const stations = [
      { station: segments[0].from, change: false },
      ...segments.map((segment, i) => ({ station: segment.to, change: i < segments.length - 1 })),
    ];
    this.stationSource.addFeatures(
      stations.map(
        ({ station, change }) =>
          new Feature({
            geometry: new Point(fromLonLat([station.lon, station.lat])),
            label: change ? `Change · ${station.name}` : '',
            change,
          }),
      ),
    );
    return features;
  }

  /** A ferry leg's drive by difficulty and its crossing, with a labelled ring at each pier. */
  private ferryFeatures(leg: Extract<MapLeg, { mode: 'ferry' }>): Feature[] {
    const { crossing } = leg.ferry;
    const toLine = (coordinates: [number, number][]) =>
      new LineString(coordinates.map((coordinate) => fromLonLat(coordinate)));
    const features = leg.geometry
      ? leg.geometry.sections.map(
          (section) =>
            new Feature({
              geometry: toLine(decodePolyline6(section.line)),
              legIndex: leg.index,
              ...(section.mode === 'sea' ? { sea: true } : { difficulty: section.difficulty }),
            }),
        )
      : [
          new Feature({
            geometry: toLine([
              [crossing.from.lon, crossing.from.lat],
              [crossing.to.lon, crossing.to.lat],
            ]),
            legIndex: leg.index,
            sea: true,
          }),
        ];
    this.stationSource.addFeatures(
      [crossing.from, crossing.to].map(
        (port) =>
          new Feature({
            geometry: new Point(fromLonLat([port.lon, port.lat])),
            label: port.name,
            port: true,
          }),
      ),
    );
    return features;
  }

  setHighlightedLeg(index: number | null): void {
    if (index === this.highlightedLeg) return;
    this.highlightedLeg = index;
    this.routeLayer.changed();
  }

  /** The map's size changed from outside (a layout switch): OpenLayers does not watch for it. */
  updateSize(): void {
    this.map.updateSize();
  }

  /**
   * Frames the planned stops, but only when the set of places changes: reordering or resizing a
   * stay redraws the route without yanking the view away from wherever it was panned.
   */
  private fitStops(stops: MapStop[]): void {
    const key = stops
      .map((stop) => stop.destination.id)
      .sort()
      .join(',');
    if (key === this.fittedKey || stops.length === 0) return;
    this.fittedKey = key;
    const extent = boundingExtent(
      stops.map(({ destination }) => fromLonLat([destination.lon, destination.lat])),
    );
    this.map.getView().fit(extent, {
      // Extra room on the right, where every stop hangs its name: the east-most label stays in
      // view; and at the bottom, clear of the legend.
      padding: [48, 110, Math.max(48, this.legendHeight() + LEGEND_CLEARANCE_PX), 48],
      maxZoom: MAX_FIT_ZOOM,
      duration: 400,
    });
  }

  private routeStyle(feature: FeatureLike): Style[] {
    const index = feature.get('legIndex') as number;
    const service = feature.get('service') as RailService | undefined;
    const sea = !!feature.get('sea');
    const estimated = !!feature.get('estimated');
    const isHighlighted = this.highlightedLeg === index;
    const isDimmed = this.highlightedLeg !== null && !isHighlighted;
    const width = isHighlighted ? 6 : 4;
    const color = sea
      ? FERRY_COLOR
      : service
        ? SERVICE_COLORS[service]
        : DIFFICULTY_COLORS[feature.get('difficulty') as Difficulty];
    return [
      new Style({
        stroke: new Stroke({ color: `rgba(0, 0, 0, ${isDimmed ? 0.3 : 0.75})`, width: width + 3 }),
        zIndex: isHighlighted ? 2 : 0,
      }),
      new Style({
        stroke: new Stroke({
          color: isDimmed ? `${color}55` : color,
          width,
          // A crossing is dotted, apart from both a drive and a line not yet computed (dashed).
          lineDash: sea ? [1, 9] : estimated ? [8, 8] : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }),
        zIndex: isHighlighted ? 3 : 1,
      }),
    ];
  }

  /** Train stations (amber where trains change, labelled) and ferry piers (cyan, labelled). */
  private stationStyle(feature: FeatureLike): Style {
    const change = !!feature.get('change');
    const port = !!feature.get('port');
    const accent = port ? FERRY_COLOR : change ? '#fbbf24' : '#f8fafc';
    return new Style({
      image: new Circle({
        radius: change || port ? 5 : 4,
        fill: new Fill({ color: '#0b0d12' }),
        stroke: new Stroke({ color: accent, width: 2 }),
      }),
      text:
        change || port
          ? new Text({
              text: feature.get('label') as string,
              font: '600 11px ui-sans-serif, system-ui, sans-serif',
              offsetY: -13,
              fill: new Fill({ color: accent }),
              stroke: HALO,
            })
          : undefined,
    });
  }

  /** The order number on the marker itself, the name hanging off to its right. */
  private stopStyle(feature: FeatureLike): Style[] {
    const kind = feature.get('kind') as Destination['kind'];
    const isAirport = kind === 'airport';
    const radius = isAirport ? 9 : 11;
    return [
      new Style({
        image: new Circle({
          radius,
          fill: new Fill({ color: KIND_COLORS[kind] }),
          stroke: new Stroke({ color: '#0b0d12', width: 2 }),
        }),
        text: new Text({
          text: isAirport ? '✈' : (feature.get('orders') as string),
          font: 'bold 11px ui-sans-serif, system-ui, sans-serif',
          fill: new Fill({ color: '#0b0d12' }),
        }),
        zIndex: isAirport ? 1 : 2,
      }),
      new Style({
        text: new Text({
          text: feature.get('name') as string,
          font: LABEL_FONT,
          textAlign: 'left',
          offsetX: radius + 5,
          fill: new Fill({ color: '#f1f5f9' }),
          stroke: HALO,
        }),
        zIndex: isAirport ? 1 : 2,
      }),
    ];
  }

  private candidateStyle(feature: FeatureLike, resolution: number): Style {
    return new Style({
      image: new Circle({
        radius: 4,
        fill: new Fill({ color: 'rgba(148, 163, 184, 0.55)' }),
        stroke: new Stroke({ color: 'rgba(10, 12, 16, 0.8)', width: 1 }),
      }),
      text:
        resolution < CANDIDATE_LABEL_RESOLUTION
          ? new Text({
              text: feature.get('name') as string,
              font: '11px ui-sans-serif, system-ui, sans-serif',
              offsetY: 12,
              fill: new Fill({ color: 'rgba(148, 163, 184, 0.9)' }),
              stroke: HALO,
            })
          : undefined,
    });
  }
}
