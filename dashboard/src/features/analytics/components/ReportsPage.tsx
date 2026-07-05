import { Link, useParams } from '@tanstack/react-router';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type { ReportKind, SavedReportSummary } from '../../../lib/api/types';
import { REPORT_KINDS } from '../../../lib/api/types';
import { useDeleteReport, useReports } from '../api';
import { PageShell } from '../../../components/layout/PageShell';

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
                  <ul className="flex flex-col gap-2">
                    {group.map((report) => (
                      <li
                        key={report.id}
                        className="flex items-center gap-2 rounded-md border border-border p-2"
                      >
                        <Link
                          to="/projects/$projectId/reports/$reportId"
                          params={{ projectId, reportId: report.id }}
                          className="flex-1 text-sm font-medium text-accent underline"
                        >
                          {report.name}
                        </Link>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${report.name}`}
                          onClick={() => deleteReport.mutate(report.id)}
                        >
                          Delete
                        </Button>
                      </li>
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
