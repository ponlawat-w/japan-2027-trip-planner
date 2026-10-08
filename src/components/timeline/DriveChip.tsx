import { Car } from 'lucide-react';
import { type CSSProperties, type FC } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { formatDistance, formatDuration } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import { DIFFICULTY_COLORS } from '@/lib/styles';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { cn } from '@/utils/cn';

interface DriveChipProps {
  leg: PlannedLeg;
  /**
   * `compact` sits under a day's date in the wide timeline: time and a difficulty dot.
   * `between` is its own row between two stays on a phone, with room for the distance too.
   */
  variant: 'compact' | 'between';
  style?: CSSProperties;
}

/** One drive in the timeline. Hovering or focusing it highlights the same drive on the map. */
const DriveChip: FC<DriveChipProps> = ({ leg: planned, variant, style }) => {
  const highlighted = usePlanStore((state) => state.highlightedLeg === planned.index);
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const units = usePreferencesStore((state) => state.units);
  const { leg } = planned;
  if (!leg) return null;

  const highlight = {
    onPointerEnter: () => setHighlightedLeg(planned.index),
    onPointerLeave: () => setHighlightedLeg(null),
    onFocus: () => setHighlightedLeg(planned.index),
    onBlur: () => setHighlightedLeg(null),
  };
  const title = `Drive: ${formatDuration(leg.winterDurationMin)} in winter conditions, ${formatDistance(leg.distanceKm, units)}, difficulty ${leg.difficulty}/5`;
  const chipClassName = cn(
    'flex items-center gap-1 rounded-md border leading-tight transition-colors',
    highlighted ? 'border-base-content/40 bg-base-300' : 'border-base-300 bg-base-200/60',
    leg.estimated && 'border-dashed',
  );

  if (variant === 'compact') {
    return (
      // Two lines: a day column is too narrow for time and distance side by side.
      <button
        type="button"
        className={cn(chipClassName, 'flex-col gap-0 px-1 py-0.5 text-[11px] tabular-nums')}
        title={title}
        {...highlight}
      >
        <span className="flex max-w-full items-center gap-1">
          <Car className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{formatDuration(leg.winterDurationMin)}</span>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: DIFFICULTY_COLORS[leg.difficulty] }}
          />
        </span>
        <span className="max-w-full truncate text-[10px] text-base-content/50">
          {leg.estimated && '≈ '}
          {formatDistance(leg.distanceKm, units)}
        </span>
      </button>
    );
  }

  // A dashed rule runs through the row on either side of the chip, so it reads as the link
  // from the stay above to the stay below.
  return (
    <div style={style} className="flex items-center gap-2 py-1.5">
      <span className="h-px grow border-t border-dashed border-base-content/20" />
      <button
        type="button"
        className={cn(chipClassName, 'shrink-0 px-2 py-1 text-xs tabular-nums')}
        title={title}
        {...highlight}
      >
        <Car className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {leg.estimated && '≈ '}
        {formatDuration(leg.winterDurationMin)}
        <span className="text-base-content/50">· {formatDistance(leg.distanceKm, units)}</span>
        <DifficultyBadge difficulty={leg.difficulty} estimated={leg.estimated} compact />
      </button>
      <span className="h-px grow border-t border-dashed border-base-content/20" />
    </div>
  );
};

export default DriveChip;
