import { AIRPORT, getLeg, STAYABLE } from '@/data/dataset';
import type { Destination } from '@/types/data';
import type { Plan } from '@/lib/plan';

/**
 * Fills every unpinned night with the plan that best trades places worth seeing against driving.
 *
 * Simulated annealing over the unpinned nights, with pinned nights fixed. The search space is tiny
 * (13 nights, a few dozen places), so a few tens of thousands of steps settle in milliseconds and
 * the result needs no cleverer optimiser.
 *
 * Two rules are absolute: a destination already pinned somewhere is never chosen, and every other
 * destination is chosen for at most one stay. When the places run out — or would have to be
 * stretched past their maximum nights — the remaining nights are left empty for a person to decide.
 *
 * The seed varies two things: the path the search takes, and a ±25% wobble on every rating. The
 * wobble is what makes clicking again worthwhile — plans that score within a whisker of each other
 * take turns being "best", instead of the same one winning every time.
 */

// --- Weights, in "points": a night at a rating-1 place is worth 1 point. ----------------------

/** A night beyond a place's ideal count is worth this share of a first night there. */
const EXTRA_NIGHT_SHARE = 0.35;
/** One hour at the wheel (winter-adjusted time). */
const DRIVE_HOUR_COST = 1;
/** Every move: check-out, packing, finding the next car park. */
const MOVE_COST = 0.75;
/** A day's drive beyond this many hours costs extra per hour: long days in snow are tiring. */
const COMFORTABLE_DRIVE_HOURS = 4.5;
const LONG_DRIVE_HOUR_COST = 1.5;
/** Per difficulty step above 3, on top of the slower winter time already counted. */
const HARD_LEG_COST = 1.5;
/**
 * An empty night. Larger than anything a night's value or a drive can add up to, so a night is
 * only left empty when there is no allowed way to fill it.
 */
const EMPTY_NIGHT_PENALTY = 20;
/**
 * Breaking a rule (a second stay at one place, a stay past its maximum). Larger again than an empty
 * night, so the search always prefers emptiness to a broken rule.
 */
const RULE_PENALTY = 100;

const RATING_WOBBLE = 0.25;
const ITERATIONS = 40000;
const RESTARTS = 3;
const START_TEMPERATURE = 3;
const END_TEMPERATURE = 0.03;

/** Marks an empty night inside the search, where every night is a string. */
const EMPTY = '';

/** mulberry32: small, fast and good enough for a seeded search. */
export const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randomSeed = (): number => Math.floor(Math.random() * 1_000_000);

const driveCost = (from: string, to: string): number => {
  const leg = getLeg(from, to);
  if (!leg) return 50;
  const hours = leg.winterDurationMin / 60;
  return (
    MOVE_COST +
    hours * DRIVE_HOUR_COST +
    Math.max(0, hours - COMFORTABLE_DRIVE_HOURS) * LONG_DRIVE_HOUR_COST +
    Math.max(0, leg.difficulty - 3) * HARD_LEG_COST
  );
};

export interface AutofillResult {
  plan: Plan;
  /** False when there was nothing to fill: every night is pinned. */
  changed: boolean;
}

