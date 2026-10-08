import { useSyncExternalStore } from 'react';

export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );

/** The breakpoint at which the timeline turns from a vertical list into a row of days. */
export const useIsWide = (): boolean => useMediaQuery('(min-width: 768px)');
