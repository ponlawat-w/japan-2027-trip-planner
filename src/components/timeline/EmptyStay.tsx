import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { type CSSProperties, type FC, type PointerEvent } from 'react';
import type { Stay } from '@/lib/plan';
import { cn } from '@/utils/cn';

interface EmptyStayProps {
  stay: Stay;
  index: number;
  style: CSSProperties;
  wide: boolean;
  isValidTarget: boolean;
  /** Nights currently swept by a mouse drag, highlighted as the range being chosen. */
  selected: (night: number) => boolean;
  onNightPointerDown: (night: number, event: PointerEvent) => void;
  onNightPointerEnter: (night: number) => void;
  onNightClick: (night: number) => void;
}

/** A run of unplanned nights: each one a target to plan, and the run a place to drop a stay. */
const EmptyStay: FC<EmptyStayProps> = ({
  stay,
  index,
  style,
  wide,
  isValidTarget,
  selected,
  onNightPointerDown,
  onNightPointerEnter,
  onNightClick,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id: `drop-${index}`, data: { index } });
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex min-w-0 rounded-lg',
        wide ? 'mx-0.5 flex-row' : 'my-0.5 flex-col',
        isValidTarget && 'ring-2 ring-info/40',
        isValidTarget && isOver && 'ring-info',
      )}
    >
      {Array.from({ length: stay.nights }, (_, offset) => {
        const night = stay.start + offset;
        return (
          <button
            key={night}
            type="button"
            className={cn(
              'flex flex-1 select-none items-center justify-center rounded-lg border border-dashed border-base-content/15 text-base-content/30 transition-colors hover:border-base-content/40 hover:text-base-content/70',
              wide ? 'min-h-20 [&:not(:first-child)]:ml-1' : 'min-h-12 [&:not(:first-child)]:mt-1',
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

export default EmptyStay;
