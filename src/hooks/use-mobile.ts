import { useCallback, useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * True on viewports narrower than 768px.
 *
 * This replaces the version the shadcn CLI generates, which set state inside an
 * effect and so caused a cascading render on every mount. `useSyncExternalStore`
 * subscribes to the media query directly, reads the value during render, and
 * returns false on the server, which keeps the first client render consistent
 * with the server output.
 */
export default function useIsMobile(): boolean {
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
