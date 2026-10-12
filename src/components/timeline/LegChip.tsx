import { Car, TrainFront } from 'lucide-react';
import { type CSSProperties, type FC } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { ServiceStrip } from '@/components/TrainRides';
import { formatChanges, formatDistance, formatDuration } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import { DIFFICULTY_COLORS, SERVICE_LABELS } from '@/lib/styles';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { cn } from '@/utils/cn';

interface LegChipProps {
  leg: PlannedLeg;
  /**
   * `compact` sits under a day's date in the wide timeline: time and a difficulty dot, or the
   * train's rides.
   * `between` is its own row between two stays on a phone, with room for the distance too.
   */
  variant: 'compact' | 'between';
  /** Opens the leg's details, where a train can be swapped for the drive and back. */
  onOpen: () => void;
  style?: CSSProperties;
}

/** One leg in the timeline. Hovering or focusing it highlights the same leg on the map. */
const LegChip: FC<LegChipProps> = ({ leg: planned, variant, onOpen, style }) => {
  const highlighted = usePlanStore((state) => state.highlightedLeg === planned.index);
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const units = usePreferencesStore((state) => state.units);
  const { road, train } = planned;
  const byTrain = planned.mode === 'train' && !!train;
  if (!byTrain && !road) return null;

  const interaction = {
    onClick: onOpen,
    onPointerEnter: () => setHighlightedLeg(planned.index),
    onPointerLeave: () => setHighlightedLeg(null),
    onFocus: () => setHighlightedLeg(planned.index),
    onBlur: () => setHighlightedLeg(null),
  };
  const choice = train ? ' Click to choose train or drive.' : '';
  const title = byTrain
    ? `Train: ${formatDuration(train.durationMin)}, ${train.segments.map((segment) => SERVICE_LABELS[segment.service]).join(' › ')} (${formatChanges(train)}), ${formatDistance(train.distanceKm, units)}.${choice}`
    : `Drive: ${formatDuration(road!.winterDurationMin)} in winter conditions, ${formatDistance(road!.distanceKm, units)}, difficulty ${road!.difficulty}/5.${choice}`;
  const estimated = !byTrain && road!.estimated;
  const chipClassName = cn(
    'flex items-center gap-1 rounded-md border leading-tight transition-colors',
    highlighted ? 'border-base-content/40 bg-base-300' : 'border-base-300 bg-base-200/60',
    estimated && 'border-dashed',
  );
  const Icon = byTrain ? TrainFront : Car;
  const minutes = byTrain ? train.durationMin : road!.winterDurationMin;

  if (variant === 'compact') {
    return (
      // Two lines: a day column is too narrow for time and distance side by side.
      <button
        type="button"
        className={cn(chipClassName, 'flex-col gap-0 px-1 py-0.5 text-[11px] tabular-nums')}
        title={title}
        {...interaction}
      >
        <span className="flex max-w-full items-center gap-1">
          <Icon className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{formatDuration(minutes)}</span>
          {!byTrain && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: DIFFICULTY_COLORS[road!.difficulty] }}
            />
          )}
        </span>
        <span className="flex max-w-full items-center gap-1 truncate text-[10px] text-base-content/50">
          {byTrain ? (
            <>
              <ServiceStrip leg={train} />
              {train.segments.length > 1 && <span>{formatChanges(train)}</span>}
            </>
          ) : (
            <>
              {estimated && '≈ '}
              {formatDistance(road!.distanceKm, units)}
            </>
          )}
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
        {...interaction}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {estimated && '≈ '}
        {formatDuration(minutes)}
        {byTrain ? (
          <>
            <ServiceStrip leg={train} className="mx-0.5" />
            <span className="text-base-content/50">{formatChanges(train)}</span>
          </>
        ) : (
          <>
            <span className="text-base-content/50">
              · {formatDistance(road!.distanceKm, units)}
            </span>
            <DifficultyBadge difficulty={road!.difficulty} estimated={estimated} compact />
          </>
        )}
      </button>
      <span className="h-px grow border-t border-dashed border-base-content/20" />
    </div>
  );
};

export default LegChip;
