import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { useReducedMotion } from '../../lib/motion';

const DURATION_MS = 800;

const defaultFormat = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** Ease-out cubic. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * Counts from 0 (or the currently displayed value) up to `value` over 800ms with
 * ease-out easing. Renders the final value immediately under reduced motion or in
 * tests, since jsdom offers no reliable rAF timing.
 */
export function AnimatedNumber({ value, format = defaultFormat, className }: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const skipAnimation = reducedMotion || import.meta.env.MODE === 'test';
  const [display, setDisplay] = useState(0);
  // Last value actually rendered, updated on every tick. Using this (rather than the
  // previous *target*) as the tween origin means a `value` change mid-animation
  // retargets smoothly from wherever the count currently is, instead of jumping
  // backward to a stale origin.
  const displayRef = useRef(0);

  useEffect(() => {
    if (skipAnimation) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }

    const from = displayRef.current;
    const to = value;
    // An integer-to-integer tween must never surface fractional intermediates: callers often
    // pass full-precision formatters (e.g. formatExactNumber) with no fraction cap, so raw
    // interpolation would flicker values like "617.284" before settling on "617". Rounding
    // each tick also keeps displayRef integer, so a mid-flight retarget between integers
    // stays on the integer path. Non-integer targets keep raw interpolation — their
    // formatters expect fractional values.
    const integerTween = Number.isInteger(from) && Number.isInteger(to);
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / DURATION_MS, 1);
      const raw = from + (to - from) * easeOutCubic(t);
      const next = integerTween ? Math.round(raw) : raw;
      displayRef.current = next;
      setDisplay(next);

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, skipAnimation]);

  const rendered = skipAnimation ? value : display;

  return <span className={cn('tabular-nums', className)}>{format(rendered)}</span>;
}
