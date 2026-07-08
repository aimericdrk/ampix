import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { ApiError } from '../../../lib/api/problem';
import type { ReportKind, RetentionInterval } from '../../../lib/api/types';
import { useReport, useRunReport } from '../api';
import { CohortSelect } from './report-actions';
import { PageShell } from '../../../components/layout/PageShell';
import { useRecents } from '../../favorites/recents';
import { analysisResultIsEmpty, ReportChart } from './ReportChart';

const KIND_LABELS: Record<ReportKind, string> = {
  insights: 'Insights',
  funnel: 'Funnel',
  retention: 'Retention',
  flows: 'Flows',
};

export function ReportDetailPage() {
  const { projectId, reportId } = useParams({
    from: '/private/projects/$projectId/reports/$reportId',
  });
  const report = useReport(projectId, reportId);
  const runReport = useRunReport(projectId, reportId);
  const [cohortId, setCohortId] = useState('');
  const recents = useRecents(projectId);
  const recordRecent = recents.record;

  const runReportMutate = runReport.mutate;
  const reportLoadedId = report.data?.id;
  const reportLoadedName = report.data?.name;
  // Run the stored definition once, as soon as the report loads (contracts §16: POST /reports/:id/run).
  useEffect(() => {
    if (!reportLoadedId) return;
    runReportMutate({});
  }, [reportLoadedId, runReportMutate]);

  // Record this visit in Recents (feat-13 §3) once the report's name is known.
  useEffect(() => {
    if (!reportLoadedId || !reportLoadedName) return;
    recordRecent({ type: 'report', id: reportLoadedId, name: reportLoadedName });
  }, [reportLoadedId, reportLoadedName, recordRecent]);

  const handleRun = () => {
    runReportMutate(cohortId ? { cohort_id: cohortId } : {});
  };

  let eventOrder: string[] | undefined;
  let interval: RetentionInterval | undefined;
  if (report.data) {
    if (report.data.kind === 'insights') {
      eventOrder = report.data.definition.events.map((e) => e.name);
    } else if (report.data.kind === 'retention') {
      interval = report.data.definition.interval;
    }
  }

  const result = runReport.data;
  const kind = report.data?.kind;

  return (
    <PageShell
      projectId={projectId}
      title={report.data?.name ?? 'Report'}
      description={kind ? `${KIND_LABELS[kind]} report` : undefined}
      breadcrumbs={[
        { label: 'Reports', to: '/projects/$projectId/reports', params: { projectId } },
        { label: report.data?.name ?? 'Report' },
      ]}
    >
      {report.isPending && <p role="status">Loading report…</p>}
      {report.error && (
        <p role="alert" className="text-danger">
          {report.error instanceof ApiError ? report.error.problem.title : 'Failed to load report'}
        </p>
      )}

      {report.data && (
        <Card>
          <CardHeader>
            <CardTitle>Run</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            {report.data.kind !== 'flows' && (
              <CohortSelect
                projectId={projectId}
                value={cohortId}
                onChange={setCohortId}
                id="report-cohort-filter"
                label="Cohort filter (optional)"
              />
            )}
            <Button onClick={handleRun} disabled={runReport.isPending}>
              {runReport.isPending ? 'Running…' : 'Run report'}
            </Button>
          </CardContent>
        </Card>
      )}

      {runReport.isError && (
        <p role="alert" className="text-danger">
          {runReport.error instanceof ApiError ? runReport.error.problem.title : 'Failed to run the report'}
        </p>
      )}

      {kind && result && analysisResultIsEmpty(kind, result) && (
        <p className="text-text-muted">No data for this report yet.</p>
      )}

      {kind && result && !analysisResultIsEmpty(kind, result) && (
        <ReportChart kind={kind} result={result} interval={interval} eventOrder={eventOrder} />
      )}
    </PageShell>
  );
}
