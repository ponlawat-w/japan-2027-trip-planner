import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CalendarDays, CarFront, ChartGantt, Eraser, Plane } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FC, type PointerEvent } from 'react';
import CalendarGrid from '@/components/calendar/CalendarGrid';
import DestinationPicker, { type PickerRequest } from '@/components/DestinationPicker';
import StayDialog from '@/components/StayDialog';
import TravelDialog from '@/components/TravelDialog';
import DayHeader from '@/components/timeline/DayHeader';
import LegChip from '@/components/timeline/LegChip';
import EmptyStay from '@/components/timeline/EmptyStay';
import { RentalBar, RentalSlot, type RentalStripControls } from '@/components/timeline/RentalStrip';
import StayBlock from '@/components/timeline/StayBlock';
import { AIRPORT, getDestination } from '@/data/dataset';
import { useIsWide } from '@/hooks/useMediaQuery';
import {
  assignRange,
  canMoveStay,
  emptyPlan,
  isRentalDay,
  legsOf,
  moveStay,
  rentalBetween,
  rentalWith,
  resizeStayTo,
  staysOf,
  type Plan,
  type Rental,
  type Stay,
} from '@/lib/plan';
import { DAYS, FLIGHT_DAY } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import SegmentedControl from '@/ui/SegmentedControl';

/**
 * The trip as a row of days (a column on a phone), with stays spanning their nights, or as a month
 * calendar ({@link CalendarGrid}). Both views share everything here: the edits, the drags and the
 * dialogs. Only where things sit, and how a pointer position becomes a day, differ.
 *
 * One timeline grid serves both orientations: each item is placed by `place()`, which turns "nights 3–5" into
 * columns when wide and rows when narrow, so the two layouts cannot drift apart.
 */
