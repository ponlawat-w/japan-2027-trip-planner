import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getDestination } from '@/data/dataset';
import { chooseMode, emptyPlan, type ModeChoices, type Plan } from '@/lib/plan';
import { decodeModes, decodePlan, planHash } from '@/lib/shareLink';
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

/**
 * A stored or shared plan made safe to use: exactly one entry per night, and any destination that
 * has since been removed from the data read as an empty night.
 */
const sanitize = (plan: unknown): Plan => {
  if (!Array.isArray(plan)) return emptyPlan();
  return Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const night = plan[index] as Partial<Plan[number]> | undefined;
    const id = night?.destinationId;
    return { destinationId: typeof id === 'string' && getDestination(id) ? id : null };
  });
};

/** What undo steps through: the nights, and how each leg between them is travelled. */
interface Snapshot {
  plan: Plan;
  modes: ModeChoices;
}

interface PlanState {
  plan: Plan;
  modes: ModeChoices;
  past: Snapshot[];
  future: Snapshot[];
  /** The leg hovered in the list or on the map, drawn emphasised in both. */
  highlightedLeg: number | null;
  setPlan: (plan: Plan) => void;
  setMode: (from: string, to: string, mode: TransportMode) => void;
  /** Loads a shared plan as one undoable step. */
  load: (snapshot: Snapshot) => void;
  undo: () => void;
  redo: () => void;
  setHighlightedLeg: (index: number | null) => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set, get) => ({
      plan: sanitize(DEFAULT_PLAN),
      modes: {},
      past: [],
      future: [],
      highlightedLeg: null,

      setPlan: (plan) => get().load({ plan, modes: get().modes }),

      setMode: (from, to, mode) =>
        get().load({ plan: get().plan, modes: chooseMode(get().modes, from, to, mode) }),

      load: (next) => {
        const { plan, modes, past } = get();
        if (JSON.stringify(next) === JSON.stringify({ plan, modes })) return;
        set({ ...next, past: [...past, { plan, modes }].slice(-HISTORY_LIMIT), future: [] });
      },

      undo: () => {
        const { plan, modes, past, future } = get();
        if (past.length === 0) return;
        set({
          ...past[past.length - 1],
          past: past.slice(0, -1),
          future: [{ plan, modes }, ...future],
        });
      },

      redo: () => {
        const { plan, modes, past, future } = get();
        if (future.length === 0) return;
        set({ ...future[0], past: [...past, { plan, modes }], future: future.slice(1) });
      },

      setHighlightedLeg: (index) => set({ highlightedLeg: index }),
    }),
    {
      name: 'japan-2027-trip-plan',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ plan: state.plan, modes: state.modes }),
      merge: (persisted, current) => {
        const stored = persisted as Partial<PlanState> | undefined;
        return {
          ...current,
          plan: stored?.plan ? sanitize(stored.plan) : current.plan,
          modes: stored?.modes && typeof stored.modes === 'object' ? stored.modes : current.modes,
        };
      },
    },
  ),
);

/**
 * Keeps the address bar showing the current plan and its transport choices, so the URL can be copied at any moment.
 *
 * On start, a plan in the URL wins over the one saved in this browser (undo brings that one back).
 * From then on every edit rewrites the fragment with `replaceState`: one browser-history entry for
 * the page, not one per edit — stepping back through edits is what undo is for. Editing the
 * fragment by hand is picked up too.
 */
export const syncPlanWithUrl = (): void => {
  const loadFromUrl = () => {
    const shared = decodePlan(window.location.hash);
    if (shared)
      usePlanStore.getState().load({ plan: shared, modes: decodeModes(window.location.hash) });
  };
  const writeToUrl = ({ plan, modes }: Snapshot) => {
    const hash = planHash(plan, modes);
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
    if (state.plan !== previous.plan || state.modes !== previous.modes) writeToUrl(state);
  });
  window.addEventListener('hashchange', loadFromUrl);
};
