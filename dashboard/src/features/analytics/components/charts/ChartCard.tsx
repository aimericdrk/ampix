import { useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { Button } from '../../../../components/ui/button';
import { downloadPng, svgToPngBlob } from '../../../../lib/chart-image';

/**
 * The titled chart container every chart composes: a header (title + optional description, with
 * an optional top-right `action` such as a breakdown selector) and a body driven by `state`.
 * `loading` swaps `children` for skeleton placeholders, `empty`/`error` show a short message
 * instead, and `ready` (the default) renders `children` as-is.
 *
 * When `exportImageName` is set, an "Export PNG" button appears alongside `action` in the header.
 * It finds the first `<svg>` rendered inside the card body and rasterizes it via
 * `svgToPngBlob`/`downloadPng` (see `lib/chart-image.ts`) — no restructuring of the chart itself
 * is required, since Recharts always renders an SVG.
 */
export function ChartCard({
  title,
  description,
  action,
  state = 'ready',
  emptyText = 'No data for this range.',
  errorText = 'Something went wrong loading this chart.',
  exportImageName,
  children,
}: {
  title: string;
  description?: string;
  /** Rendered top-right in the header, e.g. a breakdown selector. */
  action?: ReactNode;
  state?: 'loading' | 'empty' | 'error' | 'ready';
  emptyText?: string;
  errorText?: string;
  /** When set, renders an "Export PNG" button that downloads the chart's SVG as
   * `${exportImageName}.png`. Omit to keep the card exactly as before. */
  exportImageName?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExportImage = async () => {
    if (!exportImageName) return;
    const svg = contentRef.current?.querySelector('svg');
    if (!svg) return;

    setExporting(true);
    try {
      const blob = await svgToPngBlob(svg);
      downloadPng(exportImageName, blob);
    } catch {
      // Rasterization failed (e.g. unsupported environment) — nothing to download.
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {exportImageName && state === 'ready' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExportImage}
              disabled={exporting}
            >
              Export PNG
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {state === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton data-testid="chart-card-skeleton" className="h-48 w-full" />
          </div>
        )}
        {state === 'empty' && <p className="text-sm text-text-muted">{emptyText}</p>}
        {state === 'error' && <p className="text-sm text-danger">{errorText}</p>}
        {state === 'ready' && <div ref={contentRef}>{children}</div>}
      </CardContent>
    </Card>
  );
}
