import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Reveal } from './reveal';

export interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Standalone page-level heading: icon tile, title, description, breadcrumbs, and right-aligned
 * actions. Not yet wired into `PageShell` (Task 11 does that) — used directly for now. */
export function PageHeader({ icon: Icon, title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <Reveal className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs ? <div className="text-sm text-text-muted">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">
              <Icon aria-hidden="true" />
            </div>
          ) : null}
          <div>
            <h1 className="font-display text-2xl font-semibold">{title}</h1>
            {description ? <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </Reveal>
  );
}
