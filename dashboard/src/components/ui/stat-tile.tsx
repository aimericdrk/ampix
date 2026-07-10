import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { AnimatedNumber } from './animated-number';
import { Badge } from './badge';
import { Card } from './card';
import { Reveal } from './reveal';

export interface StatTileProps {
  label: string;
  value: number;
  format?: (n: number) => string;
  delta?: number;
  deltaLabel?: string;
  sparkline?: ReactNode;
  icon?: LucideIcon;
  index?: number;
  className?: string;
  /**
   * Extra content rendered inside the card, directly after the delta row — no wrapper element,
   * so it stays a flat descendant of the card alongside the label/value (adapters that need a
   * hint line, a "not filtered yet" note, etc. beyond this shape's props render them here; a few
   * page tests scope assertions by a label's or hint's containing element and rely on this
   * flatness). Additive slot for Task 13's chart-dir adapters — kept optional so every existing
   * caller is unaffected.
   */
  children?: ReactNode;
}

/** KPI card: label, animated value, optional delta badge (up/down/flat) and deltaLabel, optional
 * icon tile, and an optional sparkline pinned to the bottom edge as a faint backdrop. */
export function StatTile({
  label,
  value,
  format,
  delta,
  deltaLabel,
  sparkline,
  icon: Icon,
  index,
  className,
  children,
}: StatTileProps) {
  return (
    <Reveal index={index}>
      <Card interactive className={cn('relative overflow-hidden p-6', className)}>
        {Icon ? (
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</span>
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-4">
              <Icon aria-hidden="true" />
            </div>
          </div>
        ) : (
          <span className="block text-xs font-medium uppercase tracking-wide text-text-muted">
            {label}
          </span>
        )}
        <AnimatedNumber
          value={value}
          format={format}
          className="mt-2 block font-display text-3xl font-semibold"
        />
        {delta !== undefined && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {delta > 0 ? (
              <Badge variant="success" className="inline-flex items-center gap-1">
                <TrendingUp aria-hidden="true" size={12} />
                {`+${delta}%`}
              </Badge>
            ) : delta < 0 ? (
              <Badge variant="danger" className="inline-flex items-center gap-1">
                <TrendingDown aria-hidden="true" size={12} />
                {`${delta}%`}
              </Badge>
            ) : (
              <Badge variant="default">0%</Badge>
            )}
            {deltaLabel ? <span className="text-xs text-text-muted">{deltaLabel}</span> : null}
          </div>
        )}
        {children}
        {sparkline ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-40">{sparkline}</div>
        ) : null}
      </Card>
    </Reveal>
  );
}
