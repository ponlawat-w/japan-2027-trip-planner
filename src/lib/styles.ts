import type { DestinationKind, Difficulty, RailService } from '@/types/data';

/**
 * Colours that carry meaning, held once so the timeline, the map and the leg list agree.
 *
 * Difficulty runs green to red. Destination kinds take hues clear of that ramp (blue, pink,
 * slate), so a stop's colour is never mistaken for a difficulty. Trains are white and violet,
 * and ferries cyan, clear of both: neither is ever read as a drive of some difficulty.
 */

export const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  1: '#4ade80',
  2: '#a3e635',
  3: '#facc15',
  4: '#fb923c',
  5: '#f87171',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: 'Easy',
  2: 'Moderate',
  3: 'Demanding',
  4: 'Hard',
  5: 'Severe',
};

export const KIND_COLORS: Record<DestinationKind, string> = {
  airport: '#cbd5e1',
  city: '#38bdf8',
  onsen: '#f472b6',
};

export const KIND_LABELS: Record<DestinationKind, string> = {
  airport: 'Airport',
  city: 'City',
  onsen: 'Onsen',
};

export const SERVICE_COLORS: Record<RailService, string> = {
  shinkansen: '#f8fafc',
  local: '#a78bfa',
};

/** The boat's course: cyan, clear of the difficulty ramp and of both train services. */
export const FERRY_COLOR = '#22d3ee';

/** The rental car's days, and driving in it: amber. Someone else's car is a quiet slate. */
export const RENTAL_COLOR = '#fbbf24';
export const CAR_COLOR = '#94a3b8';

/** What a car leg is called: in the rental the traveller drives, or in someone else's car. */
export const carLabel = (rental: boolean): string => (rental ? 'Rental car' : "Someone else's car");

export const SERVICE_LABELS: Record<RailService, string> = {
  shinkansen: 'Shinkansen',
  local: 'Local train',
};
