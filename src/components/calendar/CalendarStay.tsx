import { useDraggable, useDroppable } from '@dnd-kit/core';
import { type CSSProperties, type FC, type PointerEvent } from 'react';
import { ResizeHandle } from '@/components/timeline/StayBlock';
import { getDestination } from '@/data/dataset';
import type { Stay } from '@/lib/plan';
import { KIND_COLORS } from '@/lib/styles';
import type { CalendarSegment } from '@/lib/trip';
import { cn } from '@/utils/cn';

interface CalendarStayProps {
  stay: Stay;
  index: number;
  segment: CalendarSegment;
  style: CSSProperties;
  wide: boolean;
  isValidTarget: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onResizeStart: (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
}

/**
 * A booked stay's nights within one week, as a bar across the days. A stay that runs into the next
 * week is drawn again there, with the ends that meet the week's edge left square, as calendars do.
 * Each piece moves and opens the whole stay; only its true first and last nights have edges to drag.
 */
const CalendarStay: FC<CalendarStayProps> = ({
  stay,
  index,
  segment,
  style,
  wide,
  isValidTarget,
  isDragging,
  onOpen,
  onResizeStart,
}) => {
  const destination = getDestination(stay.destinationId!)!;
  const color = KIND_COLORS[destination.kind];
  // One draggable and one drop target per piece; both carry the stay's index, so any piece will do.
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
  } = useDraggable({ id: `stay-${index}-week-${segment.week}`, data: { index } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${index}-week-${segment.week}`,
    data: { index },
  });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      style={{
        ...style,
        backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-base-200))`,
        borderColor: color,
      }}
      className={cn(
        'group relative my-1 flex min-w-0 select-none rounded-md transition-[opacity,box-shadow]',
        segment.isFirst ? cn('ml-1', wide ? 'border-l-4' : 'border-l-[3px]') : 'rounded-l-none',
        segment.isLast ? 'mr-1' : 'rounded-r-none',
        isDragging && 'opacity-40',
        isValidTarget && 'ring-2 ring-info/40',
        isValidTarget && isOver && 'ring-info',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex min-w-0 grow cursor-grab flex-col justify-center text-left active:cursor-grabbing',
          wide ? 'px-2 py-1.5' : 'px-1 py-1',
        )}
        onClick={onOpen}
        {...listeners}
        {...attributes}
        aria-label={`${destination.name}, ${stay.nights} nights`}
      >
        <span
          className={cn(
            'truncate font-semibold leading-tight',
            wide ? 'text-sm' : 'text-[11px]',
            !segment.isFirst && 'text-base-content/70',
          )}
        >
          {destination.name}
        </span>
        {wide && (
          <span className="truncate text-xs text-base-content/60">
            {destination.nameJa}
            {segment.isFirst && (
              <span className="text-base-content/50">
                {' '}
                · {stay.nights} night{stay.nights > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
      </button>
      {segment.isFirst && (
        <ResizeHandle
          edge="start"
          axis="x"
          revealOnHover={wide}
          onPointerDown={(event) => onResizeStart('start', event)}
        />
      )}
      {segment.isLast && (
        <ResizeHandle
          edge="end"
          axis="x"
          revealOnHover={wide}
          onPointerDown={(event) => onResizeStart('end', event)}
        />
      )}
    </div>
  );
};

export default CalendarStay;
