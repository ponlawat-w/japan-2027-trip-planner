import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
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
  onResizeStart: (edge: 'start' | 'end', event: PointerEvent<HTMLElement>) => void;
}

/**
 * A grip on one edge of a stay, dragged to change the nights it covers.
 *
 * Outside the block's button, so it never starts dnd-kit's reorder drag, and `touch-none`, so on a
 * phone dragging it resizes rather than scrolls. On a phone the grip is always visible, since there
 * is no hover to reveal it.
 */
export const ResizeHandle: FC<{
  edge: 'start' | 'end';
  /** `x` for a stay laid out left to right, `y` for one laid out top to bottom. */
  axis: 'x' | 'y';
  revealOnHover: boolean;
  /** What dragging it changes, if not a stay's arrival or departure. */
  label?: string;
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
}> = ({ edge, axis, revealOnHover, label, onPointerDown }) => (
  <div
    role="separator"
    aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-label={
      label ??
      (edge === 'start' ? 'Drag to change the arrival day' : 'Drag to change the departure day')
    }
    className={cn(
      'absolute z-10 flex touch-none items-center justify-center',
      axis === 'x'
        ? cn(
            'inset-y-0 cursor-ew-resize',
            // Wider without a mouse: a fingertip needs more to land on.
            revealOnHover
              ? cn('w-3', edge === 'start' ? '-left-1.5' : '-right-1.5')
              : cn('w-4', edge === 'start' ? '-left-2' : '-right-2'),
          )
        : cn('inset-x-0 h-4 cursor-ns-resize', edge === 'start' ? '-top-2' : '-bottom-2'),
    )}
    onPointerDown={onPointerDown}
  >
    <span
      className={cn(
        'rounded-full bg-base-content/50 transition-opacity',
        axis === 'x' ? 'h-[60%] max-h-8 w-1' : 'h-1 w-8',
        revealOnHover ? 'opacity-0 group-hover:opacity-100' : 'opacity-40',
      )}
    />
  </div>
);

/**
 * A booked stay across its nights: tap for every action, drag to reorder, drag an edge
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
  onResizeStart,
}) => {
  const destination = getDestination(stay.destinationId!)!;
  const color = KIND_COLORS[destination.kind];
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
  } = useDraggable({ id: `stay-${index}`, data: { index } });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop-${index}`, data: { index } });

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
          'cursor-grab active:cursor-grabbing',
        )}
        onClick={onOpen}
        {...listeners}
        {...attributes}
        aria-label={`${destination.name}, ${stay.nights} nights`}
      >
        <span className={cn('flex min-w-0 flex-col', !wide && 'grow')}>
          <span className="truncate text-sm font-semibold leading-tight">{destination.name}</span>
          <span className="truncate text-xs text-base-content/60">{destination.nameJa}</span>
        </span>
        <span className="text-xs text-base-content/50">
          {stay.nights} night{stay.nights > 1 ? 's' : ''}
        </span>
        {/* On a phone the grip hints that a long press moves the stay; wide, the cursor does. */}
        {!wide && <GripVertical className="h-4 w-4 shrink-0 text-base-content/30" />}
      </button>
      {(['start', 'end'] as const).map((edge) => (
        <ResizeHandle
          key={edge}
          edge={edge}
          axis={wide ? 'x' : 'y'}
          revealOnHover={wide}
          onPointerDown={(event) => onResizeStart(edge, event)}
        />
      ))}
      {/* Outside the block's button, so a tap opens the photos rather than the stay's actions.
          Wide, it sits in the bottom corner, clear of the resize grip along the right edge. */}
      <ImageSearchLink
        destination={destination}
        className={cn(
          'btn-xs text-base-content/40',
          wide ? 'absolute bottom-0.5 right-2' : 'self-center',
        )}
      />
    </div>
  );
};

export default StayBlock;
