import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { getDestination } from '@/data/dataset';
import {
  applyPairChoices,
  chooseMode,
  emptyPlan,
  rentalBetween,
  type Plan,
  type Rental,
  type Trip,
} from '@/lib/plan';
import { decodeTrip, planHash } from '@/lib/shareLink';
import { NIGHT_COUNT } from '@/lib/trip';
import type { TransportMode } from '@/types/data';

const HISTORY_LIMIT = 50;

/**
 * The plan to start from: the itinerary drafted before this tool existed. The 9th was Matsumoto,
 * not yet a destination here, and the 10th Kusatsu, since dropped, so both start empty.
 */
const DEFAULT_PLAN: Plan = [
  'nagoya',
  'suzuka',
  'suzuka',
  'osaka',
  'osaka',
  'gero',
  'okuhida',
  null,
  null,
  'tokyo',
  'tokyo',
  'tokyo',
  'nagoya',
].map((destinationId) => ({ destinationId }));

const MODES: TransportMode[] = ['road', 'train', 'ferry'];
const sanitizeMode = (mode: unknown): TransportMode | undefined =>
  MODES.includes(mode as TransportMode) ? (mode as TransportMode) : undefined;

/**
 * A stored or shared plan made safe to use: exactly one entry per night, any destination that
 * has since been removed from the data read as an empty night, and only known ways of arriving.
 */
const sanitize = (plan: unknown): Plan => {
  if (!Array.isArray(plan)) return emptyPlan();
  return Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const night = plan[index] as Partial<Plan[number]> | undefined;
    const id = night?.destinationId;
    const destinationId = typeof id === 'string' && getDestination(id) ? id : null;
    const arrival = sanitizeMode(night?.arrival);
    return { destinationId, ...(destinationId && arrival && { arrival }) };
  });
};

/** A stored rental made safe to use: two whole days within the trip, or none. */
const sanitizeRental = (rental: unknown): Rental | null => {
  const { from, to } = (rental ?? {}) as Partial<Rental>;
  return typeof from === 'number' && typeof to === 'number' ? rentalBetween(from, to) : null;
};

/** The trip alone, out of the store's state: what undo steps through, saves and shares. */
const tripOf = ({ plan, homeMode, rental }: Trip): Trip => ({ plan, homeMode, rental });

interface PlanState extends Trip {
  past: Trip[];
  future: Trip[];
  /** The leg hovered in the list or on the map, drawn emphasised in both. */
  highlightedLeg: number | null;
  setPlan: (plan: Plan) => void;
  /** How the leg on `day` is travelled (a leg's `day`, the flight day for the way home). */
  setMode: (day: number, mode: TransportMode) => void;
  setRental: (rental: Rental | null) => void;
  /** Loads a shared plan as one undoable step. */
  load: (trip: Trip) => void;
  undo: () => void;
  redo: () => void;
  setHighlightedLeg: (index: number | null) => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      plan: sanitize(DEFAULT_PLAN),
      homeMode: null,
      rental: null,
      past: [],
      future: [],
      highlightedLeg: null,

      setPlan: (plan) => get().load({ ...tripOf(get()), plan }),

      setMode: (day, mode) => get().load(chooseMode(tripOf(get()), day, mode)),

      setRental: (rental) => get().load({ ...tripOf(get()), rental }),

      load: (next) => {
        const { past } = get();
        const current = tripOf(get());
        if (JSON.stringify(tripOf(next)) === JSON.stringify(current)) return;
        set({ ...tripOf(next), past: [...past, current].slice(-HISTORY_LIMIT), future: [] });
      },

      undo: () => {
        const { past, future } = get();
        if (past.length === 0) return;
        set({
          ...past[past.length - 1],
          past: past.slice(0, -1),
          future: [tripOf(get()), ...future],
        });
      },

      redo: () => {
        const { past, future } = get();
        if (future.length === 0) return;
        set({ ...future[0], past: [...past, tripOf(get())], future: future.slice(1) });
      },

      setHighlightedLeg: (index) => set({ highlightedLeg: index }),
    }),
    {
      name: 'japan-2027-trip-plan',
      // 2: transport choices moved from pairs of places onto the stays they arrive at.
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => tripOf(state),
      // Version 1 kept choices per pair of places: carried over onto the legs between them.
      migrate: (persisted) => {
        const stored = (persisted ?? {}) as Partial<Trip> & { modes?: Record<string, unknown> };
        const trip: Trip = {
          plan: sanitize(stored.plan),
          homeMode: null,
          rental: sanitizeRental(stored.rental),
        };
        const pairs = Object.fromEntries(
          Object.entries(stored.modes ?? {}).flatMap(([key, mode]) =>
            sanitizeMode(mode) ? [[key, sanitizeMode(mode)!]] : [],
          ),
        );
        return applyPairChoices(trip, pairs);
      },
      merge: (persisted, current) => {
        const stored = persisted as Partial<Trip> | undefined;
        return {
          ...current,
          plan: stored?.plan ? sanitize(stored.plan) : current.plan,
          homeMode: sanitizeMode(stored?.homeMode) ?? null,
          rental: stored && 'rental' in stored ? sanitizeRental(stored.rental) : current.rental,
        };
      },
    },
  ),
);

/** The trip as one object, new only when one of its parts changes. */
export const useTrip = (): Trip => usePlanStore(useShallow(tripOf));

/**
 * Keeps the address bar showing the current trip, so the URL can be copied at any moment.
 *
 * On start, a plan in the URL wins over the one saved in this browser (undo brings that one back).
 * From then on every edit rewrites the fragment with `replaceState`: one browser-history entry for
 * the page, not one per edit — stepping back through edits is what undo is for. Editing the
 * fragment by hand is picked up too.
 */
export const syncPlanWithUrl = (): void => {
  const loadFromUrl = () => {
    const shared = decodeTrip(window.location.hash);
    if (shared) usePlanStore.getState().load(shared);
  };
  const writeToUrl = (trip: Trip) => {
    const hash = planHash(trip);
    if (window.location.hash !== hash) {
      history.replaceState(
        history.state,
        '',
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
  };

  loadFromUrl();
  writeToUrl(usePlanStore.getState());
  usePlanStore.subscribe((state, previous) => {
    if (
      state.plan !== previous.plan ||
      state.homeMode !== previous.homeMode ||
      state.rental !== previous.rental
    )
      writeToUrl(state);
  });
  window.addEventListener('hashchange', loadFromUrl);
};
