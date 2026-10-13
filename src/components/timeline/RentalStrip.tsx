import { CarFront, X } from 'lucide-react';
import { type CSSProperties, type FC, type PointerEvent } from 'react';
import { ResizeHandle } from '@/components/timeline/StayBlock';
import type { Rental } from '@/lib/plan';
import { RENTAL_COLOR } from '@/lib/styles';
import { dayLabel, dayRange } from '@/lib/trip';
import { cn } from '@/utils/cn';

/**
 * The rental car's strip, along the timeline and under each calendar week: a faint slot for every
 * day outside the rental, and the rental itself as one amber bar. No dialog: the days are set
 * where they are seen.
 */

/** Everything the strip needs from the timeline, which owns the edits for both views. */
export interface RentalStripControls {
  rental: Rental | null;
  isSwept: (day: number) => boolean;
  onSlotPointerDown: (day: number, event: PointerEvent) => void;
  onSlotPointerEnter: (day: number) => void;
  onSlotClick: (day: number) => void;
  onResizeStart: (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
  onRemove: () => void;
}

interface RentalSlotProps {
  day: number;
  style: CSSProperties;
  /** The strip runs top to bottom (the timeline on a phone). */
  vertical: boolean;
  /** Swept by a mouse drag, as the rental being chosen. */
  selected: boolean;
  hasRental: boolean;
  onPointerDown: (day: number, event: PointerEvent) => void;
  onPointerEnter: (day: number) => void;
  onClick: (day: number) => void;
}

/** A day without the rental car: drag across slots to set its days, or tap one to start or extend it. */
export const RentalSlot: FC<RentalSlotProps> = ({
  day,
  style,
  vertical,
  selected,
  hasRental,
  onPointerDown,
  onPointerEnter,
  onClick,
}) => (
  <button
    type="button"
    style={style}
    className={cn(
      'm-0.5 flex min-w-0 select-none items-center justify-center rounded-md border border-dashed border-base-content/10 text-base-content/20 transition-colors hover:border-amber-300/50 hover:text-amber-300/80',
      vertical ? 'min-h-6' : 'h-5',
      selected && 'border-amber-300 bg-amber-300/15 text-amber-300',
    )}
    onPointerDown={(event) => onPointerDown(day, event)}
    onPointerEnter={() => onPointerEnter(day)}
    onClick={() => onClick(day)}
    aria-label={
      hasRental ? `Keep the rental car until ${dayLabel(day)}` : `Rent a car from ${dayLabel(day)}`
    }
    title={hasRental ? 'Extend the rental car to this day' : 'Rental car: drag across its days'}
  >
    <CarFront className="h-3 w-3" />
  </button>
);

interface RentalBarProps {
  rental: Rental;
  style: CSSProperties;
  vertical: boolean;
  /** A mouse is in use: edge grips appear on hover rather than always. */
  wide: boolean;
  /** Whether this piece holds the rental's first or last day, where its edges can be dragged. */
  isFirst: boolean;
  isLast: boolean;
  /** Room for the dates beside the icon. */
  showLabel: boolean;
  onResizeStart: (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
  onRemove: () => void;
}

/** The rental car's days. Drag an end to change them; × removes the rental. */
export const RentalBar: FC<RentalBarProps> = ({
  rental,
  style,
  vertical,
  wide,
  isFirst,
  isLast,
  showLabel,
  onResizeStart,
  onRemove,
}) => {
  const days = rental.to - rental.from + 1;
  return (
    <div
      style={{
        ...style,
        backgroundColor: `color-mix(in oklab, ${RENTAL_COLOR} 20%, var(--color-base-200))`,
        borderColor: `color-mix(in oklab, ${RENTAL_COLOR} 60%, transparent)`,
      }}
      className={cn(
        'group relative flex min-w-0 select-none items-center gap-1 rounded-md border text-[11px] text-amber-200',
        vertical ? 'mx-0.5 flex-col py-1' : 'my-0.5 h-5 px-1.5',
        !isFirst && (vertical ? 'rounded-t-none' : 'rounded-l-none'),
        !isLast && (vertical ? 'rounded-b-none' : 'rounded-r-none'),
      )}
      title={`Rental car · ${dayRange(rental.from, rental.to)} · ${days} day${days > 1 ? 's' : ''}`}
    >
      <CarFront className="h-3 w-3 shrink-0" />
      {showLabel && (
        <span className="truncate">
          Rental car · {dayRange(rental.from, rental.to)} · {days} day{days > 1 ? 's' : ''}
        </span>
      )}
      {isLast && (
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center justify-center rounded text-amber-200/60 hover:text-amber-100',
            vertical ? 'mt-auto' : 'ml-auto',
          )}
          onClick={onRemove}
          aria-label="Remove the rental car"
          title="Remove the rental car"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      {isFirst && (
        <ResizeHandle
          edge="start"
          axis={vertical ? 'y' : 'x'}
          revealOnHover={wide}
          label="Drag to change the pick-up day"
          onPointerDown={(event) => onResizeStart('start', event)}
        />
      )}
      {isLast && (
        <ResizeHandle
          edge="end"
          axis={vertical ? 'y' : 'x'}
          revealOnHover={wide}
          label="Drag to change the return day"
          onPointerDown={(event) => onResizeStart('end', event)}
        />
      )}
    </div>
  );
};
