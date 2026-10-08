import { Minus, Pin, Plus, Search, Star } from 'lucide-react';
import { useMemo, useState, type FC } from 'react';
import DifficultyBadge from '@/components/DifficultyBadge';
import ImageSearchLink from '@/components/ImageSearchLink';
import { AIRPORT, getDestination, getLeg, STAYABLE } from '@/data/dataset';
import { formatDuration } from '@/lib/format';
import type { Plan } from '@/lib/plan';
import { KIND_COLORS, KIND_LABELS } from '@/lib/styles';
import { NIGHT_COUNT, stayDateRange } from '@/lib/trip';
import Dialog, { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/Dialog';
import type { Destination } from '@/types/data';

export interface PickerRequest {
  first: number;
  last: number;
  /** Pre-selected pin state: kept when changing a pinned stay's destination. */
  pinned: boolean;
  /** The destination being replaced, when changing a stay rather than filling empty nights. */
  currentId?: string;
}

interface DestinationPickerProps {
  plan: Plan;
  request: PickerRequest | null;
  onClose: () => void;
  onPick: (destinationId: string, first: number, last: number, pinned: boolean) => void;
}

/** The nearest planned destination before `first`, or the airport the trip starts from. */
const previousOf = (plan: Plan, first: number): string => {
  for (let i = first - 1; i >= 0; i--) {
    if (plan[i].destinationId) return plan[i].destinationId!;
  }
  return AIRPORT.id;
};

const nextOf = (plan: Plan, last: number): string => {
  for (let i = last + 1; i < plan.length; i++) {
    if (plan[i].destinationId) return plan[i].destinationId!;
  }
  return AIRPORT.id;
};

/** How far the range may stretch: up to the next pinned night that belongs to another stay. */
const maxLastOf = (plan: Plan, request: PickerRequest): number => {
  let last = request.last;
  while (
    last + 1 < NIGHT_COUNT &&
    (!plan[last + 1].pinned || plan[last + 1].destinationId === request.currentId)
  ) {
    last++;
  }
  return last;
};

const DestinationPicker: FC<DestinationPickerProps> = ({ plan, request, onClose, onPick }) => (
  <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="sm:max-w-lg">
      {request && <PickerBody plan={plan} request={request} onPick={onPick} />}
    </DialogContent>
  </Dialog>
);

const PickerBody: FC<Omit<DestinationPickerProps, 'onClose'> & { request: PickerRequest }> = ({
  plan,
  request,
  onPick,
}) => {
  const [nights, setNights] = useState(request.last - request.first + 1);
  const [pinned, setPinned] = useState(request.pinned);
  const [query, setQuery] = useState('');
  const maxNights = maxLastOf(plan, request) - request.first + 1;
  const last = request.first + nights - 1;
  const previous = previousOf(plan, request.first);
  const next = nextOf(plan, last);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = STAYABLE.filter(
      (destination) =>
        !needle ||
        destination.name.toLowerCase().includes(needle) ||
        destination.nameJa.includes(needle) ||
        destination.id.includes(needle),
    );
    // Nearest first: the cheapest way to fill a gap is usually the place on the way.
    const cost = (destination: Destination) =>
      (getLeg(previous, destination.id)?.winterDurationMin ?? 0) +
      (getLeg(destination.id, next)?.winterDurationMin ?? 0);
    return matches.sort((a, b) => cost(a) - cost(b));
  }, [query, previous, next]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{request.currentId ? 'Change destination' : 'Add a stay'}</DialogTitle>
        <DialogDescription>
          {stayDateRange(request.first, nights)} · after{' '}
          {getDestination(previous)?.name ?? previous}, before {getDestination(next)?.name ?? next}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="join">
          <button
            type="button"
            className="btn btn-sm join-item"
            onClick={() => setNights((n) => Math.max(1, n - 1))}
            disabled={nights <= 1}
            aria-label="One night fewer"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="btn btn-sm join-item pointer-events-none min-w-24">
            {nights} night{nights > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            className="btn btn-sm join-item"
            onClick={() => setNights((n) => Math.min(maxNights, n + 1))}
            disabled={nights >= maxNights}
            aria-label="One night more"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <label className="label cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm checkbox-warning"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          <Pin className="h-4 w-4" /> Pin
        </label>
      </div>

      <label className="input input-sm mt-3 w-full">
        <Search className="h-4 w-4 opacity-50" />
        <input
          type="search"
          placeholder="Search destinations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <ul className="mt-3 flex flex-col gap-1">
        {options.map((destination) => {
          const inbound = getLeg(previous, destination.id);
          const outbound = getLeg(destination.id, next);
          const isCurrent = destination.id === request.currentId;
          return (
            <li key={destination.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 grow items-start gap-3 rounded-lg border border-transparent px-3 py-2 text-left hover:border-base-content/20 hover:bg-base-300 data-[current=true]:border-base-content/30"
                data-current={isCurrent}
                onClick={() => onPick(destination.id, request.first, last, pinned)}
              >
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: KIND_COLORS[destination.kind] }}
                />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate font-medium">
                    {destination.name}{' '}
                    <span className="font-normal text-base-content/50">{destination.nameJa}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-base-content/60">
                    <span>{KIND_LABELS[destination.kind]}</span>
                    {destination.rating > 0 && (
                      <span className="inline-flex items-center text-amber-300">
                        {Array.from({ length: destination.rating }, (_, i) => (
                          <Star key={i} className="h-3 w-3 fill-current" />
                        ))}
                      </span>
                    )}
                    {destination.note && <span className="truncate">{destination.note}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-base-content/70">
                  {inbound && destination.id !== previous && (
                    <span className="inline-flex items-center gap-1">
                      in {formatDuration(inbound.winterDurationMin)}
                      <DifficultyBadge
                        difficulty={inbound.difficulty}
                        estimated={inbound.estimated}
                        compact
                      />
                    </span>
                  )}
                  {outbound && destination.id !== next && (
                    <span className="inline-flex items-center gap-1">
                      out {formatDuration(outbound.winterDurationMin)}
                      <DifficultyBadge
                        difficulty={outbound.difficulty}
                        estimated={outbound.estimated}
                        compact
                      />
                    </span>
                  )}
                </span>
              </button>
              {/* Beside the row rather than in it: a link cannot sit inside the row's button. */}
              <ImageSearchLink destination={destination} />
            </li>
          );
        })}
      </ul>
    </>
  );
};

export default DestinationPicker;
