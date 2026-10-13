import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Units = 'metric' | 'imperial';
/** How the nights are laid out: one row of days, or a month calendar. */
export type PlanView = 'timeline' | 'calendar';

interface PreferencesState {
  units: Units;
  view: PlanView;
  setUnits: (units: Units) => void;
  setView: (view: PlanView) => void;
}

/** How this viewer likes things shown. Saved per browser, and deliberately not in shared links. */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      units: 'metric',
      view: 'timeline',
      setUnits: (units) => set({ units }),
      setView: (view) => set({ view }),
    }),
    {
      name: 'japan-2027-trip-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
