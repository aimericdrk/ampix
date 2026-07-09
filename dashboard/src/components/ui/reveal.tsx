import type { ReactNode } from 'react';
import { m } from 'motion/react';
import { cn } from '../../lib/cn';
import { easeOutTransition, useReducedMotion } from '../../lib/motion';

export interface RevealProps {
  children: ReactNode;
  /** Base delay in seconds before the entrance animation starts. */
  delay?: number;
  /** Position in a staggered sequence; each step adds 60ms of delay. */
  index?: number;
  className?: string;
}

/** Fade-up entrance for content; renders a plain div under reduced motion. */
export function Reveal({ children, delay, index, className }: RevealProps) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <m.div
      className={cn(className)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...easeOutTransition, delay: (delay ?? 0) + (index ?? 0) * 0.06 }}
    >
      {children}
    </m.div>
  );
}
