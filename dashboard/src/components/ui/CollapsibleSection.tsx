import { useId, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CollapsibleSectionProps {
  /** The section's title, rendered as the toggle button's accessible name. */
  title: string;
  /** Whether the content is expanded on first render. Defaults to `true`. */
  defaultOpen?: boolean;
  children: ReactNode;
  /** Id for the collapsible region; auto-generated via `useId` when omitted. */
  id?: string;
  className?: string;
}

/**
 * An accessible disclosure: a `<button aria-expanded aria-controls>` heading that toggles the
 * visibility of a content region. Used to let data-dense pages (e.g. the user profile) collapse
 * secondary sections without removing them from the DOM.
 */
export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  id,
  className,
}: CollapsibleSectionProps) {
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
        className="flex items-center gap-2 text-left text-lg font-semibold"
      >
        <span aria-hidden className="text-text-muted">
          {open ? '▾' : '▸'}
        </span>
        {title}
      </button>
      <div id={regionId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
