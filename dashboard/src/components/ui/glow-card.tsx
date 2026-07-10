import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface GlowCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Class names for the outer gradient-border wrapper. */
  outerClassName?: string;
}

/** Card with a gradient-border glow, used for hero/highlight tiles. */
export function GlowCard({ className, outerClassName, ...props }: GlowCardProps) {
  return (
    <div className={cn('relative rounded-xl bg-gradient-brand p-px', outerClassName)}>
      <div className={cn('rounded-[11px] bg-surface', className)} {...props} />
    </div>
  );
}
