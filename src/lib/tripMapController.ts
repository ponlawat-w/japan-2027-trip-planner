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
import { DIFFICULTY_COLORS, KIND_COLORS } from '@/lib/styles';
import type { Destination, Difficulty, LegGeometry } from '@/types/data';

/** Japan's main islands, for the first view before anything is planned. */
const JAPAN_CENTER = fromLonLat([137.5, 36.2]);
const MAX_FIT_ZOOM = 10;
/** Zoomed in further than this (metres per pixel), unplanned destinations are labelled too. */
const CANDIDATE_LABEL_RESOLUTION = 1500;
const HOVER_TOLERANCE_PX = 6;

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

export interface MapLeg {
  index: number;
  from: Destination;
  to: Destination;
  /** Null until loaded, or when the leg has not been computed: drawn as a dashed straight line. */
  geometry: LegGeometry | null;
  difficulty: Difficulty;
}

/**
 * The trip map: every destination, the planned stops in order, and the route coloured by
 * difficulty.
 *
 * Imperative behind a small React wrapper, the same split as the streetview platform's maps:
 * OpenLayers owns its own render loop, and is told what changed rather than re-created.
 */
export class TripMapController {
  private readonly map: Map;
  private readonly candidateSource = new VectorSource();
  private readonly routeSource = new VectorSource();
  private readonly stopSource = new VectorSource();
  private readonly routeLayer: VectorLayer<VectorSource>;
  private highlightedLeg: number | null = null;
  private fittedKey = '';

  constructor(target: HTMLElement, onHoverLeg: (index: number | null) => void) {
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
    const features: Feature[] = [];
    for (const leg of legs) {
      if (leg.geometry) {
        for (const section of leg.geometry.sections) {
          features.push(
            new Feature({
              geometry: new LineString(
                decodePolyline6(section.line).map((coordinate) => fromLonLat(coordinate)),
              ),
              legIndex: leg.index,
              difficulty: section.difficulty,
            }),
          );
        }
      } else {
        features.push(
          new Feature({
            geometry: new LineString([
              fromLonLat([leg.from.lon, leg.from.lat]),
              fromLonLat([leg.to.lon, leg.to.lat]),
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
      padding: [48, 48, 48, 48],
      maxZoom: MAX_FIT_ZOOM,
      duration: 400,
    });
  }

  private routeStyle(feature: FeatureLike): Style[] {
    const index = feature.get('legIndex') as number;
    const difficulty = feature.get('difficulty') as Difficulty;
    const estimated = !!feature.get('estimated');
    const isHighlighted = this.highlightedLeg === index;
    const isDimmed = this.highlightedLeg !== null && !isHighlighted;
    const width = isHighlighted ? 6 : 4;
    const color = DIFFICULTY_COLORS[difficulty];
    return [
      new Style({
        stroke: new Stroke({ color: `rgba(0, 0, 0, ${isDimmed ? 0.3 : 0.75})`, width: width + 3 }),
        zIndex: isHighlighted ? 2 : 0,
      }),
      new Style({
        stroke: new Stroke({
          color: isDimmed ? `${color}55` : color,
          width,
          lineDash: estimated ? [8, 8] : undefined,
          lineCap: 'round',
          lineJoin: 'round',
        }),
        zIndex: isHighlighted ? 3 : 1,
      }),
    ];
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
