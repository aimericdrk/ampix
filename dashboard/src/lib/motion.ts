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

const motionSafeQuery = '(prefers-reduced-motion: no-preference)';

function subscribeMotionSafe(callback: () => void) {
  const mql = window.matchMedia(motionSafeQuery);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

/**
 * True only when the environment POSITIVELY declares it's fine with motion — the reactive
 * counterpart of `useReducedMotion` above, used by the chart kit (`chart-theme.tsx`) to gate
 * Recharts draw-in animation. The polarity deliberately differs from `useReducedMotion`: instead
 * of negating `reduce`, this subscribes to the AFFIRMATIVE `no-preference` query and only a
 * positive match enables motion. In a real browser the two are exact complements (the media
 * feature has exactly two values), but in jsdom the `matchMedia` stub (`src/test/setup.ts`)
 * returns `matches: false` for EVERY query — so tests resolve to "not motion-safe", which matters
 * because Recharts 3 draws animated bar/pie paths only after animation frames tick, and jsdom
 * never ticks them (DOM-presence assertions would otherwise see an empty chart). Server snapshot
 * is `false` (no motion), matching `useReducedMotion`'s safe default.
 */
export function useMotionSafe(): boolean {
  return useSyncExternalStore(
    subscribeMotionSafe,
    () => window.matchMedia(motionSafeQuery).matches,
    () => false,
  );
}

/** Springy pop for overlays/indicators (motion lib transition preset). */
export const springTransition = { type: 'spring', stiffness: 500, damping: 32 } as const;
/** Standard content entrance. */
export const easeOutTransition = { duration: 0.25, ease: [0.16, 1, 0.3, 1] } as const;
