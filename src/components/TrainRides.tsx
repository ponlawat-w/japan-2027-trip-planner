import { ArrowRightLeft } from 'lucide-react';
import { Fragment, type FC } from 'react';
import { formatDistance, formatDuration, hostOf } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import { SERVICE_COLORS, SERVICE_LABELS } from '@/lib/styles';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import type { TrainLeg, TransportMode } from '@/types/data';
import { cn } from '@/utils/cn';

/** One pill per ride, coloured by service: the gaps between them are the changes of train. */
export const ServiceStrip: FC<{ leg: TrainLeg; className?: string }> = ({ leg, className }) => (
  <span
    className={cn('inline-flex shrink-0 items-center gap-0.5', className)}
    title={leg.segments.map((segment) => SERVICE_LABELS[segment.service]).join(' › ')}
  >
    {leg.segments.map((segment, i) => (
      <span
        key={i}
        className="h-1.5 w-2.5 rounded-full"
        style={{ backgroundColor: SERVICE_COLORS[segment.service] }}
      />
    ))}
  </span>
);

/** Ride by ride, with each change of trains between them and where the times come from. */
export const TrainItinerary: FC<{ leg: TrainLeg }> = ({ leg }) => {
  const units = usePreferencesStore((state) => state.units);
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <ol className="flex flex-col gap-1.5">
        {leg.segments.map((segment, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li className="flex items-center gap-1.5 pl-1 text-warning">
                <ArrowRightLeft className="h-3 w-3 shrink-0" />
                <span>
                  Change at {segment.from.name}{' '}
                  <span className="text-warning/60">{segment.from.nameJa}</span> · about{' '}
                  {formatDuration(segment.transferMin)}
                  <span className="text-warning/60"> (walk + average wait)</span>
                </span>
              </li>
            )}
            <li className="flex gap-2">
              <span
                className="mt-1 h-2 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: SERVICE_COLORS[segment.service] }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {segment.line}{' '}
                  <span className="font-normal text-base-content/50">{segment.lineJa}</span>
                </span>
                <span className="text-base-content/60 tabular-nums">
                  {SERVICE_LABELS[segment.service]} · {segment.from.name} → {segment.to.name} ·{' '}
                  {formatDuration(segment.rideMin)} · {formatDistance(segment.distanceKm, units)}
                </span>
              </span>
            </li>
          </Fragment>
        ))}
      </ol>
      <p className="text-[11px] leading-snug text-base-content/40">
        Typical times from published timetables; waits are averages. Check the day&apos;s trains
        before you go. Sources:{' '}
        {leg.sources.map((source, i) => (
          <Fragment key={source}>
            {i > 0 && ', '}
            <a className="link" href={source} target="_blank" rel="noreferrer">
              {hostOf(source)}
            </a>
          </Fragment>
        ))}
      </p>
    </div>
  );
};

/** Train, ferry or drive, for a leg that has more than one way. */
export const TravelModeSelect: FC<{ planned: PlannedLeg; className?: string }> = ({
  planned,
  className,
}) => {
  const setMode = usePlanStore((state) => state.setMode);
  if (!planned.train && !planned.ferry) return null;
  return (
    <select
      className={cn('select select-xs w-auto shrink-0', className)}
      value={planned.mode}
      onChange={(event) => setMode(planned.day, event.target.value as TransportMode)}
      onClick={(event) => event.stopPropagation()}
      aria-label="How to travel"
    >
      {planned.train && <option value="train">Train</option>}
      {planned.ferry && <option value="ferry">Ferry</option>}
      <option value="road">{planned.rental ? 'Rental car' : 'Car'}</option>
    </select>
  );
};
