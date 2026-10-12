import { Plane } from 'lucide-react';
import { type CSSProperties, type FC } from 'react';
import LegChip from '@/components/timeline/LegChip';
import type { PlannedLeg } from '@/lib/plan';
import { FLIGHT_DAY, type TripDay } from '@/lib/trip';
import { cn } from '@/utils/cn';

interface DayHeaderProps {
  day: TripDay;
  /**
   * The leg travelled on this day, if any: into the stay that starts tonight. Shown here only in
   * the wide timeline; on a phone the timeline puts it in its own row between the two stays.
   */
  leg: PlannedLeg | undefined;
  onOpenLeg: (leg: PlannedLeg) => void;
  wide: boolean;
  style: CSSProperties;
}

/** A day's date: a column heading when wide, a label beside its night on a phone. */
const DayHeader: FC<DayHeaderProps> = ({ day, leg, onOpenLeg, wide, style }) => {
  const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
  const isFlightDay = day.index === FLIGHT_DAY;

  return (
    <div
      // The timeline measures these to turn a pointer position into a day, when an edge is dragged.
      data-day={day.index}
      style={style}
      className={cn(
        'flex min-w-0 gap-1 text-xs',
        wide ? 'flex-col items-stretch px-0.5 pb-1' : 'flex-col pt-2.5 pr-2',
      )}
    >
      <div
        className={cn(
          'flex items-baseline gap-1',
          wide ? 'justify-center' : 'flex-col items-start gap-0',
        )}
      >
        <span className={cn('text-base-content/50', isWeekend && 'text-rose-300/80')}>
          {day.weekday}
        </span>
        <span className={cn('font-semibold', wide ? 'text-sm' : 'text-base leading-tight')}>
          {day.dayOfMonth}
          {!wide && <span className="ml-1 text-xs font-normal text-base-content/40">Feb</span>}
        </span>
        {isFlightDay && wide && <Plane className="h-3.5 w-3.5 self-center text-sky-300" />}
      </div>
      {wide && leg && <LegChip leg={leg} variant="compact" onOpen={() => onOpenLeg(leg)} />}
    </div>
  );
};

export default DayHeader;
