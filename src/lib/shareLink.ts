import { getDestination } from '@/data/dataset';
import { NIGHT_COUNT } from '@/lib/trip';
import type { ModeChoices, Plan } from '@/lib/plan';
import { legKey, type TransportMode } from '@/types/data';

/**
 * The plan in the URL's fragment, readable by eye: one entry per night, `.`-separated, the
 * destination's id, or `_` when empty — `#plan=nagoya.suzuka.suzuka.osaka.osaka.gero._.…`
 *
 * Links from when stays could be pinned carry a `!` before or after some ids; it is ignored.
 *
 * Transport choices that differ from the default follow, one parameter per mode, each a
 * `.`-separated list of `from~to` pairs — `&road=nagoya~tokyo` drives a leg that has a train.
 *
 * In the fragment rather than the query, so it is never sent to the server hosting the page.
 */

const PARAMETER = 'plan';
const EMPTY = '_';
const OLD_PIN_MARK = /^!|!$/g;
const MODES: TransportMode[] = ['road', 'train'];
const PAIR = '~';

export const encodePlan = (plan: Plan): string =>
  plan.map((night) => night.destinationId ?? EMPTY).join('.');

/** The plan in `hash`, or null if there is none. Unknown destinations read as empty nights. */
export const decodePlan = (hash: string): Plan | null => {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get(PARAMETER);
  if (!encoded) return null;
  const entries = encoded.split('.');
  return Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const id = (entries[index] ?? EMPTY).replace(OLD_PIN_MARK, '');
    return { destinationId: id !== EMPTY && getDestination(id) ? id : null };
  });
};

/** The transport choices in `hash`. Pairs naming an unknown destination are dropped. */
export const decodeModes = (hash: string): ModeChoices => {
  const parameters = new URLSearchParams(hash.replace(/^#/, ''));
  const modes: ModeChoices = {};
  for (const mode of MODES) {
    for (const pair of parameters.get(mode)?.split('.') ?? []) {
      const [from, to] = pair.split(PAIR);
      if (getDestination(from) && getDestination(to)) modes[legKey(from, to)] = mode;
    }
  }
  return modes;
};

const encodeModes = (modes: ModeChoices): string =>
  MODES.map((mode) => {
    const pairs = Object.entries(modes)
      .filter(([, chosen]) => chosen === mode)
      .map(([key]) => key.replace('>', PAIR))
      .sort();
    return pairs.length > 0 ? `&${mode}=${pairs.join('.')}` : '';
  }).join('');

export const planHash = (plan: Plan, modes: ModeChoices = {}): string =>
  `#${PARAMETER}=${encodePlan(plan)}${encodeModes(modes)}`;

export const shareUrl = (plan: Plan, modes: ModeChoices = {}): string => {
  const url = new URL(window.location.href);
  url.hash = planHash(plan, modes);
  return url.toString();
};
