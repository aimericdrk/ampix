import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CollapsibleTableProps {
  /** The toggle's label — the table's name, e.g. "Table", "Nodes", "Transitions". */
  title?: string;
  /** Row count rendered next to the title, so the size is legible while collapsed. */
  count?: number;
  /** Whether the table is expanded on first render. Defaults to `false` (collapsed). */
  defaultOpen?: boolean;
  children: ReactNode;
  /** Id for the collapsible region; auto-generated via `useId` when omitted. */
  id?: string;
  className?: string;
}

/**
 * The disclosure that wraps a chart's raw data table. Every chart on the dashboard ships an exact,
 * per-bucket table underneath it; on a 30-day range that is 30 rows of scrolling between one chart
 * and the next, so the table is collapsed by default and opened on demand.
 *
 * It stays a real disclosure rather than an unmount: the table is always in the DOM behind
 * `hidden`, and the toggle carries `aria-expanded`/`aria-controls`, so the chart's accessible
 * alternative view is one activation away for assistive tech (and findable by name + row count
 * while closed).
 */
export function CollapsibleTable({
  title = 'Table',
  count,
  defaultOpen = false,
  children,
  id,
  className,
}: CollapsibleTableProps) {
  const [open, setOpen] = useState(defaultOpen);
  const generatedId = useId();
  const regionId = id ?? generatedId;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronDown
          aria-hidden="true"
          size={16}
          className={cn('shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
        {title}
        {count !== undefined && <span className="text-xs tabular-nums">({count})</span>}
      </button>
      <div id={regionId} hidden={!open} className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
