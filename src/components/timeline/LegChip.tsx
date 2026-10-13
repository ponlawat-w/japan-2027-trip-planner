import { Car, Ship, TrainFront } from 'lucide-react';
import { type CSSProperties, type FC } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { ServiceStrip } from '@/components/TrainRides';
import { formatChanges, formatDistance, formatDuration } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import {
  carLabel,
  DIFFICULTY_COLORS,
  FERRY_COLOR,
  RENTAL_COLOR,
  SERVICE_LABELS,
} from '@/lib/styles';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { ferryDrives } from '@/types/data';
import { cn } from '@/utils/cn';

interface LegChipProps {
  leg: PlannedLeg;
  /**
   * `compact` sits under a day's date in the wide timeline: time and a difficulty dot, the
   * train's rides, or the ferry's distance.
   * `between` is its own row between two stays on a phone, with room for the distance too.
   * `mini` fits a calendar day on a phone: one line, the drive's difficulty as the icon's colour.
   */
  variant: 'compact' | 'between' | 'mini';
  /** Opens the leg's details, where a train or ferry can be swapped for the drive and back. */
  onOpen: () => void;
  style?: CSSProperties;
}

/** One leg in the timeline. Hovering or focusing it highlights the same leg on the map. */
const LegChip: FC<LegChipProps> = ({ leg: planned, variant, onOpen, style }) => {
  const highlighted = usePlanStore((state) => state.highlightedLeg === planned.index);
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const units = usePreferencesStore((state) => state.units);
  const { road, train, ferry } = planned;
  const byTrain = planned.mode === 'train' && !!train;
  const byFerry = planned.mode === 'ferry' && !!ferry;
  if (!byTrain && !byFerry && !road) return null;

  const interaction = {
    onClick: onOpen,
    onPointerEnter: () => setHighlightedLeg(planned.index),
    onPointerLeave: () => setHighlightedLeg(null),
    onFocus: () => setHighlightedLeg(planned.index),
    onBlur: () => setHighlightedLeg(null),
  };
  const choice = train || ferry ? ' Click to choose how to travel.' : '';
  const ferryDriveMin = byFerry
    ? ferryDrives(ferry).reduce((sum, drive) => sum + drive.winterDurationMin, 0)
    : 0;
  const title = byTrain
    ? `Train: ${formatDuration(train.durationMin)}, ${train.segments.map((segment) => SERVICE_LABELS[segment.service]).join(' › ')} (${formatChanges(train)}), ${formatDistance(train.distanceKm, units)}.${choice}`
    : byFerry
      ? `Ferry: ${formatDuration(ferry.durationMin)} door to door, ${ferry.crossing.line} ${formatDuration(ferry.crossing.rideMin)} (¥${ferry.crossing.fareYen.toLocaleString()})${ferryDriveMin > 0 ? ` with ${formatDuration(ferryDriveMin)} of driving` : ''}.${choice}`
      : `${carLabel(planned.rental)}: ${formatDuration(road!.winterDurationMin)} in winter conditions, ${formatDistance(road!.distanceKm, units)}, difficulty ${road!.difficulty}/5.${choice}`;
  const estimated = !byTrain && !byFerry && road!.estimated;
  const chipClassName = cn(
    'flex items-center gap-1 rounded-md border leading-tight transition-colors',
    highlighted ? 'border-base-content/40 bg-base-300' : 'border-base-300 bg-base-200/60',
    estimated && 'border-dashed',
  );
  const Icon = byTrain ? TrainFront : byFerry ? Ship : Car;
  const minutes = byTrain
    ? train.durationMin
    : byFerry
      ? ferry.durationMin
      : road!.winterDurationMin;
  /** The icon's own colour, where it says more than the icon: a ferry, or the rental car. */
  const accent = byFerry ? FERRY_COLOR : !byTrain && planned.rental ? RENTAL_COLOR : undefined;
  /** What colours the icon on a phone: the drive's difficulty, or the ferry's own colour. */
  const iconColor = byFerry
    ? FERRY_COLOR
    : byTrain
      ? undefined
      : DIFFICULTY_COLORS[road!.difficulty];

  if (variant === 'mini') {
    return (
      <button
        type="button"
        className={cn(chipClassName, 'max-w-full gap-0.5 px-0.5 text-[10px] tabular-nums')}
        title={title}
        {...interaction}
      >
        <Icon className="h-2.5 w-2.5 shrink-0" style={{ color: iconColor }} />
        <span className="truncate">
          {estimated && '≈'}
          {formatDuration(minutes).replace(' min', 'm')}
        </span>
      </button>
    );
  }

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
          <Icon
            className="h-3 w-3 shrink-0 opacity-70"
            style={accent ? { color: accent, opacity: 1 } : undefined}
          />
          <span className="truncate">{formatDuration(minutes)}</span>
          {!byTrain && !byFerry && (
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
          ) : byFerry ? (
            formatDistance(ferry.distanceKm, units)
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
        <Icon
          className="h-3.5 w-3.5 shrink-0 opacity-70"
          style={accent ? { color: accent, opacity: 1 } : undefined}
        />
        {estimated && '≈ '}
        {formatDuration(minutes)}
        {byTrain ? (
          <>
            <ServiceStrip leg={train} className="mx-0.5" />
            <span className="text-base-content/50">{formatChanges(train)}</span>
          </>
        ) : byFerry ? (
          <span className="text-base-content/50">
            · {formatDistance(ferry.distanceKm, units)} · boat{' '}
            {formatDuration(ferry.crossing.rideMin)}
          </span>
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
