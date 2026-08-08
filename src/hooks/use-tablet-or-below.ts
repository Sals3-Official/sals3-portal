import { useCallback, useSyncExternalStore } from 'react';

const TABLET_BREAKPOINT = 1024;
const QUERY = `(max-width: ${TABLET_BREAKPOINT - 1}px)`;

/**
 * True on viewports narrower than 1024px (phones and tablets alike) - the
 * portal rail's "stay compact below ~1024px" rule. Mirrors `useIsMobile`'s
 * `useSyncExternalStore` pattern so the first client render matches the
 * server (`false`) instead of flashing an expanded rail before collapsing.
 */
export default function useIsTabletOrBelow(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia(QUERY);

    query.addEventListener('change', onChange);

    return () => query.removeEventListener('change', onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
