import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pin,
  PinOff,
  Star,
  Trash2,
} from 'lucide-react';
import { type FC, type ReactNode } from 'react';
import ImageSearchLink from '@/components/ImageSearchLink';
import { getDestination } from '@/data/dataset';
import { useIsWide } from '@/hooks/useMediaQuery';
import {
  assignRange,
  canMoveStay,
  moveStay,
  resizeStay,
  setPinned,
  type Plan,
  type Stay,
} from '@/lib/plan';
import { KIND_COLORS, KIND_LABELS } from '@/lib/styles';
import { stayDateRange } from '@/lib/trip';
import Dialog, { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/Dialog';

interface StayDialogProps {
  plan: Plan;
  stays: Stay[];
  /**
   * A night inside the stay being edited, or null when closed.
   *
   * A night rather than an index into `stays`: resizing or pinning can merge or split the stays
   * around it and shift every index, while a night that is still part of the stay keeps naming it.
   */
  night: number | null;
  onAnchor: (night: number) => void;
  onClose: () => void;
  onChange: (plan: Plan) => void;
  onChangeDestination: (stay: Stay) => void;
}

const ActionButton: FC<{
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}> = ({ onClick, disabled, children, className = '' }) => (
  <button
    type="button"
    className={`btn btn-sm justify-start ${className}`}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
);

/**
 * Everything that can be done to one stay, in one place — the only way on a touch screen, where
 * there is no hover to reveal controls, and the keyboard-reachable way everywhere else.
 */
const StayDialog: FC<StayDialogProps> = ({
  plan,
  stays,
  night,
  onAnchor,
  onClose,
  onChange,
  onChangeDestination,
}) => {
  const isWide = useIsWide();
  const index =
    night === null
      ? -1
      : stays.findIndex((stay) => night >= stay.start && night < stay.start + stay.nights);
  const stay = index >= 0 ? stays[index] : undefined;
  const destination = stay?.destinationId ? getDestination(stay.destinationId) : undefined;

  const last = stay ? stay.start + stay.nights - 1 : 0;

  /** Applies an edit, re-anchoring on a night the stay still holds afterwards, or closing. */
  const apply = (next: Plan, anchor: number | 'close') => {
    onChange(next);
    if (anchor === 'close') onClose();
    else onAnchor(anchor);
  };
  const EarlierIcon = isWide ? ChevronLeft : ChevronUp;
  const LaterIcon = isWide ? ChevronRight : ChevronDown;

  return (
    <Dialog open={!!stay && !!destination} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {stay && destination && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: KIND_COLORS[destination.kind] }}
                />
                {destination.name}
                <span className="font-normal text-base-content/50">{destination.nameJa}</span>
                <ImageSearchLink destination={destination} className="btn-xs" />
              </DialogTitle>
              <DialogDescription>
                {stayDateRange(stay.start, stay.nights)} · {stay.nights} night
                {stay.nights > 1 ? 's' : ''} · {KIND_LABELS[destination.kind]}
                {destination.rating > 0 && (
                  <span className="ml-2 inline-flex translate-y-0.5 text-amber-300">
                    {Array.from({ length: destination.rating }, (_, i) => (
                      <Star key={i} className="h-3 w-3 fill-current" />
                    ))}
                  </span>
                )}
              </DialogDescription>
              {destination.note && (
                <p className="text-sm text-base-content/70">{destination.note}</p>
              )}
            </DialogHeader>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <ActionButton
                className={stay.pinned ? 'btn-warning' : 'btn-soft btn-warning'}
                onClick={() => apply(setPinned(plan, stay.start, last, !stay.pinned), stay.start)}
              >
                {stay.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                {stay.pinned ? 'Unpin' : 'Pin'}
              </ActionButton>
              <ActionButton onClick={() => onChangeDestination(stay)}>
                <ArrowLeftRight className="h-4 w-4" /> Change place
              </ActionButton>

              <ActionButton
                onClick={() => apply(resizeStay(plan, stay, 'start', 1), stay.start)}
                disabled={stay.start === 0}
              >
                <EarlierIcon className="h-4 w-4" /> Arrive a day earlier
              </ActionButton>
              <ActionButton
                onClick={() => apply(resizeStay(plan, stay, 'end', 1), stay.start)}
                disabled={last === plan.length - 1}
              >
                <LaterIcon className="h-4 w-4" /> Leave a day later
              </ActionButton>
              <ActionButton
                onClick={() => apply(resizeStay(plan, stay, 'start', -1), last)}
                disabled={stay.nights <= 1}
              >
                <LaterIcon className="h-4 w-4" /> Arrive a day later
              </ActionButton>
              <ActionButton
                onClick={() => apply(resizeStay(plan, stay, 'end', -1), stay.start)}
                disabled={stay.nights <= 1}
              >
                <EarlierIcon className="h-4 w-4" /> Leave a day earlier
              </ActionButton>

              <ActionButton
                onClick={() => apply(moveStay(plan, index, index - 1), 'close')}
                disabled={!canMoveStay(stays, index, index - 1)}
              >
                <EarlierIcon className="h-4 w-4" /> Swap with previous
              </ActionButton>
              <ActionButton
                onClick={() => apply(moveStay(plan, index, index + 1), 'close')}
                disabled={!canMoveStay(stays, index, index + 1)}
              >
                <LaterIcon className="h-4 w-4" /> Swap with next
              </ActionButton>
            </div>
            {stay.pinned && (
              <p className="mt-2 text-xs text-base-content/50">
                Pinned stays keep their dates: unpin to swap this one with its neighbours.
              </p>
            )}

            <button
              type="button"
              className="btn btn-sm btn-soft btn-error mt-4 w-full"
              onClick={() => apply(assignRange(plan, stay.start, last, null), 'close')}
            >
              <Trash2 className="h-4 w-4" /> Remove stay
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StayDialog;
