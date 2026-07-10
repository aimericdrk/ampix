import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}

/** Centered placeholder for empty lists/tables with an optional icon and call-to-action. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-12 text-center">
      <div className="relative mb-3 flex items-center justify-center">
        <div className="absolute size-24 rounded-full bg-gradient-brand opacity-20 blur-2xl" />
        {Icon ? (
          <div className="relative flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-6">
            <Icon aria-hidden="true" />
          </div>
        ) : null}
      </div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-center text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