const Timeline: FC = () => {
  const committed = usePlanStore((state) => state.plan);
  const setPlan = usePlanStore((state) => state.setPlan);
  const homeMode = usePlanStore((state) => state.homeMode);
  // While an edge is being dragged the timeline shows the resize live, and commits it (one undo
  // step) only on release. Everything below reads `plan`, the one on screen.
  const [preview, setPreview] = useState<Plan | null>(null);
  const plan = preview ?? committed;
  const gridRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide();
  const view = usePreferencesStore((state) => state.view);
  const setView = usePreferencesStore((state) => state.setView);
  const calendar = view === 'calendar';
  const stays = useMemo(() => staysOf(plan), [plan]);
  const committedRental = usePlanStore((state) => state.rental);
  const setRental = usePlanStore((state) => state.setRental);
  // Like `preview`: the rental as its edge is dragged, committed on release.
  const [rentalPreview, setRentalPreview] = useState<Rental | null>(null);
  const rental = rentalPreview ?? committedRental;
  const legs = useMemo(() => legsOf({ plan, homeMode, rental }), [plan, homeMode, rental]);
  const legsByDay = useMemo(() => new Map(legs.map((leg) => [leg.day, leg])), [legs]);
  // By index, so the dialog follows the leg as its mode changes underneath it.
  const [openLeg, setOpenLeg] = useState<number | null>(null);

  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [openNight, setOpenNight] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  // --- Choosing empty nights: a click picks one; a mouse drag sweeps a range. ------------------
  const [sweep, setSweep] = useState<{ anchor: number; current: number } | null>(null);

  useEffect(() => {
    if (!sweep) return;
    const finish = () => {
      setPicker({
        first: Math.min(sweep.anchor, sweep.current),
        last: Math.max(sweep.anchor, sweep.current),
      });
      setSweep(null);
    };
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [sweep]);

  const onNightPointerDown = (night: number, event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button === 0) {
      setSweep({ anchor: night, current: night });
    }
  };
  const onNightPointerEnter = (night: number) => {
    if (sweep) setSweep({ anchor: sweep.anchor, current: night });
  };
  // Touch and keyboard arrive here. A mouse click arrives too, after its one-night sweep has
  // already opened the same picker on release, which makes this a no-op for it.
  const onNightClick = (night: number) => {
    if (!sweep) setPicker({ first: night, last: night });
  };
  const isSwept = (night: number) =>
    !!sweep &&
    night >= Math.min(sweep.anchor, sweep.current) &&
    night <= Math.max(sweep.anchor, sweep.current);

  // --- Choosing the rental car's days: a mouse drag sweeps them; a click starts or extends. ---
  const [rentalSweep, setRentalSweep] = useState<{ anchor: number; current: number } | null>(null);

  useEffect(() => {
    if (!rentalSweep) return;
    const finish = () => {
      const { anchor, current } = rentalSweep;
      // A click without a drag adds its day, as a tap does; a drag sets the days it swept.
      setRental(
        anchor === current
          ? rentalWith(usePlanStore.getState().rental, anchor)
          : rentalBetween(anchor, current),
      );
      setRentalSweep(null);
    };
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [rentalSweep, setRental]);

  const isRentalSwept = (day: number) =>
    !!rentalSweep &&
    day >= Math.min(rentalSweep.anchor, rentalSweep.current) &&
    day <= Math.max(rentalSweep.anchor, rentalSweep.current);

  // --- Reordering by drag. ------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A held press, so a swipe across the timeline still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const onDragStart = (event: DragStartEvent) => setDragging(event.active.data.current?.index);
  const onDragEnd = (event: DragEndEvent) => {
    const from = event.active.data.current?.index as number | undefined;
    const to = event.over?.data.current?.index as number | undefined;
    setDragging(null);
    if (from !== undefined && to !== undefined && canMoveStay(stays, from, to)) {
      setPlan(moveStay(plan, from, to));
    }
  };

  // --- Resizing by dragging a stay's edge. ----------------------------------------------------
  /** The boundary between days nearest the pointer, measured off the day headers' positions. */
  const boundaryAt = (clientX: number, clientY: number): number => {
    const headers = [...gridRef.current!.querySelectorAll<HTMLElement>('[data-day]')];
    const rects = headers.map((header) => header.getBoundingClientRect());
    if (calendar) {
      // Days wrap from one week to the next, so no single axis orders them: take the day square
      // nearest the pointer, then the side of it the pointer is on.
      const distance = (rect: DOMRect) =>
        Math.hypot(
          Math.max(rect.left - clientX, 0, clientX - rect.right),
          Math.max(rect.top - clientY, 0, clientY - rect.bottom),
        );
      let nearest = 0;
      rects.forEach((rect, i) => {
        if (distance(rect) < distance(rects[nearest])) nearest = i;
      });
      const rect = rects[nearest];
      return Number(headers[nearest].dataset.day) + (clientX > rect.left + rect.width / 2 ? 1 : 0);
    }
    const edges = wide
      ? [...rects.map((rect) => rect.left), rects[rects.length - 1].right]
      : [...rects.map((rect) => rect.top), rects[rects.length - 1].bottom];
    const position = wide ? clientX : clientY;
    let nearest = 0;
    edges.forEach((edge, i) => {
      if (Math.abs(edge - position) < Math.abs(edges[nearest] - position)) nearest = i;
    });
    return nearest;
  };

  /** The day nearest the pointer, in any layout: the closest day header or square. */
  const dayAt = (clientX: number, clientY: number): number => {
    const headers = [...gridRef.current!.querySelectorAll<HTMLElement>('[data-day]')];
    const distance = (rect: DOMRect) =>
      Math.hypot(
        Math.max(rect.left - clientX, 0, clientX - rect.right),
        Math.max(rect.top - clientY, 0, clientY - rect.bottom),
      );
    const rects = headers.map((header) => header.getBoundingClientRect());
    let nearest = 0;
    rects.forEach((rect, i) => {
      if (distance(rect) < distance(rects[nearest])) nearest = i;
    });
    return Number(headers[nearest].dataset.day);
  };

  /**
   * Follows the pointer from an edge's grip until release: `onMove` with each position, then
   * `onEnd` with whether the gesture finished (rather than being cancelled).
   *
   * The pointer is captured by the grid, not by the grip: the block re-renders as it resizes, and
   * a grip that is replaced mid-drag would take the rest of the gesture with it.
   */
  const followEdge = (
    event: PointerEvent<HTMLElement>,
    onMove: (clientX: number, clientY: number) => void,
    onEnd: (finished: boolean) => void,
  ) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current!;
    grid.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      onMove(moveEvent.clientX, moveEvent.clientY);
    const finish = (endEvent: globalThis.PointerEvent) => {
      grid.removeEventListener('pointermove', move);
      grid.removeEventListener('pointerup', finish);
      grid.removeEventListener('pointercancel', finish);
      onEnd(endEvent.type === 'pointerup');
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', finish);
    grid.addEventListener('pointercancel', finish);
  };

  const startResize = (stay: Stay, edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => {
    const base = committed;
    let latest = base;
    followEdge(
      event,
      (x, y) => {
        latest = resizeStayTo(base, stay, edge, boundaryAt(x, y));
        setPreview(latest);
      },
      (finished) => {
        setPreview(null);
        if (finished) setPlan(latest);
      },
    );
  };

  /** Moves the rental's pick-up or return day to the day under the pointer, never past the other. */
  const startRentalResize = (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => {
    if (!committedRental) return;
    const base = committedRental;
    let latest = base;
    followEdge(
      event,
      (x, y) => {
        const day = dayAt(x, y);
        latest =
          edge === 'start'
            ? rentalBetween(Math.min(day, base.to), base.to)
            : rentalBetween(base.from, Math.max(day, base.from));
        setRentalPreview(latest);
      },
      (finished) => {
        setRentalPreview(null);
        if (finished) setRental(latest);
      },
    );
  };

  const rentalStrip: RentalStripControls = {
    rental,
    isSwept: isRentalSwept,
    onSlotPointerDown: (day, event) => {
      if (event.pointerType === 'mouse' && event.button === 0) {
        setRentalSweep({ anchor: day, current: day });
      }
    },
    onSlotPointerEnter: (day) => {
      if (rentalSweep) setRentalSweep({ anchor: rentalSweep.anchor, current: day });
    },
    // Touch and keyboard: a mouse click has already been handled by its sweep's release.
    onSlotClick: (day) => {
      if (!rentalSweep) setRental(rentalWith(committedRental, day));
    },
    onResizeStart: startRentalResize,
    onRemove: () => setRental(null),
  };

  /**
   * Where nights sit in the grid. Wide, each day is a column. On a phone each day is two rows: a
   * drive row (empty, so zero height, unless a drive arrives that day) and then the night itself,
   * so a drive appears between the stay it leaves and the stay it reaches.
   */
  const driveRow = (day: number) => 2 * day + 1;
  const nightRow = (day: number) => 2 * day + 2;
  const place = (start: number, span: number) =>
    wide
      ? { gridColumn: `${start + 1} / span ${span}`, gridRow: 2 }
      : { gridRow: `${nightRow(start)} / span ${2 * span - 1}`, gridColumn: 2 };
  /**
   * The rental strip: a row under the stays when wide, a narrow column beside them on a phone. A
   * day there takes its drive row too, since the drive that day is in the rental.
   */
  const placeRental = (from: number, to: number) =>
    wide
      ? { gridColumn: `${from + 1} / ${to + 2}`, gridRow: 3 }
      : { gridRow: `${driveRow(from)} / ${nightRow(to) + 1}`, gridColumn: 3 };

  const openStay = (stay: Stay) => setOpenNight(stay.start);
  const changeDestination = (stay: Stay) => {
    setOpenNight(null);
    setPicker({
      first: stay.start,
      last: stay.start + stay.nights - 1,
      currentId: stay.destinationId ?? undefined,
    });
  };

  const draggedStay = dragging !== null ? stays[dragging] : undefined;

  return (
    <section className="rounded-xl border border-base-300 bg-base-200/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="grow text-sm font-semibold uppercase tracking-wide text-base-content/60">
          {calendar ? 'Calendar' : 'Timeline'}
        </h2>
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            {
              value: 'timeline',
              label: (
                <>
                  <ChartGantt className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Timeline</span>
                </>
              ),
              title: 'Every day in one row',
            },
            {
              value: 'calendar',
              label: (
                <>
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Calendar</span>
                </>
              ),
              title: 'A month calendar, a week to a row',
            },
          ]}
        />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setPlan(emptyPlan())}
          disabled={committed.every((night) => night.destinationId === null)}
          title="Empty every night (undo brings them back)"
        >
          <Eraser className="h-4 w-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        {calendar ? (
          <CalendarGrid
            gridRef={gridRef}
            stays={stays}
            legsByDay={legsByDay}
            wide={wide}
            dragging={dragging}
            isSwept={isSwept}
            onNightPointerDown={onNightPointerDown}
            onNightPointerEnter={onNightPointerEnter}
            onNightClick={onNightClick}
            onOpenStay={openStay}
            onResizeStart={startResize}
            onOpenLeg={(leg) => setOpenLeg(leg.index)}
            rentalStrip={rentalStrip}
          />
        ) : (
          <div className={wide ? '-mx-1 overflow-x-auto px-1 pb-1' : ''}>
            <div
              ref={gridRef}
              className="grid"
              style={
                wide
                  ? {
                      gridTemplateColumns: `repeat(${DAYS.length}, minmax(4.5rem, 1fr))`,
                      gridTemplateRows: 'auto auto auto',
                    }
                  : {
                      gridTemplateColumns: '3.25rem minmax(0, 1fr) 1.75rem',
                      gridTemplateRows: `repeat(${DAYS.length}, auto minmax(3.5rem, auto))`,
                    }
              }
            >
              {DAYS.map((day) => (
                <DayHeader
                  key={day.index}
                  day={day}
                  leg={legsByDay.get(day.index)}
                  onOpenLeg={(leg) => setOpenLeg(leg.index)}
                  wide={wide}
                  style={
                    wide
                      ? { gridColumn: day.index + 1, gridRow: 1 }
                      : { gridRow: nightRow(day.index), gridColumn: 1 }
                  }
                />
              ))}

              {!wide &&
                [...legsByDay.values()].map((leg) => (
                  <LegChip
                    key={`leg-${leg.index}`}
                    leg={leg}
                    variant="between"
                    onOpen={() => setOpenLeg(leg.index)}
                    style={{ gridRow: driveRow(leg.day), gridColumn: 2 }}
                  />
                ))}

              {stays.map((stay, index) => {
                const isValidTarget =
                  dragging !== null && dragging !== index && canMoveStay(stays, dragging, index);
                return stay.destinationId ? (
                  <StayBlock
                    key={`${stay.start}-${stay.destinationId}`}
                    stay={stay}
                    index={index}
                    style={place(stay.start, stay.nights)}
                    wide={wide}
                    isValidTarget={isValidTarget}
                    isDragging={dragging === index}
                    onOpen={() => openStay(stay)}
                    onResizeStart={(edge, event) => startResize(stay, edge, event)}
                  />
                ) : (
                  <EmptyStay
                    key={`${stay.start}-empty`}
                    stay={stay}
                    index={index}
                    style={place(stay.start, stay.nights)}
                    wide={wide}
                    isValidTarget={isValidTarget}
                    selected={isSwept}
                    onNightPointerDown={onNightPointerDown}
                    onNightPointerEnter={onNightPointerEnter}
                    onNightClick={onNightClick}
                  />
                );
              })}

              <div
                style={place(FLIGHT_DAY, 1)}
                className={`bg-hatched flex items-center justify-center gap-1.5 rounded-lg border border-base-300 p-2 text-xs text-base-content/60 ${wide ? 'mx-0.5 min-h-20 flex-col text-center' : 'my-0.5 min-h-12'}`}
              >
                <Plane className="h-4 w-4 text-sky-300" />
                <span>
                  Flight home
                  <span className="block text-base-content/40">
                    from {AIRPORT.id.toUpperCase()}
                  </span>
                </span>
              </div>

              {rental && (
                <RentalBar
                  rental={rental}
                  style={placeRental(rental.from, rental.to)}
                  vertical={!wide}
                  wide={wide}
                  isFirst
                  isLast
                  showLabel={wide}
                  onResizeStart={rentalStrip.onResizeStart}
                  onRemove={rentalStrip.onRemove}
                />
              )}
              {DAYS.filter((day) => !isRentalDay(rental, day.index)).map((day) => (
                <RentalSlot
                  key={`rental-${day.index}`}
                  day={day.index}
                  style={placeRental(day.index, day.index)}
                  vertical={!wide}
                  selected={isRentalSwept(day.index)}
                  hasRental={!!rental}
                  onPointerDown={rentalStrip.onSlotPointerDown}
                  onPointerEnter={rentalStrip.onSlotPointerEnter}
                  onClick={rentalStrip.onSlotClick}
                />
              ))}
            </div>
          </div>
        )}

        <DragOverlay>
          {draggedStay?.destinationId && (
            <div className="rounded-lg border-l-4 border-info bg-base-300 px-3 py-2 text-sm font-semibold shadow-xl">
              {getDestination(draggedStay.destinationId)?.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <p className="mt-2 text-xs text-base-content/40">
        {wide
          ? 'Click or drag across empty nights to plan them. '
          : 'Tap an empty night to plan it. '}
        Drag a stay&apos;s edge to change its nights. {wide ? 'Click' : 'Tap'} a leg to choose how
        to travel. {wide ? 'Drag' : 'Press and hold'} a stay to reorder it.{' '}
        <CarFront className="inline h-3 w-3 align-[-2px] text-amber-300/70" /> Rental car:{' '}
        {wide ? 'drag across its days in the car row' : 'tap a day in the car column'}, then drag
        its ends. Car legs outside it are in someone else&apos;s car.
      </p>

      <DestinationPicker
        plan={plan}
        request={picker}
        onClose={() => setPicker(null)}
        onPick={(destinationId, first, last) => {
          let next = picker?.currentId ? assignRange(plan, picker.first, picker.last, null) : plan;
          next = assignRange(next, first, last, destinationId);
          setPlan(next);
          setPicker(null);
        }}
      />
      <TravelDialog
        planned={openLeg !== null ? legs[openLeg] : undefined}
        onClose={() => setOpenLeg(null)}
      />
      <StayDialog
        plan={plan}
        stays={stays}
        night={openNight}
        onAnchor={setOpenNight}
        onClose={() => setOpenNight(null)}
        onChange={setPlan}
        onChangeDestination={changeDestination}
      />
    </section>
  );
};

export default Timeline;
