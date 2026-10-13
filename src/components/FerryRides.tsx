import { Car, Clock, Footprints, Ship } from 'lucide-react';
import { Fragment, type FC, type ReactNode } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { formatDistance, formatDuration, hostOf } from '@/lib/format';
import { carLabel, FERRY_COLOR, RENTAL_COLOR } from '@/lib/styles';
import { usePreferencesStore } from '@/store/preferencesStore';
import type { FerryAccess, FerryLeg } from '@/types/data';

const Step: FC<{ icon: ReactNode; children: ReactNode }> = ({ icon, children }) => (
  <li className="flex gap-2">
    <span className="mt-0.5 shrink-0">{icon}</span>
    <span className="flex min-w-0 flex-col">{children}</span>
  </li>
);

/** The stretch on land at one end of the crossing: a drive to or from the pier, or a walk. */
const AccessStep: FC<{ access: FerryAccess; toPort: boolean; rental: boolean }> = ({
  access,
  toPort,
  rental,
}) => {
  const units = usePreferencesStore((state) => state.units);
  const where = (
    <>
      {access.port.name}{' '}
      <span className="font-normal text-base-content/50">{access.port.nameJa}</span>
    </>
  );
  if (access.kind === 'walk') {
    return (
      <Step icon={<Footprints className="h-3.5 w-3.5 opacity-70" />}>
        <span className="font-medium">
          {toPort ? 'Walk to ' : 'Walk from '}
          {where}
        </span>
        <span className="text-base-content/60 tabular-nums">
          About {formatDuration(access.walkMin)}
          {access.port.note && ` · ${access.port.note}`}
        </span>
      </Step>
    );
  }
  const { drive } = access;
  return (
    <Step
      icon={
        <Car
          className="h-3.5 w-3.5 opacity-70"
          style={rental ? { color: RENTAL_COLOR, opacity: 1 } : undefined}
        />
      }
    >
      <span className="font-medium">
        {carLabel(rental)} {toPort ? 'to ' : 'from '}
        {where}
      </span>
      <span className="flex flex-wrap items-center gap-1 text-base-content/60 tabular-nums">
        {formatDuration(drive.winterDurationMin)} in winter ·{' '}
        {formatDistance(drive.distanceKm, units)}
        <DifficultyBadge difficulty={drive.difficulty} compact />
      </span>
      {access.port.note && <span className="text-base-content/50">{access.port.note}</span>}
    </Step>
  );
};

/**
 * Door to door by boat: the drive or walk at each end, the pier, and the crossing's timetable.
 * `rental` says whose car the drive is in, as the day's rental decides.
 */
export const FerryItinerary: FC<{ leg: FerryLeg; rental: boolean }> = ({ leg, rental }) => {
  const units = usePreferencesStore((state) => state.units);
  const { crossing } = leg;
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <ol className="flex flex-col gap-1.5">
        <AccessStep access={leg.before} toPort rental={rental} />
        <li className="flex items-center gap-1.5 pl-1 text-warning">
          <Clock className="h-3 w-3 shrink-0" />
          At the pier {formatDuration(crossing.boardingMin)} before departure, as the operator asks
        </li>
        <Step icon={<Ship className="h-3.5 w-3.5" style={{ color: FERRY_COLOR }} />}>
          <span className="font-medium">
            {crossing.line}{' '}
            <span className="font-normal text-base-content/50">{crossing.lineJa}</span>
          </span>
          <span className="text-base-content/60 tabular-nums">
            {crossing.from.name} → {crossing.to.name} · {formatDuration(crossing.rideMin)} ·{' '}
            {formatDistance(crossing.distanceKm, units)} · ¥{crossing.fareYen.toLocaleString()} one
            way
          </span>
          <span className="mt-1 flex flex-wrap gap-1 tabular-nums" aria-label="Departures">
            {crossing.departures.map((time) => (
              <span key={time} className="rounded bg-base-300/70 px-1.5 py-0.5">
                {time}
              </span>
            ))}
          </span>
        </Step>
        <AccessStep access={leg.after} toPort={false} rental={rental} />
      </ol>
      {crossing.note && <p className="text-base-content/60">{crossing.note}</p>}
      <p className="text-[11px] leading-snug text-base-content/40">
        Timetable and fare as published; no wait is counted, so time the drive to a sailing. Check
        the day&apos;s sailings and book before you go. Sources:{' '}
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
