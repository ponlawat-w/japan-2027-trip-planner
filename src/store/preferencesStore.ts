import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Units = 'metric' | 'imperial';
/** How the nights are laid out: one row of days, or a month calendar. */
export type PlanView = 'timeline' | 'calendar';
/** The first column of the calendar, as `Date.getDay()` counts it: 0 Sunday, 1 Monday. */
export type WeekStart = 0 | 1;

interface PreferencesState {
  units: Units;
  view: PlanView;
  weekStart: WeekStart;
  setUnits: (units: Units) => void;
  setView: (view: PlanView) => void;
  setWeekStart: (weekStart: WeekStart) => void;
}

/** How this viewer likes things shown. Saved per browser, and deliberately not in shared links. */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      units: 'metric',
      view: 'timeline',
      weekStart: 0,
      setUnits: (units) => set({ units }),
      setView: (view) => set({ view }),
      setWeekStart: (weekStart) => set({ weekStart }),
    }),
    {
      name: 'japan-2027-trip-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
