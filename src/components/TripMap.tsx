import { useEffect, useMemo, useRef, useState, type FC, type Ref } from 'react';
import {
  AIRPORT,
  DESTINATIONS,
  getDestination,
  loadFerryGeometry,
  loadLegGeometry,
  loadTrainGeometry,
} from '@/data/dataset';
import { legsOf, stopsOf } from '@/lib/plan';
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_LABELS,
  FERRY_COLOR,
  KIND_COLORS,
  KIND_LABELS,
  SERVICE_COLORS,
  SERVICE_LABELS,
} from '@/lib/styles';
import { TripMapController, type MapLeg, type MapStop } from '@/lib/tripMapController';
import { usePlanStore, useTrip } from '@/store/planStore';
import {
  legKey,
  type Difficulty,
  type FerryGeometry,
  type LegGeometry,
  type RailService,
  type TrainGeometry,
  type TransportMode,
} from '@/types/data';

const SERVICES: RailService[] = ['shinkansen', 'local'];

/** Lines are kept per mode: the same pair of places has one line by road, another by train or ferry. */
const geometryKey = (mode: TransportMode, from: string, to: string) =>
  `${mode}:${legKey(from, to)}`;

const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4, 5];

const Legend: FC<{ ref: Ref<HTMLDivElement> }> = ({ ref }) => (
  <div
    ref={ref}
    className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 rounded-lg border border-base-300 bg-base-100/85 px-2 py-1.5 text-[11px] backdrop-blur"
  >
    <div className="flex items-center gap-2">
      {DIFFICULTIES.map((difficulty) => (
        <span
          key={difficulty}
          className="inline-flex items-center gap-1"
          title={DIFFICULTY_LABELS[difficulty]}
        >
          <span
            className="h-1 w-3 rounded"
            style={{ backgroundColor: DIFFICULTY_COLORS[difficulty] }}
          />
          {difficulty}
        </span>
      ))}
      <span className="text-base-content/50">difficulty</span>
    </div>
    <div className="flex items-center gap-2">
      {SERVICES.map((service) => (
        <span key={service} className="inline-flex items-center gap-1">
          <span className="h-1 w-3 rounded" style={{ backgroundColor: SERVICE_COLORS[service] }} />
          {SERVICE_LABELS[service]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full border-2 border-amber-400" />
        Change
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="w-3 border-t-[3px] border-dotted" style={{ borderColor: FERRY_COLOR }} />
        Ferry
      </span>
    </div>
    <div className="flex items-center gap-2">
      {(['city', 'onsen'] as const).map((kind) => (
        <span key={kind} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: KIND_COLORS[kind] }} />
          {KIND_LABELS[kind]}
        </span>
      ))}
    </div>
  </div>
);

/** The plan on a map: stops numbered in order, drives coloured by difficulty, trains by service, ferries cyan. */
const TripMap: FC = () => {
  const trip = useTrip();
  const { plan } = trip;
  const highlightedLeg = usePlanStore((state) => state.highlightedLeg);
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<TripMapController | null>(null);
  const [geometries, setGeometries] = useState<
    Map<string, LegGeometry | TrainGeometry | FerryGeometry | null>
  >(new Map());

  const legs = useMemo(() => legsOf(trip), [trip]);
  const stops = useMemo((): MapStop[] => {
    const orders = new Map<string, string[]>();
    stopsOf(plan).forEach((stop, i) => {
      orders.set(stop.destinationId, [...(orders.get(stop.destinationId) ?? []), String(i + 1)]);
    });
    const planned = [...orders.entries()].flatMap(([id, order]) => {
      const destination = getDestination(id);
      return destination ? [{ destination, orders: order }] : [];
    });
    return planned.length > 0 ? [{ destination: AIRPORT, orders: [] }, ...planned] : [];
  }, [plan]);

  useEffect(() => {
    const controller = new TripMapController(
      containerRef.current!,
      setHighlightedLeg,
      () => legendRef.current?.offsetHeight ?? 0,
    );
    controllerRef.current = controller;
    const observer = new ResizeObserver(() => controller.updateSize());
    observer.observe(containerRef.current!);
    return () => {
      observer.disconnect();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [setHighlightedLeg]);

  useEffect(() => {
    const planned = new Set(stops.map((stop) => stop.destination.id));
    controllerRef.current?.setCandidates(
      DESTINATIONS.filter((destination) => !planned.has(destination.id)),
    );
    controllerRef.current?.setStops(stops);
  }, [stops]);

  // Lines load lazily, a chunk per leg; each arrival redraws the route with what is in so far.
  useEffect(() => {
    let cancelled = false;
    for (const { from, to, mode } of legs) {
      const key = geometryKey(mode, from, to);
      if (geometries.has(key)) continue;
      const load =
        mode === 'train'
          ? loadTrainGeometry
          : mode === 'ferry'
            ? loadFerryGeometry
            : loadLegGeometry;
      load(from, to).then((geometry: LegGeometry | TrainGeometry | FerryGeometry | null) => {
        if (!cancelled) setGeometries((current) => new Map(current).set(key, geometry));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [legs, geometries]);

  useEffect(() => {
    const mapLegs: MapLeg[] = legs.flatMap((planned): MapLeg[] => {
      const geometry = geometries.get(geometryKey(planned.mode, planned.from, planned.to)) ?? null;
      if (planned.mode === 'train' && planned.train) {
        return [
          {
            mode: 'train',
            index: planned.index,
            train: planned.train,
            geometry: geometry as TrainGeometry | null,
          },
        ];
      }
      if (planned.mode === 'ferry' && planned.ferry) {
        return [
          {
            mode: 'ferry',
            index: planned.index,
            ferry: planned.ferry,
            geometry: geometry as FerryGeometry | null,
          },
        ];
      }
      const from = getDestination(planned.from);
      const to = getDestination(planned.to);
      if (!from || !to || !planned.road) return [];
      return [
        {
          mode: 'road',
          index: planned.index,
          from,
          to,
          geometry: geometry as LegGeometry | null,
          difficulty: planned.road.difficulty,
        },
      ];
    });
    controllerRef.current?.setLegs(mapLegs);
  }, [legs, geometries]);

  useEffect(() => {
    controllerRef.current?.setHighlightedLeg(highlightedLeg);
  }, [highlightedLeg]);

  return (
    <section className="relative min-h-[360px] overflow-hidden rounded-xl border border-base-300 bg-base-300">
      <div ref={containerRef} className="absolute inset-0" />
      <Legend ref={legendRef} />
    </section>
  );
};

export default TripMap;
