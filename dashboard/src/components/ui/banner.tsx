import { type AriaRole, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  variant?: BannerVariant;
  title?: string;
  children: ReactNode;
  className?: string;
  /**
   * Overrides the variant's default ARIA role. Transient messages should keep the live-region
   * default (info/success → `status`, warning/danger → `alert`); permanently-visible framing
   * content (e.g. a danger-zone card frame) should pass `role="note"` so it doesn't announce
   * as a live alert or collide with real transient alerts on the page.
   */
  role?: AriaRole;
}

const variantConfig: Record<
  BannerVariant,
  { icon: typeof Info; role: 'status' | 'alert'; classes: string }
> = {
  info: { icon: Info, role: 'status', classes: 'border-info bg-info-soft text-info' },
  success: { icon: CircleCheck, role: 'status', classes: 'border-success bg-success-soft text-success' },
  warning: { icon: TriangleAlert, role: 'alert', classes: 'border-warning bg-warning-soft text-warning' },
  danger: { icon: CircleAlert, role: 'alert', classes: 'border-danger bg-danger-soft text-danger' },
};

/** Inline status/alert banner with soft tint, left accent border, and matching icon. */
export function Banner({ variant = 'info', title, children, className, role }: BannerProps) {
  const { icon: Icon, role: defaultRole, classes } = variantConfig[variant];

  return (
    <div
      role={role ?? defaultRole}
      className={cn('flex gap-2.5 rounded-lg border-l-2 p-3.5 text-sm', classes, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
