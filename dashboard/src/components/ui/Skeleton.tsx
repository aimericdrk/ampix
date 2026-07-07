import { type HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** A shimmering placeholder block shown while data is loading. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded bg-border/40', className)} {...props} />;
}
