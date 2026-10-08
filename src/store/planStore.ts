import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getDestination } from '@/data/dataset';
import { autofill, randomSeed } from '@/lib/autofill';
import { emptyPlan, type Plan } from '@/lib/plan';
import { decodePlan, planHash } from '@/lib/shareLink';
import { NIGHT_COUNT } from '@/lib/trip';

const HISTORY_LIMIT = 50;

/**
 * The plan to start from: the itinerary drafted before this tool existed, with the fixed parts
 * pinned — the first night in Nagoya, Suzuka, and the last night before the flight.
 * The 9th was Matsumoto, not yet a destination here, so it starts empty.
 */
const DEFAULT_PLAN: Plan = (
  [
    ['nagoya', true],
    ['suzuka', true],
    ['suzuka', true],
    ['osaka', false],
    ['osaka', false],
    ['gero', false],
    ['okuhida', false],
    [null, false],
    ['kusatsu', false],
    ['tokyo', false],
    ['tokyo', false],
    ['tokyo', false],
    ['nagoya', true],
  ] as const
).map(([destinationId, pinned]) => ({ destinationId, pinned }));

/**
 * A stored or shared plan made safe to use: exactly one entry per night, and any destination that
 * has since been removed from the data read as an empty night.
 */
const sanitize = (plan: unknown): Plan => {
  if (!Array.isArray(plan)) return emptyPlan();
  return Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const night = plan[index] as Partial<Plan[number]> | undefined;
    const id = night?.destinationId;
    return typeof id === 'string' && getDestination(id)
      ? { destinationId: id, pinned: !!night?.pinned }
      : { destinationId: null, pinned: false };
  });
};

interface PlanState {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  /** The leg hovered in the list or on the map, drawn emphasised in both. */
  highlightedLeg: number | null;
  setPlan: (plan: Plan) => void;
  undo: () => void;
  redo: () => void;
  runAutofill: () => boolean;
  setHighlightedLeg: (index: number | null) => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      plan: sanitize(DEFAULT_PLAN),
      past: [],
      future: [],
      highlightedLeg: null,

      setPlan: (plan) => {
        const { plan: current, past } = get();
        if (JSON.stringify(plan) === JSON.stringify(current)) return;
        set({ plan, past: [...past, current].slice(-HISTORY_LIMIT), future: [] });
      },

      undo: () => {
        const { plan, past, future } = get();
        if (past.length === 0) return;
        set({ plan: past[past.length - 1], past: past.slice(0, -1), future: [plan, ...future] });
      },

      redo: () => {
        const { plan, past, future } = get();
        if (future.length === 0) return;
        set({ plan: future[0], past: [...past, plan], future: future.slice(1) });
      },

      runAutofill: () => {
        const result = autofill(get().plan, randomSeed());
        if (!result.changed) return false;
        get().setPlan(result.plan);
        return true;
      },

      setHighlightedLeg: (index) => set({ highlightedLeg: index }),
    }),
    {
      name: 'japan-2027-trip-plan',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ plan: state.plan }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PlanState> | undefined;
        return {
          ...current,
          plan: stored?.plan ? sanitize(stored.plan) : current.plan,
        };
      },
    },
  ),
);

/**
 * Keeps the address bar showing the current plan, so the URL can be copied at any moment.
 *
 * On start, a plan in the URL wins over the one saved in this browser (undo brings that one back).
 * From then on every edit rewrites the fragment with `replaceState`: one browser-history entry for
 * the page, not one per edit — stepping back through edits is what undo is for. Editing the
 * fragment by hand is picked up too.
 */
export const syncPlanWithUrl = (): void => {
  const loadFromUrl = () => {
    const shared = decodePlan(window.location.hash);
    if (shared) usePlanStore.getState().setPlan(shared);
  };
  const writeToUrl = (plan: Plan) => {
    const hash = planHash(plan);
    if (window.location.hash !== hash) {
      history.replaceState(
        history.state,
        '',
        `${window.location.pathname}${window.location.search}${hash}`,
      );
    }
  };

  loadFromUrl();
  writeToUrl(usePlanStore.getState().plan);
  usePlanStore.subscribe((state, previous) => {
    if (state.plan !== previous.plan) writeToUrl(state.plan);
  });
  window.addEventListener('hashchange', loadFromUrl);
};
