import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical, Pin } from 'lucide-react';
import { type CSSProperties, type FC, type PointerEvent } from 'react';
import ImageSearchLink from '@/components/ImageSearchLink';
import { getDestination } from '@/data/dataset';
import type { Stay } from '@/lib/plan';
import { KIND_COLORS } from '@/lib/styles';
import { cn } from '@/utils/cn';

interface StayBlockProps {
  stay: Stay;
  index: number;
  style: CSSProperties;
  wide: boolean;
  /** Something is being dragged and this stay is a place it may be dropped. */
  isValidTarget: boolean;
  isDragging: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onResizeStart: (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
}

/**
 * A grip on one edge of a stay, dragged to change the nights it covers.
 *
 * Outside the block's button, so it never starts dnd-kit's reorder drag, and `touch-none`, so on a
 * phone dragging it resizes rather than scrolls. On a phone the grip is always visible, since there
 * is no hover to reveal it.
 */
const ResizeHandle: FC<{
  edge: 'start' | 'end';
  wide: boolean;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}> = ({ edge, wide, onPointerDown }) => (
  <div
    role="separator"
    aria-orientation={wide ? 'vertical' : 'horizontal'}
    aria-label={
      edge === 'start' ? 'Drag to change the arrival day' : 'Drag to change the departure day'
    }
    className={cn(
      'absolute z-10 flex touch-none items-center justify-center',
      wide
        ? cn('inset-y-0 w-3 cursor-ew-resize', edge === 'start' ? '-left-1.5' : '-right-1.5')
        : cn('inset-x-0 h-4 cursor-ns-resize', edge === 'start' ? '-top-2' : '-bottom-2'),
    )}
    onPointerDown={onPointerDown}
  >
    <span
      className={cn(
        'rounded-full bg-base-content/50 transition-opacity',
        wide ? 'h-8 w-1 opacity-0 group-hover:opacity-100' : 'h-1 w-8 opacity-40',
      )}
    />
  </div>
);

/**
 * A booked stay across its nights: tap for every action, drag (unpinned) to reorder, drag an edge
 * to change its nights.
 */
const StayBlock: FC<StayBlockProps> = ({
  stay,
  index,
  style,
  wide,
  isValidTarget,
  isDragging,
  onOpen,
  onTogglePin,
  onResizeStart,
}) => {
  const destination = getDestination(stay.destinationId!)!;
  const color = KIND_COLORS[destination.kind];
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
  } = useDraggable({ id: `stay-${index}`, data: { index }, disabled: stay.pinned });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${index}`,
    data: { index },
    disabled: stay.pinned,
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
        'group relative flex min-w-0 select-none rounded-lg border-l-4 transition-[opacity,box-shadow]',
        wide ? 'mx-0.5 min-h-20' : 'my-0.5 min-h-12',
        stay.pinned && 'ring-1 ring-amber-300/50',
        isDragging && 'opacity-40',
        isValidTarget && 'ring-2 ring-info/40',
        isValidTarget && isOver && 'ring-info',
      )}
    >
      <button
        type="button"
        className={cn(
          'flex min-w-0 grow gap-1 p-2 text-left',
          wide ? 'flex-col' : 'flex-row items-center',
          !stay.pinned && 'cursor-grab active:cursor-grabbing',
        )}
        onClick={onOpen}
        {...listeners}
        {...attributes}
        aria-label={`${destination.name}, ${stay.nights} nights${stay.pinned ? ', pinned' : ''}`}
      >
        <span className={cn('flex min-w-0 flex-col', !wide && 'grow')}>
          <span className="truncate text-sm font-semibold leading-tight">{destination.name}</span>
          <span className="truncate text-xs text-base-content/60">{destination.nameJa}</span>
        </span>
        <span className="text-xs text-base-content/50">
          {stay.nights} night{stay.nights > 1 ? 's' : ''}
        </span>
        {/* On a phone the grip hints that a long press moves the stay; wide, the cursor does. */}
        {!stay.pinned && !wide && (
          <GripVertical className="h-4 w-4 shrink-0 text-base-content/30" />
        )}
      </button>
      <ResizeHandle
        edge="start"
        wide={wide}
        onPointerDown={(event) => onResizeStart('start', event)}
      />
      <ResizeHandle edge="end" wide={wide} onPointerDown={(event) => onResizeStart('end', event)} />
      {/* Outside the block's button, so a tap opens the photos rather than the stay's actions.
          Wide, it sits in the bottom corner, clear of the resize grip along the right edge. */}
      <ImageSearchLink
        destination={destination}
        className={cn(
          'btn-xs text-base-content/40',
          wide ? 'absolute bottom-0.5 right-2' : 'self-center',
        )}
      />
      <button
        type="button"
        className={cn(
          'btn btn-ghost btn-xs btn-square shrink-0',
          wide ? 'absolute right-0.5 top-0.5' : 'self-center mr-1',
          stay.pinned ? 'text-amber-300' : 'text-base-content/30 hover:text-amber-200',
        )}
        onClick={onTogglePin}
        title={stay.pinned ? 'Unpin: auto-fill may change it' : 'Pin: auto-fill keeps it'}
      >
        <Pin className={cn('h-3.5 w-3.5', stay.pinned && 'fill-current')} />
      </button>
    </div>
  );
};

export default StayBlock;
