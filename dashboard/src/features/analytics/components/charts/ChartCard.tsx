import { type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/Skeleton';

/**
 * The titled chart container every chart composes: a header (title + optional description, with
 * an optional top-right `action` such as a breakdown selector) and a body driven by `state`.
 * `loading` swaps `children` for skeleton placeholders, `empty`/`error` show a short message
 * instead, and `ready` (the default) renders `children` as-is.
 */
export function ChartCard({
  title,
  description,
  action,
  state = 'ready',
  emptyText = 'No data for this range.',
  errorText = 'Something went wrong loading this chart.',
  children,
}: {
  title: string;
  description?: string;
  /** Rendered top-right in the header, e.g. a breakdown selector. */
  action?: ReactNode;
  state?: 'loading' | 'empty' | 'error' | 'ready';
  emptyText?: string;
  errorText?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        {state === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton data-testid="chart-card-skeleton" className="h-48 w-full" />
          </div>
        )}
        {state === 'empty' && <p className="text-sm text-text-muted">{emptyText}</p>}
        {state === 'error' && <p className="text-sm text-danger">{errorText}</p>}
        {state === 'ready' && children}
      </CardContent>
    </Card>
  );
}
