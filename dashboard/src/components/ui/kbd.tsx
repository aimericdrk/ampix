import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'rounded border border-border bg-surface-raised px-1.5 py-0.5 font-sans text-[11px] text-text-muted',
        'shadow-[inset_0_-1px_0_var(--border)]',
        className,
      )}
      {...props}
    />
  ),
);
Kbd.displayName = 'Kbd';
