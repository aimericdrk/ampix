import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/** True when the user prefers reduced motion (defaults to true on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}

/** Springy pop for overlays/indicators (motion lib transition preset). */
export const springTransition = { type: 'spring', stiffness: 500, damping: 32 } as const;
/** Standard content entrance. */
export const easeOutTransition = { duration: 0.25, ease: [0.16, 1, 0.3, 1] } as const;
