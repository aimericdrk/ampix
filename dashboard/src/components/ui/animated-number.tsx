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
 * Counts from the previous value up to `value` over 800ms with ease-out easing.
 * Renders the final value immediately under reduced motion or in tests, since
 * jsdom offers no reliable rAF timing.
 */
export function AnimatedNumber({ value, format = defaultFormat, className }: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion();
  const skipAnimation = reducedMotion || import.meta.env.MODE === 'test';
  const [display, setDisplay] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    if (skipAnimation) {
      setDisplay(value);
      previousValueRef.current = value;
      return;
    }

    const from = previousValueRef.current;
    const to = value;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / DURATION_MS, 1);
      const eased = easeOutCubic(t);
      setDisplay(from + (to - from) * eased);

      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previousValueRef.current = to;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, skipAnimation]);

  const rendered = skipAnimation ? value : display;

  return <span className={cn('tabular-nums', className)}>{format(rendered)}</span>;
}
