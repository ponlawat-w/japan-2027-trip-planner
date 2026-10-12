import { AlertTriangle, Car, ChevronDown, Ship, TrainFront } from 'lucide-react';
import { useMemo, useState, type FC } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { ServiceStrip, TrainItinerary, TravelModeSelect } from '@/components/TrainRides';
import { getDestination, type Leg } from '@/data/dataset';
import {
  formatChanges,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPercent,
  formatTurnRate,
  localizeText,
} from '@/lib/format';
import { legsOf, type PlannedLeg } from '@/lib/plan';
import { dayLabel } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { cn } from '@/utils/cn';

const Factor: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-2">
    <dt className="text-base-content/50">{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);

/** What a drive's difficulty is based on, and anything to check by hand before driving it. */
export const RoadDetails: FC<{ leg: Leg }> = ({ leg }) => {
  const units = usePreferencesStore((state) => state.units);
  const distance = (km: number) => formatDistance(km, units);
  const metric = units === 'metric';
  return (
    <div className="text-xs">
      {leg.warnings.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1 text-warning">
          {leg.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {localizeText(warning, units)}
            </li>
          ))}
        </ul>
      )}
      {!leg.estimated && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2">
          <Factor label="Highest point" value={formatElevation(leg.factors.maxElevationM, units)} />
          <Factor
            label={metric ? 'Above 1,000 m' : 'Above 3,280 ft'}
            value={distance(leg.factors.kmAbove1000m)}
          />
          <Factor label="Steep (> 8%)" value={distance(leg.factors.kmSteep)} />
          <Factor
            label={metric ? 'Nights below 0 °C' : 'Nights below 32 °F'}
            value={formatPercent(leg.factors.freezeRatio)}
          />
          <Factor label="Days with snow cover" value={formatPercent(leg.factors.snowRatio)} />
          <Factor label="Snowy minor roads" value={distance(leg.factors.kmSnowyMinorRoad)} />
          <Factor label="Minor / narrow road" value={distance(leg.factors.kmMinorRoad)} />
          <Factor label="Winding" value={formatTurnRate(leg.factors.curvinessDegPerKm, units)} />
          <Factor
            label="Bridges / tunnels"
            value={`${leg.factors.bridges} / ${leg.factors.tunnels}`}
          />
          <Factor label="Tolls" value={leg.factors.toll ? 'Yes' : 'No'} />
        </dl>
      )}
    </div>
  );
};

/** The leg's one-line figures for the way it is travelled. */
const LegFigures: FC<{ planned: PlannedLeg }> = ({ planned }) => {
  const units = usePreferencesStore((state) => state.units);
  const { road, train } = planned;
  if (planned.mode === 'train' && train) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-base-content/60 tabular-nums">
        <TrainFront className="h-3.5 w-3.5 shrink-0 opacity-70" />
        {formatDuration(train.durationMin)} · {formatDistance(train.distanceKm, units)} ·{' '}
        <ServiceStrip leg={train} /> {formatChanges(train)}
      </span>
    );
  }
  if (!road) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-base-content/60 tabular-nums">
      <Car className="h-3.5 w-3.5 shrink-0 opacity-70" />
      <span>
        {road.estimated && '≈ '}
        {formatDistance(road.distanceKm, units)} · {formatDuration(road.winterDurationMin)}
        {road.winterDurationMin !== road.durationMin && (
          <span className="text-base-content/40"> ({formatDuration(road.durationMin)} dry)</span>
        )}
      </span>
    </span>
  );
};

const LegRow: FC<{ planned: PlannedLeg }> = ({ planned }) => {
  const [open, setOpen] = useState(false);
  const highlighted = usePlanStore((state) => state.highlightedLeg === planned.index);
  const setHighlightedLeg = usePlanStore((state) => state.setHighlightedLeg);
  const { road, train } = planned;
  const byTrain = planned.mode === 'train' && !!train;
  const from = getDestination(planned.from);
  const to = getDestination(planned.to);

  return (
    <li
      className={cn(
        'rounded-lg border transition-colors',
        highlighted ? 'border-base-content/30 bg-base-300/60' : 'border-base-300 bg-base-200/40',
      )}
      onPointerEnter={() => setHighlightedLeg(planned.index)}
      onPointerLeave={() => setHighlightedLeg(null)}
    >
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          className="flex min-w-0 grow items-center gap-2 py-2 pl-3 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="flex min-w-0 grow flex-col">
            <span className="text-xs text-base-content/50">{dayLabel(planned.day)}</span>
            <span className="truncate text-sm font-medium">
              {from?.name ?? planned.from} → {to?.name ?? planned.to}
            </span>
            <LegFigures planned={planned} />
          </span>
          {!byTrain && road?.factors.ferry && <Ship className="h-4 w-4 shrink-0 text-sky-300" />}
          {!byTrain && road && road.warnings.length > 0 && (
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          )}
          {!byTrain && road && (
            <DifficultyBadge difficulty={road.difficulty} estimated={road.estimated} compact />
          )}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')}
          />
        </button>
        <TravelModeSelect planned={planned} />
      </div>
      {open && (byTrain || road) && (
        <div className="border-t border-base-300 px-3 py-2">
          {byTrain ? <TrainItinerary leg={train} /> : road && <RoadDetails leg={road} />}
        </div>
      )}
    </li>
  );
};

/** Every leg, in order, with what its time and difficulty are based on a tap away. */
const LegList: FC = () => {
  const plan = usePlanStore((state) => state.plan);
  const modes = usePlanStore((state) => state.modes);
  const legs = useMemo(() => legsOf(plan, modes), [plan, modes]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-base-300 bg-base-200/40 p-3">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/60">
        Travel
      </h2>
      {legs.length === 0 ? (
        <p className="text-sm text-base-content/50">Plan a night to see the legs.</p>
      ) : (
        <ol className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
          {legs.map((planned) => (
            <LegRow key={`${planned.index}-${planned.from}-${planned.to}`} planned={planned} />
          ))}
        </ol>
      )}
      <p className="mt-2 text-[11px] leading-snug text-base-content/40">
        Where a train is listed it is the default; switch any leg back to driving. Difficulty and
        winter times are estimates from road data, terrain and past Februaries. They cannot tell if
        a road is icy, closed or under chain control today: check JARTIC and the road operator
        before setting off.
      </p>
    </section>
  );
};

export default LegList;
