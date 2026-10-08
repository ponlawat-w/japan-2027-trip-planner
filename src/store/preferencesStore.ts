import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type Units = 'metric' | 'imperial';

interface PreferencesState {
  units: Units;
  setUnits: (units: Units) => void;
}

/** How this viewer likes things shown. Saved per browser, and deliberately not in shared links. */
export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      units: 'metric',
      setUnits: (units) => set({ units }),
    }),
    {
      name: 'japan-2027-trip-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
