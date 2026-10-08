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
import { Plane } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PointerEvent,
} from 'react';
import DestinationPicker, { type PickerRequest } from '@/components/DestinationPicker';
import StayDialog from '@/components/StayDialog';
import AutofillControls from '@/components/timeline/AutofillControls';
import DayHeader from '@/components/timeline/DayHeader';
import DriveChip from '@/components/timeline/DriveChip';
import EmptyStay from '@/components/timeline/EmptyStay';
import StayBlock from '@/components/timeline/StayBlock';
import { AIRPORT, getDestination } from '@/data/dataset';
import { useIsWide } from '@/hooks/useMediaQuery';
import {
  assignRange,
  canMoveStay,
  legsOf,
  moveStay,
  resizeStayTo,
  setPinned,
  staysOf,
  type Plan,
  type PlannedLeg,
  type Stay,
} from '@/lib/plan';
import { DAYS, FLIGHT_DAY } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';

/**
 * The trip as a row of days (a column on a phone), with stays spanning their nights.
 *
 * One grid serves both orientations: each item is placed by `place()`, which turns "nights 3–5" into
 * columns when wide and rows when narrow, so the two layouts cannot drift apart.
 */
const Timeline: FC = () => {
  const committed = usePlanStore((state) => state.plan);
  const setPlan = usePlanStore((state) => state.setPlan);
  // While an edge is being dragged the timeline shows the resize live, and commits it (one undo
  // step) only on release. Everything below reads `plan`, the one on screen.
  const [preview, setPreview] = useState<Plan | null>(null);
  const plan = preview ?? committed;
  const gridRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide();
  const stays = useMemo(() => staysOf(plan), [plan]);
  const legsByDay = useMemo(() => {
    const byDay = new Map<number, PlannedLeg>();
    for (const leg of legsOf(plan)) byDay.set(leg.day, leg);
    return byDay;
  }, [plan]);

  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [openNight, setOpenNight] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  // --- Choosing empty nights: a click picks one; a mouse drag sweeps a range. ------------------
  const [sweep, setSweep] = useState<{ anchor: number; current: number } | null>(null);

  /** Keeps a sweep inside the unpinned nights around its anchor. */
  const clampSweep = useCallback(
    (anchor: number, night: number): number => {
      const step = night >= anchor ? 1 : -1;
      let reach = anchor;
      while (reach !== night && !plan[reach + step]?.pinned) reach += step;
      return reach;
    },
    [plan],
  );

  useEffect(() => {
    if (!sweep) return;
    const finish = () => {
      setPicker({
        first: Math.min(sweep.anchor, sweep.current),
        last: Math.max(sweep.anchor, sweep.current),
        pinned: false,
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
    if (sweep) setSweep({ anchor: sweep.anchor, current: clampSweep(sweep.anchor, night) });
  };
  // Touch and keyboard arrive here. A mouse click arrives too, after its one-night sweep has
  // already opened the same picker on release, which makes this a no-op for it.
  const onNightClick = (night: number) => {
    if (!sweep) setPicker({ first: night, last: night, pinned: false });
  };
  const isSwept = (night: number) =>
    !!sweep &&
    night >= Math.min(sweep.anchor, sweep.current) &&
    night <= Math.max(sweep.anchor, sweep.current);

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

  /**
   * Follows the pointer from an edge's grip until release.
   *
   * The pointer is captured by the grid, not by the grip: the stay block re-renders as it resizes,
   * and a grip that is replaced mid-drag would take the rest of the gesture with it.
   */
  const startResize = (stay: Stay, edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current!;
    const base = committed;
    let latest = base;
    grid.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => {
      latest = resizeStayTo(base, stay, edge, boundaryAt(moveEvent.clientX, moveEvent.clientY));
      setPreview(latest);
    };
    const finish = (endEvent: globalThis.PointerEvent) => {
      grid.removeEventListener('pointermove', move);
      grid.removeEventListener('pointerup', finish);
      grid.removeEventListener('pointercancel', finish);
      setPreview(null);
      if (endEvent.type === 'pointerup') setPlan(latest);
    };
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', finish);
    grid.addEventListener('pointercancel', finish);
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

  const openStay = (stay: Stay) => setOpenNight(stay.start);
  const changeDestination = (stay: Stay) => {
    setOpenNight(null);
    setPicker({
      first: stay.start,
      last: stay.start + stay.nights - 1,
      pinned: stay.pinned,
      currentId: stay.destinationId ?? undefined,
    });
  };

  const draggedStay = dragging !== null ? stays[dragging] : undefined;

  return (
    <section className="rounded-xl border border-base-300 bg-base-200/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="grow text-sm font-semibold uppercase tracking-wide text-base-content/60">
          Timeline
        </h2>
        <AutofillControls />
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className={wide ? '-mx-1 overflow-x-auto px-1 pb-1' : ''}>
          <div
            ref={gridRef}
            className="grid"
            style={
              wide
                ? {
                    gridTemplateColumns: `repeat(${DAYS.length}, minmax(4.5rem, 1fr))`,
                    gridTemplateRows: 'auto auto',
                  }
                : {
                    gridTemplateColumns: '3.25rem minmax(0, 1fr)',
                    gridTemplateRows: `repeat(${DAYS.length}, auto minmax(3.5rem, auto))`,
                  }
            }
          >
            {DAYS.map((day) => (
              <DayHeader
                key={day.index}
                day={day}
                leg={legsByDay.get(day.index)}
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
                <DriveChip
                  key={`drive-${leg.index}`}
                  leg={leg}
                  variant="between"
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
                  onTogglePin={() =>
                    setPlan(setPinned(plan, stay.start, stay.start + stay.nights - 1, !stay.pinned))
                  }
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
                <span className="block text-base-content/40">from {AIRPORT.id.toUpperCase()}</span>
              </span>
            </div>
          </div>
        </div>

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
        Drag a stay&apos;s edge to change its nights. {wide ? 'Drag' : 'Press and hold'} an unpinned
        stay to reorder it; pinned stays keep their dates.
      </p>

      <DestinationPicker
        plan={plan}
        request={picker}
        onClose={() => setPicker(null)}
        onPick={(destinationId, first, last, pinned) => {
          let next = picker?.currentId ? assignRange(plan, picker.first, picker.last, null) : plan;
          next = assignRange(next, first, last, destinationId, pinned);
          setPlan(next);
          setPicker(null);
        }}
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
