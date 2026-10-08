import { AlertTriangle } from 'lucide-react';
import { useMemo, type FC, type ReactNode } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { getDestination } from '@/data/dataset';
import { formatDistance, formatDuration } from '@/lib/format';
import { summarize } from '@/lib/summary';
import { NIGHT_COUNT } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';

const Tile: FC<{ label: string; value: ReactNode; detail?: ReactNode }> = ({
  label,
  value,
  detail,
}) => (
  <div className="flex min-w-0 flex-col rounded-xl border border-base-300 bg-base-200/40 px-3 py-2">
    <span className="text-xs text-base-content/50">{label}</span>
    <span className="truncate text-xl font-semibold tabular-nums">{value}</span>
    {detail && <span className="truncate text-xs text-base-content/60">{detail}</span>}
  </div>
);

/** The plan in numbers. Read-only: everything here follows from the timeline. */
const TripSummary: FC = () => {
  const plan = usePlanStore((state) => state.plan);
  const units = usePreferencesStore((state) => state.units);
  const summary = useMemo(() => summarize(plan), [plan]);
  const approx = summary.hasEstimates ? '≈ ' : '';
  const longest = summary.longestLeg;

  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Destinations" value={summary.destinations} detail={`${summary.onsen} onsen`} />
        <Tile
          label="Nights planned"
          value={`${summary.nightsPlanned} / ${NIGHT_COUNT}`}
          detail={
            summary.nightsEmpty > 0 ? (
              <span className="text-warning">{summary.nightsEmpty} still empty</span>
            ) : (
              `${summary.pinnedNights} pinned`
            )
          }
        />
        <Tile
          label="Total distance"
          value={`${approx}${formatDistance(summary.totalKm, units)}`}
          detail={summary.ferries > 0 ? `${summary.ferries} with a ferry` : 'round trip from NGO'}
        />
        <Tile
          label="Driving (winter)"
          value={`${approx}${formatDuration(summary.totalWinterDriveMin)}`}
          detail={`${formatDuration(summary.totalDriveMin)} in good conditions`}
        />
        <Tile
          label="Longest day"
          value={longest?.leg ? formatDuration(longest.leg.winterDurationMin) : '—'}
          detail={
            longest
              ? `${getDestination(longest.from)?.name} → ${getDestination(longest.to)?.name}`
              : undefined
          }
        />
        <Tile
          label="Hardest drive"
          value={
            summary.hardest ? (
              <DifficultyBadge difficulty={summary.hardest} className="text-sm" />
            ) : (
              '—'
            )
          }
          detail="of 5, for February"
        />
      </div>
      {summary.issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          {summary.issues.map((issue) => (
            <li key={issue} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {issue}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default TripSummary;
