import { useCallback, useSyncExternalStore } from 'react';

/**
 * Live `matchMedia` result, correct on the very first render (unlike
 * useIsMobile), so it can pick options that are only read at mount.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
  );
}
