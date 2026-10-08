import { getDestination } from '@/data/dataset';
import { NIGHT_COUNT } from '@/lib/trip';
import type { Plan } from '@/lib/plan';

/**
 * The plan in the URL's fragment, readable by eye: one entry per night, `.`-separated, the
 * destination's id with `!` when pinned and `_` when empty —
 * `#plan=!nagoya.!suzuka.!suzuka.osaka.osaka.gero._.…`
 *
 * The pin mark leads the id: chat apps cut trailing punctuation off a link, and a trailing `!` on
 * a pinned last night would be lost. Links from before this, with the mark after the id, still read.
 *
 * In the fragment rather than the query, so it is never sent to the server hosting the page.
 */

const PARAMETER = 'plan';
const EMPTY = '_';
const PINNED = '!';

export const encodePlan = (plan: Plan): string =>
  plan
    .map((night) =>
      night.destinationId === null ? EMPTY : `${night.pinned ? PINNED : ''}${night.destinationId}`,
    )
    .join('.');

/** The plan in `hash`, or null if there is none. Unknown destinations read as empty nights. */
export const decodePlan = (hash: string): Plan | null => {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get(PARAMETER);
  if (!encoded) return null;
  const entries = encoded.split('.');
  return Array.from({ length: NIGHT_COUNT }, (_, index) => {
    const entry = entries[index] ?? EMPTY;
    const pinned = entry.startsWith(PINNED) || entry.endsWith(PINNED);
    const id = entry.replace(/^!|!$/g, '');
    return id !== EMPTY && getDestination(id)
      ? { destinationId: id, pinned }
      : { destinationId: null, pinned: false };
  });
};

export const planHash = (plan: Plan): string => `#${PARAMETER}=${encodePlan(plan)}`;

export const shareUrl = (plan: Plan): string => {
  const url = new URL(window.location.href);
  url.hash = planHash(plan);
  return url.toString();
};
