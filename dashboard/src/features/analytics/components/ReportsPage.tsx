import { Link, useParams } from '@tanstack/react-router';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type { ReportKind, SavedReportSummary } from '../../../lib/api/types';
import { REPORT_KINDS } from '../../../lib/api/types';
import { useDeleteReport, useReportPreview, useReports } from '../api';
import { PageShell } from '../../../components/layout/PageShell';
import { FavoriteButton } from '../../favorites/FavoriteButton';
import { useFavorites } from '../../favorites/favorites';
import { analysisResultIsEmpty } from './ReportChart';
import { ChartThumbnail, type ChartThumbnailState } from './ChartThumbnail';

const KIND_LABELS: Record<ReportKind, string> = {
  insights: 'Insights',
  funnel: 'Funnels',
  retention: 'Retention',
  flows: 'Flows',
};

export function ReportsPage() {
  const { projectId } = useParams({ from: '/private/projects/$projectId/reports' });
  const reports = useReports(projectId);
  const deleteReport = useDeleteReport(projectId);
  const favorites = useFavorites(projectId);

  const byKind = (kind: ReportKind): SavedReportSummary[] =>
    (reports.data?.reports ?? []).filter((report) => report.kind === kind);

  return (
    <PageShell
      projectId={projectId}
      title="Reports"
      description="Your saved analyses, ready to re-run or add to a dashboard."
      breadcrumbs={[{ label: 'Saved' }, { label: 'Reports' }]}
    >
      {reports.isPending && <p role="status">Loading reports…</p>}
      {reports.error && (
        <p role="alert" className="text-danger">
          {reports.error instanceof ApiError ? reports.error.problem.title : 'Failed to load reports'}
        </p>
      )}

      {reports.data && reports.data.reports.length === 0 && (
        <p className="text-text-muted">
          No saved reports yet. Build an analysis, then choose “Save as report”.
        </p>
      )}

      {reports.data && reports.data.reports.length > 0 && (
        <div className="flex flex-col gap-6">
          {REPORT_KINDS.map((kind) => {
            const group = byKind(kind);
            if (group.length === 0) return null;
            return (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle>{KIND_LABELS[kind]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                    {group.map((report) => (
                      <ReportCard
                        key={report.id}
                        projectId={projectId}
                        report={report}
                        onDelete={() => deleteReport.mutate(report.id)}
                        isFavorite={favorites.isFavorite('report', report.id)}
                        onToggleFavorite={() =>
                          favorites.toggle({ type: 'report', id: report.id, name: report.name })
                        }
                      />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

/**
 * One report as a small card: a decorative `ChartThumbnail` (its live preview via
 * `useReportPreview`) over the name link + Delete. The preview query's state maps directly to the
 * thumbnail: pending → loading, error → error, empty result → empty, otherwise ready.
 */
function ReportCard({
  projectId,
  report,
  onDelete,
  isFavorite,
  onToggleFavorite,
}: {
  projectId: string;
  report: SavedReportSummary;
  onDelete: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  const preview = useReportPreview(projectId, report.id);

  let state: ChartThumbnailState;
  if (preview.isPending) state = 'loading';
  else if (preview.isError || !preview.data) state = 'error';
  else if (analysisResultIsEmpty(report.kind, preview.data)) state = 'empty';
  else state = 'ready';

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2">
      <ChartThumbnail kind={report.kind} result={preview.data} state={state} />
      <div className="flex items-center gap-2">
        <Link
          to="/projects/$projectId/reports/$reportId"
          params={{ projectId, reportId: report.id }}
          className="flex-1 truncate text-sm font-medium text-accent underline"
        >
          {report.name}
        </Link>
        <FavoriteButton name={report.name} isFavorite={isFavorite} onToggle={onToggleFavorite} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Delete ${report.name}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
