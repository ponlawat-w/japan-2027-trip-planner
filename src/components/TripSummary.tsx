import { AlertTriangle, CalendarDays, Car, CarFront, Route, Ship, TrainFront } from 'lucide-react';
import { useMemo, type CSSProperties, type FC, type ReactNode } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { getDestination } from '@/data/dataset';
import { formatDistance, formatDuration } from '@/lib/format';
import { travelMinutes } from '@/lib/plan';
import { CAR_COLOR, FERRY_COLOR, RENTAL_COLOR, SERVICE_COLORS } from '@/lib/styles';
import { summarize, type CarTotals } from '@/lib/summary';
import { dayRange, NIGHT_COUNT } from '@/lib/trip';
import { usePlanStore, useTrip } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';

/**
 * What a group of figures covers, worn by its heading and its top edge: the plan, every leg
 * however it is travelled, or one way of travelling. The four ways share nothing, so their
 * figures add up to _All travel_.
 */
const SCOPE_ACCENTS = {
  plan: 'var(--color-base-content)',
  all: '#38bdf8',
  rental: RENTAL_COLOR,
  car: CAR_COLOR,
  train: SERVICE_COLORS.local,
  ferry: FERRY_COLOR,
} as const;

const Group: FC<{
  scope: keyof typeof SCOPE_ACCENTS;
  icon: ReactNode;
  label: string;
  columns: number;
  className?: string;
  children: ReactNode;
}> = ({ scope, icon, label, columns, className = '', children }) => (
  <section
    className={`flex min-w-0 flex-col gap-1.5 rounded-xl border border-t-[3px] border-base-300 bg-base-200/40 p-2 ${className}`}
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

const useSummary = () => {
  const trip = useTrip();
  return useMemo(() => summarize(trip), [trip]);
};

/** Plan problems worth fixing, shown above the timeline where they can be fixed. */
export const TripIssues: FC = () => {
  const { issues } = useSummary();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
      {issues.map((issue) => (
        <li key={issue} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {issue}
        </li>
      ))}
    </ul>
  );
};

/** One car's driving: its winter time, and its distance and dry time beneath. */
const DrivingTile: FC<{ totals: CarTotals; approx: string; none: string }> = ({
  totals,
  approx,
  none,
}) => {
  const units = usePreferencesStore((state) => state.units);
  return (
    <Tile
      label="Driving (winter)"
      value={totals.drives > 0 ? `${approx}${formatDuration(totals.winterMin)}` : '—'}
      detail={
        totals.drives > 0
          ? `${approx}${formatDistance(totals.km, units)} · ${formatDuration(totals.dryMin)} dry`
          : none
      }
    />
  );
};

/**
 * The plan in numbers: the whole trip, then each way of travelling on its own. Read-only: it all
 * follows from the timeline.
 */
const TripSummary: FC = () => {
  const rental = usePlanStore((state) => state.rental);
  const units = usePreferencesStore((state) => state.units);
  const summary = useSummary();
  const longest = summary.longestLeg;
  const longestMinutes = longest && travelMinutes(longest);
  const approx = summary.hasEstimates ? '≈ ' : '';
  const iconClass = 'h-3.5 w-3.5';
  const withFerry = (totals: CarTotals) =>
    totals.withFerry > 0 ? ` · ${totals.withFerry} with a ferry` : '';

  return (
    <section className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[2fr_3fr]">
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

        <Group scope="all" icon={<Route className={iconClass} />} label="All travel" columns={3}>
          <Tile
            label="Distance"
            value={`${approx}${formatDistance(summary.totalKm, units)}`}
            detail="round trip from NGO"
          />
          <Tile
            label="Time"
            value={`${approx}${formatDuration(summary.totalTravelMin)}`}
            detail="cars, trains and ferries"
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
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]">
        <Group
          scope="rental"
          icon={<CarFront className={iconClass} />}
          label="Rental car · you drive"
          columns={2}
          className="sm:col-span-2 xl:col-span-1"
        >
          <DrivingTile
            totals={summary.rental}
            approx={approx}
            none={rental ? 'no drives on its days' : 'no rental car'}
          />
          <Tile
            label="Hardest drive"
            value={
              summary.rental.hardest ? (
                <DifficultyBadge difficulty={summary.rental.hardest} className="text-sm" />
              ) : (
                '—'
              )
            }
            detail={
              rental
                ? `${dayRange(rental.from, rental.to)} · ${summary.rental.days} day${summary.rental.days === 1 ? '' : 's'}${withFerry(summary.rental)}`
                : 'set its days on the timeline'
            }
          />
        </Group>

        <Group
          scope="car"
          icon={<Car className={iconClass} />}
          label="Someone else's car"
          columns={1}
        >
          <DrivingTile totals={summary.car} approx={approx} none="no car legs" />
        </Group>

        <Group scope="train" icon={<TrainFront className={iconClass} />} label="Train" columns={1}>
          <Tile
            label="On trains"
            value={summary.train.legs > 0 ? formatDuration(summary.train.minutes) : '—'}
            detail={
              summary.train.legs > 0
                ? `${formatDistance(summary.train.km, units)} · ${summary.train.changes} change${summary.train.changes === 1 ? '' : 's'}`
                : 'no train legs'
            }
          />
        </Group>

        <Group scope="ferry" icon={<Ship className={iconClass} />} label="Ferry" columns={1}>
          <Tile
            label="Boat, pier and walks"
            value={summary.ferry.legs > 0 ? formatDuration(summary.ferry.minutes) : '—'}
            detail={
              summary.ferry.legs > 0
                ? `${formatDuration(summary.ferry.boatMin)} on board · ¥${summary.ferry.fareYen.toLocaleString()} each`
                : 'no ferry legs'
            }
          />
        </Group>
      </div>
    </section>
  );
};

export default TripSummary;
