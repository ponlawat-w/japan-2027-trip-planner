import { AlertTriangle, CalendarDays, Car, Route, TrainFront } from 'lucide-react';
import { useMemo, type CSSProperties, type FC, type ReactNode } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { getDestination } from '@/data/dataset';
import { formatDistance, formatDuration } from '@/lib/format';
import { travelMinutes } from '@/lib/plan';
import { SERVICE_COLORS } from '@/lib/styles';
import { summarize } from '@/lib/summary';
import { NIGHT_COUNT } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';

/**
 * What a group of figures covers, worn by its heading and its top edge: every leg however it is
 * travelled, the driven legs only, or the train legs only.
 */
const SCOPE_ACCENTS = {
  plan: 'var(--color-base-content)',
  all: '#38bdf8',
  car: '#fbbf24',
  train: SERVICE_COLORS.local,
} as const;

const Group: FC<{
  scope: keyof typeof SCOPE_ACCENTS;
  icon: ReactNode;
  label: string;
  columns: number;
  children: ReactNode;
}> = ({ scope, icon, label, columns, children }) => (
  <section
    className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-t-[3px] border-base-300 bg-base-200/40 p-2"
    style={{ borderTopColor: SCOPE_ACCENTS[scope] } as CSSProperties}
  >
    <h2
      className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: SCOPE_ACCENTS[scope], opacity: scope === 'plan' ? 0.6 : 1 }}
    >
      {icon}
      {label}
    </h2>
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  </section>
);

const Tile: FC<{ label: string; value: ReactNode; detail?: ReactNode }> = ({
  label,
  value,
  detail,
}) => (
  <div className="flex min-w-0 flex-col rounded-lg bg-base-100/40 px-2.5 py-1.5">
    <span className="truncate text-xs text-base-content/50">{label}</span>
    <span className="truncate text-lg font-semibold tabular-nums">{value}</span>
    {detail && <span className="truncate text-xs text-base-content/60">{detail}</span>}
  </div>
);

/** The plan in numbers, grouped by what each covers. Read-only: it all follows from the timeline. */
const TripSummary: FC = () => {
  const plan = usePlanStore((state) => state.plan);
  const modes = usePlanStore((state) => state.modes);
  const units = usePreferencesStore((state) => state.units);
  const summary = useMemo(() => summarize(plan, modes), [plan, modes]);
  const longest = summary.longestLeg;
  const longestMinutes = longest && travelMinutes(longest);
  const approx = summary.hasEstimates ? '≈ ' : '';
  const iconClass = 'h-3.5 w-3.5';

  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[2fr_3fr_2fr_1fr]">
        <Group scope="plan" icon={<CalendarDays className={iconClass} />} label="Plan" columns={2}>
          <Tile
            label="Destinations"
            value={summary.destinations}
            detail={`${summary.onsen} onsen`}
          />
          <Tile
            label="Nights planned"
            value={`${summary.nightsPlanned} / ${NIGHT_COUNT}`}
            detail={
              summary.nightsEmpty > 0 ? (
                <span className="text-warning">{summary.nightsEmpty} still empty</span>
              ) : (
                'all planned'
              )
            }
          />
        </Group>

        <Group
          scope="all"
          icon={<Route className={iconClass} />}
          label="All travel · car + train"
          columns={3}
        >
          <Tile
            label="Distance"
            value={`${approx}${formatDistance(summary.totalKm, units)}`}
            detail="round trip from NGO"
          />
          <Tile
            label="Time"
            value={`${approx}${formatDuration(summary.totalTravelMin)}`}
            detail="winter driving + trains"
          />
          <Tile
            label="Longest day"
            value={longestMinutes ? formatDuration(longestMinutes) : '—'}
            detail={
              longest
                ? `${getDestination(longest.from)?.name} → ${getDestination(longest.to)?.name}`
                : undefined
            }
          />
        </Group>

        <Group scope="car" icon={<Car className={iconClass} />} label="By car only" columns={2}>
          <Tile
            label="Driving (winter)"
            value={
              summary.totalWinterDriveMin > 0
                ? `${approx}${formatDuration(summary.totalWinterDriveMin)}`
                : '—'
            }
            detail={
              summary.totalWinterDriveMin > 0
                ? `${approx}${formatDistance(summary.driveKm, units)} · ${formatDuration(summary.totalDriveMin)} dry`
                : 'no drives'
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
            detail={
              summary.ferries > 0 ? `of 5 · ${summary.ferries} with a ferry` : 'of 5, for February'
            }
          />
        </Group>

        <Group
          scope="train"
          icon={<TrainFront className={iconClass} />}
          label="By train only"
          columns={1}
        >
          <Tile
            label="On trains"
            value={summary.trainLegs > 0 ? formatDuration(summary.trainMin) : '—'}
            detail={
              summary.trainLegs > 0
                ? `${formatDistance(summary.trainKm, units)} · ${summary.trainChanges} change${summary.trainChanges === 1 ? '' : 's'}`
                : 'no train legs'
            }
          />
        </Group>
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
