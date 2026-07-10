import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** A shimmering placeholder block shown while data is loading. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--surface)_25%,var(--surface-raised)_50%,var(--surface)_75%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