export const autofill = (plan: Plan, seed: number): AutofillResult => {
  const random = createRandom(seed);
  const free = plan.flatMap((night, index) => (night.pinned ? [] : [index]));
  if (free.length === 0) return { plan, changed: false };

  // Worth visiting, and not already on the plan as a pinned stay.
  const pinnedIds = new Set(plan.flatMap((night) => (night.pinned ? [night.destinationId] : [])));
  const candidates: Destination[] = STAYABLE.filter(
    (destination) => destination.rating > 0 && !pinnedIds.has(destination.id),
  );
  const candidateIds = new Set(candidates.map((destination) => destination.id));

  const byId = new Map(STAYABLE.map((destination) => [destination.id, destination]));
  const ratings = new Map(
    candidates.map((destination) => [
      destination.id,
      destination.rating * (1 + RATING_WOBBLE * (random() * 2 - 1)),
    ]),
  );
  const costCache = new Map<string, number>();
  const cachedDriveCost = (from: string, to: string): number => {
    const key = `${from}>${to}`;
    if (!costCache.has(key)) costCache.set(key, driveCost(from, to));
    return costCache.get(key)!;
  };

  /**
   * Higher is better. Only what auto-fill controls is scored: pinned stays' own value is the same
   * in every candidate plan, so it would not change which one wins.
   */
  const score = (nights: string[]): number => {
    let total = 0;
    const stays = new Map<string, number>();
    let previous = AIRPORT.id;
    // Widened with `as`: it is reassigned inside `closeRun`, which narrowing does not follow.
    let run = null as { id: string; length: number } | null;
    const closeRun = () => {
      if (!run) return;
      stays.set(run.id, (stays.get(run.id) ?? 0) + 1);
      const destination = byId.get(run.id);
      if (destination && candidateIds.has(run.id)) {
        const rating = ratings.get(run.id) ?? 0;
        for (let k = 1; k <= run.length; k++) {
          total += k <= destination.idealNights ? rating : rating * EXTRA_NIGHT_SHARE;
        }
        if (run.length > destination.maxNights) {
          total -= (run.length - destination.maxNights) * RULE_PENALTY;
        }
      }
      run = null;
    };
    for (const id of nights) {
      if (id === EMPTY) {
        closeRun();
        total -= EMPTY_NIGHT_PENALTY;
        continue;
      }
      if (run?.id === id) {
        run.length++;
        continue;
      }
      closeRun();
      if (id !== previous) total -= cachedDriveCost(previous, id);
      previous = id;
      run = { id, length: 1 };
    }
    closeRun();
    total -= cachedDriveCost(previous, AIRPORT.id);
    for (const [id, count] of stays) {
      if (candidateIds.has(id) && count > 1) total -= (count - 1) * RULE_PENALTY;
    }
    return total;
  };

  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

  /** A candidate not used anywhere else in `nights` (outside `except`), or empty if none is left. */
  const unusedCandidate = (nights: string[], except: [number, number] = [-1, -1]): string => {
    const used = new Set(nights.filter((_, i) => i < except[0] || i > except[1]));
    const unused = candidates.filter((destination) => !used.has(destination.id));
    return unused.length > 0 ? pick(unused).id : EMPTY;
  };

  const initial = (): string[] => {
    const nights = plan.map((night) => (night.pinned ? night.destinationId! : EMPTY));
    let i = 0;
    while (i < nights.length) {
      if (plan[i].pinned) {
        i++;
        continue;
      }
      const id = unusedCandidate(nights);
      const length = id === EMPTY ? 1 : 1 + Math.floor(random() * byId.get(id)!.idealNights);
      for (let k = 0; k < length && i < nights.length && !plan[i].pinned; k++, i++) nights[i] = id;
    }
    return nights;
  };

  /** The run of free nights holding the same value as night `at`. */
  const runAround = (nights: string[], at: number): [number, number] => {
    let first = at;
    let last = at;
    while (first > 0 && !plan[first - 1].pinned && nights[first - 1] === nights[at]) first--;
    while (last < nights.length - 1 && !plan[last + 1].pinned && nights[last + 1] === nights[at]) {
      last++;
    }
    return [first, last];
  };

  const neighbour = (nights: string[]): string[] => {
    const next = [...nights];
    const at = pick(free);
    const move = random();
    if (move < 0.25) {
      // A different place for this one night.
      next[at] = unusedCandidate(nights, [at, at]);
    } else if (move < 0.35) {
      next[at] = EMPTY;
    } else if (move < 0.6) {
      // Extend a neighbouring stay over this night: how multi-night stays form.
      const side = random() < 0.5 ? at - 1 : at + 1;
      if (side >= 0 && side < next.length && candidateIds.has(next[side])) next[at] = next[side];
    } else if (move < 0.85) {
      // A different place for the whole stay.
      const [first, last] = runAround(nights, at);
      const id = unusedCandidate(nights, [first, last]);
      for (let i = first; i <= last; i++) next[i] = id;
    } else {
      // Swap two stays' places, keeping their lengths: reorders the route.
      const other = pick(free);
      const [a1, a2] = runAround(nights, at);
      const [b1, b2] = runAround(nights, other);
      const a = nights[at];
      const b = nights[other];
      for (let i = a1; i <= a2; i++) next[i] = b;
      for (let i = b1; i <= b2; i++) next[i] = a;
    }
    return next;
  };

  let best = initial();
  let bestScore = score(best);
  for (let restart = 0; restart < RESTARTS; restart++) {
    let current = restart === 0 ? best : initial();
    let currentScore = score(current);
    for (let step = 0; step < ITERATIONS; step++) {
      const temperature =
        START_TEMPERATURE * (END_TEMPERATURE / START_TEMPERATURE) ** (step / ITERATIONS);
      const candidate = neighbour(current);
      const candidateScore = score(candidate);
      const delta = candidateScore - currentScore;
      if (delta >= 0 || random() < Math.exp(delta / temperature)) {
        current = candidate;
        currentScore = candidateScore;
        if (currentScore > bestScore) {
          best = current;
          bestScore = currentScore;
        }
      }
    }
  }

  return {
    plan: plan.map((night, index) =>
      night.pinned
        ? night
        : { destinationId: best[index] === EMPTY ? null : best[index], pinned: false },
    ),
    changed: true,
  };
};
