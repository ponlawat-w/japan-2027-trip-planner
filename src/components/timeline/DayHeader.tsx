import { Car, Plane } from 'lucide-react';
import { type CSSProperties, type FC } from 'react';
import { formatDistance, formatDuration } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import { DIFFICULTY_COLORS } from '@/lib/styles';
import { FLIGHT_DAY, type TripDay } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { cn } from '@/utils/cn';

interface DayHeaderProps {
  day: TripDay;
  /** The drive made on this day, if any: into the stay that starts tonight. */
  leg: PlannedLeg | undefined;
  wide: boolean;
  style: CSSProperties;
}

/** A day's date, with the drive made that morning beneath it. */
const DayHeader: FC<DayHeaderProps> = ({ day, leg, wide, style }) => {
  const highlighted = usePlanStore(
    (state) => leg !== undefined && state.highlightedLeg === leg.index,
  );
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const units = usePreferencesStore((state) => state.units);
  const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
  const isFlightDay = day.index === FLIGHT_DAY;

  return (
    <div
      // The timeline measures these to turn a pointer position into a day, when an edge is dragged.
      data-day={day.index}
      style={style}
      className={cn(
        'flex min-w-0 gap-1 text-xs',
        wide ? 'flex-col items-stretch px-0.5 pb-1' : 'flex-col justify-center pr-2',
      )}
    >
      <div className={cn('flex items-baseline gap-1', wide && 'justify-center')}>
        <span className={cn('text-base-content/50', isWeekend && 'text-rose-300/80')}>
          {day.weekday}
        </span>
        <span className="text-sm font-semibold">{day.dayOfMonth}</span>
        {isFlightDay && <Plane className="h-3.5 w-3.5 self-center text-sky-300" />}
      </div>
      {leg?.leg && (
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 rounded-md border px-1 py-0.5 text-[11px] leading-tight transition-colors',
            wide ? 'justify-center' : 'w-fit',
            highlighted ? 'border-base-content/40 bg-base-300' : 'border-base-300 bg-base-200/60',
            leg.leg.estimated && 'border-dashed',
          )}
          onPointerEnter={() => setHighlightedLeg(leg.index)}
          onPointerLeave={() => setHighlightedLeg(null)}
          onFocus={() => setHighlightedLeg(leg.index)}
          onBlur={() => setHighlightedLeg(null)}
          title={`Drive: ${formatDuration(leg.leg.winterDurationMin)} in winter conditions, ${formatDistance(leg.leg.distanceKm, units)}, difficulty ${leg.leg.difficulty}/5`}
        >
          <Car className="h-3 w-3 shrink-0 opacity-70" />
          <span className="truncate">{formatDuration(leg.leg.winterDurationMin)}</span>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: DIFFICULTY_COLORS[leg.leg.difficulty] }}
          />
        </button>
      )}
    </div>
  );
};

export default DayHeader;
