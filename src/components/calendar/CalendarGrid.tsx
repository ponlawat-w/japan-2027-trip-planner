import { useDroppable } from '@dnd-kit/core';
import { Plane, Plus } from 'lucide-react';
import { useMemo, type CSSProperties, type FC, type PointerEvent, type RefObject } from 'react';
import CalendarStay from '@/components/calendar/CalendarStay';
import LegChip from '@/components/timeline/LegChip';
import { RentalBar, RentalSlot, type RentalStripControls } from '@/components/timeline/RentalStrip';
import { AIRPORT } from '@/data/dataset';
import { canMoveStay, isRentalDay, type PlannedLeg, type Stay } from '@/lib/plan';
import {
  calendarPosition,
  calendarSegments,
  calendarWeeks,
  FLIGHT_DAY,
  type CalendarSegment,
} from '@/lib/trip';
import { cn } from '@/utils/cn';

interface CalendarGridProps {
  /** Holds the day squares (`data-day`), which the timeline measures to resize a stay. */
  gridRef: RefObject<HTMLDivElement | null>;
  stays: Stay[];
  legsByDay: Map<number, PlannedLeg>;
  wide: boolean;
  /** The stay being dragged to a new place, if any. */
  dragging: number | null;
  isSwept: (night: number) => boolean;
  onNightPointerDown: (night: number, event: PointerEvent) => void;
  onNightPointerEnter: (night: number) => void;
  onNightClick: (night: number) => void;
  onOpenStay: (stay: Stay) => void;
  onResizeStart: (stay: Stay, edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
  onOpenLeg: (leg: PlannedLeg) => void;
  rentalStrip: RentalStripControls;
}

/**
 * Unplanned nights within one week. A subgrid, so each night lines up with its day's square, and
 * one drop target, so a stay can be moved into the run as in the timeline.
 */
const CalendarEmpty: FC<{
  index: number;
  segment: CalendarSegment;
  style: CSSProperties;
  isValidTarget: boolean;
  selected: (night: number) => boolean;
  onNightPointerDown: (night: number, event: PointerEvent) => void;
  onNightPointerEnter: (night: number) => void;
  onNightClick: (night: number) => void;
}> = ({
  index,
  segment,
  style,
  isValidTarget,
  selected,
  onNightPointerDown,
  onNightPointerEnter,
  onNightClick,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${index}-week-${segment.week}`,
    data: { index },
  });
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'grid grid-cols-subgrid rounded-md',
        isValidTarget && 'ring-2 ring-info/40',
        isValidTarget && isOver && 'ring-info',
      )}
    >
      {Array.from({ length: segment.nights }, (_, offset) => {
        const night = segment.start + offset;
        return (
          <button
            key={night}
            type="button"
            className={cn(
              'm-1 flex select-none items-center justify-center rounded-md border border-dashed border-base-content/15 text-base-content/30 transition-colors hover:border-base-content/40 hover:text-base-content/70',
              selected(night) && 'border-info bg-info/10 text-info',
            )}
            onPointerDown={(event) => onNightPointerDown(night, event)}
            onPointerEnter={() => onNightPointerEnter(night)}
            onClick={() => onNightClick(night)}
            aria-label="Plan this night"
          >
            <Plus className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
};

/**
 * The trip as a month calendar: the whole weeks around 2–15 February, a square per day.
 *
 * Each week is four grid rows: the date, the leg travelled that day, the night's stay, and the
 * rental car's strip. So a leg sits on the day it is travelled, just above the stay it arrives
 * at. Dates outside the trip are shown faded, for context only.
 */
const CalendarGrid: FC<CalendarGridProps> = ({
  gridRef,
  stays,
  legsByDay,
  wide,
  dragging,
  isSwept,
  onNightPointerDown,
  onNightPointerEnter,
  onNightClick,
  onOpenStay,
  onResizeStart,
  onOpenLeg,
  rentalStrip,
}) => {
  const weeks = useMemo(() => calendarWeeks(), []);
  const dateRow = (week: number) => 4 * week + 2;
  const legRow = (week: number) => 4 * week + 3;
  const stayRow = (week: number) => 4 * week + 4;
  const rentalRow = (week: number) => 4 * week + 5;
  const { rental } = rentalStrip;
  const place = (segment: CalendarSegment) => ({
    gridColumn: `${segment.column + 1} / span ${segment.nights}`,
    gridRow: stayRow(segment.week),
  });
  const flight = calendarPosition(FLIGHT_DAY);

  return (
    <div
      ref={gridRef}
      className="grid gap-x-1"
      style={{
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gridTemplateRows: `auto repeat(${weeks.length}, auto auto minmax(${wide ? '3.5rem' : '2.75rem'}, auto) auto)`,
      }}
    >
      {weeks[0].map((cell) => {
        const weekday = cell.date.getDay();
        return (
          <div
            key={`weekday-${cell.column}`}
            style={{ gridColumn: cell.column + 1, gridRow: 1 }}
            className={cn(
              'pb-1 text-center text-xs text-base-content/50',
              (weekday === 0 || weekday === 6) && 'text-rose-300/80',
            )}
          >
            {cell.date.toLocaleDateString('en-GB', { weekday: 'short' })}
          </div>
        );
      })}

      {weeks.flat().map((cell) => {
        const inTrip = cell.tripDay !== null;
        const weekday = cell.date.getDay();
        const isFirstCell = cell.week === 0 && cell.column === 0;
        const showMonth = isFirstCell || cell.date.getDate() === 1;
        return [
          // The day's square, behind the four rows of its week. Trip days carry `data-day`, which
          // the timeline measures to turn a pointer position into a day when an edge is dragged.
          <div
            key={`square-${cell.week}-${cell.column}`}
            data-day={inTrip ? cell.tripDay! : undefined}
            style={{ gridColumn: cell.column + 1, gridRow: `${dateRow(cell.week)} / span 4` }}
            className={cn(
              'my-0.5 rounded-lg border',
              inTrip ? 'border-base-300 bg-base-100/50' : 'border-dashed border-base-300/50',
              cell.tripDay === FLIGHT_DAY && 'bg-hatched',
            )}
          />,
          <div
            key={`date-${cell.week}-${cell.column}`}
            style={{ gridColumn: cell.column + 1, gridRow: dateRow(cell.week) }}
            className={cn(
              'flex items-center gap-1 px-1.5 pt-1.5 text-xs tabular-nums',
              !inTrip && 'opacity-30',
            )}
          >
            <span
              className={cn(
                'font-semibold',
                wide && 'text-sm',
                (weekday === 0 || weekday === 6) && 'text-rose-300/90',
              )}
            >
              {cell.date.getDate()}
            </span>
            {showMonth && (
              <span className="truncate text-base-content/50">
                {cell.date.toLocaleDateString('en-GB', { month: 'short' })}
              </span>
            )}
          </div>,
        ];
      })}

      {[...legsByDay.values()].map((leg) => {
        const { week, column } = calendarPosition(leg.day);
        return (
          <div
            key={`leg-${leg.index}`}
            style={{ gridColumn: column + 1, gridRow: legRow(week) }}
            className="flex min-w-0 px-1 pt-0.5"
          >
            <LegChip leg={leg} variant={wide ? 'compact' : 'mini'} onOpen={() => onOpenLeg(leg)} />
          </div>
        );
      })}

      {stays.flatMap((stay, index) => {
        const isValidTarget =
          dragging !== null && dragging !== index && canMoveStay(stays, dragging, index);
        return calendarSegments(stay.start, stay.nights).map((segment) =>
          stay.destinationId ? (
            <CalendarStay
              key={`${stay.start}-${stay.destinationId}-${segment.week}`}
              stay={stay}
              index={index}
              segment={segment}
              style={place(segment)}
              wide={wide}
              isValidTarget={isValidTarget}
              isDragging={dragging === index}
              onOpen={() => onOpenStay(stay)}
              onResizeStart={(edge, event) => onResizeStart(stay, edge, event)}
            />
          ) : (
            <CalendarEmpty
              key={`${stay.start}-empty-${segment.week}`}
              index={index}
              segment={segment}
              style={place(segment)}
              isValidTarget={isValidTarget}
              selected={isSwept}
              onNightPointerDown={onNightPointerDown}
              onNightPointerEnter={onNightPointerEnter}
              onNightClick={onNightClick}
            />
          ),
        );
      })}

      <div
        style={{ gridColumn: flight.column + 1, gridRow: stayRow(flight.week) }}
        className="m-1 flex items-center justify-center gap-1.5 text-xs text-base-content/60"
        title={`Flight home from ${AIRPORT.id.toUpperCase()}`}
      >
        <Plane className="h-4 w-4 shrink-0 text-sky-300" />
        {wide && (
          <span className="truncate">
            Flight home
            <span className="block text-base-content/40">from {AIRPORT.id.toUpperCase()}</span>
          </span>
        )}
      </div>

      {rental &&
        calendarSegments(rental.from, rental.to - rental.from + 1).map((segment) => (
          <RentalBar
            key={`rental-${segment.week}`}
            rental={rental}
            style={{
              gridColumn: `${segment.column + 1} / span ${segment.nights}`,
              gridRow: rentalRow(segment.week),
            }}
            vertical={false}
            wide={wide}
            isFirst={segment.isFirst}
            isLast={segment.isLast}
            // The dates once, where there is room for them.
            showLabel={segment.isFirst && (wide || segment.nights >= 3)}
            onResizeStart={rentalStrip.onResizeStart}
            onRemove={rentalStrip.onRemove}
          />
        ))}
      {weeks
        .flat()
        .filter((cell) => cell.tripDay !== null && !isRentalDay(rental, cell.tripDay))
        .map((cell) => (
          <RentalSlot
            key={`rental-${cell.tripDay}`}
            day={cell.tripDay!}
            style={{ gridColumn: cell.column + 1, gridRow: rentalRow(cell.week) }}
            vertical={false}
            selected={rentalStrip.isSwept(cell.tripDay!)}
            hasRental={!!rental}
            onPointerDown={rentalStrip.onSlotPointerDown}
            onPointerEnter={rentalStrip.onSlotPointerEnter}
            onClick={rentalStrip.onSlotClick}
          />
        ))}
    </div>
  );
};

export default CalendarGrid;
