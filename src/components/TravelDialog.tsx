import { Car, TrainFront } from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import { RoadDetails } from '@/components/LegList';
import { ServiceStrip, TrainItinerary } from '@/components/TrainRides';
import { getDestination } from '@/data/dataset';
import { formatChanges, formatDistance, formatDuration } from '@/lib/format';
import type { PlannedLeg } from '@/lib/plan';
import { dayLabel } from '@/lib/trip';
import { usePlanStore } from '@/store/planStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import type { TransportMode } from '@/types/data';
import Dialog, { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/Dialog';
import { cn } from '@/utils/cn';

const Option: FC<{
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  children: ReactNode;
}> = ({ selected, onSelect, icon, label, children }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={cn(
      'flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors',
      selected
        ? 'border-info bg-info/10'
        : 'border-base-300 bg-base-100/40 hover:border-base-content/30',
    )}
  >
    <span className="flex items-center gap-1.5 text-sm font-semibold">
      {icon}
      {label}
    </span>
    {children}
  </button>
);

/** One leg: how to travel it, where a train is an option, and what that way involves. */
const TravelDialog: FC<{ planned: PlannedLeg | undefined; onClose: () => void }> = ({
  planned,
  onClose,
}) => {
  const setMode = usePlanStore((state) => state.setMode);
  const units = usePreferencesStore((state) => state.units);
  const from = planned && getDestination(planned.from);
  const to = planned && getDestination(planned.to);
  const choose = (mode: TransportMode) => planned && setMode(planned.from, planned.to, mode);

  return (
    <Dialog open={!!planned} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {planned && (
          <>
            <DialogHeader>
              <DialogTitle>
                {from?.name ?? planned.from} → {to?.name ?? planned.to}
              </DialogTitle>
              <DialogDescription>{dayLabel(planned.day)}</DialogDescription>
            </DialogHeader>

            {planned.train && (
              <div
                className="mt-4 grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="How to travel"
              >
                <Option
                  selected={planned.mode === 'train'}
                  onSelect={() => choose('train')}
                  icon={<TrainFront className="h-4 w-4" />}
                  label="Train"
                >
                  <span className="text-lg font-semibold tabular-nums">
                    {formatDuration(planned.train.durationMin)}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-base-content/60">
                    <ServiceStrip leg={planned.train} />
                    {formatChanges(planned.train)}
                  </span>
                  <span className="text-xs text-base-content/50 tabular-nums">
                    {formatDistance(planned.train.distanceKm, units)} of track
                  </span>
                </Option>
                <Option
                  selected={planned.mode === 'road'}
                  onSelect={() => choose('road')}
                  icon={<Car className="h-4 w-4" />}
                  label="Drive"
                >
                  {planned.road && (
                    <>
                      <span className="text-lg font-semibold tabular-nums">
                        {planned.road.estimated && '≈ '}
                        {formatDuration(planned.road.winterDurationMin)}
                      </span>
                      <DifficultyBadge
                        difficulty={planned.road.difficulty}
                        estimated={planned.road.estimated}
                        compact
                      />
                      <span className="text-xs text-base-content/50 tabular-nums">
                        {formatDistance(planned.road.distanceKm, units)} by road
                      </span>
                    </>
                  )}
                </Option>
              </div>
            )}

            <div className="mt-4">
              {planned.mode === 'train' && planned.train ? (
                <TrainItinerary leg={planned.train} />
              ) : (
                planned.road && (
                  <>
                    {!planned.train && (
                      <p className="mb-2 text-sm tabular-nums">
                        <Car className="mr-1.5 inline h-4 w-4 opacity-70" />
                        {planned.road.estimated && '≈ '}
                        {formatDuration(planned.road.winterDurationMin)} in winter ·{' '}
                        {formatDistance(planned.road.distanceKm, units)}{' '}
                        <DifficultyBadge
                          difficulty={planned.road.difficulty}
                          estimated={planned.road.estimated}
                          compact
                        />
                      </p>
                    )}
                    <RoadDetails leg={planned.road} />
                  </>
                )
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TravelDialog;
