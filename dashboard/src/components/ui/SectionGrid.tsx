import { type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A responsive density grid for KPI rows / chart grids: columns auto-fill to fit the container,
 * each at least `min` px wide, sharing the remaining space evenly (`repeat(auto-fill, minmax(min, 1fr))`).
 */
export function SectionGrid({
  min = 240,
  children,
  className,
}: {
  /** Minimum column width in px before wrapping to a new row. Defaults to 240. */
  min?: number;
  children: ReactNode;
  className?: string;
}) {
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
  };

  return (
    <div className={cn('grid gap-4', className)} style={style}>
      {children}
    </div>
  );
}
